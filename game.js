/* =============================================================
   모기 잡기 게임 (game.js)
   -------------------------------------------------------------
   첫 화면(hero-card) 위를 모기가 날아다니고, 마우스·손가락(모기약)으로 누르면 잡힌다.
   (예전에는 motion.js 안에 있었다. 2026-10-07 팀장 피드백으로 스테이지·배지가 붙으면서 파일을 나눴다.)

     · 자유 모드: 평소 상태. 오늘 모기지수 단계만큼 모기가 떠 있고, 잡으면 새 모기가 들어온다. 잡은 수는 누적된다.
     · 도전 모드: '도전' 버튼을 누르면 1단계(3마리)부터. 제한 시간 안에 목표를 잡으면 다음 단계가 열리고,
                  못 잡으면 실패. 실패해도 누적 잡은 수는 그대로 남는다. 오늘 모기지수가 높을수록 더 높은 단계가 열린다
                  (매우 높음인 날만 1,000마리 단계). 숫자는 전부 game-config.js 에 있다.
     · 배지: 누적 잡은 수가 기준에 닿으면 임명장(배지 카드)이 뜬다. 알 → 장구벌레 → 번데기 → 모기 → 종류별 모기 순.
     · 저장: 이 브라우저(localStorage 'mz-game')에 남긴다. 로그인했으면 auth.js(MZAuth)로 서버에도 보낸다.
       서버에는 한 마리마다가 아니라 도전이 끝날 때 한 번만 보낸다(서버 부하·어뷰징 방지).
     · '움직임 줄이기' 설정이면 모기를 숨기고 게임을 끈다.
   다른 화면(내 배지 등)은 window.MZGame.state() 로 기록을 읽는다.
   ============================================================= */
(function () {
  'use strict';
  const CFG = window.MZ_GAME_CONFIG || {};
  const STAGES = CFG.STAGES || [{ target: 3, seconds: 20 }];
  const DIFF = CFG.DIFFICULTY || [{ count: 2, flee: 200, push: 2.6, jink: 0.7, vmax: 8, hit: 1 }];
  const BADGES = CFG.BADGES || [];
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = window.matchMedia('(max-width: 620px)').matches;
  const KEY = 'mz-game';
  const todayKey = () => new Date().toISOString().slice(0, 10);

  /* ---------- 기록 (브라우저 저장) ---------- */
  function loadState() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { s = null; }
    if (!s || typeof s !== 'object') {
      // 예전 버전('mz-kills' 에 잡은 수만 저장)에서 이어받는다
      let old = 0;
      try { old = parseInt(localStorage.getItem('mz-kills') || '0', 10) || 0; } catch (e) { old = 0; }
      s = { kills: Math.max(0, old), bestStage: 0, badges: [], today: { date: todayKey(), runs: 0 }, history: [], pending: [], golden: 0 };
    }
    if (!s.today || s.today.date !== todayKey()) s.today = { date: todayKey(), runs: 0 };
    s.badges = Array.isArray(s.badges) ? s.badges : [];
    s.history = Array.isArray(s.history) ? s.history : [];
    s.pending = Array.isArray(s.pending) ? s.pending : [];
    s.golden = Number(s.golden) || 0;   // 잡은 황금 모기 수
    return s;
  }
  const state = loadState();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); localStorage.setItem('mz-kills', String(state.kills)); } catch (e) { /* 저장 못 해도 게임은 된다 */ }
    document.dispatchEvent(new CustomEvent('game:changed', { detail: { kills: state.kills } }));
  }
  // 받을 수 있는데 아직 안 받은 배지 (누적 수 기준)
  function dueBadges() { return BADGES.filter((b) => state.kills >= b.need && !state.badges.includes(b.id)); }

  /* ---------- 배지 그림: 단계마다 다른 모양 (작고 귀엽게, SVG) ---------- */
  function badgeIcon(id, size) {
    const sz = size || 64;
    const wrap = (inner, bg) => `<svg class="bdg-ic" width="${sz}" height="${sz}" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="30" fill="${bg}"/>${inner}</svg>`;
    const mosq = (body, extra) => `<g stroke="#1d1d1f" stroke-width="1.6" fill="none" stroke-linecap="round"><path d="M27 36l-7 8M30 38l-2 10M36 37l5 9M26 34l-9 2M38 34l9 3"/></g><ellipse cx="34" cy="26" rx="11" ry="4" transform="rotate(-25 34 26)" fill="rgba(255,255,255,.7)" stroke="#555" stroke-width="1"/><ellipse cx="31" cy="28" rx="9" ry="3.4" transform="rotate(-40 31 28)" fill="rgba(255,255,255,.55)" stroke="#555" stroke-width="1"/><path d="M28 34q10-1 20 3q-10 2-20 0z" fill="${body}"/><circle cx="25" cy="33" r="3.2" fill="${body}"/><path d="M23 34l-8 3" stroke="#1d1d1f" stroke-width="1.6" stroke-linecap="round"/>${extra || ''}`;
    switch (id) {
      case 'egg': return wrap(`<g fill="#fff" stroke="#8a6d3b" stroke-width="1.2"><ellipse cx="24" cy="30" rx="5" ry="7"/><ellipse cx="34" cy="27" rx="5" ry="7"/><ellipse cx="42" cy="33" rx="5" ry="7"/><ellipse cx="29" cy="40" rx="5" ry="7"/><ellipse cx="39" cy="42" rx="5" ry="7"/></g>`, '#FFE8A3');
      case 'larva': return wrap(`<path d="M18 40c4-10 8-10 12 0s8 10 12 0 6-8 8-4" fill="none" stroke="#5a4632" stroke-width="7" stroke-linecap="round"/><circle cx="20" cy="36" r="4.5" fill="#5a4632"/><circle cx="19" cy="35" r="1.3" fill="#fff"/>`, '#CFEFFF');
      case 'pupa': return wrap(`<path d="M38 20c10 0 12 14 2 20s-18 8-20 14" fill="none" stroke="#6b4f2a" stroke-width="9" stroke-linecap="round"/><circle cx="38" cy="22" r="8" fill="#6b4f2a"/><circle cx="36" cy="20" r="2" fill="#fff"/>`, '#D9F2D0');
      case 'adult': return wrap(mosq('#2b2b2f'), '#E9EEF5');
      case 'culex': return wrap(mosq('#8B3A2F'), '#FFD9D1');
      case 'tritaen': return wrap(mosq('#B03A2E', '<circle cx="46" cy="36" r="2" fill="#fff"/>'), '#FFE3C2');
      case 'albo': return wrap(mosq('#111', '<path d="M31 35h12" stroke="#fff" stroke-width="1.6"/><path d="M27 33l-2 1" stroke="#fff" stroke-width="2"/>'), '#DDE7F3');
      case 'anoph': return wrap(mosq('#3a2d22', '<circle cx="36" cy="25" r="1.4" fill="#3a2d22"/><circle cx="40" cy="23" r="1.4" fill="#3a2d22"/><circle cx="30" cy="27" r="1.4" fill="#3a2d22"/>'), '#F3E3C8');
      case 'aegypti': return wrap(mosq('#111', '<path d="M33 35h4M39 35h4" stroke="#fff" stroke-width="1.8"/><path d="M24 30q1 3 0 6" stroke="#fff" stroke-width="1.4"/>'), '#FFD6A5');
      default: return wrap('', '#eee');
    }
  }

  /* ---------- 게임 본체 ---------- */
  function setupGame() {
    const proto = document.getElementById('flyer');
    const card = proto && proto.closest('.hero-card');
    if (!proto || !card || reduceMotion) { if (proto) proto.hidden = true; return; }
    const hint = document.getElementById('sprayHint');
    const HIT = CFG.HIT_RADIUS || { mobile: 60, desktop: 46 };
    const BASE_HIT = small ? HIT.mobile : HIT.desktop;   // 이 거리 안이면 잡힌 것 (손가락은 정확하지 않아 휴대폰은 조금 넓게)
    const SPRAY = CFG.SPRAY || { cost: 12, refill: 32, lockMs: 1000 };
    const EV = CFG.EVENTS || {};
    const FREE = { count: 1, flee: 230, push: 3.2, jink: 0.9, vmax: 11, hit: 1 };   // 자유 모드 난이도
    let diff = FREE;                      // 지금 적용 중인 난이도
    let cx = null, cy = null;             // 모기약(마우스) 위치
    let level = null;                     // 오늘 모기지수 단계 (0~4)
    const flies = [];
    card.classList.add('spray');

    // 도전 상태
    const run = { on: false, stage: 0, target: 0, caught: 0, startAt: 0, endAt: 0, timer: null,
      base: 0, needQueen: false, swarmUntil: 0, swarmCheckAt: 0 };
    // 모기약 통 (0~100). 바닥나면 잠깐 못 뿌린다
    let tank = 100, tankLockUntil = 0, lastEmptyPopAt = 0;
    // 연속 잡기
    let combo = 0, lastKillAt = 0;

    /* --- 화면 조각: 도전 버튼·HUD --- */
    const hud = document.createElement('div');
    hud.className = 'ghud';
    hud.innerHTML = `
      <button type="button" class="ghud-go" id="gameGo"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg><span>도전</span></button>
      <div class="ghud-run" hidden>
        <span class="ghud-stage"></span>
        <span class="ghud-count"><b>0</b>/0</span>
        <span class="ghud-time">0:00</span>
        <button type="button" class="ghud-quit" aria-label="도전 그만두기">×</button>
      </div>`;
    card.appendChild(hud);
    const tankEl = document.createElement('div');
    tankEl.className = 'gtank';
    tankEl.setAttribute('aria-hidden', 'true');
    tankEl.innerHTML = '<span>모기약</span><i><b></b></i>';
    card.appendChild(tankEl);
    const tankBar = tankEl.querySelector('b');
    const goBtn = hud.querySelector('#gameGo');
    const runBox = hud.querySelector('.ghud-run');
    const stageEl = hud.querySelector('.ghud-stage');
    const countEl = hud.querySelector('.ghud-count');
    const timeEl = hud.querySelector('.ghud-time');
    hud.querySelector('.ghud-quit').addEventListener('click', () => endRun(false, true));
    goBtn.addEventListener('click', () => openStagePicker());
    // HUD·카드 위에서는 스프레이가 나가지 않게 (버튼이 먹게)
    hud.addEventListener('pointerdown', (e) => e.stopPropagation());

    function openStages() {
      const lv = level == null ? 2 : level;
      const open = (CFG.OPEN_STAGES_BY_LEVEL || [3, 3, 4, 5, 6])[lv] || 3;
      return Math.min(open, STAGES.length);
    }
    function fmt(ms) { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

    /* --- 단계 고르기 카드 --- */
    function openStagePicker() {
      if (state.today.runs >= (CFG.DAILY_PLAY_LIMIT || 30)) { overlay(`<p class="egg-k">오늘은 여기까지</p><p class="egg-t">하루 ${CFG.DAILY_PLAY_LIMIT}번까지 도전할 수 있어요</p><p class="egg-p">잡은 수는 그대로 남아요. 내일 다시 도전해 주세요.</p>`, [['닫기', null]]); return; }
      const open = openStages();
      const unlocked = Math.min(open, state.bestStage + 1);   // 깬 단계 다음까지, 오늘 열린 단계 안에서
      const rows = STAGES.map((s, i) => {
        const n = i + 1, ok = n <= unlocked, todayLocked = n > open;
        return `<button type="button" class="stg${ok ? '' : ' is-locked'}" data-stage="${n}" ${ok ? '' : 'disabled'}><b>${n}단계</b><span>${s.target.toLocaleString('ko-KR')}마리 · ${fmt(s.seconds * 1000)}</span><i>${n <= state.bestStage ? '완료' : ok ? '도전 가능' : todayLocked ? '모기가 더 많은 날 열려요' : '이전 단계 먼저'}</i></button>`;
      }).join('');
      const box = overlay(`<p class="egg-k">모기 잡기 도전</p><p class="egg-t">몇 단계에 도전할까요?</p><p class="egg-p">제한 시간 안에 목표 마리 수를 잡으면 다음 단계가 열려요. 실패해도 잡은 수는 남아요.<br>오늘 모기지수 단계로 ${open}단계까지 열렸어요.</p><div class="stg-list">${rows}</div>`, [['닫기', null]]);
      box.querySelectorAll('.stg:not([disabled])').forEach((b) => b.addEventListener('click', () => { box.remove(); startRun(Number(b.dataset.stage)); }));
    }

    /* --- 도전 시작·끝 --- */
    function startRun(n) {
      const s = STAGES[n - 1]; if (!s) return;
      run.on = true; run.stage = n; run.target = s.target; run.caught = 0; run.startAt = performance.now(); run.endAt = run.startAt + s.seconds * 1000;
      diff = DIFF[Math.min(n - 1, DIFF.length - 1)];
      const cnt = Math.max(1, Math.round(diff.count * (small ? (CFG.MOBILE_COUNT_SCALE || 0.7) : 1)));
      run.base = cnt; run.needQueen = false; run.swarmUntil = 0; run.swarmCheckAt = run.startAt + 1000;
      combo = 0; tank = 100; tankLockUntil = 0;
      flies.forEach((f) => { f.queen = 0; setLook(f); });
      setCount(cnt);
      goBtn.hidden = true; runBox.hidden = false; if (hint) hint.hidden = true;
      stageEl.textContent = `${n}단계`;
      countEl.innerHTML = `<b>0</b>/${run.target.toLocaleString('ko-KR')}`;
      state.today.runs += 1; save();
      card.classList.add('in-run');
      run.timer = setInterval(() => {
        const left = run.endAt - performance.now();
        timeEl.textContent = fmt(left);
        timeEl.classList.toggle('is-low', left < 10000);
        if (left <= 0) endRun(false);
      }, 200);
    }
    function endRun(success, quit) {
      if (!run.on) return;
      clearInterval(run.timer); run.timer = null;
      run.on = false;
      const ms = Math.round(performance.now() - run.startAt);
      card.classList.remove('in-run');
      run.needQueen = false; run.swarmUntil = 0;
      flies.forEach((f) => { f.queen = 0; setLook(f); });
      goBtn.hidden = false; runBox.hidden = true;
      if (success) state.bestStage = Math.max(state.bestStage, run.stage);
      const rec = { stage: run.stage, kills: run.caught, ms, ok: !!success, at: new Date().toISOString() };
      state.history.unshift(rec); state.history = state.history.slice(0, 50);
      if (!quit) state.pending.push(rec);
      save();
      if (!quit) syncPending();
      diff = FREE; applyFreeCount();
      if (quit) return;
      const next = run.stage + 1, canNext = success && next <= openStages() && STAGES[next - 1];
      if (success) {
        overlay(`<p class="egg-k">${run.stage}단계 성공</p><p class="egg-n">${run.caught.toLocaleString('ko-KR')}<small>마리</small></p><p class="egg-t">${fmt(ms)} 만에 다 잡았어요</p><p class="egg-p">${canNext ? `다음은 ${next}단계, ${STAGES[next - 1].target.toLocaleString('ko-KR')}마리예요.` : next <= STAGES.length ? '다음 단계는 모기가 더 많은 날 열려요.' : '모든 단계를 깼어요. 전설입니다.'}</p>`,
          canNext ? [[`${next}단계 도전`, () => startRun(next)], ['그만', null]] : [['닫기', null]]);
      } else {
        overlay(`<p class="egg-k">${run.stage}단계 실패</p><p class="egg-n">${run.caught.toLocaleString('ko-KR')}<small>/${run.target.toLocaleString('ko-KR')}</small></p><p class="egg-t">시간이 다 됐어요</p><p class="egg-p">잡은 ${run.caught}마리는 누적에 남았어요. 지금까지 ${state.kills.toLocaleString('ko-KR')}마리.</p>`,
          [['다시 도전', () => startRun(run.stage)], ['그만', null]]);
      }
    }
    // 서버로 보내기: 로그인 상태면 도전 기록을 보낸다. 안 되면 pending 에 남겨 다음에 다시
    async function syncPending() {
      const A = window.MZAuth;
      if (!A || !A.enabled || !A.user() || !state.pending.length) return;
      const batch = state.pending.slice(0, 10);
      try {
        const r = await A.submitRuns(batch);
        if (r && r.ok) { state.pending = state.pending.slice(batch.length); save(); }
      } catch (e) { /* 다음 기회에 */ }
    }
    document.addEventListener('auth:changed', syncPending);

    /* --- 덮는 카드 (결과·단계 고르기·배지) --- */
    function overlay(inner, buttons, cls) {
      card.querySelectorAll('.egg').forEach((e) => e.remove());
      const egg = document.createElement('div');
      egg.className = 'egg' + (cls ? ' ' + cls : '');
      egg.setAttribute('role', 'dialog');
      egg.innerHTML = `<div class="egg-rain" aria-hidden="true"></div><div class="egg-card">${inner}<div class="egg-btns"></div></div>`;
      const btns = egg.querySelector('.egg-btns');
      (buttons || [['닫기', null]]).forEach(([label, fn], i) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = i === 0 ? 'btn-main' : 'btn-sub'; b.textContent = label;
        b.addEventListener('click', () => { egg.remove(); if (fn) fn(); });
        btns.appendChild(b);
      });
      egg.addEventListener('pointerdown', (e) => e.stopPropagation());   // 카드 위에선 스프레이가 나가지 않는다
      card.appendChild(egg);
      const first = btns.querySelector('button'); if (first) first.focus();
      return egg;
    }
    // 배지 카드: 임명장. 모기 떼가 떨어진다
    function showBadge(b, onClose) {
      const egg = overlay(`<div class="bdg-hero">${badgeIcon(b.id, 112)}</div><p class="egg-k">모기제로 배지 · ${BADGES.indexOf(b) + 1}/${BADGES.length}</p><p class="egg-t">${b.name} · ${b.title}</p><p class="egg-n">${b.need.toLocaleString('ko-KR')}<small>마리</small></p><p class="egg-p">${b.text}</p><p class="egg-d">${new Date().toLocaleDateString('ko-KR')} · 모기제로 임명장</p>`,
        [['계속 잡기', onClose || null], ['내 배지 보기', () => { location.href = 'me.html#badges'; }]], 'egg-badge');
      const rain = egg.querySelector('.egg-rain');
      if (!reduceMotion) for (let i = 0; i < 20; i++) { const m = proto.cloneNode(true); m.removeAttribute('id'); m.className = 'flyer egg-fly'; m.style.left = (Math.random() * 100) + '%'; m.style.setProperty('--d', (Math.random() * 1.8).toFixed(2) + 's'); m.style.setProperty('--r', (Math.random() * 720 - 360).toFixed(0) + 'deg'); rain.appendChild(m); }
    }
    function awardDue() {
      const due = dueBadges();
      if (!due.length) return;
      const b = due[0];
      state.badges.push(b.id); save();
      setTimeout(() => showBadge(b, () => awardDue()), 600);
    }

    /* --- 모기 --- */
    function pick(f, now) {
      const W = card.clientWidth, H = card.clientHeight;
      f.gx = W * (0.12 + Math.random() * 0.76); f.gy = H * (0.1 + Math.random() * 0.55);
      f.nextPick = now + 1800 + Math.random() * 1400;
    }
    function spawn(f, now, fromEdge) {
      const W = card.clientWidth, H = card.clientHeight;
      if (fromEdge) { f.x = Math.random() < 0.5 ? -40 : W + 40; f.y = H * (0.15 + Math.random() * 0.4); f.entering = true; }
      else { f.x = W * (0.3 + Math.random() * 0.5); f.y = H * (0.15 + Math.random() * 0.4); f.entering = false; }
      f.vx = 0; f.vy = 0; f.alpha = 1; f.spin = 0; f.dead = 0; f.face = 1;
      f.el.style.opacity = '1';
      const g = EV.golden;
      f.golden = Boolean(g) && Math.random() < (run.on ? g.chanceRun : g.chanceFree);
      f.queen = 0;
      setLook(f);
      pick(f, now);
    }
    // 황금·여왕 모기는 모양을 바꿔 보여 준다 (design.css .is-golden / .is-queen)
    function setLook(f) {
      f.el.classList.toggle('is-golden', Boolean(f.golden));
      f.el.classList.toggle('is-queen', f.queen > 0);
    }
    // 가운데 위에 잠깐 뜨는 알림 (모기떼·여왕 등장)
    function banner(text) {
      card.querySelectorAll('.gbanner').forEach((e) => e.remove());
      const b = document.createElement('div');
      b.className = 'gbanner';
      b.setAttribute('role', 'status');
      b.textContent = text;
      card.appendChild(b);
      setTimeout(() => b.remove(), 2200);
    }
    function popAt(x, y, text, cls) {
      const pop = document.createElement('span');
      pop.className = 'kill-pop' + (cls ? ' ' + cls : '');
      pop.textContent = text;
      pop.style.left = x + 'px'; pop.style.top = y + 'px';
      card.appendChild(pop);
      setTimeout(() => pop.remove(), 1200);
    }
    function addFly(fromEdge) {
      const el = flies.length ? proto.cloneNode(true) : proto;
      if (el !== proto) { el.removeAttribute('id'); card.appendChild(el); }
      el.hidden = false;
      const f = { el, phase: Math.random() * 10, x: 0, y: 0, vx: 0, vy: 0, gx: 0, gy: 0, nextPick: 0, dead: 0, spin: 0, alpha: 1, face: 1, entering: false, golden: false, queen: 0, dartAt: 0 };
      spawn(f, performance.now(), fromEdge);
      flies.push(f);
    }
    function setCount(n) {
      while (flies.length < n) addFly(true);
      while (flies.length > n) { const f = flies.pop(); if (f.el !== proto) f.el.remove(); else f.el.hidden = true; }
      if (hint && !run.on) hint.textContent = (n > 1 ? `모기 ${n}마리 · 눌러서 잡아 보세요` : '모기를 눌러서 잡아 보세요') + (state.kills ? ` · 지금까지 ${state.kills.toLocaleString('ko-KR')}마리` : '');
    }
    function applyFreeCount() {
      const table = small ? (CFG.FREE_COUNT_BY_LEVEL_MOBILE || [1, 1, 2, 3, 5]) : (CFG.FREE_COUNT_BY_LEVEL || [1, 2, 3, 5, 8]);
      let n = table[level == null ? 0 : level];
      if (isDusk()) n += (EV.dusk && EV.dusk.extra) || 0;
      setCount(n);
      if (isDusk() && hint && !run.on) hint.textContent = '해 질 무렵이라 모기가 더 많아요 · ' + hint.textContent;
    }
    // 지금이 해 질 무렵인지 (실제 시각 기준)
    function isDusk() {
      const d = EV.dusk; if (!d) return false;
      const h = new Date().getHours();
      return h >= d.from && h < d.to;
    }
    document.addEventListener('mosquito:updated', (e) => {
      const idx = e.detail && e.detail.index;
      if (idx == null) return;
      const n = Math.round(idx);
      level = n <= 20 ? 0 : n <= 40 ? 1 : n <= 60 ? 2 : n <= 80 ? 3 : 4;
      if (!run.on) applyFreeCount();
      goBtn.querySelector('span').textContent = `도전 · ${openStages()}단계까지`;
    });

    card.addEventListener('pointermove', (e) => { const r = card.getBoundingClientRect(); cx = e.clientX - r.left; cy = e.clientY - r.top; });
    function spray(px, py) {
      const now = performance.now();
      // 모기약 통이 바닥나면 잠깐 못 뿌린다
      if (now < tankLockUntil || tank < SPRAY.cost) {
        if (now - lastEmptyPopAt > 900) { lastEmptyPopAt = now; popAt(px, py - 20, '모기약 채우는 중…', 'is-empty'); }
        return;
      }
      tank -= SPRAY.cost;
      if (tank < SPRAY.cost) tankLockUntil = now + SPRAY.lockMs;
      puff(px, py);
      const hitR = BASE_HIT * (diff.hit || 1);
      flies.forEach((f) => {
        if (f.dead) return;
        const d = Math.hypot(px - f.x, py - f.y);
        if (d <= hitR * (f.queen ? 1.4 : 1)) {
          // 여왕 모기는 여러 번 맞혀야 한다. 맞을 때마다 멀리 튕겨 나간다
          if (f.queen > 1) {
            f.queen -= 1;
            const a = Math.random() * Math.PI * 2;
            f.vx += Math.cos(a) * 18; f.vy += Math.sin(a) * 18;
            popAt(f.x, f.y - 30, `여왕 모기 · ${f.queen}번 더`, 'is-queen');
            return;
          }
          kill(f); return;
        }
        if (d < 200) { const k = (1 - d / 200) * 14; f.vx += ((f.x - px) / d) * k; f.vy += ((f.y - py) / d) * k; }
      });
    }
    // 누르면 한 번, 꾹 누르고 있으면 0.12초마다 연사. 손가락·마우스를 움직이면 그 자리를 따라간다
    let sprayTimer = null;
    const stopSpray = () => { if (sprayTimer) { clearInterval(sprayTimer); sprayTimer = null; } };
    let downAt = 0;
    card.addEventListener('pointerdown', (e) => {
      if (e.target.closest && e.target.closest('.egg, .ghud, .hm-toggle')) return;
      const r = card.getBoundingClientRect();
      cx = e.clientX - r.left; cy = e.clientY - r.top;
      downAt = performance.now();
      try { card.setPointerCapture(e.pointerId); } catch (err) { /* 지원 안 하는 브라우저 */ }
      spray(cx, cy);
      stopSpray();
      sprayTimer = setInterval(() => { if (cx != null) spray(cx, cy); }, 120);
    });
    ['pointerup', 'pointercancel'].forEach((ev) => card.addEventListener(ev, stopSpray));
    card.addEventListener('pointerleave', () => { if (!sprayTimer) { cx = null; cy = null; } });
    card.addEventListener('touchmove', (e) => {
      if (!sprayTimer) return;
      if (performance.now() - downAt > 180) e.preventDefault();
      else stopSpray();
    }, { passive: false });
    window.addEventListener('blur', stopSpray);
    card.addEventListener('contextmenu', (e) => e.preventDefault());

    function puff(px, py) {
      const p = document.createElement('div');
      p.className = 'puff';
      p.style.left = px + 'px'; p.style.top = py + 'px';
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + Math.random() * 0.6, d = 26 + Math.random() * 30;
        const b = document.createElement('i');
        b.style.setProperty('--dx', (Math.cos(a) * d).toFixed(0) + 'px');
        b.style.setProperty('--dy', (Math.sin(a) * d).toFixed(0) + 'px');
        p.appendChild(b);
      }
      card.appendChild(p);
      setTimeout(() => p.remove(), 800);
    }
    function kill(f) {
      const now = performance.now();
      const wasGolden = f.golden, wasQueen = f.queen > 0;
      f.dead = now; f.queen = 0; f.golden = false; setLook(f);
      state.kills += 1;
      if (wasGolden) state.golden += 1;
      // 마지막 한 마리가 여왕 모기일 때는 여왕을 잡아야 도전이 끝난다
      const counts = run.on && run.caught < run.target && (!run.needQueen || wasQueen);
      if (counts) {   // 목표를 채운 뒤 연사로 더 잡힌 건 도전 기록엔 안 넣는다 (서버 검사와 맞춤)
        run.caught += 1;
        countEl.innerHTML = `<b>${run.caught.toLocaleString('ko-KR')}</b>/${run.target.toLocaleString('ko-KR')}`;
      }
      save();
      // 연속 잡기
      combo = now - lastKillAt <= ((EV.combo && EV.combo.withinMs) || 1300) ? combo + 1 : 1;
      lastKillAt = now;
      let text = run.on ? `${run.caught}/${run.target}` : (state.kills === 1 ? '잡았다!' : `잡았다! ${state.kills.toLocaleString('ko-KR')}마리째`);
      let cls = '';
      if (wasGolden) {
        cls = 'is-golden';
        if (run.on && EV.golden) { run.endAt += EV.golden.bonusSec * 1000; text = `황금 모기! +${EV.golden.bonusSec}초`; }
        else text = '황금 모기를 잡았어요!';
      } else if (wasQueen) {
        cls = 'is-queen'; text = '여왕 모기를 잡았어요!';
      } else if (combo >= 3) {
        text = `${combo}연속! ` + text;
        if (run.on && EV.combo && combo % EV.combo.every === 0) { run.endAt += EV.combo.bonusSec * 1000; text = `${combo}연속! +${EV.combo.bonusSec}초`; }
      }
      popAt(f.x, f.y - 30, text, cls);
      // 여왕 등장: 목표까지 한 마리 남으면 살아 있는 모기 하나를 여왕으로 바꾼다
      if (run.on && EV.queen && run.stage >= EV.queen.fromStage && !run.needQueen && run.caught === run.target - 1) {
        run.needQueen = true;
        if (run.swarmUntil) { run.swarmUntil = 0; setCount(run.base); }   // 모기떼는 여왕이 나오면 끝
        const alive = flies.filter((x) => !x.dead);
        const q = alive.length ? alive[Math.floor(Math.random() * alive.length)] : null;
        if (q) { q.queen = EV.queen.hits; q.golden = false; setLook(q); }
        banner(`마지막은 여왕 모기! ${EV.queen.hits}번 맞혀야 해요`);
      }
      if (hint) hint.hidden = true;
      if (run.on && run.caught >= run.target) { setTimeout(() => endRun(true), 350); return; }
      if (!run.on && dueBadges().length) awardDue();
    }
    // 도전이 끝난 뒤에 배지를 준다 (도전 중엔 카드가 가리지 않게)
    document.addEventListener('game:changed', () => { if (!run.on && dueBadges().length && !card.querySelector('.egg')) awardDue(); });

    const t0 = performance.now();
    addFly(false);
    // 시연용: ?egg=1 → 100마리 배지, ?egg=아이디 → 그 배지 카드. 기록은 바꾸지 않는다
    try {
      const want = new URLSearchParams(location.search).get('egg');
      const b = want === '1' ? BADGES.find((x) => x.need === 100) : BADGES.find((x) => x.id === want || String(x.need) === want);
      if (b) setTimeout(() => showBadge(b), 1500);
    } catch (err) { /* 무시 */ }

    let lastTick = performance.now();
    function tick(now) {
      const t = (now - t0) / 1000, W = card.clientWidth, H = card.clientHeight;
      const dt = Math.min(0.1, Math.max(0, (now - lastTick) / 1000)); lastTick = now;
      // 모기약 통 다시 채우기 + 막대 표시 (가득 차 있으면 숨긴다)
      tank = Math.min(100, tank + SPRAY.refill * dt);
      tankBar.style.width = tank.toFixed(0) + '%';
      tankEl.classList.toggle('is-low', now < tankLockUntil);
      tankEl.classList.toggle('show', tank < 99.5);
      // 모기떼 습격 (도전 중, fromStage 단계부터, 1초마다 확률)
      const sw = EV.swarm;
      if (run.on && sw && run.stage >= sw.fromStage && !run.needQueen) {
        if (run.swarmUntil && now > run.swarmUntil) { run.swarmUntil = 0; setCount(run.base); }
        else if (!run.swarmUntil && now > run.swarmCheckAt) {
          run.swarmCheckAt = now + 1000;
          if (run.caught >= run.target * 0.2 && Math.random() < sw.chance) {
            run.swarmUntil = now + sw.ms;
            setCount(run.base + sw.extra);
            banner('모기떼가 몰려와요!');
          }
        }
      }
      const swarmBoost = run.swarmUntil ? ((sw && sw.speed) || 1) : 1;
      const dart = EV.dart;
      flies.forEach((f) => {
        const el = f.el;
        if (f.dead) {
          const k = (now - f.dead) / 1000;
          f.vy += 0.9; f.x += f.vx * 0.3; f.y += f.vy; f.spin += 28; f.alpha = Math.max(0, 1 - k * 1.1);
          el.style.opacity = f.alpha.toFixed(2);
          el.style.transform = `translate(${f.x.toFixed(1)}px, ${f.y.toFixed(1)}px) translate(-50%, -50%) rotate(${f.spin}deg)`;
          if (k > (run.on ? 0.6 : 1.1)) {
            spawn(f, now, true);   // 도전 중엔 새 모기가 더 빨리 들어온다
            // 여왕이 필요한데 살아 있는 여왕이 없으면 새로 들어오는 모기를 여왕으로
            if (run.on && run.needQueen && !flies.some((x) => x.queen > 0 && !x.dead)) { f.queen = EV.queen.hits; f.golden = false; setLook(f); }
          }
          return;
        }
        if (now > f.nextPick) pick(f, now);
        let fleeing = false;
        if (cx != null) {
          const dx = f.x - cx, dy = f.y - cy, d = Math.hypot(dx, dy);
          if (d < diff.flee && d > 1) {
            fleeing = true;
            const k = (1 - d / diff.flee) * diff.push;
            f.vx += (dx / d) * k; f.vy += (dy / d) * k;
            if (!f.jinkAt || now > f.jinkAt) { f.jinkAt = now + 400; f.jinkDir = Math.random() < 0.5 ? -1 : 1; }
            f.vx += (-dy / d) * k * diff.jink * f.jinkDir; f.vy += (dx / d) * k * diff.jink * f.jinkDir;
            if (f.x < 60) f.vx += 1.2; if (f.x > W - 60) f.vx -= 1.2; if (f.y < 60) f.vy += 1.2; if (f.y > H - 60) f.vy -= 1.2;
          }
        }
        f.vx += (f.gx - f.x) * 0.01; f.vy += (f.gy - f.y) * 0.01;
        // 갑자기 꺾기: 가끔 휙 다른 방향으로 (손가락이 닿기 전에도 예측하기 어렵게)
        if (dart && now > f.dartAt) {
          if (f.dartAt) { const a = Math.random() * Math.PI * 2, pw = dart.power * (diff.jink || 1); f.vx += Math.cos(a) * pw; f.vy += Math.sin(a) * pw; }
          f.dartAt = now + dart.minMs + Math.random() * (dart.maxMs - dart.minMs);
        }
        const speedUp = (f.golden ? ((EV.golden && EV.golden.speed) || 1) : 1) * swarmBoost * (f.queen ? 0.8 : 1);
        const damp = fleeing ? 0.94 : 0.9, vmax = (fleeing ? diff.vmax : 6) * speedUp;
        f.vx *= damp; f.vy *= damp;
        const sp = Math.hypot(f.vx, f.vy);
        if (sp > vmax) { f.vx *= vmax / sp; f.vy *= vmax / sp; }
        const tp = t + f.phase;
        f.x += f.vx + Math.sin(tp * 23) * 1.4 + Math.sin(tp * 7.3) * 0.9;
        f.y += f.vy + Math.cos(tp * 19) * 1.3 + Math.sin(tp * 5.1) * 1.1;
        if (f.entering && f.x > 20 && f.x < W - 20) f.entering = false;
        if (!f.entering) { f.x = Math.max(20, Math.min(W - 20, f.x)); f.y = Math.max(20, Math.min(H - 20, f.y)); }
        if (Math.abs(f.vx) > 0.4) f.face = f.vx > 0 ? -1 : 1;
        const tilt = Math.max(-25, Math.min(25, f.vy * 3));
        el.style.transform = `translate(${f.x.toFixed(1)}px, ${f.y.toFixed(1)}px) translate(-50%, -50%) scaleX(${f.face}) rotate(${(tilt * -f.face).toFixed(1)}deg)`;
      });
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    // 로그인돼 있으면 밀린 기록을 보낸다
    setTimeout(syncPending, 3000);
  }

  // 다른 화면에서 쓰는 공개 함수
  window.MZGame = {
    state: () => JSON.parse(JSON.stringify(state)),
    badges: BADGES,
    badgeIcon,
    stages: STAGES,
    // 서버에서 받은 누적값이 더 크면 그걸 믿는다 (다른 기기에서 잡은 것)
    mergeServer: (srv) => {
      if (!srv) return;
      if (srv.total_kills > state.kills) state.kills = srv.total_kills;
      if (srv.best_stage > state.bestStage) state.bestStage = srv.best_stage;
      (srv.badges || []).forEach((id) => { if (!state.badges.includes(id)) state.badges.push(id); });
      save();
    },
  };
  document.addEventListener('DOMContentLoaded', setupGame);
}());
