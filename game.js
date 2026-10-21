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
      s = { kills: Math.max(0, old), bestStage: 0, badges: [], today: { date: todayKey(), runs: 0 }, history: [], pending: [], golden: 0, elites: 0, bosses: 0, gold: 0, weapons: ['spray'], weapon: 'spray' };
    }
    if (!s.today || s.today.date !== todayKey()) s.today = { date: todayKey(), runs: 0 };
    s.badges = Array.isArray(s.badges) ? s.badges : [];
    s.history = Array.isArray(s.history) ? s.history : [];
    s.pending = Array.isArray(s.pending) ? s.pending : [];
    s.kills = Number(s.kills) || 0;
    s.bestStage = Number(s.bestStage) || 0;
    s.golden = Number(s.golden) || 0;   // 잡은 황금 모기 수
    s.elites = Number(s.elites) || 0;   // 잡은 엘리트 모기 수
    s.bosses = Number(s.bosses) || 0;   // 잡은 보스 모기 수
    s.gold = Number(s.gold) || 0;       // 골드 (상점에서 무기 사기)
    s.weapons = Array.isArray(s.weapons) && s.weapons.length ? s.weapons : ['spray'];   // 가진 무기
    if (!s.weapons.includes(s.weapon)) s.weapon = 'spray';                              // 들고 있는 무기
    s.weaponLv = s.weaponLv && typeof s.weaponLv === 'object' ? s.weaponLv : {};
    // 없앤 무기는 가지고 있었으면 산 값을 골드로 돌려준다 (2026-10-21 대형 분무기)
    const RETIRED = { fogger: 600 };
    Object.keys(RETIRED).forEach((id) => {
      if (!s.weapons.includes(id)) return;
      s.weapons = s.weapons.filter((x) => x !== id);
      s.gold = (Number(s.gold) || 0) + RETIRED[id];
      delete s.weaponLv[id];
      if (s.weapon === id) s.weapon = 'spray';
    });          // 무기 강화 단계 { 무기: 1~5 }
    return s;
  }
  const state = loadState();
  function writeLocal() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); localStorage.setItem('mz-kills', String(state.kills)); } catch (e) { /* 저장 못 해도 게임은 된다 */ }
  }
  function save() {
    writeLocal();
    document.dispatchEvent(new CustomEvent('game:changed', { detail: { kills: state.kills } }));
    if (window.MZAuth && window.MZAuth.touch) window.MZAuth.touch('game');   // 로그인했으면 3초 뒤 계정에도 보관
  }
  // 계정 보관 (auth.js bindSync): 잡은 수·골드·무기·특별 모기 수·최고 단계·배지·최근 도전 50판
  //   랭킹은 이 값을 쓰지 않는다(서버가 검사한 도전 기록으로만). 다른 폰에서 로그인해도 이어 하게 하는 용도
  const NUM_FIELDS = ['kills', 'bestStage', 'golden', 'elites', 'bosses', 'gold'];
  function gameSnapshot() {
    const o = {};
    NUM_FIELDS.forEach((k) => { o[k] = state[k]; });
    return Object.assign(o, { weapons: state.weapons, weapon: state.weapon, weaponLv: state.weaponLv, badges: state.badges, history: state.history.slice(0, 50) });
  }
  function applyGame(d, merge, why) {
    d = d || {};
    NUM_FIELDS.forEach((k) => { const v = Math.max(0, Number(d[k]) || 0); state[k] = merge ? Math.max(Number(state[k]) || 0, v) : v; });
    // 계정이 바뀌면(로그인·로그아웃·다른 계정) 이 기기에 밀린 기록은 버린다 — 손님 기록이 계정 랭킹으로 가지 않게
    if (why === 'link' || why === 'switch' || why === 'logout') { state.pending = []; state.today = { date: todayKey(), runs: 0 }; }
    const w = Array.isArray(d.weapons) ? d.weapons.filter((x) => typeof x === 'string') : [];
    state.weapons = merge ? Array.from(new Set(state.weapons.concat(w))) : w.slice();
    const known = (CFG.WEAPONS || []).map((x) => x.id);
    if (known.length) state.weapons = state.weapons.filter((x) => known.includes(x));   // 없앤 무기는 빼기
    if (!state.weapons.includes('spray')) state.weapons.unshift('spray');
    if (!merge && typeof d.weapon === 'string') state.weapon = d.weapon;
    if (!state.weapons.includes(state.weapon)) state.weapon = 'spray';
    const lv = d.weaponLv && typeof d.weaponLv === 'object' ? d.weaponLv : {};
    if (!merge) state.weaponLv = {};
    Object.keys(lv).forEach((k) => { const v = Math.min(9, Math.max(1, Number(lv[k]) || 1)); state.weaponLv[k] = merge ? Math.max(state.weaponLv[k] || 1, v) : v; });
    const b = Array.isArray(d.badges) ? d.badges.filter((x) => typeof x === 'string') : [];
    state.badges = merge ? Array.from(new Set(state.badges.concat(b))) : b;
    const h = (Array.isArray(d.history) ? d.history : []).filter((r) => r && r.at);
    const all = merge ? h.concat(state.history) : h;
    state.history = all.filter((r, i) => all.findIndex((x) => x.at === r.at) === i).sort((x, y) => String(y.at).localeCompare(String(x.at))).slice(0, 50);
    writeLocal();
    document.dispatchEvent(new CustomEvent('game:changed', { detail: { kills: state.kills, synced: true } }));
    // 로그인한 계정의 잡은 수·최고 단계·배지는 서버가 검사한 값으로 맞춘다
    const A = window.MZAuth;
    if ((why === 'link' || why === 'switch' || why === 'newer') && A && A.myScore) {
      Promise.all([A.myScore(), A.myBadges()]).then(([sc, bd]) => {
        state.kills = sc ? sc.total_kills : 0;
        state.bestStage = sc ? sc.best_stage : 0;
        state.badges = (bd || []).map((x) => x.badge_id);
        writeLocal();
        document.dispatchEvent(new CustomEvent('game:changed', { detail: { kills: state.kills, synced: true } }));
      }).catch(() => { /* 다음에 */ });
    }
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

  // 상점 무기 그림 (작은 선 그림)
  const WEAPON_ICON = {
    spray: '<svg viewBox="0 0 40 40" width="40" height="40"><rect x="13" y="12" width="14" height="24" rx="3" fill="#3182F6"/><rect x="16" y="6" width="8" height="7" rx="1.5" fill="#1B64DA"/><path d="M24 8h6" stroke="#8B95A1" stroke-width="2.4" stroke-linecap="round"/><circle cx="33" cy="6" r="1.6" fill="#8B95A1"/><circle cx="35" cy="10" r="1.3" fill="#8B95A1"/></svg>',
    racket: '<svg viewBox="0 0 40 40" width="40" height="40"><ellipse cx="22" cy="15" rx="11" ry="12" fill="none" stroke="#F2C94C" stroke-width="3"/><path d="M14 15h16M22 4v22M17 8l10 14M27 8 17 22" stroke="#F2C94C" stroke-width="1"/><path d="m15 25-7 11" stroke="#191F28" stroke-width="4" stroke-linecap="round"/><path d="m29 2-3 5h3l-2 5" stroke="#3182F6" stroke-width="1.6" fill="none"/></svg>',
    fogger: '<svg viewBox="0 0 40 40" width="40" height="40"><rect x="6" y="14" width="20" height="20" rx="5" fill="#0E9F6E"/><rect x="11" y="9" width="10" height="6" rx="2" fill="#0B7A55"/><path d="M26 20h6l4-3" stroke="#4E5968" stroke-width="2.6" stroke-linecap="round" fill="none"/><circle cx="37" cy="13" r="2" fill="#B0B8C1"/></svg>',
    coil: '<svg viewBox="0 0 40 40" width="40" height="40"><path d="M20 30c-7 0-11-4-11-9s4-9 11-9 8 3 8 6-3 5-7 5-4-2-4-3" fill="none" stroke="#2E7D32" stroke-width="3" stroke-linecap="round"/><path d="M17 23c0-3 2-5 5-5" stroke="#E5484D" stroke-width="2" fill="none"/><path d="M14 9c1-2 0-4 1-6M20 8c1-2 0-4 1-6" stroke="#B0B8C1" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>',
    laser: '<svg viewBox="0 0 40 40" width="40" height="40"><rect x="4" y="16" width="18" height="9" rx="3" fill="#6B21A8"/><rect x="8" y="24" width="6" height="10" rx="2" fill="#4C1D95"/><path d="M22 20h16" stroke="#E5484D" stroke-width="2.4" stroke-linecap="round"/><circle cx="38" cy="20" r="2" fill="#FF8A8A"/></svg>',
  };

  /* ---------- 효과음 (Web Audio) ----------
     소리 파일 없이 브라우저에서 바로 만든다(사이트가 무거워지지 않게). 무기마다 다른 소리, 잡을 때 '퍽', 보스는 '쾅'.
     브라우저 규칙상 화면을 한 번 누른 뒤에만 소리가 난다. 오른쪽 위 스피커 버튼으로 끄고 켠다(이 기기에 기억). */
  const Sound = (function () {
    let ctx = null;
    let on = true;
    try { on = localStorage.getItem('mz-sound') !== 'off'; } catch (e) { on = true; }
    function ac() {
      if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    // 잡음(치익 소리 재료)
    function noise(c, dur) {
      const b = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource(); src.buffer = b; return src;
    }
    // 소리 크기 곡선: 빨리 커졌다가 dur 동안 줄어든다
    function amp(c, peak, dur, attack) {
      const g = c.createGain(), t = c.currentTime;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + (attack || 0.005));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      g.connect(c.destination); return g;
    }
    function filt(c, type, freq, q) { const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; if (q) f.Q.value = q; return f; }
    function tone(c, type, f0, f1, dur, peak) {
      const o = c.createOscillator(), t = c.currentTime;
      o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      o.connect(amp(c, peak, dur)); o.start(t); o.stop(t + dur + 0.02);
    }
    function hiss(c, dur, type, freq, peak, q) {
      const n = noise(c, dur), f = filt(c, type, freq, q);
      n.connect(f); f.connect(amp(c, peak, dur, 0.01)); n.start();
    }
    const SFX = {
      spray: (c) => hiss(c, 0.18, 'bandpass', 4500, 0.25, 0.8),                                         // 치익
      zap: (c) => { tone(c, 'square', 140, 60, 0.12, 0.18); hiss(c, 0.09, 'highpass', 3000, 0.22); },     // 지직
      fog: (c) => hiss(c, 0.4, 'lowpass', 1600, 0.3),                                                    // 쉬이익
      coil: (c) => { hiss(c, 0.7, 'lowpass', 700, 0.25); tone(c, 'sine', 320, 180, 0.5, 0.06); },          // 스르륵
      laser: (c) => tone(c, 'sawtooth', 1900, 380, 0.11, 0.12),                                           // 퓽
      // 무기별 '잡았다' 소리
      killZap: (c) => { tone(c, 'square', 90, 40, 0.18, 0.25); hiss(c, 0.16, 'highpass', 4000, 0.3); setTimeout(() => hiss(c, 0.06, 'highpass', 5000, 0.2), 60); },   // 지지직
      killFog: (c) => { tone(c, 'sine', 240, 70, 0.22, 0.35); hiss(c, 0.25, 'lowpass', 900, 0.25); },     // 퍼엉
      killCoil: (c) => { hiss(c, 0.5, 'bandpass', 1200, 0.18, 0.6); tone(c, 'sine', 600, 250, 0.35, 0.08); },   // 스르륵
      killLaser: (c) => { tone(c, 'sawtooth', 2400, 900, 0.07, 0.12); hiss(c, 0.18, 'highpass', 6000, 0.22); },  // 치익
      kill: (c) => { tone(c, 'triangle', 520, 90, 0.12, 0.35); hiss(c, 0.05, 'highpass', 2000, 0.2); },   // 퍽
      big: (c) => { tone(c, 'square', 110, 45, 0.18, 0.28); hiss(c, 0.08, 'lowpass', 900, 0.3); },        // 쿵 (엘리트·보스 맞음)
      boom: (c) => { tone(c, 'sine', 90, 28, 0.9, 0.6); hiss(c, 0.9, 'lowpass', 600, 0.5); },             // 쾅 (보스 처치)
      coin: (c) => { tone(c, 'square', 988, 988, 0.08, 0.08); setTimeout(() => tone(c, 'square', 1319, 1319, 0.12, 0.08), 70); },   // 띠링
      empty: (c) => tone(c, 'square', 160, 150, 0.05, 0.08),                                              // 딸깍 (통 바닥)
    };
    let lastAt = {};
    return {
      play(name, gapMs) {
        if (!on || !SFX[name]) return;
        const now = performance.now();
        if (gapMs && lastAt[name] && now - lastAt[name] < gapMs) return;   // 연사 때 너무 겹치지 않게
        lastAt[name] = now;
        const c = ac(); if (!c) return;
        try { SFX[name](c); } catch (e) { /* 소리가 안 나도 게임은 된다 */ }
      },
      toggle() { on = !on; try { localStorage.setItem('mz-sound', on ? 'on' : 'off'); } catch (e) { /* 무시 */ } return on; },
      get on() { return on; },
    };
  }());

  /* ---------- 게임 본체 ---------- */
  function setupGame() {
    const proto = document.getElementById('flyer');
    const card = proto && proto.closest('.hero-card');
    if (!proto || !card || reduceMotion) { if (proto) proto.hidden = true; return; }
    const hint = document.getElementById('sprayHint');
    const HIT = CFG.HIT_RADIUS || { mobile: 60, desktop: 46 };
    const BASE_HIT = small ? HIT.mobile : HIT.desktop;   // 이 거리 안이면 잡힌 것 (손가락은 정확하지 않아 휴대폰은 조금 넓게)
    const SPRAY = CFG.SPRAY || { cost: 12, refill: 32, lockMs: 1000 };
    const WEAPONS = CFG.WEAPONS || [{ id: 'spray', name: '모기약 스프레이', price: 0, range: 1, cost: 1, refill: 1, sound: 'spray', text: '' }];
    const GOLD = CFG.GOLD || { normal: 1, golden: 5, elite: 10, boss: 50, stageClear: 10 };
    // 무기 강화: 단계(Lv)에 따라 범위·약 소모·충전·모기향을 좋게 한 값을 쓴다 (game-config.js UPGRADE)
    const UP = CFG.UPGRADE || { maxLv: 5, costRate: 0.5, minBase: 200, range: 0.08, cost: 0.08, refill: 0.1, coilRadius: 0.1, coilCooldown: 0.08 };
    const lvOf = (id) => Math.min(UP.maxLv, Math.max(1, Number(state.weaponLv[id]) || 1));
    const upCost = (w) => Math.round(Math.max(w.price || 0, UP.minBase) * UP.costRate * lvOf(w.id) / 10) * 10;
    const weapon = () => {
      const base = WEAPONS.find((w) => w.id === state.weapon) || WEAPONS[0];
      const k = lvOf(base.id) - 1;
      if (!k) return base;
      const w = Object.assign({}, base, {
        range: (base.range || 1) * (1 + UP.range * k),
        cost: (base.cost || 1) * Math.max(0.3, 1 - UP.cost * k),
        refill: (base.refill || 1) * (1 + UP.refill * k),
        power: (base.power || 1) + Math.floor(k / 2),
      });
      if (base.coil) w.coil = Object.assign({}, base.coil, { radius: Math.round(base.coil.radius * (1 + UP.coilRadius * k)), cooldownMs: Math.round(base.coil.cooldownMs * Math.max(0.4, 1 - UP.coilCooldown * k)) });
      return w;
    };
    const coils = [];        // 모기향 연기 { x, y, until, r, el, nextAt }
    let coilReadyAt = 0;
    const EV = CFG.EVENTS || {};
    const FREE = { count: 1, flee: 230, push: 3.2, jink: 0.9, vmax: 11, hit: 1 };   // 자유 모드 난이도
    let diff = FREE;                      // 지금 적용 중인 난이도
    let cx = null, cy = null;             // 모기약(마우스) 위치
    let level = null;                     // 오늘 모기지수 단계 (0~4)
    const flies = [];
    // 엘리트·보스와 그 분신은 일반 모기(flies)와 따로 둔다. 일반 모기 수(setCount)에 섞이지 않게
    const SP = CFG.SPECIAL || null;
    const extras = [];
    let baseKills = 0;   // 이 화면에서 잡은 일반 모기 수 (엘리트·보스 등장 기준)
    card.classList.add('spray');
    // 들고 있는 무기 모양을 마우스 커서로 (PC). 폰은 커서가 없어 누를 때 무기별 효과로 구분한다
    // 레이저 총: 카드 아래 가운데에 두고, 누르는 쪽으로 돌아가 총구에서 빔이 나간다
    const gun = document.createElement('div');
    gun.className = 'laser-gun'; gun.hidden = true; gun.setAttribute('aria-hidden', 'true');
    gun.innerHTML = '<svg viewBox="0 0 64 24" width="86" height="32"><rect x="0" y="5" width="40" height="14" rx="5" fill="#6B21A8" stroke="#fff" stroke-width="1.5"/><rect x="38" y="8" width="20" height="8" rx="3" fill="#4C1D95" stroke="#fff" stroke-width="1.2"/><circle cx="60" cy="12" r="3.2" fill="#FF6B6B"/><rect x="8" y="9" width="14" height="6" rx="2" fill="#C4B5FD"/></svg>';
    card.appendChild(gun);
    const GUN_LEN = 84;   // 총 끝(총구)까지 거리
    // 총 자리: 카드 오른쪽 아래 (아래 요약 카드·버튼에 가리지 않게 조금 위)
    function gunOrigin() { return { x: card.clientWidth - 90, y: card.clientHeight - 120 }; }
    function aimGun(x, y) {
      const o = gunOrigin();
      let ang = Math.atan2(y - o.y, x - o.x) * 180 / Math.PI;
      if (ang > -5) ang = ang > 90 ? -175 : -5;   // 아래쪽은 못 쏜다
      gun.style.left = o.x + 'px'; gun.style.top = o.y + 'px';
      gun.style.transform = `translate(0, -50%) rotate(${ang}deg)`;
      return ang;
    }
    function setCursor() {
      const id = (WEAPONS.find((w) => w.id === state.weapon) || WEAPONS[0]).id;
      const isGun = !!(WEAPONS.find((w) => w.id === id) || {}).beam;
      const svg = (WEAPON_ICON[id] || '').replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
      card.style.cursor = isGun ? 'crosshair' : svg ? `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") 20 20, crosshair` : '';
      card.dataset.weapon = id;
      gun.hidden = !isGun;
      if (isGun) aimGun(card.clientWidth / 2, card.clientHeight / 3);
    }
    card.addEventListener('pointermove', (e) => { if (!gun.hidden) { const r = card.getBoundingClientRect(); aimGun(e.clientX - r.left, e.clientY - r.top); } });
    window.addEventListener('resize', () => { if (!gun.hidden) aimGun(card.clientWidth / 2, card.clientHeight / 3); });
    setCursor();
    document.addEventListener('game:changed', (e) => { if (e.detail && e.detail.synced) setCursor(); });

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
      <button type="button" class="ghud-btn" id="gameSound" aria-label="효과음 끄기"></button>
      <button type="button" class="ghud-btn ghud-shop" id="gameShop" aria-label="상점 열기"><span aria-hidden="true">🪙</span><b id="gameGold">0</b></button>
      <button type="button" class="ghud-go" id="gameGo" aria-label="모기 잡기 도전"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg><span>도전</span></button>
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
    const bossBar = document.createElement('div');
    bossBar.className = 'gboss';
    bossBar.hidden = true;
    bossBar.innerHTML = '<p><b>보스 모기</b><span></span></p><i><b></b></i>';
    card.appendChild(bossBar);
    const goBtn = hud.querySelector('#gameGo');
    const runBox = hud.querySelector('.ghud-run');
    const stageEl = hud.querySelector('.ghud-stage');
    const countEl = hud.querySelector('.ghud-count');
    const timeEl = hud.querySelector('.ghud-time');
    hud.querySelector('.ghud-quit').addEventListener('click', () => endRun(false, true));
    goBtn.addEventListener('click', () => openStagePicker());
    const goldEl = hud.querySelector('#gameGold');
    const soundBtn = hud.querySelector('#gameSound');
    const SPK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9Z"/>';
    function drawSound() {
      soundBtn.innerHTML = SPK + (Sound.on ? '<path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>' : '<path d="m17 9 5 6M22 9l-5 6"/></svg>');
      soundBtn.setAttribute('aria-label', Sound.on ? '효과음 끄기' : '효과음 켜기');
    }
    drawSound();
    soundBtn.addEventListener('click', () => { Sound.toggle(); drawSound(); });
    hud.querySelector('#gameShop').addEventListener('click', () => openShop());
    function drawGold() { goldEl.textContent = state.gold.toLocaleString('ko-KR'); }
    // 계정에서 기록을 받아 오면 골드 숫자를 다시 그린다
    document.addEventListener('game:changed', (e) => { if (e.detail && e.detail.synced) drawGold(); });
    drawGold();
    function addGold(n) { if (!n) return; state.gold += n; drawGold(); }

    // 무기 성능 한 줄 (강화 단계 반영): 범위 · 약 소모 · 충전 · 위력
    function statLine(id) {
      const keep = state.weapon; state.weapon = id; const w = weapon(); state.weapon = keep;
      return `범위 ×${w.range.toFixed(1)} · 약 ×${(w.cost || 1).toFixed(2)} · 충전 ×${(w.refill || 1).toFixed(1)} · 위력 ${w.power || 1}`;
    }
    /* --- 상점: 골드로 무기를 사고, 가진 무기를 바꿔 든다 --- */
    function openShop() {
      const rows = WEAPONS.map((w) => {
        const owned = state.weapons.includes(w.id), equipped = state.weapon === w.id;
        const lv = lvOf(w.id), max = lv >= UP.maxLv, cost = upCost(w);
        const btn = equipped ? '<span class="shop-on">들고 있어요</span>'
          : owned ? `<button type="button" class="btn-sub" data-equip="${w.id}">들기</button>`
          : `<button type="button" class="btn-main" data-buy="${w.id}" ${state.gold < w.price ? 'disabled' : ''}>🪙 ${w.price.toLocaleString('ko-KR')}</button>`;
        // 가진 무기는 강화 버튼 (Lv.5 까지)
        const up = !owned ? '' : max ? '<span class="shop-max">최고 단계</span>'
          : `<button type="button" class="btn-sub shop-up" data-up="${w.id}" ${state.gold < cost ? 'disabled' : ''}>강화 🪙 ${cost.toLocaleString('ko-KR')}</button>`;
        return `<li class="shop-item${equipped ? ' is-on' : ''}"><span class="shop-ic" aria-hidden="true">${WEAPON_ICON[w.id] || ''}</span><span class="shop-txt"><b>${w.name}${owned ? ` <em class="shop-lv">Lv.${lv}</em>` : ''}</b><small>${w.text}</small><small class="shop-stat">${statLine(w.id)}</small></span><span class="shop-btns">${btn}${up}</span></li>`;
      }).join('');
      const box = overlay(`<p class="egg-k">모기 잡기 상점</p><p class="egg-t">🪙 ${state.gold.toLocaleString('ko-KR')} 골드</p><p class="egg-p">강화 한 단계마다 범위 +${Math.round(UP.range * 100)}% · 약 ${Math.round(UP.cost * 100)}% 덜 씀 · 충전 ${Math.round(UP.refill * 100)}% 빠름 · 2단계마다 위력 +1</p><ul class="shop-list">${rows}</ul>`, [['닫기', null]], 'egg-shop');
      box.querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => {
        const w = WEAPONS.find((x) => x.id === b.dataset.buy);
        if (!w || state.gold < w.price) return;
        state.gold -= w.price; state.weapons.push(w.id); state.weapon = w.id;
        save(); drawGold(); setCursor(); Sound.play('coin');
        openShop();
      }));
      box.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => {
        const w = WEAPONS.find((x) => x.id === b.dataset.up);
        if (!w || !state.weapons.includes(w.id) || lvOf(w.id) >= UP.maxLv) return;
        const cost = upCost(w);
        if (state.gold < cost) return;
        state.gold -= cost; state.weaponLv[w.id] = lvOf(w.id) + 1;
        save(); drawGold(); Sound.play('coin');
        openShop();
      }));
      box.querySelectorAll('[data-equip]').forEach((b) => b.addEventListener('click', () => {
        state.weapon = b.dataset.equip; save(); setCursor(); Sound.play(weapon().sound); openShop();
      }));
    }
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
      document.body.classList.add('game-run');   // 도전 중에는 지도 말풍선을 띄우지 않는다 (hero-map.js)
      run.on = true; run.stage = n; run.target = s.target; run.caught = 0; run.startAt = performance.now(); run.endAt = run.startAt + s.seconds * 1000;
      diff = DIFF[Math.min(n - 1, DIFF.length - 1)];
      const cnt = Math.max(1, Math.round(diff.count * (small ? (CFG.MOBILE_COUNT_SCALE || 0.7) : 1)));
      run.base = cnt; run.needQueen = false; run.swarmUntil = 0; run.swarmCheckAt = run.startAt + 1000;
      combo = 0; tank = 100; tankLockUntil = 0;
      clearExtras();
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
      run.on = false; document.body.classList.remove('game-run');
      const ms = Math.round(performance.now() - run.startAt);
      card.classList.remove('in-run');
      run.needQueen = false; run.swarmUntil = 0;
      flies.forEach((f) => { f.queen = 0; setLook(f); });
      clearExtras();
      goBtn.hidden = false; runBox.hidden = true;
      if (success) { state.bestStage = Math.max(state.bestStage, run.stage); addGold(run.stage * (GOLD.stageClear || 10)); }
      const rec = { stage: run.stage, kills: run.caught, ms, ok: !!success, at: new Date().toISOString() };
      state.history.unshift(rec); state.history = state.history.slice(0, 50);
      if (!quit && myUid()) state.pending.push(Object.assign({ uid: myUid() }, rec));   // 로그인했을 때만 서버로 보낼 기록에 넣는다
      save();
      if (!quit) syncPending();
      diff = FREE; applyFreeCount();
      if (quit) return;
      const next = run.stage + 1, canNext = success && next <= openStages() && STAGES[next - 1];
      if (success) {
        overlay(`<p class="egg-k">${run.stage}단계 성공</p><p class="egg-n">${run.caught.toLocaleString('ko-KR')}<small>마리</small></p><p class="egg-t">${fmt(ms)} 만에 다 잡았어요</p><p class="egg-p">${canNext ? `다음은 ${next}단계, ${STAGES[next - 1].target.toLocaleString('ko-KR')}마리예요.` : next <= STAGES.length ? '다음 단계는 모기가 더 많은 날 열려요.' : '모든 단계를 깼어요. 전설입니다.'}</p>${loginHint()}`,
          canNext ? [[`${next}단계 도전`, () => startRun(next)], ['그만', null]] : [['닫기', null]]);
      } else {
        overlay(`<p class="egg-k">${run.stage}단계 실패</p><p class="egg-n">${run.caught.toLocaleString('ko-KR')}<small>/${run.target.toLocaleString('ko-KR')}</small></p><p class="egg-t">시간이 다 됐어요</p><p class="egg-p">잡은 ${run.caught}마리는 누적에 남았어요. 지금까지 ${state.kills.toLocaleString('ko-KR')}마리.</p>${loginHint()}`,
          [['다시 도전', () => startRun(run.stage)], ['그만', null]]);
      }
    }
    // 로그인하지 않았으면 결과 카드에 '랭킹 기록에 남지 않아요' 안내
    function loginHint() {
      const A = window.MZAuth;
      return A && A.enabled && !A.user() ? '<p class="egg-p egg-login">로그인하지 않으면 랭킹 기록에 남지 않아요. <a href="account.html?next=index.html">로그인</a></p>' : '';
    }
    // 그냥 잡기(도전 밖): 잡은 수를 모았다가 20초마다 또는 40마리마다 한 묶음(stage 0)으로 보낸다
    //   걸린 시간도 같이 보내서 서버가 '사람이 잡을 수 있는 속도'(분당 상한)와 하루 상한으로 다시 자른다
    let freeK = 0, freeStart = 0;
    // 지금 로그인한 계정 (손님이면 null). 보낼 기록에는 누구 기록인지 적어 둔다 — 손님 기록이 계정으로 가지 않게
    function myUid() { const A = window.MZAuth; const u = A && A.enabled && A.user && A.user(); return u ? u.id : null; }
    function addFree() {
      if (!freeK) freeStart = Date.now();
      freeK += 1;
      if (freeK >= 20) flushFree();
    }
    function flushFree() {
      if (!freeK) return;
      if (!myUid()) { freeK = 0; return; }   // 손님은 이 기기에만 쌓는다
      state.pending.push({ uid: myUid(), stage: 0, kills: freeK, ms: Math.max(Date.now() - freeStart, 1000), ok: false, at: new Date().toISOString() });
      freeK = 0; save(); syncPending();
    }
    setInterval(flushFree, 10000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushFree(); });
    // 서버로 보내기: 로그인 상태면 도전 기록을 보낸다. 안 되면 pending 에 남겨 다음에 다시
    let syncing = false;
    async function syncPending() {
      const A = window.MZAuth, uid = myUid();
      if (!A || !uid || syncing) return;
      // 다른 계정·손님 때 기록은 버린다. 지금 계정 것만 보낸다
      state.pending = state.pending.filter((r) => r.uid === uid);
      if (!state.pending.length) return;
      syncing = true;
      const batch = state.pending.slice(0, 10);
      try {
        const r = await A.submitRuns(batch);
        if (r && r.ok) { state.pending = state.pending.filter((x) => !batch.includes(x)); save(); syncing = false; if (state.pending.length) setTimeout(syncPending, 1000); return; }
      } catch (e) { /* 다음 기회에 */ }
      syncing = false;
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
    /* --- 엘리트 · 보스 모기 ---
       엘리트: 스킬 1개(순간이동·투명·분신 중 무작위), 여러 번 맞혀야 잡힌다
       보스:   스킬 3개 모두, 체력 막대가 뜨고, 체력이 반 아래로 내려가면 화가 나서 스킬이 빨라진다 */
    /* 엘리트·보스 그림 (일반 모기와 같은 120×80 칸, 머리가 왼쪽)
       엘리트: 보라 갑옷 줄무늬 · 뿔 두 개 · 빨간 겹눈 · 꼬리 침 · 무늬 날개 · 머리 위에 스킬 표시
       보스:   크고 뚱뚱한 검붉은 몸 · 등 가시 · 빛나는 마디 · 금관 · 빨간 눈 두 개 · 찢어진 큰 날개 · 긴 침 */
    const LEGS = '<path d="M52 44 L40 60 L30 74"/><path d="M58 45 L54 63 L50 78"/><path d="M64 45 L70 62 L78 76"/><path d="M50 42 L34 50 L18 54"/><path d="M68 43 L84 54 L100 58"/>';
    const SKILL_MARK = {
      blink: '<path d="M60 2 L53 12 L58 12 L54 21 L64 9 L59 9 Z" fill="#FDE047" stroke="#1d1d1f" stroke-width=".8" stroke-linejoin="round"/>',
      cloak: '<path d="M52 21 V10 a6 6 0 0 1 12 0 V21 l-3-2 -3 2 -3-2 Z" fill="rgba(255,255,255,.75)" stroke="#1d1d1f" stroke-width=".8"/><circle cx="56" cy="11" r="1" fill="#1d1d1f"/><circle cx="60" cy="11" r="1" fill="#1d1d1f"/>',
      decoy: '<circle cx="55" cy="12" r="5" fill="none" stroke="#A7F3D0" stroke-width="1.8"/><circle cx="61" cy="12" r="5" fill="none" stroke="#fff" stroke-width="1.8"/>',
    };
    const LOOKS = {
      elite: (skill) => `<svg viewBox="0 0 120 80" width="100%" height="100%">
        <g class="legs" stroke="#2E1065" stroke-width="2.4" fill="none" stroke-linecap="round">${LEGS}</g>
        <g class="wing w1"><path d="M50 34 C60 8 92 6 96 16 C90 26 70 34 50 36 Z" fill="rgba(196,170,255,.55)" stroke="#6D28D9" stroke-width="1.4"/><path d="M56 32 L88 14 M62 33 L92 20 M68 33 L93 24" stroke="#6D28D9" stroke-width=".9" opacity=".7"/></g>
        <g class="wing w2"><path d="M50 36 C54 16 76 12 82 20 C76 30 64 34 50 37 Z" fill="rgba(196,170,255,.35)" stroke="#7C3AED" stroke-width="1"/></g>
        <path d="M58 41 Q80 37 104 47 Q82 55 58 47 Z" fill="#3B2470" stroke="#fff" stroke-width="1.2"/>
        <path d="M70 40.5 v9 M80 41 v10 M90 43 v8" stroke="#C4B5FD" stroke-width="2.4"/>
        <path d="M103 46 L114 46.5 L104 49.5 Z" fill="#C4B5FD" stroke="#fff" stroke-width=".6"/>
        <ellipse cx="54" cy="42" rx="9" ry="7" fill="#2E1065" stroke="#fff" stroke-width="1.2"/>
        <path d="M47 39 Q54 33 61 39" stroke="#A78BFA" stroke-width="2" fill="none"/>
        <circle cx="43" cy="40" r="5" fill="#2E1065" stroke="#fff" stroke-width="1.2"/>
        <path d="M44 35.6 L47.5 27.5 L46.8 36.4 Z M40.6 35.8 L39.5 28 L43 35.4 Z" fill="#C4B5FD" stroke="#fff" stroke-width=".6" stroke-linejoin="round"/>
        <circle cx="41.5" cy="39.4" r="2.3" fill="#FF3B6B"/><circle cx="40.9" cy="38.7" r=".7" fill="#fff"/>
        <path d="M39 42 L16 49" stroke="#1d1d1f" stroke-width="2" stroke-linecap="round"/>
        ${SKILL_MARK[skill] || ''}
      </svg>`,
      boss: () => `<svg viewBox="0 0 120 80" width="100%" height="100%">
        <g class="legs" stroke="#1a0606" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round">${LEGS}</g>
        <g class="wing w1"><path d="M48 33 C52 6 94 2 108 14 L100 17 L105 23 L95 24 L98 30 C80 34 62 35 48 36 Z" fill="rgba(70,12,12,.6)" stroke="#991B1B" stroke-width="1.6"/><path d="M54 32 L96 10 M60 33 L100 20 M66 34 L94 28" stroke="#F87171" stroke-width=".8" opacity=".6"/></g>
        <g class="wing w2"><path d="M48 35 C52 14 80 10 88 18 L82 22 L86 27 C72 32 60 35 48 37 Z" fill="rgba(70,12,12,.4)" stroke="#991B1B" stroke-width="1.2"/></g>
        <path d="M56 37 Q84 27 112 46 Q86 63 56 51 Z" fill="#1F0707" stroke="#F87171" stroke-width="1.4"/>
        <path class="boss-glow" d="M68 35.5 Q71 44 68 54 M80 33 Q83 44 80 57 M92 36 Q95 45 92 55 M103 41 Q105 46 103 51" stroke="#EF4444" stroke-width="2.6" fill="none" stroke-linecap="round"/>
        <path d="M62 36 L65 27 L68 35 Z M74 32.5 L78 22 L81.5 32.5 Z M87 34 L91 25 L93.5 36 Z" fill="#7F1D1D" stroke="#F87171" stroke-width="1" stroke-linejoin="round"/>
        <ellipse cx="51" cy="42" rx="11" ry="9" fill="#2A0B0B" stroke="#F87171" stroke-width="1.4"/>
        <path d="M43 37 Q51 30 59 37 M44 47 Q51 52 58 47" stroke="#B91C1C" stroke-width="2" fill="none"/>
        <circle cx="38" cy="41" r="7" fill="#2A0B0B" stroke="#F87171" stroke-width="1.4"/>
        <path d="M31.5 34.5 L32.5 25.5 L36 30.5 L38.6 23.5 L41.2 30.5 L44.6 25.5 L45.4 34.5 Z" fill="#FACC15" stroke="#A16207" stroke-width="1" stroke-linejoin="round"/>
        <circle cx="38.6" cy="31" r="1.3" fill="#EF4444"/>
        <circle class="boss-eye" cx="34.6" cy="39.6" r="2.6" fill="#FF2D2D"/><circle class="boss-eye" cx="40" cy="38.2" r="2.1" fill="#FF2D2D"/>
        <circle cx="34" cy="39" r=".8" fill="#fff"/><circle cx="39.5" cy="37.6" r=".7" fill="#fff"/>
        <path d="M32 44 L5 53" stroke="#1a0606" stroke-width="2.8" stroke-linecap="round"/><circle cx="5" cy="53" r="1.9" fill="#EF4444"/>
      </svg>`,
    };
    function makeEl(kind, skill) {
      let el;
      if (LOOKS[kind]) {
        el = document.createElement('div');
        el.className = 'flyer';
        el.setAttribute('aria-hidden', 'true');
        el.innerHTML = LOOKS[kind](skill);   // 이 파일에서 만든 그림만 넣는다
      } else {
        el = proto.cloneNode(true);
        el.removeAttribute('id'); el.hidden = false;
      }
      card.appendChild(el);
      return el;
    }
    function newFly(el) {
      return { el, phase: Math.random() * 10, x: 0, y: 0, vx: 0, vy: 0, gx: 0, gy: 0, nextPick: 0, dead: 0, spin: 0, alpha: 1, face: 1, entering: false, golden: false, queen: 0, dartAt: 0 };
    }
    function skillInterval(f, key) {
      const k = SP.SKILLS[key];
      let ms = f.kind === 'boss' ? k.bossMs : k.everyMs;
      if (f.rage) ms *= SP.boss.rageFaster || 0.6;
      return ms;
    }
    function addSpecial(kind) {
      const conf = SP[kind];
      const now = performance.now();
      const keys = Object.keys(SP.SKILLS);
      const skills = kind === 'boss' ? keys : [keys[Math.floor(Math.random() * keys.length)]];
      const f = newFly(makeEl(kind, skills[0]));
      spawn(f, now, true);
      f.golden = false; f.queen = 0; setLook(f);
      f.kind = kind; f.hp = conf.hp; f.maxHp = conf.hp; f.size = conf.size; f.rage = false; f.cloakUntil = 0;
      f.skills = skills;
      f.skillAt = {};
      f.skills.forEach((k) => { f.skillAt[k] = now + skillInterval(f, k) * (0.6 + Math.random() * 0.4); });
      f.el.classList.add('is-' + kind);
      extras.push(f);
      const names = f.skills.map((k) => SP.SKILLS[k].name).join(' · ');
      banner(`${conf.name} 등장! 스킬: ${names}`);
      if (kind === 'boss') updateBossBar(f);
    }
    function updateBossBar(f) {
      const boss = f || extras.find((x) => x.kind === 'boss' && !x.dead);
      bossBar.hidden = !boss;
      if (!boss) return;
      bossBar.querySelector('i b').style.width = Math.max(0, (boss.hp / boss.maxHp) * 100).toFixed(0) + '%';
      bossBar.querySelector('span').textContent = `${boss.hp}/${boss.maxHp}${boss.rage ? ' · 화났어요!' : ''}`;
      bossBar.classList.toggle('is-rage', Boolean(boss.rage));
    }
    function removeExtra(f) {
      const i = extras.indexOf(f);
      if (i >= 0) extras.splice(i, 1);
      f.el.remove();
    }
    function clearExtras() {
      while (extras.length) removeExtra(extras[0]);
      updateBossBar(null);
    }
    // 일반 모기를 잡을 때마다 불러, 기준 수에 닿으면 엘리트나 보스를 내보낸다
    function maybeSpawnSpecial() {
      if (!SP) return;
      const bossOut = extras.some((x) => x.kind === 'boss' && !x.dead);
      if (baseKills % SP.bossEvery === 0) { if (!bossOut) addSpecial('boss'); return; }
      const elites = extras.filter((x) => x.kind === 'elite' && !x.dead).length;
      if (baseKills % SP.eliteEvery === 0 && !bossOut && elites < (SP.maxElites || 2)) addSpecial('elite');
    }
    function useSkill(f, key, now) {
      const W = card.clientWidth, H = card.clientHeight;
      if (key === 'blink') {
        puff(f.x, f.y);
        f.x = W * (0.12 + Math.random() * 0.76); f.y = H * (0.12 + Math.random() * 0.6);
        f.vx = 0; f.vy = 0; pick(f, now);
        puff(f.x, f.y);
      } else if (key === 'cloak') {
        f.cloakUntil = now + SP.SKILLS.cloak.lastMs;
      } else if (key === 'decoy') {
        const n = SP.SKILLS.decoy.count || 2;
        for (let i = 0; i < n; i++) {
          const d = newFly(makeEl(f.kind, f.skills[0]));   // 진짜와 똑같은 그림
          d.kind = 'decoy'; d.expire = now + SP.SKILLS.decoy.lastMs; d.size = f.size;
          d.x = f.x + (Math.random() - 0.5) * 120; d.y = f.y + (Math.random() - 0.5) * 80;
          d.el.classList.add('is-' + f.kind);   // 진짜와 똑같이 생겼다
          pick(d, now);
          extras.push(d);
        }
        // 분신을 만들면서 진짜도 자리를 바꾼다 (어느 게 진짜인지 헷갈리게)
        f.vx += (Math.random() - 0.5) * 20; f.vy += (Math.random() - 0.5) * 20;
      }
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
      // 폰에서는 '도전'만 보이게 뒷부분을 따로 감싼다 (첫 화면 위 버튼들이 '경남 한눈에'와 겹치지 않게)
      goBtn.querySelector('span').innerHTML = `도전<em class="ghud-more"> · ${openStages()}단계까지</em>`;
    });

    card.addEventListener('pointermove', (e) => { const r = card.getBoundingClientRect(); cx = e.clientX - r.left; cy = e.clientY - r.top; });
    function spray(px, py) {
      const now = performance.now();
      // 모기약 통이 바닥나면 잠깐 못 뿌린다
      const w = weapon();
      const cost = SPRAY.cost * (w.cost || 1);
      if (now < tankLockUntil || tank < cost) {
        if (now - lastEmptyPopAt > 900) { lastEmptyPopAt = now; popAt(px, py - 20, '모기약 채우는 중…', 'is-empty'); Sound.play('empty'); }
        return;
      }
      tank -= cost;
      if (tank < cost) tankLockUntil = now + SPRAY.lockMs;
      puff(px, py, w.id, BASE_HIT * (diff.hit || 1) * (w.range || 1));
      Sound.play(w.sound, 90);
      // 모기향: 누른 자리에 연기 (쿨타임마다 한 번)
      if (w.coil && now >= coilReadyAt) { coilReadyAt = now + w.coil.cooldownMs; dropCoil(px, py, w.coil, now); }
      const hitR = BASE_HIT * (diff.hit || 1) * (w.range || 1);
      // 레이저: 카드 아래 가운데에서 누른 쪽으로 빔을 끝까지 쏜다. 빔 가까이(굵기 안)에 있는 모기는 모두 맞는다
      let beamDist = null;
      if (w.beam) {
        const W = card.clientWidth, H = card.clientHeight;
        const ang = aimGun(px, py) * Math.PI / 180, g = gunOrigin();
        let dx = Math.cos(ang), dy = Math.sin(ang);
        const ox = g.x + dx * GUN_LEN, oy = g.y + dy * GUN_LEN;   // 총구
        const tx = dx > 0 ? (W - ox) / dx : dx < 0 ? -ox / dx : Infinity, ty = dy < 0 ? -oy / dy : Infinity;
        const t = Math.min(tx, ty);
        beamDist = (x, y) => { const u = Math.max(0, Math.min(t, (x - ox) * dx + (y - oy) * dy)); return Math.hypot(x - (ox + dx * u), y - (oy + dy * u)); };
      }
      const distOf = (f) => (beamDist ? beamDist(f.x, f.y) : Math.hypot(px - f.x, py - f.y));
      const beamR = hitR * 0.4;   // 빔 굵기 (반지름). 끝까지 꿰뚫는 대신 가늘다
      flies.forEach((f) => {
        if (f.dead) return;
        const d = distOf(f);
        if (beamDist) { if (d <= beamR * (f.queen ? 1.4 : 1)) { if (f.queen > 1) { f.queen -= 1; popAt(f.x, f.y - 30, `여왕 모기 · ${f.queen}번 더`, 'is-queen'); return; } kill(f); } return; }
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
      // 엘리트·보스·분신 (배열이 바뀌므로 복사본으로 돈다)
      extras.slice().forEach((f) => {
        if (f.dead || !extras.includes(f)) return;   // 같은 뿌리기에서 먼저 지워진 분신은 건너뛴다
        const d = distOf(f);
        if (d > (beamDist ? beamR : hitR) * (f.size || 1)) {
          if (beamDist) return;
          if (d < 200) { const k = (1 - d / 200) * 10; f.vx += ((f.x - px) / d) * k; f.vy += ((f.y - py) / d) * k; }
          return;
        }
        if (f.cloakUntil > now) { popAt(f.x, f.y - 30, '안 보여요!', 'is-empty'); return; }   // 투명할 땐 맞지 않는다
        if (f.kind === 'decoy') { puff(f.x, f.y); popAt(f.x, f.y - 30, '가짜!', 'is-empty'); removeExtra(f); return; }
        f.hp -= weapon().power || 1;   // 비싼 무기·강화할수록 엘리트·보스에게 더 세게
        if (f.hp <= 0) { kill(f); return; }
        Sound.play('big', 60);
        const a = Math.random() * Math.PI * 2;
        f.vx += Math.cos(a) * 16; f.vy += Math.sin(a) * 16;
        const conf = SP[f.kind];
        if (f.kind === 'boss' && !f.rage && f.hp <= f.maxHp * (conf.rageAt || 0.5)) {
          f.rage = true; f.el.classList.add('is-rage');
          banner('보스 모기가 화났어요! 스킬이 빨라져요');
        }
        popAt(f.x, f.y - 40, `${conf.name} · ${f.hp}번 더`, 'is-' + f.kind);
        if (f.kind === 'boss') updateBossBar(f);
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

    // 모기향 연기: r 안에 들어온 모기를 0.3초마다 잡는다(엘리트·보스는 1초마다 1번 맞음)
    function dropCoil(x, y, conf, now) {
      // 동시에 놓을 수 있는 개수를 넘으면 가장 오래된 것부터 치운다
      while (coils.length >= (conf.max || 2)) { const old = coils.shift(); old.el.remove(); }
      const el = document.createElement('div');
      el.className = 'gcoil';
      el.style.left = x + 'px'; el.style.top = y + 'px';
      el.style.setProperty('--r', conf.radius + 'px');
      el.style.setProperty('--ms', conf.ms + 'ms');
      card.appendChild(el);
      coils.push({ x, y, r: conf.radius, pull: conf.pull || 0, until: now + conf.ms, el, nextAt: now, bigAt: now });
    }
    function tickCoils(now) {
      for (let i = coils.length - 1; i >= 0; i--) {
        const z = coils[i];
        if (now > z.until) { z.el.remove(); coils.splice(i, 1); continue; }
        // 끌어당기기: 연기 둘레 밖 pull 거리 안의 모기를 가운데로 (모기향 냄새에 홀린 듯)
        if (z.pull) flies.forEach((f) => {
          if (f.dead) return;
          const dx = z.x - f.x, dy = z.y - f.y, d = Math.hypot(dx, dy);
          if (d > z.r * 0.6 && d < z.r + z.pull) { const k = 0.9 * (1 - d / (z.r + z.pull)) + 0.25; f.vx += (dx / d) * k; f.vy += (dy / d) * k; }
        });
        if (now >= z.nextAt) {
          z.nextAt = now + 300;
          flies.forEach((f) => { if (!f.dead && Math.hypot(f.x - z.x, f.y - z.y) <= z.r) kill(f); });
          extras.slice().forEach((f) => {
            if (f.dead || !extras.includes(f) || Math.hypot(f.x - z.x, f.y - z.y) > z.r) return;
            if (f.kind === 'decoy') { removeExtra(f); return; }
            if (now >= z.bigAt) { f.hp -= weapon().power || 1; if (f.hp <= 0) kill(f); else { Sound.play('big', 60); if (f.kind === 'boss') updateBossBar(f); } }
          });
          if (now >= z.bigAt) z.bigAt = now + 1000;
        }
      }
    }
    // 무기별 효과: 스프레이 안개 · 전기채 번개와 그물 · 분무기 큰 구름 · 모기향 연기 · 레이저 빔 (r = 잡는 범위)
    const NS = 'http://www.w3.org/2000/svg';
    function puff(px, py, wid, r) {
      const R = Math.round(r || 46);
      if (wid === 'racket') {
        // 전기 모기채: 범위만 한 그물 테두리가 번쩍 + 번개 4갈래
        const p = document.createElement('div');
        p.className = 'fx fx-racket'; p.style.left = px + 'px'; p.style.top = py + 'px';
        let bolts = '';
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + Math.random() * 0.8;
          let d = 'M0 0', x = 0, y = 0;
          for (let k = 1; k <= 4; k++) { const t = (R * k) / 4; x = Math.cos(a) * t + (Math.random() - 0.5) * 10; y = Math.sin(a) * t + (Math.random() - 0.5) * 10; d += ` L${x.toFixed(1)} ${y.toFixed(1)}`; }
          bolts += `<path d="${d}"/>`;
        }
        p.innerHTML = `<svg width="${R * 2 + 20}" height="${R * 2 + 20}" viewBox="${-R - 10} ${-R - 10} ${R * 2 + 20} ${R * 2 + 20}" aria-hidden="true"><ellipse class="net" rx="${R}" ry="${R * 1.08}"/><path class="mesh" d="M${-R} 0H${R}M0 ${-R}V${R}M${-R * 0.7} ${-R * 0.7}L${R * 0.7} ${R * 0.7}M${R * 0.7} ${-R * 0.7}L${-R * 0.7} ${R * 0.7}"/><g class="bolt">${bolts}</g></svg>`;
        card.appendChild(p); setTimeout(() => p.remove(), 380); return;
      }
      if (wid === 'laser') {
        // 레이저: 카드 오른쪽 아래(퇴치기 자리)에서 누른 곳까지 빔 + 맞은 자리 빨간 점
        const W = card.clientWidth;
        const ang = aimGun(px, py), g = gunOrigin(), rad = ang * Math.PI / 180;
        const dx = Math.cos(rad), dy = Math.sin(rad);
        const ox = g.x + dx * GUN_LEN, oy = g.y + dy * GUN_LEN;   // 총구에서 나간다
        const tx = dx > 0 ? (W - ox) / dx : dx < 0 ? -ox / dx : Infinity, ty = dy < 0 ? -oy / dy : Infinity;
        const len = Math.min(tx, ty);
        gun.classList.remove('kick'); void gun.offsetWidth; gun.classList.add('kick');   // 반동
        const beam = document.createElement('div');
        beam.className = 'fx fx-beam'; beam.style.left = ox + 'px'; beam.style.top = oy + 'px';
        beam.style.width = len + 'px'; beam.style.transform = `rotate(${ang}deg)`;
        beam.style.setProperty('--w', Math.max(6, Math.round(R * 0.4)) + 'px');   // 빛줄기 (판정은 이보다 조금 넓다)
        const muzzle = document.createElement('div');
        muzzle.className = 'fx fx-muzzle'; muzzle.style.left = ox + 'px'; muzzle.style.top = oy + 'px';
        card.appendChild(beam); card.appendChild(muzzle);
        setTimeout(() => { beam.remove(); muzzle.remove(); }, 340); return;
      }
      if (wid === 'fogger') {
        // 대형 분무기: 범위만 한 초록빛 구름이 크게 퍼진다
        const p = document.createElement('div');
        p.className = 'fx fx-fog'; p.style.left = px + 'px'; p.style.top = py + 'px';
        for (let i = 0; i < 4; i++) {
          const b = document.createElement('i');
          b.style.setProperty('--s', Math.round(R * (1.1 + Math.random() * 0.6)) + 'px');
          b.style.setProperty('--dx', Math.round((Math.random() - 0.5) * R * 0.8) + 'px');
          b.style.setProperty('--dy', Math.round((Math.random() - 0.5) * R * 0.8) + 'px');
          p.appendChild(b);
        }
        card.appendChild(p); setTimeout(() => p.remove(), 1100); return;
      }
      if (wid === 'coil') {
        // 모기향: 회색 연기가 꼬불꼬불 위로 올라간다
        const p = document.createElement('div');
        p.className = 'fx fx-smoke'; p.style.left = px + 'px'; p.style.top = py + 'px';
        for (let i = 0; i < 5; i++) {
          const b = document.createElement('i');
          b.style.setProperty('--dx', Math.round((Math.random() - 0.5) * 40) + 'px');
          b.style.setProperty('--d', (i * 0.08).toFixed(2) + 's');
          p.appendChild(b);
        }
        card.appendChild(p); setTimeout(() => p.remove(), 1300); return;
      }
      const p = document.createElement('div');
      p.className = 'puff' + (wid ? ' w-' + wid : '');
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
    // 잡은 자리 자국: 무기마다 다르게 (스프레이 물방울 · 전기채 불꽃 · 분무기 초록 방울 · 모기향 재 · 레이저 탄 자국)
    function hitMark(x, y, wid) {
      const m = document.createElement('div');
      m.className = 'fx fx-hit hit-' + (wid || 'spray');
      m.style.left = x + 'px'; m.style.top = y + 'px';
      for (let i = 0; i < 8; i++) { const b = document.createElement('i'); b.style.setProperty('--a', (i * 45 + Math.random() * 20) + 'deg'); m.appendChild(b); }
      card.appendChild(m);
      setTimeout(() => m.remove(), 700);
    }
    function kill(f) {
      const now = performance.now();
      const wasGolden = f.golden, wasQueen = f.queen > 0, special = f.kind === 'elite' || f.kind === 'boss' ? f.kind : null;
      f.dead = now; f.queen = 0; f.golden = false; setLook(f);
      state.kills += 1;
      if (!run.on) addFree();   // 도전 밖에서 그냥 잡은 것도 랭킹에 (서버가 분당·하루 상한으로 자른다)
      if (wasGolden) state.golden += 1;
      if (special === 'elite') state.elites += 1;
      if (special === 'boss') { state.bosses += 1; updateBossBar(null); }
      // 골드: 일반 1 · 황금 5 · 엘리트 10 · 보스 50
      addGold(special ? (GOLD[special] || 0) : (wasGolden ? GOLD.golden : GOLD.normal));
      Sound.play(special === 'boss' ? 'boom' : (special || wasGolden ? 'coin' : (weapon().killSound || 'kill')), special === 'boss' ? 0 : 40);
      if (special === 'elite') Sound.play('kill');
      // 엘리트·보스가 죽으면 남은 분신도 사라진다
      if (special) extras.filter((x) => x.kind === 'decoy').forEach((x) => { puff(x.x, x.y); removeExtra(x); });
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
      const hw = weapon();
      hitMark(f.x, f.y, hw.id);
      let text = run.on ? `${run.caught}/${run.target}` : (state.kills === 1 ? (hw.hitWord || '잡았다!') : `${hw.hitWord || '잡았다!'} ${state.kills.toLocaleString('ko-KR')}마리째`);
      let cls = '';
      if (special) {
        const conf = SP[special];
        cls = 'is-' + special;
        text = `${conf.name} 처치!`;
        if (run.on && conf.bonusSec) { run.endAt += conf.bonusSec * 1000; text += ` +${conf.bonusSec}초`; }
      } else if (wasGolden) {
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
      if (!special) { baseKills += 1; maybeSpawnSpecial(); }
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


    // 살아 있는 모기 한 마리를 한 칸 움직이고 그린다 (일반·엘리트·보스·분신 공통)
    function moveFly(f, now, t, W, H, swarmBoost, dart) {
      const el = f.el;
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
      const speedUp = (f.golden ? ((EV.golden && EV.golden.speed) || 1) : 1) * swarmBoost * (f.queen ? 0.8 : 1)
        * (f.kind && SP && SP[f.kind] ? SP[f.kind].speed : 1) * (f.rage ? 1.2 : 1);
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
      // 투명 스킬: 잠깐 거의 안 보인다
      if (f.kind) el.style.opacity = f.cloakUntil > now ? '0.12' : '1';
    }
    let lastTick = performance.now();
    function tick(now) {
      const t = (now - t0) / 1000, W = card.clientWidth, H = card.clientHeight;
      const dt = Math.min(0.1, Math.max(0, (now - lastTick) / 1000)); lastTick = now;
      // 모기약 통 다시 채우기 + 막대 표시 (가득 차 있으면 숨긴다)
      tank = Math.min(100, tank + SPRAY.refill * (weapon().refill || 1) * dt);
      tickCoils(now);
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
        moveFly(f, now, t, W, H, swarmBoost, dart);
      });
      // 엘리트·보스·분신: 스킬을 쓰고 움직인다. 죽으면 떨어지다 사라지고 다시 나오지 않는다
      for (let i = extras.length - 1; i >= 0; i--) {
        const f = extras[i];
        if (f.dead) {
          const k = (now - f.dead) / 1000;
          f.vy += 0.9; f.x += f.vx * 0.3; f.y += f.vy; f.spin += 22;
          f.el.style.opacity = Math.max(0, 1 - k * 0.9).toFixed(2);
          f.el.style.transform = `translate(${f.x.toFixed(1)}px, ${f.y.toFixed(1)}px) translate(-50%, -50%) rotate(${f.spin}deg)`;
          if (k > 1.3) removeExtra(f);
          continue;
        }
        if (f.kind === 'decoy' && now > f.expire) { puff(f.x, f.y); removeExtra(f); continue; }
        if (f.skills) f.skills.forEach((key) => { if (now >= f.skillAt[key]) { useSkill(f, key, now); f.skillAt[key] = now + skillInterval(f, key); } });
        moveFly(f, now, t, W, H, swarmBoost, dart);
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    // 로그인돼 있으면 밀린 기록을 보낸다
    setTimeout(syncPending, 3000);
    // 시험용 골드: 주소 뒤에 ?testgold=10000 → 이 기기에 골드를 더한다 (한 번 쓰면 주소에서 지운다)
    //   골드는 이 기기에만 있고 랭킹(잡은 수)과는 상관없다
    (function testGold() {
      const m = location.search.match(/[?&]testgold=(\d{1,6})/);
      if (!m) return;
      addGold(Number(m[1])); save();
      try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* 무시 */ }
    }());
  }

  // 다른 화면에서 쓰는 공개 함수
  window.MZGame = {
    state: () => JSON.parse(JSON.stringify(state)),
    badges: BADGES,
    badgeIcon,
    stages: STAGES,
    weapons: CFG.WEAPONS || [],
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
  // auth.js 가 game.js 뒤에 불러와지므로 화면이 준비된 뒤 등록한다
  document.addEventListener('DOMContentLoaded', () => { if (window.MZAuth && window.MZAuth.bindSync) window.MZAuth.bindSync('game', gameSnapshot, applyGame); });
}());
