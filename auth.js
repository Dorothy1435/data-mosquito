/* =============================================================
   회원가입 · 로그인 · 기록 보내기 (auth.js)  — window.MZAuth
   -------------------------------------------------------------
   Supabase(서버)에 계정과 게임 기록을 둔다. 사이트는 정적 파일이라 브라우저가 Supabase 에 직접 붙는다.
     · 서버 주소와 공개 키(anon key)는 /api/public-config 에서 받는다 (Vercel 환경변수. 코드에 적지 않는다).
       로컬 시험용으로는 config.js 의 window.MOSQUITO_CONFIG.supabase = { url, anonKey } 를 쓴다.
     · 공개 키는 브라우저에 노출돼도 되는 키다. 표 접근 권한은 서버의 행 단위 보안(RLS)과 함수가 막는다.
     · 서버가 준비되지 않았으면(주소 없음) enabled=false 로 두고, 화면은 "준비 중"을 보여 준다. 게임은 그대로 된다.
     · 기록 보내기는 도전이 끝날 때 한 번(submitRuns). 서버 함수(submit_game_runs)가 말이 되는 기록인지 검사한다.
   표·함수 정의: supabase/game-schema.sql
   ============================================================= */
(function () {
  'use strict';
  const CFG = window.MZ_GAME_CONFIG || {};
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
  let client = null;
  let session = null;
  let profile = null;      // { id, nickname, role }
  let status = 'loading';  // loading · off(서버 없음) · ready · error
  let lastError = '';

  function emit() {
    markStaffNav();
    document.dispatchEvent(new CustomEvent('auth:changed', { detail: { user: user(), profile, status } }));
  }
  // 직원 계정으로 로그인하면 상단 메뉴에 '전문가용' 버튼이 생긴다 (시민에게는 보이지 않는다)
  function markStaffNav() {
    const nav = document.getElementById('primaryNav'); if (!nav) return;
    const staff = !!(profile && profile.role === 'staff');
    let a = nav.querySelector('a[data-staff-link]');
    if (staff && !a) {
      a = document.createElement('a'); a.href = 'expert.html'; a.className = 'lk-pro'; a.dataset.staffLink = '1';
      a.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6Z"/></svg>전문가용';
      if (location.pathname.endsWith('/expert.html')) a.setAttribute('aria-current', 'page');
      nav.appendChild(a);
    } else if (!staff && a) a.remove();
  }
  function user() { return session && session.user ? session.user : null; }

  // 1) 설정 받기 (서버 → 없으면 로컬 config.js)
  async function loadConfig() {
    try {
      const r = await fetch(CFG.PUBLIC_CONFIG_URL || '/api/public-config', { cache: 'no-store' });
      if (r.ok) { const j = await r.json(); if (j && j.enabled && j.supabaseUrl && j.supabaseAnonKey) return { url: j.supabaseUrl, key: j.supabaseAnonKey }; }
    } catch (e) { /* 로컬 파일 열기 등: 아래로 */ }
    const local = window.MOSQUITO_CONFIG && window.MOSQUITO_CONFIG.supabase;
    if (local && local.url && local.anonKey) return { url: local.url, key: local.anonKey };
    return null;
  }
  // 2) Supabase 라이브러리 읽기 (설정이 있을 때만)
  function loadSdk() {
    return new Promise((resolve, reject) => {
      if (window.supabase && window.supabase.createClient) { resolve(); return; }
      const s = document.createElement('script'); s.src = SDK_URL; s.async = true;
      s.onload = () => resolve(); s.onerror = () => reject(new Error('sdk'));
      document.head.appendChild(s);
    });
  }
  async function loadProfile() {
    const u = user(); if (!u || !client) { profile = null; return; }
    const { data } = await client.from('profiles').select('id, nickname, role').eq('id', u.id).maybeSingle();
    profile = data || null;
  }

  const ready = (async () => {
    const conf = await loadConfig();
    if (!conf) { status = 'off'; emit(); return; }
    try {
      await loadSdk();
      client = window.supabase.createClient(conf.url, conf.key, { auth: { persistSession: true, autoRefreshToken: true } });
      const { data } = await client.auth.getSession();
      session = data.session || null;
      await loadProfile();
      status = 'ready';
      client.auth.onAuthStateChange(async (_ev, s) => { session = s; await loadProfile(); emit(); });
    } catch (e) { status = 'error'; lastError = String(e && e.message || e); }
    emit();
  })();

  // 회원가입: 이메일 + 비밀번호 + 닉네임. 닉네임은 서버 트리거가 profiles 에 넣는다
  async function signUp(email, password, nickname) {
    if (!client) throw new Error('서버가 아직 연결되지 않았어요.');
    const nick = String(nickname || '').trim();
    if (nick.length < 2 || nick.length > 12) throw new Error('닉네임은 2~12자로 적어 주세요.');
    const { data, error } = await client.auth.signUp({ email, password, options: { data: { nickname: nick } } });
    if (error) throw new Error(koError(error));
    session = data.session || null;
    await loadProfile(); emit();
    return { needsConfirm: !data.session };   // 이메일 확인을 켜 둔 경우 세션이 바로 안 생긴다
  }
  async function signIn(email, password) {
    if (!client) throw new Error('서버가 아직 연결되지 않았어요.');
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(koError(error));
    session = data.session; await loadProfile(); emit();
  }
  async function signOut() {
    if (!client) return;
    await client.auth.signOut();
    session = null; profile = null; emit();
  }
  // 도전 기록 보내기: 서버 함수가 검사한 뒤 누적에 더한다. 돌려주는 값: { ok, accepted, total_kills, best_stage, badges }
  async function submitRuns(runs) {
    if (!client || !user()) return { ok: false, reason: 'no-login' };
    const rows = (runs || []).map((r) => ({ stage: r.stage, kills: r.kills, duration_ms: r.ms, success: !!r.ok, played_at: r.at }));
    const { data, error } = await client.rpc('submit_game_runs', { p_runs: rows });
    if (error) { lastError = koError(error); return { ok: false, reason: lastError }; }
    if (window.MZGame && data) window.MZGame.mergeServer(data);
    return Object.assign({ ok: true }, data || {});
  }
  // 내 시즌 기록 (서버 기준)
  async function myScore() {
    if (!client || !user()) return null;
    const { data } = await client.from('game_scores').select('total_kills, best_stage, runs, season').eq('user_id', user().id).eq('season', CFG.SEASON || new Date().getFullYear()).maybeSingle();
    return data || null;
  }
  async function myBadges() {
    if (!client || !user()) return [];
    const { data } = await client.from('user_badges').select('badge_id, earned_at').eq('user_id', user().id);
    return data || [];
  }
  // 랭킹: 공개 보기(닉네임·누적·최고 단계). 서버가 5분마다 만들어 둔 표를 읽는다
  async function ranking(limit) {
    if (!client) return [];
    const { data } = await client.from('ranking_public').select('rank, nickname, total_kills, best_stage, badge_count').eq('season', CFG.SEASON || new Date().getFullYear()).order('rank', { ascending: true }).limit(limit || 100);
    return data || [];
  }
  async function myRank() {
    if (!client || !user() || !profile) return null;
    const { data } = await client.from('ranking_public').select('rank, total_kills').eq('season', CFG.SEASON || new Date().getFullYear()).eq('nickname', profile.nickname).maybeSingle();
    return data || null;
  }
  function koError(err) {
    const m = String(err && err.message || err || '');
    if (/already registered|already exists/i.test(m)) return '이미 가입된 이메일이에요.';
    if (/invalid login|invalid credentials/i.test(m)) return '이메일 또는 비밀번호가 맞지 않아요.';
    if (/password/i.test(m) && /6|short|weak/i.test(m)) return '비밀번호는 6자 이상으로 해 주세요.';
    if (/email not confirmed/i.test(m)) return '이메일 확인이 아직 안 됐어요. 받은 메일의 링크를 눌러 주세요.';
    if (/nickname/i.test(m) && /unique|duplicate/i.test(m)) return '이미 쓰는 닉네임이에요.';
    if (/rate limit|too many/i.test(m)) return '요청이 너무 많아요. 잠시 뒤 다시 해 주세요.';
    if (/daily|limit/i.test(m)) return '오늘 도전 횟수를 다 썼어요.';
    return m || '알 수 없는 오류';
  }

  window.MZAuth = {
    get enabled() { return status === 'ready'; },
    get status() { return status; },
    get lastError() { return lastError; },
    ready, user, profile: () => profile,
    isStaff: () => !!(profile && profile.role === 'staff'),
    signUp, signIn, signOut, submitRuns, myScore, myBadges, ranking, myRank,
  };
}());
