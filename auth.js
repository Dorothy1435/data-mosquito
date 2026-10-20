/* =============================================================
   회원가입 · 로그인 · 계정 관리 · 기록 보내기 (auth.js)  — window.MZAuth
   -------------------------------------------------------------
   로그인하지 않아도 모든 기능을 쓸 수 있다. 로그인은 랭킹(기록 경쟁)과 기록을 다른 기기로 옮길 때만 필요하다.
   로그인 전 기록은 이 브라우저에 쌓이고(game.js), 로그인하면 서버(Supabase)로 올린다.

     · 서버 주소·공개 키·캡차 키·소셜 로그인 목록은 /api/public-config 에서 받는다 (Vercel 환경변수. 코드에 적지 않는다).
       로컬 시험용으로는 config.js 의 window.MOSQUITO_CONFIG.supabase = { url, anonKey } 를 쓴다.
     · 공개 키는 브라우저에 노출돼도 되는 키다. 표 접근 권한은 서버의 행 단위 보안(RLS)과 함수가 막는다.
     · 서버가 준비되지 않았으면(주소 없음) status='off' 로 두고, 화면은 "준비 중"을 보여 준다.
     · 봇·AI 자동 가입 막기: 캡차 키가 있으면 가입·로그인·비밀번호 찾기 때 Cloudflare Turnstile 토큰을 같이 보낸다.
       (토큰 검사는 Supabase 가 한다: 대시보드 → Authentication → Bot and Abuse Protection)
     · 가입 마무리: 필수 동의(만 14세 이상·이용약관·개인정보)와 닉네임을 마쳐야 랭킹에 기록이 올라간다.
       구글·카카오로 처음 들어온 사람도 이 단계를 거친다.
   표·함수 정의: supabase/game-schema.sql, supabase/account-schema.sql
   ============================================================= */
(function () {
  'use strict';
  const CFG = window.MZ_GAME_CONFIG || {};
  // 약관·처리방침 판. 문서를 크게 고치면 날짜를 바꾸고, 바뀐 판에 다시 동의를 받는다
  const POLICY_VERSION = '2026-10-20';
  // 버전을 정확히 고정하고 무결성 값(SRI)을 붙인다. 외부 서버의 파일이 바뀌면 브라우저가 실행을 거부한다 (2026-10-12 보안 점검)
  // 버전을 올릴 때는 새 파일의 sha384 값을 다시 계산해 SDK_SRI 도 함께 바꾼다
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js';
  const SDK_SRI = 'sha384-BWcjm9OdFth9TbhCxZPdm+gAOUMAzQy9nmTs12ioXdCcbVnJaPMn+fMUoQCLt60R';
  let client = null;
  let session = null;
  let profile = null;      // { id, nickname, role, onboarded_at, nickname_changed_at }
  let status = 'loading';  // loading · off(서버 없음) · ready · error
  let lastError = '';
  let conf = null;         // { url, key, turnstile, providers }
  let recovering = false;  // 비밀번호 재설정 메일의 링크로 들어온 상태

  function emit() {
    markStaffNav();
    // 직원 계정이면 <html class="is-staff"> — 전문가용 버튼·화면은 이 표시가 있을 때만 보인다 (design.css)
    // 다른 화면에서도 바로 쓰게 이 기기에 기억한다(mz-staff). 로그아웃·직원 아님이면 지운다
    if (status !== 'loading') {
      const staff = !!(profile && profile.role === 'staff');
      document.documentElement.classList.toggle('is-staff', staff);
      try { if (staff) localStorage.setItem('mz-staff', '1'); else localStorage.removeItem('mz-staff'); } catch (e) { /* 무시 */ }
    }
    document.dispatchEvent(new CustomEvent('auth:changed', { detail: { user: user(), profile, status } }));
  }
  // 직원 계정으로 로그인하면 상단 메뉴에 '전문가용' 버튼이 생긴다 (메뉴에 이미 있으면 그대로)
  function markStaffNav() {
    const nav = document.getElementById('primaryNav'); if (!nav) return;
    const staff = !!(profile && profile.role === 'staff');
    if (nav.querySelector('a[href="expert.html"]:not([data-staff-link])')) return;
    let a = nav.querySelector('a[data-staff-link]');
    if (staff && !a) {
      a = document.createElement('a'); a.href = 'expert.html'; a.className = 'lk-pro'; a.dataset.staffLink = '1';
      a.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6Z"/></svg>전문가용';
      if (location.pathname.endsWith('/expert.html')) a.setAttribute('aria-current', 'page');
      nav.appendChild(a);
    } else if (!staff && a) a.remove();
  }
  function user() { return session && session.user ? session.user : null; }
  function need() { if (!client) throw new Error('서버가 아직 연결되지 않았어요.'); }
  function needUser() { need(); if (!user()) throw new Error('먼저 로그인해 주세요.'); }

  // 1) 설정 받기 (서버 → 없으면 로컬 config.js)
  async function loadConfig() {
    try {
      const r = await fetch(CFG.PUBLIC_CONFIG_URL || '/api/public-config', { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        if (j && j.enabled && j.supabaseUrl && j.supabaseAnonKey) {
          return { url: j.supabaseUrl, key: j.supabaseAnonKey, turnstile: j.turnstileSiteKey || '', providers: Array.isArray(j.providers) ? j.providers : [] };
        }
      }
    } catch (e) { /* 로컬 파일 열기 등: 아래로 */ }
    // 이 PC에서 시험할 때만(localhost) config.js 를 읽는다. config.js 는 깃에 올리지 않는 파일이라 실제 사이트에는 없다
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !(window.MOSQUITO_CONFIG && window.MOSQUITO_CONFIG.supabase)) {
      await new Promise((resolve) => { const s = document.createElement('script'); s.src = 'config.js'; s.onload = s.onerror = () => resolve(); document.head.appendChild(s); });
    }
    const local = window.MOSQUITO_CONFIG && window.MOSQUITO_CONFIG.supabase;
    if (local && local.url && local.anonKey) return { url: local.url, key: local.anonKey, turnstile: local.turnstileSiteKey || '', providers: local.providers || [] };
    return null;
  }
  // 2) Supabase 라이브러리 읽기 (설정이 있을 때만)
  function loadSdk() {
    return new Promise((resolve, reject) => {
      if (window.supabase && window.supabase.createClient) { resolve(); return; }
      const s = document.createElement('script'); s.src = SDK_URL; s.async = true;
      s.integrity = SDK_SRI; s.crossOrigin = 'anonymous';
      s.onload = () => resolve(); s.onerror = () => reject(new Error('sdk'));
      document.head.appendChild(s);
    });
  }
  async function loadProfile() {
    const u = user(); if (!u || !client) { profile = null; return; }
    const { data } = await client.from('profiles').select('id, nickname, role, onboarded_at, nickname_changed_at').eq('id', u.id).maybeSingle();
    profile = data || null;
  }

  const ready = (async () => {
    conf = await loadConfig();
    if (!conf) { status = 'off'; emit(); return; }
    try {
      await loadSdk();
      client = window.supabase.createClient(conf.url, conf.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
      client.auth.onAuthStateChange(async (ev, s) => {
        if (ev === 'PASSWORD_RECOVERY') recovering = true;
        session = s; await loadProfile(); emit();
      });
      const { data } = await client.auth.getSession();
      session = data.session || null;
      await loadProfile();
      status = 'ready';
    } catch (e) { status = 'error'; lastError = String(e && e.message || e); }
    emit();
  })();

  // ---------- 가입 · 로그인 ----------
  // 회원가입: 이메일 + 비밀번호 + 닉네임 + 필수 동의. 이메일 확인은 끈다(대시보드 설정) → 가입하면 바로 로그인된다
  async function signUp({ email, password, nickname, consents, captchaToken }) {
    need();
    checkPassword(password);
    const nick = String(nickname || '').trim();
    if (!validNickname(nick)) throw new Error('닉네임은 2~12자 한글·영문·숫자로 적어 주세요.');
    const { data, error } = await client.auth.signUp({ email, password, options: { data: { nickname: nick }, captchaToken } });
    if (error) throw new Error(koError(error));
    session = data.session || null;
    if (session) {
      await finishOnboarding(nick, consents);   // 가입과 동시에 동의 기록
    }
    await loadProfile(); emit();
    return { needsConfirm: !data.session };   // 대시보드에서 이메일 확인을 켜 두면 세션이 바로 안 생긴다
  }
  async function signIn({ email, password, captchaToken }) {
    need();
    const { data, error } = await client.auth.signInWithPassword({ email, password, options: { captchaToken } });
    if (error) throw new Error(koError(error));
    session = data.session; await loadProfile(); emit();
  }
  // 구글·카카오: 그 회사 로그인 화면으로 갔다가 돌아온다. 돌아온 주소의 정보는 라이브러리가 읽는다(detectSessionInUrl)
  async function signInWith(provider) {
    need();
    if (!(conf.providers || []).includes(provider)) throw new Error('이 로그인 방법은 아직 준비 중이에요.');
    const back = location.origin + location.pathname;
    const { error } = await client.auth.signInWithOAuth({ provider, options: { redirectTo: back } });
    if (error) throw new Error(koError(error));
  }
  async function signOut(everywhere) {
    if (!client) return;
    await client.auth.signOut(everywhere ? { scope: 'global' } : undefined);
    session = null; profile = null; recovering = false; emit();
  }

  // ---------- 가입 마무리 · 동의 ----------
  // consents: { age14, terms, privacy, location, motion } (true/false). 필수 셋이 모두 true 여야 한다
  function consentItems(consents) {
    const c = consents || {};
    return ['age14', 'terms', 'privacy', 'location', 'motion', 'photo_donate'].filter((k) => k in c)
      .map((k) => ({ kind: k, version: POLICY_VERSION, agreed: !!c[k] }));
  }
  async function finishOnboarding(nickname, consents) {
    needUser();
    const c = consents || {};
    if (!c.age14 || !c.terms || !c.privacy) throw new Error('필수 항목(만 14세 이상, 이용약관, 개인정보 수집·이용)에 동의해 주세요.');
    const { error } = await client.rpc('finish_onboarding', { p_nickname: String(nickname || '').trim(), p_items: consentItems(c) });
    if (error) throw new Error(koError(error));
    await loadProfile(); emit();
  }
  function needsOnboarding() { return !!(user() && profile && !profile.onboarded_at); }
  async function myConsents() {
    if (!client || !user()) return {};
    const { data } = await client.from('my_consents').select('kind, version, agreed, created_at');
    const out = {}; (data || []).forEach((r) => { out[r.kind] = r; });
    return out;
  }
  // 선택 동의(위치·움직임 센서) 바꾸기·철회. 기록은 지우지 않고 새 줄을 더한다
  async function setConsent(kind, agreed) {
    needUser();
    if (['age14', 'terms', 'privacy'].includes(kind)) throw new Error('필수 동의는 철회 대신 계정 삭제로 처리돼요.');
    const { error } = await client.rpc('record_consents', { p_items: [{ kind, version: POLICY_VERSION, agreed: !!agreed }] });
    if (error) throw new Error(koError(error));
  }

  // ---------- 계정 관리 ----------
  // 이메일·비밀번호로 가입한 계정인지 (구글·카카오만 쓰는 계정은 비밀번호가 없다)
  function hasPassword() {
    const u = user(); if (!u) return false;
    const ids = u.identities || [];
    return ids.some((i) => i.provider === 'email') || (u.app_metadata && u.app_metadata.provider === 'email');
  }
  function loginMethods() {
    const u = user(); if (!u) return [];
    return Array.from(new Set((u.identities || []).map((i) => i.provider).concat(u.app_metadata && u.app_metadata.providers || [])));
  }
  // 비밀번호를 잊었을 때: 재설정 메일 보내기 → 메일 링크로 돌아오면 recovering=true → updatePassword
  async function sendPasswordReset(email, captchaToken) {
    need();
    const { error } = await client.auth.resetPasswordForEmail(String(email || '').trim(), { redirectTo: location.origin + '/me.html', captchaToken });
    if (error) throw new Error(koError(error));
  }
  // 비밀번호 바꾸기. 로그인 상태에서 바꿀 때는 지금 비밀번호를 한 번 더 확인한다(남이 잠깐 폰을 잡았을 때 대비)
  async function changePassword(currentPassword, newPassword, captchaToken) {
    needUser();
    checkPassword(newPassword);
    if (!recovering) {
      const { error: e1 } = await client.auth.signInWithPassword({ email: user().email, password: currentPassword, options: { captchaToken } });
      if (e1) throw new Error('지금 비밀번호가 맞지 않아요.');
    }
    const { error } = await client.auth.updateUser({ password: newPassword });
    if (error) throw new Error(koError(error));
    recovering = false; emit();
  }
  async function changeNickname(nickname) {
    needUser();
    const nick = String(nickname || '').trim();
    if (!validNickname(nick)) throw new Error('닉네임은 2~12자 한글·영문·숫자로 적어 주세요.');
    const { error } = await client.rpc('change_nickname', { p_nickname: nick });
    if (error) throw new Error(koError(error));
    await loadProfile(); emit();
  }
  // 계정 삭제: 서버의 계정과 모든 기록(게임·배지·동의)을 바로 지운다
  async function deleteAccount() {
    needUser();
    // 기증한 사진 파일을 먼저 지운다 (Supabase 는 SQL 로 저장소 파일을 지우지 못하게 막아 둠)
    try {
      const dir = user().id;
      const { data: files } = await client.storage.from(PHOTO_BUCKET).list(dir, { limit: 1000 });
      if (files && files.length) await client.storage.from(PHOTO_BUCKET).remove(files.map((f) => `${dir}/${f.name}`));
    } catch (e) { /* 사진이 없거나 저장소가 아직 없으면 넘어간다 */ }
    const { error } = await client.rpc('delete_my_account');
    if (error) throw new Error(koError(error));
    try { await client.auth.signOut({ scope: 'local' }); } catch (e) { /* 계정이 이미 없음 */ }
    session = null; profile = null; emit();
  }
  // 내 정보 내려받기(열람권): 서버에 있는 내 정보를 한 파일로
  async function exportMyData() {
    needUser();
    const uid = user().id;
    const [p, scores, runs, badges, consents, jogs, photos] = await Promise.all([
      client.from('profiles').select('nickname, role, created_at, onboarded_at, nickname_changed_at').eq('id', uid).maybeSingle(),
      client.from('game_scores').select('*').eq('user_id', uid),
      client.from('game_runs').select('stage, kills, duration_ms, success, played_at, received_at').eq('user_id', uid).order('played_at', { ascending: false }).limit(5000),
      client.from('user_badges').select('badge_id, earned_at').eq('user_id', uid),
      client.from('consents').select('kind, version, agreed, created_at').eq('user_id', uid).order('created_at'),
      client.from('run_sessions').select('started_at, duration_s, distance_m, sweat_steps, total_steps, received_at').eq('user_id', uid).order('started_at', { ascending: false }).limit(5000),
      client.from('photo_donations').select('created_at, ai_label, ai_conf, district, review, label').eq('user_id', uid).order('created_at', { ascending: false }).limit(5000),
    ]);
    return {
      exported_at: new Date().toISOString(),
      account: { email: user().email, login_methods: loginMethods(), created_at: user().created_at },
      profile: p.data || null, game_scores: scores.data || [], game_runs: runs.data || [], badges: badges.data || [], consents: consents.data || [], run_sessions: jogs.data || [], photo_donations: photos.data || [],
    };
  }

  // ---------- 사진 기증 (AI 학습용, photo-donate.js) ----------
  const PHOTO_BUCKET = 'photo-donations';
  // blob: 폰에서 줄이고 위치 정보를 지운 JPEG. meta: { ai_label, ai_conf, phash, width, height, district }
  async function donatePhoto(blob, meta) {
    needUser();
    if (needsOnboarding()) throw new Error('가입 마무리(동의)를 먼저 해 주세요.');
    const path = `${user().id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const up = await client.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    if (up.error) throw new Error('사진을 올리지 못했어요. 잠시 뒤 다시 해 주세요.');
    const { data, error } = await client.rpc('donate_photo', { p: Object.assign({ path }, meta) });
    if (error || !data || !data.ok) {
      await client.storage.from(PHOTO_BUCKET).remove([path]).catch(() => {});   // 기록이 안 되면 올린 파일도 지운다
      const why = (data && data.reason) || '';
      throw new Error({ consent: '사진 기증에 동의해 주세요.', daily: '오늘은 20장까지 기증할 수 있어요. 내일 다시 해 주세요.', duplicate: '이미 기증한 사진이에요.', label: '모기로 확실히 보이는 사진만 기증할 수 있어요.' }[why] || (error ? koError(error) : '기증하지 못했어요.'));
    }
    return data;
  }
  // 직원: 확인을 기다리는 기증 사진 (사진 주소는 10분짜리 비밀 주소)
  async function pendingPhotos(limit) {
    if (!client || !user()) return [];
    const { data } = await client.from('photo_donations').select('id, path, ai_label, ai_conf, district, created_at').eq('review', 'pending').order('created_at', { ascending: true }).limit(limit || 30);
    const rows = data || [];
    if (!rows.length) return [];
    const { data: urls } = await client.storage.from(PHOTO_BUCKET).createSignedUrls(rows.map((r) => r.path), 600);
    const byPath = {}; (urls || []).forEach((u) => { byPath[u.path] = u.signedUrl; });
    return rows.map((r) => Object.assign({ url: byPath[r.path] || '' }, r));
  }
  async function photoCounts() {
    if (!client || !user()) return null;
    const q = (review) => client.from('photo_donations').select('id', { count: 'exact', head: true }).eq('review', review);
    const [a, b, c] = await Promise.all([q('pending'), q('confirmed'), q('rejected')]);
    return { pending: a.count || 0, confirmed: b.count || 0, rejected: c.count || 0 };
  }
  async function reviewPhoto(id, label) {
    needUser();
    const { error } = await client.rpc('review_photo', { p_id: id, p_label: label });
    if (error) throw new Error(koError(error));
  }
  async function deletePhoto(id) {
    needUser();
    const { data: path, error } = await client.rpc('delete_photo_donation', { p_id: id });
    if (error) throw new Error(koError(error));
    if (path) await client.storage.from(PHOTO_BUCKET).remove([path]).catch(() => {});
  }

  // ---------- 게임 기록 ----------
  // 도전 기록 보내기: 서버 함수가 검사한 뒤 누적에 더한다. 가입 마무리 전이면 보내지 않고 이 기기에 남긴다
  async function submitRuns(runs) {
    if (!client || !user()) return { ok: false, reason: 'no-login' };
    if (needsOnboarding()) return { ok: false, reason: 'onboarding' };
    const rows = (runs || []).map((r) => ({ stage: r.stage, kills: r.kills, duration_ms: r.ms, success: !!r.ok, played_at: r.at }));
    const { data, error } = await client.rpc('submit_game_runs_checked', { p_runs: rows });
    if (error) { lastError = koError(error); return { ok: false, reason: lastError }; }
    if (window.MZGame && data) window.MZGame.mergeServer(data);
    return Object.assign({ ok: true }, data || {});
  }
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
  // 랭킹: 공개 보기(닉네임·누적·최고 단계). 서버가 10초마다 만들어 둔 표를 읽는다
  async function ranking(limit) {
    if (!client) return [];
    const { data } = await client.from('ranking_public').select('rank, nickname, total_kills, best_stage, badge_count').eq('season', CFG.SEASON || new Date().getFullYear()).order('rank', { ascending: true }).limit(limit || 100);
    return data || [];
  }
  // 뛰어런: 달리기 요약 보내기 (달린 길 좌표는 보내지 않는다). 서버 함수 submit_run 이 다시 검사한다
  async function submitRun(row) {
    if (!client || !user()) return { ok: false, reason: 'no-login' };
    if (needsOnboarding()) return { ok: false, reason: 'onboarding' };
    const { data, error } = await client.rpc('submit_run', { p: row });
    if (error) return { ok: false, reason: koError(error) };
    return data || { ok: false };
  }
  // 뛰어런 랭킹: period = 'week'(이번 주) · 'season'(올해 누적)
  async function runRanking(period, limit) {
    if (!client) return [];
    const { data } = await client.from('run_ranking_public').select('rank, nickname, distance_km, sweat_steps, runs').eq('period', period || 'week').order('rank', { ascending: true }).limit(limit || 100);
    return data || [];
  }
  async function myRank() {
    if (!client || !user() || !profile) return null;
    const { data } = await client.from('ranking_public').select('rank, total_kills').eq('season', CFG.SEASON || new Date().getFullYear()).eq('nickname', profile.nickname).maybeSingle();
    return data || null;
  }

  // ---------- 검사 · 오류 문구 ----------
  function validNickname(n) {
    return /^[가-힣A-Za-z0-9_]{2,12}$/.test(n) && !/(관리자|운영자|보건소|admin|staff|모기제로)/i.test(n);
  }
  // 비밀번호: 8자 이상, 영문과 숫자를 함께 (대시보드 'Minimum password length' 도 8로 맞춘다)
  function checkPassword(pw) {
    const p = String(pw || '');
    if (p.length < 8 || p.length > 72) throw new Error('비밀번호는 8자 이상으로 해 주세요.');
    if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) throw new Error('비밀번호에 영문과 숫자를 함께 넣어 주세요.');
  }
  function koError(err) {
    const m = String(err && err.message || err || '');
    if (/captcha/i.test(m)) return '사람인지 확인(캡차)을 다시 해 주세요.';
    if (/already registered|already exists/i.test(m)) return '이미 가입된 이메일이에요.';
    if (/invalid login|invalid credentials/i.test(m)) return '이메일 또는 비밀번호가 맞지 않아요.';
    if (/same.*password|different from the old/i.test(m)) return '지금 비밀번호와 다른 비밀번호로 정해 주세요.';
    if (/password/i.test(m) && /6|8|short|weak|pwned|leaked/i.test(m)) return '더 안전한 비밀번호로 정해 주세요 (8자 이상, 영문과 숫자).';
    if (/email not confirmed/i.test(m)) return '이메일 확인이 아직 안 됐어요. 받은 메일의 링크를 눌러 주세요.';
    if (/nickname duplicate|unique|duplicate/i.test(m)) return '이미 쓰는 닉네임이에요.';
    if (/nickname invalid/i.test(m)) return '닉네임은 2~12자 한글·영문·숫자로, 운영자로 보이는 이름은 쓸 수 없어요.';
    if (/nickname cooldown/i.test(m)) return '닉네임은 30일에 한 번만 바꿀 수 있어요.';
    if (/required consent/i.test(m)) return '필수 항목에 동의해 주세요.';
    if (/onboarding required/i.test(m)) return '가입 마무리(동의)를 먼저 해 주세요.';
    if (/rate limit|too many|security purposes/i.test(m)) return '요청이 너무 많아요. 잠시 뒤 다시 해 주세요.';
    if (/provider is not enabled|unsupported provider/i.test(m)) return '이 로그인 방법은 아직 준비 중이에요.';
    if (/daily|limit/i.test(m)) return '오늘 도전 횟수를 다 썼어요.';
    return m || '알 수 없는 오류';
  }

  window.MZAuth = {
    get enabled() { return status === 'ready'; },
    get status() { return status; },
    get lastError() { return lastError; },
    get turnstileSiteKey() { return (conf && conf.turnstile) || ''; },
    get providers() { return (conf && conf.providers) || []; },
    get recovering() { return recovering; },
    POLICY_VERSION,
    ready, user, profile: () => profile,
    isStaff: () => !!(profile && profile.role === 'staff'),
    // 직원 전용 서버 함수(api/reports-admin.js)에 보낼 접속 토큰
    accessToken: () => (session && session.access_token) || '',
    signUp, signIn, signInWith, signOut,
    finishOnboarding, needsOnboarding, myConsents, setConsent,
    hasPassword, loginMethods, sendPasswordReset, changePassword, changeNickname, deleteAccount, exportMyData,
    submitRuns, myScore, myBadges, ranking, myRank, submitRun, runRanking,
    donatePhoto, pendingPhotos, photoCounts, reviewPhoto, deletePhoto,
    validNickname, checkPassword,
  };
}());
