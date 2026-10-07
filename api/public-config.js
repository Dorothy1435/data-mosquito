// 모기제로 공개 설정 — Vercel 서버리스 함수
// -------------------------------------------------------------
// GET /api/public-config → { enabled, supabaseUrl, supabaseAnonKey }
//   브라우저(auth.js)가 회원가입·로그인·게임 기록에 쓸 Supabase 주소와 공개 키(anon key)를 받아 간다.
//   anon 키는 브라우저에 보여도 되는 키다(행 단위 보안 RLS 가 권한을 막는다). service role 키는 절대 내보내지 않는다.
// 환경변수 (Vercel–Supabase 연동이 자동으로 넣는 이름을 그대로 쓴다):
//   NEXT_PUBLIC_SUPABASE_URL 또는 SUPABASE_URL
//   NEXT_PUBLIC_SUPABASE_ANON_KEY 또는 SUPABASE_ANON_KEY
//   ACCOUNTS_ENABLED=0 이면 (표를 아직 안 만들었을 때 등) 끈다. 없으면 켜진 것으로 본다.

module.exports = function handler(req, res) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
  const enabled = process.env.ACCOUNTS_ENABLED !== '0' && Boolean(url && key);
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');
  res.status(200).json(enabled ? { enabled: true, supabaseUrl: url.replace(/\/$/, ''), supabaseAnonKey: key } : { enabled: false });
};
