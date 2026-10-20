/* =============================================================
   모기제로 모바일 탭 화면 (mobile-tabs.js)
   -------------------------------------------------------------
   폰(900px 이하)에서는 긴 한 페이지 스크롤 대신 아래 탭 바로 화면을 바꾼다.
     · 탭: 오늘 · 챙길 것 · [빨간 물렸어요] · 우리 동네 · 도감 · 내 배지. 탭을 누르면 그 탭의 구역만 보이고 맨 위로 간다.
       (사진 판별은 도감 화면으로 옮겼다 — 2026-10-08 피드백. 물렸어요 버튼은 화면을 바꾸지 않고 제보 창을 연다: citizen.js)
     · 구역은 data-tab 값으로 탭에 배정한다 (index.html). 바닥글은 어느 탭에서나 보인다.
     · 주소의 # (예: index.html#kit) 로 들어오면 그 구역이 속한 탭을 연다. 페이지 안 # 링크도 탭을 바꾼다.
     · 지도(Leaflet)는 숨겨진 채 만들어지면 크기를 모르므로, 탭이 보일 때 창 크기 변경 신호를 보내 다시 재게 한다.
   데스크톱(901px 이상)은 전과 같은 한 페이지 스크롤이고, 이 파일은 아무것도 하지 않는다.
   ============================================================= */
(function () {
  'use strict';
  const mq = window.matchMedia('(max-width: 900px)');
  const TABS = ['today', 'kit', 'town'];
  // 구역 id → 탭 (주소의 # 와 페이지 안 링크용)
  const HASH_TAB = { heroTitle: 'today', glance: 'today', flow: 'today', today: 'today', outing: 'today', kit: 'kit', town: 'town', why: 'town', report: 'town', rankLead: 'town', districtCard: 'town' };
  let active = null;

  function tabOf(id) { return HASH_TAB[id] || null; }

  function show(tab, opts) {
    const o = opts || {};
    if (!TABS.includes(tab)) tab = 'today';
    active = tab;
    document.body.dataset.tab = tab;
    document.querySelectorAll('.tabbar [data-tab]').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-current', on ? 'page' : 'false');
    });
    if (!o.keepScroll) window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    if (!o.keepHash) {
      const id = { today: 'flow', kit: 'kit', town: 'town' }[tab];
      try { history.replaceState(null, '', '#' + id); } catch (e) { /* 무시 */ }
    }
    // 지도·그래프가 숨어 있다 나타나면 크기를 다시 재게 한다
    setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
    document.dispatchEvent(new CustomEvent('tab:shown', { detail: { tab } }));
  }

  function apply() {
    const on = mq.matches && document.querySelector('.tabbar');
    document.body.classList.toggle('tabs', Boolean(on));
    if (!on) { delete document.body.dataset.tab; return; }
    const id = (location.hash || '').replace('#', '');
    show(tabOf(id) || active || 'today', { keepHash: true, keepScroll: true });
    // # 로 들어왔으면 그 구역 위치로 (탭을 연 뒤에)
    if (id && document.getElementById(id) && tabOf(id)) setTimeout(() => { const el = document.getElementById(id); if (el && el.getBoundingClientRect().top > innerHeight) el.scrollIntoView({ block: 'start' }); }, 80);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const bar = document.querySelector('.tabbar');
    if (!bar) return;
    bar.querySelectorAll('button[data-tab]').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
    // 페이지 안 # 링크(메뉴·'자세히' 링크)는 탭을 바꾼다
    document.addEventListener('click', (e) => {
      if (!document.body.classList.contains('tabs')) return;
      const a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a) return;
      const id = a.getAttribute('href').slice(1);
      const tab = tabOf(id);
      if (!tab) return;
      e.preventDefault();
      show(tab, { keepHash: true });
      try { history.replaceState(null, '', '#' + id); } catch (err) { /* 무시 */ }
      const el = document.getElementById(id);
      if (el && tab !== 'today') setTimeout(() => el.scrollIntoView({ block: 'start', behavior: 'smooth' }), 30);
    });
    window.addEventListener('hashchange', () => { const t = tabOf(location.hash.slice(1)); if (t && document.body.classList.contains('tabs')) show(t, { keepHash: true }); });
    mq.addEventListener ? mq.addEventListener('change', apply) : mq.addListener(apply);
    apply();
  });
})();

/* =============================================================
   계정 바로가기 (2026-10-20) — 모든 화면 위쪽에 로그인 버튼
   · PC: 메뉴 오른쪽 끝에 '로그인' (로그인한 뒤엔 '내 계정'). 누르면 내 기록 화면의 계정 칸으로 간다.
   · 폰: 오른쪽 위 별 아이콘을 사람(계정) 아이콘으로 바꾼다.
   · 로그인 여부는 Supabase 가 이 브라우저에 남긴 로그인 정보(sb-…-auth-token)가 있는지로만 본다(서버에 묻지 않음).
   ============================================================= */
(function () {
  'use strict';
  const PERSON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c1.2-3.6 4.2-5.5 7.5-5.5s6.3 1.9 7.5 5.5"/></svg>';
  function loggedIn() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (/^sb-.+-auth-token$/.test(k)) { const v = JSON.parse(localStorage.getItem(k) || 'null'); if (v && (v.access_token || (v.currentSession && v.currentSession.access_token))) return true; }
      }
    } catch (e) { /* 저장소를 못 읽으면 로그인 안 한 것으로 */ }
    return false;
  }
  try { if (localStorage.getItem('mz-staff') === '1') document.documentElement.classList.add('is-staff'); } catch (e) { /* 무시 */ }
  function draw() {
    const inn = document.querySelector('.nav .nav-in'); if (!inn) return;
    const on = loggedIn();
    let a = inn.querySelector('.login-top');
    if (!a) {
      a = document.createElement('a'); a.className = 'login-top'; a.href = 'account.html';
      const where = inn.querySelector('.where'), toggle = inn.querySelector('.nav-toggle');
      if (where) where.after(a); else if (toggle) toggle.before(a); else inn.appendChild(a);
    }
    a.textContent = on ? '내 계정' : '로그인';
    const onAccount = /\/account(\.html)?$/.test(location.pathname);
    if (onAccount) a.setAttribute('aria-current', 'page');
    // 폰: 별(내 기록) 아이콘을 사람(계정) 아이콘으로 바꾸고 로그인 화면으로 보낸다. 내 기록은 계정 화면에서 간다
    const star = inn.querySelector('.me-top[href="me.html"], .me-top[data-person]');
    if (star && !star.dataset.person) { star.dataset.person = '1'; star.innerHTML = PERSON; star.href = 'account.html'; }
    if (star) { star.setAttribute('aria-label', on ? '내 계정' : '로그인'); if (onAccount) star.setAttribute('aria-current', 'page'); else star.removeAttribute('aria-current'); }
    // 로그인 안내 줄: data-login-note 가 있는 곳에 '로그인하지 않으면 기록에 남지 않아요'
    document.querySelectorAll('[data-login-note]').forEach((el) => {
      el.hidden = on;
      if (!on) el.innerHTML = '로그인하지 않으면 랭킹 기록에 남지 않아요. 지금 기록은 이 기기에만 저장돼요. <a href="account.html?next=' + encodeURIComponent((location.pathname.split('/').pop() || 'index.html').replace(/^$/, 'index.html')) + '">로그인</a>';
    });
  }
  document.addEventListener('DOMContentLoaded', draw);
  document.addEventListener('auth:changed', draw);
  window.addEventListener('storage', draw);
})();
