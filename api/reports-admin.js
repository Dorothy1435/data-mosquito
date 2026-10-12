// 모기제로 시민 제보 보기 (직원 전용) — Vercel 서버리스 함수
// -------------------------------------------------------------
// GET /api/reports-admin?days=30            → { ok, rows: [...], byDistrict: {...} }
// GET /api/reports-admin?days=30&format=csv → CSV 파일 (엑셀에서 열 수 있게 BOM 포함)
//   요청 머리글: Authorization: Bearer <로그인한 사람의 Supabase 접속 토큰>
// 권한: 서버가 토큰으로 사람을 확인하고, profiles.role 이 'staff' 일 때만 준다.
//   (화면에서 버튼을 숨기는 것만으로는 막을 수 없으므로 서버에서 확인한다 — 2026-10-12 보안 점검)
// 개인을 알아볼 수 있는 정보는 표에 없다(누가 보냈는지 저장하지 않음).

const MAX_ROWS = 5000;

function supabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/$/, ''), key } : null;
}

// 토큰으로 사람을 확인하고 직원인지 본다. 직원이면 true
async function isStaff(db, token) {
  if (!token) return false;
  try {
    const u = await fetch(`${db.url}/auth/v1/user`, { headers: { apikey: db.key, Authorization: `Bearer ${token}` } });
    if (!u.ok) return false;
    const user = await u.json();
    if (!user || !user.id) return false;
    const p = await fetch(`${db.url}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role`, {
      headers: { apikey: db.key, Authorization: `Bearer ${db.key}` },
    });
    const rows = p.ok ? await p.json() : [];
    return Array.isArray(rows) && rows[0] && rows[0].role === 'staff';
  } catch (_) { return false; }
}

const COLS = ['id', 'created_at', 'kind', 'district', 'bite_when', 'bite_count', 'source', 'precision', 'lat', 'lng', 'photo_label', 'review'];
const KIND_KO = { mosquito: '모기 봤어요', bite: '물렸어요', breeding: '고인 물' };

function toCsv(rows) {
  const head = ['번호', '시각', '종류', '동', '언제', '몇 군데', '위치 방법', '위치 자세함', '위도(100m)', '경도(100m)', '사진 판별', '보건소 확인'];
  const esc = (v) => {
    const t = v == null ? '' : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const lines = rows.map((r) => COLS.map((c) => esc(c === 'kind' ? KIND_KO[r.kind] || r.kind : r[c])).join(','));
  return '﻿' + [head.join(','), ...lines].join('\r\n');
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const db = supabase();
  if (!db) { res.status(200).json({ ok: false, message: '제보 저장소가 아직 연결되지 않았어요.' }); return; }
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!(await isStaff(db, token))) { res.status(403).json({ ok: false, message: '직원 계정으로 로그인해야 볼 수 있어요.' }); return; }

  const q = req.query || {};
  const days = Math.min(365, Math.max(1, parseInt(q.days, 10) || 30));
  const since = new Date(Date.now() - days * 86400000).toISOString();
  try {
    const r = await fetch(`${db.url}/rest/v1/reports?select=${COLS.join(',')}&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=${MAX_ROWS}`, {
      headers: { apikey: db.key, Authorization: `Bearer ${db.key}` },
    });
    if (!r.ok) { res.status(200).json({ ok: false, message: '제보를 불러오지 못했어요. (표를 만들었는지 확인해 주세요)' }); return; }
    const rows = await r.json();
    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="mosquito-reports-${days}d.csv"`);
      res.status(200).send(toCsv(rows));
      return;
    }
    // 동별 · 종류별 개수
    const byDistrict = {};
    rows.forEach((row) => {
      const d = byDistrict[row.district] || (byDistrict[row.district] = { bite: 0, mosquito: 0, breeding: 0 });
      d[row.kind] = (d[row.kind] || 0) + 1;
    });
    res.status(200).json({ ok: true, days, total: rows.length, byDistrict, rows: rows.slice(0, 200) });
  } catch (_) {
    res.status(200).json({ ok: false, message: '제보를 불러오지 못했어요.' });
  }
};
