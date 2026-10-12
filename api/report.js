// 모기제로 시민 제보 — Vercel 서버리스 함수
// -------------------------------------------------------------
// POST /api/report  { kind: 'mosquito'|'bite'|'breeding', district?, lat?, lng?, source: 'gps'|'pick', when?, count?, photoLabel? }
//   → Supabase reports 표에 넣는다. 위치 저장 방식은 환경변수 REPORT_PRECISION 으로 고른다.
//      district (기본): 동 이름만 저장. 브라우저도 좌표를 보내지 않고 폰 안에서 동 이름으로 바꿔 보낸다.
//      100m          : 약 100m 로 반올림한 좌표 + 동. (위치정보법 절차를 마친 뒤에만)
// GET  /api/report  → { stored, precision, items: 최근 14일 동 단위 제보 개수 } (공개 지도용, 정확한 위치 없음)
//
// 저장 스위치: Vercel 환경변수 REPORT_STORE_ENABLED=1 일 때만 저장한다.
//   위치정보법 절차(위치기반서비스사업 신고, 개인위치정보 이용약관·동의)를 마치기 전에는 켜지 않는다.
//   스위치가 꺼져 있으면 { stored: false } 만 돌려주고 아무것도 저장하지 않는다.
// 필요한 환경변수 (Vercel–Supabase 연동이 자동으로 넣어 준다): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   service role 키는 이 서버에서만 쓰고 브라우저로 보내지 않는다.
// 누가 보냈는지(IP·기기)는 저장하지 않는다. 오류 기록에도 위치를 남기지 않는다.

const model = require('../mosquito-model.js');
const limit = require('./_limit.js');

const KINDS = ['mosquito', 'bite', 'breeding'];
const LABELS = ['흰줄숲모기', '얼룩날개모기', '집모기류', '모기 아님', '알 수 없음'];
const BOUNDS = { minLat: 35.13, maxLat: 35.40, minLng: 128.68, maxLng: 129.05 };
const WHENS = ['방금', '1시간 안', '오늘', '어제'];
const COUNTS = ['1군데', '2~3군데', '4군데 이상'];
const DISTRICT_NAMES = Object.keys(model.COORDS);
// 위치 저장 방식: 기본은 동 단위
const precisionMode = () => (process.env.REPORT_PRECISION === '100m' ? '100m' : 'district');

function supabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/$/, ''), key } : null;
}

module.exports = async function handler(req, res) {
  const db = supabase();
  const enabled = process.env.REPORT_STORE_ENABLED === '1' && db;

  // 공개 지도용 집계
  if (req.method === 'GET') {
    if (!enabled) { res.status(200).json({ ok: true, stored: false, precision: precisionMode(), items: [] }); return; }
    try {
      const r = await fetch(`${db.url}/rest/v1/reports_public?select=district,kind,n,last_at`, {
        headers: { apikey: db.key, Authorization: `Bearer ${db.key}` },
      });
      const items = r.ok ? await r.json() : [];
      res.setHeader('Cache-Control', 's-maxage=300');
      res.status(200).json({ ok: true, stored: true, precision: precisionMode(), items });
    } catch (e) {
      res.status(200).json({ ok: false, stored: true, items: [] });
    }
    return;
  }

  if (req.method !== 'POST') { res.status(405).json({ ok: false, message: 'POST만 허용됩니다.' }); return; }

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); }
  catch (_) { res.status(400).json({ ok: false, message: '제보 내용을 읽지 못했어요.' }); return; }

  const kind = KINDS.includes(body.kind) ? body.kind : null;
  const source = body.source === 'pick' ? 'pick' : 'gps';
  const photoLabel = LABELS.includes(body.photoLabel) ? body.photoLabel : null;
  const biteWhen = kind === 'bite' && WHENS.includes(body.when) ? body.when : null;
  const biteCount = kind === 'bite' && COUNTS.includes(body.count) ? body.count : null;
  if (!kind) { res.status(400).json({ ok: false, message: '무엇을 제보할지 골라 주세요.' }); return; }
  // 위치: 동 이름(기본) 또는 좌표. 좌표가 오면 김해 안인지 확인하고 가장 가까운 동을 붙인다
  const lat = Number(body.lat), lng = Number(body.lng);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= BOUNDS.minLat && lat <= BOUNDS.maxLat && lng >= BOUNDS.minLng && lng <= BOUNDS.maxLng;
  const district = DISTRICT_NAMES.includes(body.district) ? body.district : (hasCoords ? model.nearestDistrict(lat, lng) : null);
  if (!district) { res.status(400).json({ ok: false, message: '김해 안에서만 제보할 수 있어요.' }); return; }

  // 반복 제보 막기: 한 사람 1분 3건 · 하루 30건, 사이트 전체 하루 20,000건
  if (!(await limit.allow(req, 'report', { perMin: 3, perDay: 30, allPerDay: 20000 }))) {
    res.status(200).json({ ok: false, stored: false, limited: true, message: '제보가 너무 잦아요. 잠시 후 다시 알려 주세요.' });
    return;
  }

  if (!enabled) {
    // 시험판: 저장하지 않는다
    res.status(200).json({ ok: true, stored: false, message: '시험판이라 저장되지 않았어요.' });
    return;
  }

  // 동 단위(기본): 좌표는 저장하지 않는다. 100m 방식: 약 100m 로 반올림 — 정확한 위치는 저장하지 않는다
  const keepCoords = precisionMode() === '100m' && hasCoords;
  const row = {
    kind,
    lat: keepCoords ? Math.round(lat * 1000) / 1000 : null,
    lng: keepCoords ? Math.round(lng * 1000) / 1000 : null,
    district,
    source,
    precision: keepCoords ? '100m' : 'district',
    photo_label: photoLabel,
    bite_when: biteWhen,
    bite_count: biteCount,
  };
  try {
    const r = await fetch(`${db.url}/rest/v1/reports`, {
      method: 'POST',
      headers: { apikey: db.key, Authorization: `Bearer ${db.key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      console.error('제보 저장 실패', r.status);   // 위치·내용은 기록하지 않는다
      res.status(200).json({ ok: false, stored: false, message: '지금은 제보를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.' });
      return;
    }
    res.status(200).json({ ok: true, stored: true, district: row.district, message: `${row.district}에 제보했어요. 보건소가 확인할게요.` });
  } catch (e) {
    console.error('제보 저장 오류');
    res.status(200).json({ ok: false, stored: false, message: '지금은 제보를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.' });
  }
};
