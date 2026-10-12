// 호출 한도 (api/ask.js · api/identify.js · api/report.js 가 함께 쓴다)
// -------------------------------------------------------------
// 같은 사람이 너무 자주 부르거나, 하루 전체 호출이 너무 많으면 막는다.
//   · 챗봇·사진 판별은 AI 회사 요금이 나가고, 제보는 가짜 제보로 통계가 망가질 수 있어서다.
//   · Supabase 가 연결돼 있으면 표(api_limits)에서 센다 → 서버가 여러 대로 늘어나도 함께 센다.
//     표·함수: supabase/limits.sql. 연결이 없거나 실패하면 이 서버의 메모리에서만 센다(완벽하진 않지만 막아 준다).
//   · IP 주소는 저장하지 않는다. 하루마다 바뀌는 해시로 바꿔서 세기만 한다.
// (파일 이름이 _ 로 시작하면 Vercel 이 이 파일을 별도 주소로 열지 않는다)
const crypto = require('crypto');

const memory = new Map();   // 키 → { n, reset }

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  const first = String(Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0].trim();
  return first || (req.socket && req.socket.remoteAddress) || 'unknown';
}

// IP 를 그대로 두지 않고 '날짜 + 비밀값'과 섞은 해시로 바꾼다 (다음 날이면 다른 값)
function anonId(req) {
  const day = new Date().toISOString().slice(0, 10);
  return crypto.createHash('sha256').update(`${day}|${process.env.LIMIT_SALT || 'mosquito-zero'}|${clientIp(req)}`).digest('hex').slice(0, 24);
}

function memoryHit(key, windowSec, max) {
  const now = Date.now();
  let e = memory.get(key);
  if (!e || now > e.reset) { e = { n: 0, reset: now + windowSec * 1000 }; memory.set(key, e); }
  e.n += 1;
  if (memory.size > 5000) for (const [k, v] of memory) if (now > v.reset) memory.delete(k);
  return e.n <= max;
}

// Supabase 함수 api_limit_hit 로 센다. 연결이 없거나 실패하면 null (→ 메모리로 센다)
async function dbHit(key, windowSec, max) {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return null;
  try {
    const r = await fetch(`${url}/rest/v1/rpc/api_limit_hit`, {
      method: 'POST',
      headers: { apikey: svc, Authorization: `Bearer ${svc}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_key: key, p_window: windowSec, p_max: max }),
    });
    if (!r.ok) return null;
    return (await r.json()) === true;
  } catch (_) { return null; }
}

/**
 * 한도 안이면 true, 넘었으면 false.
 * rules: { perMin, perDay, allPerDay } — 한 사람 1분 · 한 사람 하루 · 전체 하루 (빠진 항목은 검사 안 함)
 */
async function allow(req, name, rules) {
  const id = anonId(req);
  const checks = [
    [`${name}:m:${id}`, 60, rules.perMin],
    [`${name}:d:${id}`, 86400, rules.perDay],
    [`${name}:all`, 86400, rules.allPerDay],
  ].filter((c) => c[2]);
  const results = await Promise.all(checks.map(async ([key, win, max]) => {
    const ok = await dbHit(key, win, max);
    return ok === null ? memoryHit(key, win, max) : ok;
  }));
  return results.every(Boolean);
}

// 디버그 정보(오류 원문·모델 목록)는 서버 비밀값 DEBUG_TOKEN 을 아는 사람에게만 보여 준다
function debugAllowed(value) {
  const token = process.env.DEBUG_TOKEN;
  return Boolean(token) && String(value || '') === token;
}

module.exports = { allow, debugAllowed };
