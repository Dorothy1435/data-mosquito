/* =============================================================
   로그인 · 회원가입 · 내 계정 화면 (account.js, account.html, account.css)
   -------------------------------------------------------------
   위쪽 '로그인' 버튼을 누르면 오는 화면. 로그인하지 않아도 사이트의 모든 기능은 쓸 수 있고,
   로그인은 랭킹 참여와 기록 보관용이다.
   화면은 상태에 따라 바뀐다
     login(로그인) · signup(회원가입) · forgot(비밀번호 찾기) · recover(메일 링크로 새 비밀번호)
     onboard(가입 마무리: 카카오로 처음 들어왔을 때 닉네임·필수 동의) · account(내 계정)
   주소 뒤 ?next=ranking.html 처럼 붙이면 로그인한 뒤 그 화면으로 돌아간다.
   봇·AI 자동 가입 막기: 캡차 키가 있으면 Cloudflare Turnstile 을 붙인다(가입·로그인·비밀번호 찾기·변경).
   ============================================================= */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let mode = /(^|[?&])mode=signup/.test(location.search) ? 'signup' : 'login';   // login · signup · forgot
  const NEXT = (() => { const m = location.search.match(/[?&]next=([a-z-]+\.html)/); return m ? m[1] : ''; })();

  // 공식 로고 (카카오 말풍선) — 각 회사 로그인 버튼 가이드의 색을 따른다
  const KAKAO_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="#000" d="M12 3.2c-5.3 0-9.6 3.4-9.6 7.6 0 2.7 1.8 5.1 4.5 6.4-.2.7-.7 2.6-.8 3-.1.5.2.5.4.3.2-.1 2.6-1.8 3.7-2.5.6.1 1.2.1 1.8.1 5.3 0 9.6-3.4 9.6-7.6S17.3 3.2 12 3.2z"/></svg>';
  const EYE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const MAIL_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/></svg>';
  // 마지막으로 쓴 로그인 방법 (이 기기에만). '최근 사용' 말풍선에 쓴다
  const LAST_KEY = 'mz-last-login';
  const lastGet = () => { try { return localStorage.getItem(LAST_KEY) || ''; } catch (e) { return ''; } };
  const lastSet = (m) => { try { localStorage.setItem(LAST_KEY, m); } catch (e) { /* 저장 못 해도 괜찮다 */ } };
  // 아이디 저장 (이메일을 이 기기에 기억)
  const SAVE_KEY = 'mz-saved-email';
  const savedGet = () => { try { return localStorage.getItem(SAVE_KEY) || ''; } catch (e) { return ''; } };
  const savedSet = (v) => { try { if (v) localStorage.setItem(SAVE_KEY, v); else localStorage.removeItem(SAVE_KEY); } catch (e) { /* 무시 */ } };
  // 비밀번호를 5번 틀리면 '사람 확인(캡차)'을 거쳐야 다시 시도할 수 있다. 캡차 키가 아직 없으면 1분 동안 잠근다
  const FAIL_KEY = 'mz-login-fail', FAIL_LIMIT = 5, LOCK_MS = 60 * 1000;
  const failGet = () => { try { return JSON.parse(localStorage.getItem(FAIL_KEY) || 'null') || { n: 0, t: 0 }; } catch (e) { return { n: 0, t: 0 }; } };
  const failSet = (v) => { try { if (v) localStorage.setItem(FAIL_KEY, JSON.stringify(v)); else localStorage.removeItem(FAIL_KEY); } catch (e) { /* 무시 */ } };
  const recent = (m) => (lastGet() === m ? '<em class="ax-recent">최근 사용</em>' : '');
  // 방법 고르기 버튼 두 개 (카카오 · 이메일). verb: '로그인' 또는 '가입'
  function pick(verb, emailMode, withRecent) {
    return `<div class="ax-pick">
        <button type="button" class="ax-sns-btn kakao" data-oauth="kakao">${KAKAO_SVG}<span>카카오로 ${verb}</span>${withRecent ? recent('kakao') : ''}</button>
        <button type="button" class="ax-sns-btn mail" data-mode="${emailMode}">${MAIL_SVG}<span>이메일로 ${verb}</span>${withRecent ? recent('email') : ''}</button>
      </div>`;
  }
  const CHECK ='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';

  /* ---------- 캡차 (Cloudflare Turnstile) ---------- */
  let tsLoading = null;
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve();
    if (!tsLoading) {
      tsLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        s.async = true; s.onload = () => resolve(); s.onerror = () => { tsLoading = null; reject(new Error('captcha')); };
        document.head.appendChild(s);
      });
    }
    return tsLoading;
  }
  function captcha(box) {
    const key = window.MZAuth.turnstileSiteKey;
    let token = null, id = null;
    if (!key || !box) return { token: () => undefined, reset() {}, needed: false };
    loadTurnstile().then(() => {
      id = window.turnstile.render(box, { sitekey: key, language: 'ko', theme: 'light', size: 'flexible',
        callback: (t) => { token = t; }, 'expired-callback': () => { token = null; }, 'error-callback': () => { token = null; } });
    }).catch(() => { box.textContent = '사람인지 확인하는 칸을 불러오지 못했어요. 새로고침해 주세요.'; });
    return { token: () => token || undefined, reset() { token = null; if (id != null && window.turnstile) window.turnstile.reset(id); }, needed: true };
  }

  /* ---------- 화면 조각 ---------- */
  function field(name, label, type, attrs) {
    const pw = type === 'password';
    return `<div class="ax-field"><label for="f_${name}">${label}</label>
      <div class="ax-input${pw ? ' has-eye' : ''}"><input id="f_${name}" name="${name}" type="${type}" ${attrs || ''}>${pw ? `<button type="button" class="ax-eye" aria-label="비밀번호 보기" data-eye="f_${name}">${EYE}</button>` : ''}</div></div>`;
  }

  // 동의: 토스처럼 '전체 동의' 한 줄 + 항목 목록. 필수 항목의 수집 내용은 항목 바로 아래 회색 글로
  function consents() {
    const row = (name, req, text, link) => `<li><label class="ax-check"><input type="checkbox" name="${name}"${req ? ' data-req' : ''}><i>${CHECK}</i><span><b class="${req ? 'req' : 'opt'}">${req ? '필수' : '선택'}</b> ${text}</span></label>${link ? `<a href="${link}" target="_blank" rel="noopener" class="ax-view">보기</a>` : ''}</li>`;
    return `<fieldset class="ax-agree">
      <legend class="sr-only">약관 동의</legend>
      <label class="ax-check all"><input type="checkbox" id="agAll"><i>${CHECK}</i><span>전체 동의하기</span></label>
      <ul>
        ${row('age14', true, '만 14세 이상이에요')}
        ${row('terms', true, '이용약관', 'terms.html')}
        ${row('privacy', true, '개인정보 수집·이용', 'privacy.html#signup')}
        <li class="ax-sum">이메일·닉네임·이름·휴대폰 번호·모기 잡기와 뛰어런 기록을 로그인, 랭킹, 상품 지급 연락에 쓰고, 계정을 지우면 바로 모두 지워요. 이름·휴대폰은 본인만 볼 수 있어요.</li>
        ${row('location', false, '위치정보 이용 (제보 위치, 뛰어런 거리)', 'privacy.html#location')}
        ${row('motion', false, '움직임 센서 이용 (뛰어런 걸음)')}
      </ul>
    </fieldset>`;
  }
  function wireConsent(root) {
    const all = root.querySelector('#agAll');
    const boxes = Array.from(root.querySelectorAll('.ax-agree ul input[name]'));
    all.addEventListener('change', () => boxes.forEach((b) => { b.checked = all.checked; }));
    boxes.forEach((b) => b.addEventListener('change', () => { all.checked = boxes.every((x) => x.checked); }));
    return () => Object.fromEntries(boxes.map((b) => [b.name, b.checked]));
  }
  const errLine = '<p class="ax-err" role="alert"></p>';

  const VIEWS = {
    // 로그인 첫 화면: 버튼만. 이메일을 누르면 그때 입력칸이 열린다 (미리캠퍼스 방식)
    login: () => ({
      title: '로그인',
      lead: '',
      body: `${pick('로그인', 'email', true)}${errLine}
      <p class="ax-join">아직 회원이 아니신가요? <button type="button" data-mode="signup">회원가입</button></p>
      <p class="ax-skip"><a href="me.html">로그인 없이 내 기록 보기</a></p>`,
    }),
    // 회원가입 첫 화면: 버튼만
    signup: () => ({
      title: '가입하고 랭킹에 참여하세요',
      lead: '',
      body: `${pick('가입', 'signupEmail', false)}${errLine}
      <p class="ax-join">이미 회원이신가요? <button type="button" data-mode="login">로그인하기</button></p>`,
    }),
    email: () => ({
      title: '이메일로 로그인',
      lead: '',
      body: `<form class="ax-form" id="axForm" novalidate>
        ${field('email', '이메일', 'email', 'autocomplete="email" required inputmode="email"')}
        ${field('password', '비밀번호', 'password', 'autocomplete="current-password" required')}
        <div class="ax-keep"><label class="ax-check sm"><input type="checkbox" name="saveId"><i>${CHECK}</i><span>아이디 저장</span></label><label class="ax-check sm"><input type="checkbox" name="autoLogin" checked><i>${CHECK}</i><span>자동 로그인</span></label></div>
        <div class="ax-cap" id="capBox"></div>${errLine}
        <button type="submit" class="ax-btn">로그인</button>
        <p class="ax-links"><button type="button" data-mode="findId">아이디 찾기</button><span aria-hidden="true">|</span><button type="button" data-mode="forgot">비밀번호 찾기</button><span aria-hidden="true">|</span><button type="button" data-mode="signup">회원가입</button></p>
      </form>
      <p class="ax-back"><button type="button" data-mode="login">다른 방법으로 로그인</button></p>`,
    }),
    signupEmail: () => ({
      title: '이메일로 가입',
      lead: '',
      body: `<form class="ax-form" id="axForm" novalidate>
        ${field('nickname', '닉네임 (랭킹에 보여요)', 'text', 'maxlength="12" autocomplete="nickname" required placeholder="2~12자 한글·영문·숫자"')}
        ${field('real_name', '이름', 'text', 'maxlength="20" autocomplete="name" required placeholder="실명 (상품 받을 때 확인해요)"')}
        ${field('phone', '휴대폰 번호', 'tel', 'maxlength="13" autocomplete="tel" inputmode="numeric" required placeholder="010-1234-5678"')}
        ${field('email', '이메일', 'email', 'autocomplete="email" required inputmode="email"')}
        ${field('password', '비밀번호', 'password', 'autocomplete="new-password" minlength="8" required placeholder="8자 이상, 영문과 숫자"')}
        ${field('password2', '비밀번호 확인', 'password', 'autocomplete="new-password" minlength="8" required')}
        ${consents()}
        <div class="ax-cap" id="capBox"></div>${errLine}
        <button type="submit" class="ax-btn">가입하기</button>
        <p class="ax-links"><button type="button" data-mode="signup">다른 방법으로 가입</button></p>
      </form>`,
    }),
    // 아이디 찾기: 이름 + 휴대폰 번호 → 가린 이메일
    findId: () => ({
      title: '아이디 찾기',
      lead: '가입할 때 적은 이름과 휴대폰 번호를 넣어 주세요.',
      body: `<form class="ax-form" id="axForm" novalidate>
        ${field('real_name', '이름', 'text', 'maxlength="20" autocomplete="name" required')}
        ${field('phone', '휴대폰 번호', 'tel', 'maxlength="13" autocomplete="tel" inputmode="numeric" required placeholder="010-1234-5678"')}
        ${errLine}
        <button type="submit" class="ax-btn">찾기</button>
        <p class="ax-links"><button type="button" data-mode="forgot">비밀번호 찾기</button><span aria-hidden="true">|</span><button type="button" data-mode="email">로그인</button></p>
      </form>`,
    }),
    forgot: () => ({
      title: '비밀번호 찾기',
      lead: '가입한 이메일로 비밀번호를 새로 정하는 링크를 보내 드려요. 카카오로 가입했다면 그 계정으로 로그인해 주세요.',
      body: `<form class="ax-form" id="axForm" novalidate>
        ${field('email', '이메일', 'email', 'autocomplete="email" required inputmode="email"')}
        <div class="ax-cap" id="capBox"></div>${errLine}
        <button type="submit" class="ax-btn">메일 받기</button>
        <p class="ax-links"><button type="button" data-mode="email">로그인으로 돌아가기</button></p>
      </form>`,
    }),
  };

  function paint(title, lead, body) {
    $('axTitle').textContent = title;
    $('axLead').textContent = lead;
    $('axLead').hidden = !lead;   // 설명이 없는 화면은 빈 줄을 남기지 않는다
    $('axBody').innerHTML = body;
    document.querySelector('.ax-wrap').classList.toggle('is-pick', Boolean($('axBody').querySelector('.ax-pick')));
    document.title = `모기제로 | ${title}`;
    // 비밀번호 보기 버튼
    $('axBody').querySelectorAll('[data-eye]').forEach((b) => b.addEventListener('click', () => {
      const i = $(b.dataset.eye); const show = i.type === 'password';
      i.type = show ? 'text' : 'password'; b.setAttribute('aria-label', show ? '비밀번호 숨기기' : '비밀번호 보기'); b.classList.toggle('on', show);
    }));
    $('axBody').querySelectorAll('input[name="phone"]').forEach((i) => i.addEventListener('input', () => {
      const d = i.value.replace(/[^0-9]/g, '').slice(0, 11);
      i.value = d.length < 4 ? d : d.length < 8 ? `${d.slice(0, 3)}-${d.slice(3)}` : `${d.slice(0, 3)}-${d.slice(3, d.length - 4)}-${d.slice(-4)}`;
    }));
    $('axBody').querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; render(); }));
    $('axBody').querySelectorAll('[data-oauth]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try { await window.MZAuth.signInWith(b.dataset.oauth); lastSet(b.dataset.oauth); } catch (ex) { const e = $('axBody').querySelector('.ax-err'); if (e) e.textContent = ex.message; b.disabled = false; }
    }));
  }
  // 폼 제출: 버튼 잠그기, 오류 문구, 캡차 다시 받기
  function onSubmit(form, cap, work) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = form.querySelector('.ax-err'), btn = form.querySelector('.ax-btn');
      err.textContent = ''; err.classList.remove('ok');
      if (cap && cap.needed && !cap.token()) { err.textContent = '사람인지 확인하는 칸을 먼저 눌러 주세요.'; return; }
      btn.disabled = true; btn.classList.add('busy');
      try {
        const msg = await work(form, cap ? cap.token() : undefined);
        if (msg) { err.classList.add('ok'); err.textContent = msg; }
      } catch (ex) { err.textContent = ex.message || '잘 안 됐어요. 다시 해 주세요.'; }
      if (cap) cap.reset();
      btn.disabled = false; btn.classList.remove('busy');
    });
  }
  function goNext() { if (NEXT) location.href = NEXT; }

  /* ---------- 내 계정 (로그인 뒤) ---------- */
  function accountView(A) {
    const p = A.profile() || {}, u = A.user();
    const methods = A.loginMethods().map((m) => ({ email: '이메일', kakao: '카카오' }[m] || m)).join(' · ') || '이메일';
    const next = p.nickname_changed_at ? new Date(new Date(p.nickname_changed_at).getTime() + 30 * 864e5) : null;
    const row = (id, title, sub, inner) => `<details class="ax-row" id="${id}"><summary><span><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span></summary><div class="ax-row-body">${inner}</div></details>`;
    return `<div class="ax-me">
        <p class="ax-me-name">${esc(p.nickname || '회원')}</p>
        <p class="ax-me-sub">${esc(u.email || '')} · ${esc(methods)}로 로그인${A.isStaff() ? ' · 직원' : ''}</p>
      </div>
      <a class="ax-go" href="me.html"><span><b>내 기록</b><small>잡은 수 · 배지</small></span></a>
      <a class="ax-go" href="ranking.html"><span><b>랭킹</b><small>모기 잡기 · 뛰어런</small></span></a>
      ${A.isStaff() ? '<a class="ax-go" href="expert.html"><span><b>전문가용 화면</b><small>방역 내비게이션 · 시민 제보</small></span></a>' : ''}
      <p class="ax-group">계정 설정</p>
      <div class="ax-list">
        ${row('rowNick', '닉네임 바꾸기', next && next > new Date() ? `${next.toLocaleDateString('ko-KR')}부터 바꿀 수 있어요` : '30일에 한 번', `<form class="ax-form" id="nickForm" novalidate>${field('nickname', '새 닉네임', 'text', `maxlength="12" required value="${esc(p.nickname || '')}"`)}${errLine}<button type="submit" class="ax-btn">바꾸기</button></form>`)}
        ${row('rowContact', '이름 · 휴대폰', '상품 받을 때 연락처', `<form class="ax-form" id="contactForm" novalidate>${field('real_name', '이름', 'text', 'maxlength="20" autocomplete="name" required')}${field('phone', '휴대폰 번호', 'tel', 'maxlength="13" autocomplete="tel" inputmode="numeric" required')}<p class="ax-note">본인만 볼 수 있고, 랭킹에는 보이지 않아요.</p>${errLine}<button type="submit" class="ax-btn">저장</button></form>`)}
        ${A.hasPassword() ? row('rowPw', '비밀번호 바꾸기', '', `<form class="ax-form" id="pwForm" novalidate>${field('current', '지금 비밀번호', 'password', 'autocomplete="current-password" required')}${field('password', '새 비밀번호', 'password', 'autocomplete="new-password" minlength="8" required placeholder="8자 이상, 영문과 숫자"')}${field('password2', '새 비밀번호 확인', 'password', 'autocomplete="new-password" minlength="8" required')}<div class="ax-cap" id="capPw"></div>${errLine}<button type="submit" class="ax-btn">바꾸기</button></form>`) : ''}
        ${row('rowConsent', '선택 동의', '위치정보 · 움직임 센서', `<div class="ax-form"><label class="ax-switch"><span><b>위치정보 이용</b><small>제보 위치, 뛰어런 거리</small></span><input type="checkbox" role="switch" data-consent="location"></label><label class="ax-switch"><span><b>움직임 센서 이용</b><small>뛰어런 걸음 세기</small></span><input type="checkbox" role="switch" data-consent="motion"></label><p class="ax-err" id="consentErr" role="alert"></p><p class="ax-note">끄면 그 기능을 쓸 때 다시 물어봐요. <a href="privacy.html">개인정보 처리방침</a> · <a href="terms.html">이용약관</a></p></div>`)}
        ${A.isAdmin() ? row('rowAdmin', '직원 권한 관리', '최고 관리자만 보여요', `<div class="ax-form"><div class="ax-adm-search">${field('admQ', '닉네임으로 찾기', 'search', 'maxlength="12" placeholder="비워 두면 최근 가입 순"')}<button type="button" class="ax-btn sub" id="admFind">찾기</button></div><p class="ax-err" id="admErr" role="alert"></p><ul class="ax-adm" id="admList" aria-live="polite"></ul></div>`) : ''}
        ${row('rowData', '내 정보 내려받기', '서버에 있는 내 정보 전부', `<div class="ax-form"><p class="ax-note">이메일, 닉네임, 모기 잡기·뛰어런 기록, 동의 기록을 파일 하나로 받아요.</p><button type="button" class="ax-btn sub" id="exportBtn">파일로 받기</button>${errLine}</div>`)}
      </div>
      <div class="ax-foot">
        <button type="button" class="ax-text" id="logoutBtn">로그아웃</button>
        <button type="button" class="ax-text" id="logoutAllBtn">모든 기기에서 로그아웃</button>
      </div>
      <details class="ax-row danger" id="rowDelete"><summary><span><b>계정 삭제</b><small>계정과 서버의 모든 기록을 바로 지워요</small></span></summary>
        <div class="ax-row-body"><form class="ax-form" id="delForm" novalidate>
          <p class="ax-note">잡은 수·배지·뛰어런 기록·랭킹·동의 기록이 모두 지워지고 되돌릴 수 없어요.</p>
          ${field('confirm', '확인을 위해 ‘삭제’라고 적어 주세요', 'text', 'autocomplete="off" required')}
          <label class="ax-check"><input type="checkbox" name="local"><i>${CHECK}</i><span>이 기기에 남은 기록도 지우기</span></label>
          ${errLine}<button type="submit" class="ax-btn danger">계정 삭제</button>
        </form></div></details>`;
  }
  // 직원 권한 관리 (최고 관리자만): 닉네임으로 찾아 직원 ↔ 일반을 바꾼다
  function wireAdmin(A) {
    const list = $('admList'); if (!list) return;
    const err = $('admErr');
    const ROLE = { staff: '직원', citizen: '일반' };
    async function load() {
      err.textContent = ''; list.innerHTML = '<li class="ax-adm-msg">불러오는 중이에요…</li>';
      try {
        const rows = await A.adminListMembers($('f_admQ').value);
        if (!rows.length) { list.innerHTML = '<li class="ax-adm-msg">찾는 회원이 없어요.</li>'; return; }
        list.innerHTML = rows.map((r) => `<li><span><b>${esc(r.nickname)}</b><small>${r.is_admin ? '최고 관리자' : ROLE[r.role] || r.role} · ${new Date(r.joined_at).toLocaleDateString('ko-KR')} 가입</small></span>${r.is_admin ? '<em class="ax-adm-tag">최고 관리자</em>' : `<button type="button" class="ax-adm-btn${r.role === 'staff' ? ' on' : ''}" data-nick="${esc(r.nickname)}" data-to="${r.role === 'staff' ? 'citizen' : 'staff'}">${r.role === 'staff' ? '직원 해제' : '직원으로'}</button>`}</li>`).join('');
        list.querySelectorAll('[data-nick]').forEach((b) => b.addEventListener('click', async () => {
          const to = b.dataset.to, nick = b.dataset.nick;
          if (!confirm(`${nick} 님을 ${to === 'staff' ? '직원으로 지정' : '일반 회원으로 변경'}할까요?`)) return;
          b.disabled = true;
          try { await A.adminSetRole(nick, to); await load(); } catch (ex) { err.textContent = ex.message; b.disabled = false; }
        }));
      } catch (ex) { list.innerHTML = ''; err.textContent = ex.message; }
    }
    $('admFind').addEventListener('click', load);
    $('f_admQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); load(); } });
    const det = $('rowAdmin');
    if (det) det.addEventListener('toggle', () => { if (det.open && !list.children.length) load(); });
  }
  function wireAccount(A) {
    wireAdmin(A);
    // 이름·휴대폰: 저장된 값을 채우고(가려서 보여 줌), 바꾸면 저장
    A.myContact().then((c) => {
      const f = $('contactForm'); if (!f) return;
      // 한 번 저장한 이름·휴대폰은 바꿀 수 없다(상품 대상 확인용). 보여 주기만 한다
      if (c) {
        const tel = c.phone.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3');
        f.outerHTML = `<div class="ax-form ax-locked"><p><span>이름</span><b>${esc(c.real_name)}</b></p><p><span>휴대폰</span><b>${esc(tel)}</b></p><p class="ax-note">이름·휴대폰은 바꿀 수 없어요. 잘못 적었다면 운영 기관에 알려 주세요. 본인만 볼 수 있고 랭킹에는 보이지 않아요.</p></div>`;
      }
      const sub = document.querySelector('#rowContact small');
      if (sub) sub.textContent = c ? `${c.real_name.slice(0, 1)}${'*'.repeat(Math.max(1, c.real_name.length - 1))} · ${c.phone.slice(0, 3)}-****-${c.phone.slice(-4)}${c.verified ? ' · 본인인증 완료' : ''}` : '아직 없어요 · 상품을 받으려면 필요해요';
    });
    onSubmit($('contactForm'), null, async (f) => { await A.setContact(f.real_name.value, f.phone.value); return '저장했어요. 이제 바꿀 수 없어요.'; });
    onSubmit($('nickForm'), null, async (f) => { await A.changeNickname(f.nickname.value); return '바꿨어요. 랭킹에는 10초 안에 반영돼요.'; });
    if ($('pwForm')) {
      const cap = captcha($('capPw'));
      onSubmit($('pwForm'), cap, async (f, token) => {
        if (f.password.value !== f.password2.value) throw new Error('새 비밀번호 두 칸이 서로 달라요.');
        await A.changePassword(f.current.value, f.password.value, token);
        f.reset(); return '비밀번호를 바꿨어요.';
      });
    }
    A.myConsents().then((c) => {
      document.querySelectorAll('[data-consent]').forEach((sw) => {
        const k = sw.dataset.consent;
        sw.checked = !!(c[k] && c[k].agreed);
        sw.addEventListener('change', async () => {
          try {
            await A.setConsent(k, sw.checked);
            if (window.MZConsent) window.MZConsent.set(k, sw.checked, { skipServer: true });
            $('consentErr').textContent = '';
          } catch (ex) { sw.checked = !sw.checked; $('consentErr').textContent = ex.message; }
        });
      });
    });
    $('exportBtn').addEventListener('click', async (e) => {
      const err = e.target.parentElement.querySelector('.ax-err');
      try {
        const data = await A.exportMyData();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = `모기제로-내정보-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      } catch (ex) { err.textContent = ex.message; }
    });
    $('logoutBtn').addEventListener('click', () => A.signOut());
    $('logoutAllBtn').addEventListener('click', () => A.signOut(true));
    onSubmit($('delForm'), null, async (f) => {
      if (f.confirm.value.trim() !== '삭제') throw new Error("'삭제'라고 정확히 적어 주세요.");
      const wipe = f.local.checked;
      await A.deleteAccount();
      if (wipe) { ['mz-game', 'mz-runs', 'mz-run-opt', 'mz-consent'].forEach((k) => { try { localStorage.removeItem(k); } catch (e) { /* 무시 */ } }); }
      setTimeout(() => { location.href = 'index.html'; }, 600);
      return '계정을 지웠어요.';
    });
  }

  /* ---------- 그리기 ---------- */
  function render() {
    const A = window.MZAuth;
    if (!A || A.status === 'loading') { paint('로그인', '서버를 확인하는 중이에요.', ''); return; }
    if (A.status === 'off' || A.status === 'error') {
      paint('로그인', '회원가입·로그인은 준비 중이에요.', `<p class="ax-note">서버가 연결되면 열려요. 그때까지도 모든 기능을 로그인 없이 쓸 수 있고, 기록은 이 기기에 남아요.${A.status === 'error' ? ' (지금은 서버에 연결할 수 없어요)' : ''}</p><a class="ax-btn" href="index.html">첫 화면으로</a>`);
      return;
    }
    const u = A.user();
    if (u && A.recovering) {
      paint('새 비밀번호', '앞으로 쓸 비밀번호를 정해 주세요.', `<form class="ax-form" id="axForm" novalidate>${field('password', '새 비밀번호', 'password', 'autocomplete="new-password" minlength="8" required placeholder="8자 이상, 영문과 숫자"')}${field('password2', '새 비밀번호 확인', 'password', 'autocomplete="new-password" minlength="8" required')}${errLine}<button type="submit" class="ax-btn">저장</button></form>`);
      onSubmit($('axForm'), null, async (f) => { if (f.password.value !== f.password2.value) throw new Error('두 칸이 서로 달라요.'); await A.changePassword('', f.password.value); return '저장했어요.'; });
      return;
    }
    if (u && A.needsOnboarding()) {
      paint('거의 다 됐어요', '닉네임과 연락처, 동의만 남았어요. 랭킹에는 닉네임만 보여요.', `<form class="ax-form" id="axForm" novalidate>${field('nickname', '닉네임 (랭킹에 보여요)', 'text', 'maxlength="12" required placeholder="2~12자 한글·영문·숫자"')}${field('real_name', '이름', 'text', 'maxlength="20" autocomplete="name" required placeholder="실명 (상품 받을 때 확인해요)"')}${field('phone', '휴대폰 번호', 'tel', 'maxlength="13" autocomplete="tel" inputmode="numeric" required placeholder="010-1234-5678"')}${consents()}${errLine}<button type="submit" class="ax-btn">시작하기</button><p class="ax-links"><button type="button" id="laterBtn">나중에 할게요 (로그아웃)</button></p></form>`);
      // 카카오가 이름·전화번호를 주면(비즈 앱 검수 후) 미리 채운다. 전화번호는 '+82 10-1234-5678' 꼴로 온다
      const md = (u.user_metadata) || {};
      const kname = md.name || md.full_name || '';
      const kphone = String(md.phone_number || md.phone || '').replace(/^\+82\s?/, '0').replace(/[^0-9]/g, '');
      if (kname && /^[가-힣A-Za-z ]{2,20}$/.test(kname) && md.phone_number) $('f_real_name').value = kname;
      if (/^01[016789][0-9]{7,8}$/.test(kphone)) $('f_phone').value = kphone.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3');
      const get = wireConsent($('axBody'));
      $('laterBtn').addEventListener('click', () => A.signOut());
      onSubmit($('axForm'), null, async (f) => {
        const c = get();
        await A.finishOnboarding(f.nickname.value, c, f.real_name.value, f.phone.value);
        if (window.MZConsent) { window.MZConsent.set('location', !!c.location, { skipServer: true }); window.MZConsent.set('motion', !!c.motion, { skipServer: true }); }
        goNext();
      });
      return;
    }
    if (u) {
      paint('내 계정', '', accountView(A));
      $('axLead').hidden = true;
      wireAccount(A);
      return;
    }
    $('axLead').hidden = false;
    const v = VIEWS[mode]();
    paint(v.title, v.lead, v.body);
    const cap = mode === 'email' ? null : captcha($('capBox'));
    if (mode === 'signupEmail') {
      const get = wireConsent($('axBody'));
      onSubmit($('axForm'), cap, async (f, token) => {
        if (f.password.value !== f.password2.value) throw new Error('비밀번호 두 칸이 서로 달라요.');
        const c = get();
        if (!c.age14 || !c.terms || !c.privacy) throw new Error('필수 항목 3가지에 동의해 주세요.');
        const r = await A.signUp({ email: f.email.value.trim(), password: f.password.value, nickname: f.nickname.value, consents: c, captchaToken: token, name: f.real_name.value, phone: f.phone.value });
        lastSet('email');
        if (window.MZConsent) { window.MZConsent.set('location', !!c.location, { skipServer: true }); window.MZConsent.set('motion', !!c.motion, { skipServer: true }); }
        if (r.needsConfirm) { mode = 'email'; return '가입 확인 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인해 주세요.'; }
        goNext();
        return '';
      });
    } else if (mode === 'findId') {
      onSubmit($('axForm'), null, async (f) => {
        const r = await A.findLogin(f.real_name.value, f.phone.value);
        if (!r) throw new Error('이 이름·휴대폰 번호로 가입한 계정이 없어요.');
        const prov = Array.isArray(r.providers) ? r.providers : [];
        const kakao = prov.includes('kakao'), mail = prov.includes('email');
        if (kakao && !mail) return '카카오로 가입한 계정이에요. 카카오로 로그인해 주세요.';
        return `가입한 이메일은 ${r.email} 이에요.${kakao ? ' (카카오 로그인도 돼요)' : ''}`;
      });
    } else if (mode === 'forgot') {
      onSubmit($('axForm'), cap, async (f, token) => { await A.sendPasswordReset(f.email.value, token); return '메일을 보냈어요. 받은 편지함(스팸함도)을 확인해 주세요.'; });
    } else if (mode === 'email') {
      // 아이디 저장: 저장한 이메일을 미리 채운다. 자동 로그인: 끄면 이 창을 닫거나 앱을 끄면 로그아웃 (auth.js)
      const fm = $('axForm');
      const saved = savedGet();
      if (saved) { fm.email.value = saved; fm.saveId.checked = true; }
      fm.autoLogin.checked = A.autoLogin;
      // 5번 틀린 뒤에만 캡차를 붙인다
      let capE = failGet().n >= FAIL_LIMIT ? captcha($('capBox')) : null;
      const capProxy = { get needed() { return Boolean(capE && capE.needed); }, token: () => (capE ? capE.token() : undefined), reset() { if (capE) capE.reset(); } };
      onSubmit(fm, capProxy, async (f, token) => {
        const fl = failGet();
        if (fl.n >= FAIL_LIMIT && !capProxy.needed && Date.now() - fl.t < LOCK_MS) {
          throw new Error(`비밀번호를 ${FAIL_LIMIT}번 틀렸어요. ${Math.ceil((LOCK_MS - (Date.now() - fl.t)) / 1000)}초 뒤에 다시 해 주세요.`);
        }
        try {
          await A.signIn({ email: f.email.value.trim(), password: f.password.value, captchaToken: token, autoLogin: f.autoLogin.checked });
        } catch (ex) {
          if (/맞지 않아요/.test(ex.message)) {
            const n = fl.n + 1;
            failSet({ n, t: Date.now() });
            if (n >= FAIL_LIMIT) {
              if (!capE) capE = captcha($('capBox'));
              throw new Error(capE.needed ? `비밀번호를 ${n}번 틀렸어요. 아래에서 사람인지 확인한 뒤 다시 해 주세요.` : `비밀번호를 ${n}번 틀렸어요. 1분 뒤에 다시 해 주세요.`);
            }
            throw new Error(`${ex.message} (${n}/${FAIL_LIMIT}번)`);
          }
          throw ex;
        }
        failSet(null);
        savedSet(f.saveId.checked ? f.email.value.trim() : '');
        lastSet('email'); goNext();
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    render();
    document.addEventListener('auth:changed', render);
    if (window.MZAuth) window.MZAuth.ready.then(render);
  });
}());
