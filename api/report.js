// 모기제로 시민 제보 — Vercel 서버리스 함수
// -------------------------------------------------------------
// POST /api/report  { kind: 'mosquito'|'bite'|'breeding', lat, lng, source: 'gps'|'pick', photoLabel? }
//   → 위치를 약 100m 로 반올림하고 가장 가까운 동을 붙여 Supabase reports 표에 넣는다.
// GET  /api/report  → 최근 14일 동 단위 제보 개수 (공개 지도용, 정확한 위치 없음)
//
// 저장 스위치: Vercel 환경변수 REPORT_STORE_ENABLED=1 일 때만 저장한다.
//   위치정보법 절차(위치기반서비스사업 신고, 개인위치정보 이용약관·동의)를 마치기 전에는 켜지 않는다.
//   스위치가 꺼져 있으면 { stored: false } 만 돌려주고 아무것도 저장하지 않는다.
// 필요한 환경변수 (Vercel–Supabase 연동이 자동으로 넣어 준다): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   service role 키는 이 서버에서만 쓰고 브라우저로 보내지 않는다.
// 누가 보냈는지(IP·기기)는 저장하지 않는다. 오류 기록에도 위치를 남기지 않는다.

const model = require('../mosquito-model.js');

const KINDS = ['mosquito', 'bite', 'breeding'];
const LABELS = ['흰줄숲모기', '얼룩날개모기', '집모기류', '모기 아님', '알 수 없음'];
const BOUNDS = { minLat: 35.13, maxLat: 35.40, minLng: 128.68, maxLng: 129.05 };

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
    if (!enabled) { res.status(200).json({ ok: true, stored: false, items: [] }); return; }
    try {
      const r = await fetch(`${db.url}/rest/v1/reports_public?select=district,kind,n,last_at`, {
        headers: { apikey: db.key, Authorization: `Bearer ${db.key}` },
      });
      const items = r.ok ? await r.json() : [];
      res.setHeader('Cache-Control', 's-maxage=300');
      res.status(200).json({ ok: true, stored: true, items });
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
  const lat = Number(body.lat), lng = Number(body.lng);
  const source = body.source === 'pick' ? 'pick' : 'gps';
  const photoLabel = LABELS.includes(body.photoLabel) ? body.photoLabel : null;
  if (!kind) { res.status(400).json({ ok: false, message: '무엇을 제보할지 골라 주세요.' }); return; }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)
    || lat < BOUNDS.minLat || lat > BOUNDS.maxLat || lng < BOUNDS.minLng || lng > BOUNDS.maxLng) {
    res.status(400).json({ ok: false, message: '김해 안에서만 제보할 수 있어요.' }); return;
  }

  if (!enabled) {
    // 시험판: 저장하지 않는다
    res.status(200).json({ ok: true, stored: false, message: '시험판이라 저장되지 않았어요.' });
    return;
  }

  // 약 100m 로 반올림 — 정확한 위치는 저장하지 않는다
  const row = {
    kind,
    lat: Math.round(lat * 1000) / 1000,
    lng: Math.round(lng * 1000) / 1000,
    district: model.nearestDistrict(lat, lng),
    source,
    photo_label: photoLabel,
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
