/* =============================================================
   뛰어런 (runner.js) — 나이키 런 클럽 방식, 슬로우 조깅 이상만 '땀 걸음'으로 센다
   -------------------------------------------------------------
   모기는 땀과 숨(이산화탄소)에 끌린다. 그래서 '땀 나는 활동'만 세는 것이 이 기능의 규칙이다.
   화면: 시작(이번 주·최고 기록·지난 달리기) → 뛰는 중(큰 거리·페이스·시간) → 요약(달린 길 지도·구간 기록)

   판정 (숫자는 game-config.js 의 RUN)
     · 걸음: 휴대폰 흔들림 센서(DeviceMotion)에서 큰 흔들림의 꼭대기를 한 걸음으로 센다.
     · 10초를 한 칸으로 묶는다: 칸마다 걸음 수 → 분당 걸음, GPS 거리 → 속도·보폭(거리 ÷ 걸음).
         뛴 칸   : 분당 145~220걸음, (GPS 가 있으면) 시속 4~15km, 보폭 0.5~1.6m
         흔들기  : 걸음은 많은데 거의 움직이지 않음(보폭이 너무 짧음)
         탈것    : 시속 20km 넘음 (거리도 더하지 않음)
     · 뛴 칸이 6개(1분) 이상 이어지면 그 칸들의 걸음을 '땀 걸음'으로 인정한다. 중간에 2칸(20초)까지는 쉬어도 이어진다.
     · GPS 를 끄면 걸음만 세고, 그 기록은 이 기기 기록으로만 남는다(랭킹에는 GPS 기록만).
   거리: GPS 오차가 30m 넘는 값, 한 번에 너무 멀리 튄 값은 쓰지 않는다. 일시정지 동안은 더하지 않는다.
   저장: 이 기기(localStorage 'mz-runs')에 달리기마다. 달린 길(좌표)은 이 폰에만 남기고 서버로 보내지 않는다.
   화면이 꺼지거나 다른 앱으로 가면 휴대폰이 센서를 멈춘다(웹의 한계). 화면이 꺼져도 세는 것은 앱 버전에서.
   ============================================================= */
(function () {
  'use strict';
  const C = Object.assign({
    windowSec: 10, minCadence: 145, maxCadence: 220, minKmh: 4, maxRunKmh: 15, vehicleKmh: 20,
    strideMin: 0.5, strideMax: 1.6, sustainWindows: 6, graceWindows: 2, gpsMaxAccuracy: 30,
    dailyCap: 30000, stepThreshold: 2.2, minStepMs: 250,
  }, (window.MZ_GAME_CONFIG || {}).RUN || {});
  const KEY = 'mz-runs', OLD_KEY = 'mz-run', OPT_KEY = 'mz-run-opt';
  const $ = (id) => document.getElementById(id);
  const n = (v) => Math.round(Number(v) || 0).toLocaleString('ko-KR');

  /* ---------- 저장 ---------- */
  function readJSON(k, d) { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function loadRuns() { const r = readJSON(KEY, []); return Array.isArray(r) ? r : []; }
  function saveRuns(list) {
    // 오래된 달리기는 지도 좌표를 지워 용량을 줄인다(최근 20개만 지도 보관, 최대 200개)
    const trimmed = list.slice(0, 200).map((r, i) => (i < 20 ? r : Object.assign({}, r, { route: [] })));
    if (!writeJSON(KEY, trimmed)) writeJSON(KEY, trimmed.map((r, i) => (i < 5 ? r : Object.assign({}, r, { route: [] }))));
  }
  let runs = loadRuns();
  // 예전 판(날짜별 합계 'mz-run')은 지난 기록으로 한 번만 옮긴다
  (function migrate() {
    const old = readJSON(OLD_KEY, null);
    if (!old || !old.days) return;
    Object.entries(old.days).forEach(([d, v]) => {
      if (!v || !(v.steps || v.km)) return;
      runs.push({ id: 'old-' + d, start: new Date(d + 'T12:00:00').getTime(), sec: v.sec || 0, m: Math.round((v.km || 0) * 1000), sweat: v.steps || 0, steps: v.steps || 0, splits: [], route: [], gps: (v.km || 0) > 0, old: true });
    });
    runs.sort((a, b) => b.start - a.start);
    saveRuns(runs);
    try { localStorage.removeItem(OLD_KEY); } catch (e) { /* 무시 */ }
  }());
  const opts = Object.assign({ gps: true, voice: true }, readJSON(OPT_KEY, {}));

  /* ---------- 숫자 모양 ---------- */
  function hms(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  }
  function pace(secPerKm) {
    if (!isFinite(secPerKm) || secPerKm <= 0 || secPerKm > 60 * 60) return `-'--"`;
    const m = Math.floor(secPerKm / 60), s = Math.round(secPerKm % 60);
    return `${m}'${String(s === 60 ? 59 : s).padStart(2, '0')}"`;
  }
  function paceWords(secPerKm) { const m = Math.floor(secPerKm / 60), s = Math.round(secPerKm % 60); return `${m}분 ${s}초`; }
  const kmText = (m) => (m / 1000).toFixed(2);
  function distM(a, b) {
    const R = 6371000, r = (x) => (x * Math.PI) / 180;
    const h = Math.sin(r(b[0] - a[0]) / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(r(b[1] - a[1]) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /* ---------- 달리기 상태 ---------- */
  let S = null;               // 지금 달리기
  let wakeLock = null, geoId = null, tick = null;
  // 걸음 감지
  let smooth = 9.8, base = 9.8, above = false, lastStepAt = 0;

  function newRun() {
    return {
      start: Date.now(), sec: 0, m: 0, steps: 0, sweat: 0, paused: false,
      splits: [], route: [], gps: opts.gps,
      win: { steps: 0, m: 0, sec: 0 },          // 지금 채우는 10초 칸
      seg: { runWins: 0, steps: 0, gap: 0 },     // 지금 이어지는 '뛰는 구간'
      count: { run: 0, walk: 0, shake: 0, vehicle: 0, still: 0 },
      lastFix: null, lastKmMark: 0, recentCad: 0, recentKmh: 0, stateText: '준비',
    };
  }

  function onMotion(e) {
    if (!S || S.paused) return;
    const a = e.accelerationIncludingGravity || e.acceleration;
    if (!a || a.x == null) return;
    const mag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
    smooth += (mag - smooth) * 0.35;      // 잔떨림 줄이기
    base += (mag - base) * 0.02;          // 천천히 따라가는 기준선(중력)
    const now = performance.now();
    if (!above && smooth - base > C.stepThreshold) {
      above = true;
      if (now - lastStepAt >= C.minStepMs) { lastStepAt = now; S.steps += 1; S.win.steps += 1; }
    } else if (above && smooth - base < C.stepThreshold * 0.4) {
      above = false;
    }
  }

  // GPS: 오차가 크거나 튄 값은 버리고, 3m 넘게 움직였을 때만 거리를 더한다
  function onFix(p) {
    if (!S || S.paused) return;
    const c = p.coords;
    if (/GPS/.test($('lvWarn').textContent)) $('lvWarn').textContent = '';   // 위치가 다시 들어오면 안내를 지운다
    if (c.accuracy > C.gpsMaxAccuracy) return;
    const pt = [c.latitude, c.longitude], t = Date.now();
    if (S.lastFix) {
      const d = distM(S.lastFix.pt, pt), dt = (t - S.lastFix.t) / 1000;
      if (dt <= 0) return;
      const kmh = (d / dt) * 3.6;
      if (kmh > 45) { S.lastFix = { pt, t }; return; }      // 튄 값
      if (d < 3) return;                                     // 제자리 흔들림
      S.lastFix = { pt, t };
      if (kmh > C.vehicleKmh) return;                        // 탈것 구간은 거리에 넣지 않는다
      S.m += d; S.win.m += d;
      const last = S.route[S.route.length - 1];
      if (!last || distM(last, pt) >= 8) S.route.push([+pt[0].toFixed(6), +pt[1].toFixed(6)]);
      // 1km 마다 구간 기록·음성 안내
      while (S.m >= (S.lastKmMark + 1) * 1000) {
        S.lastKmMark += 1;
        const prev = S.splits.reduce((x, y) => x + y, 0);
        S.splits.push(Math.round(S.sec - prev));
        say(`${S.lastKmMark}킬로미터. 이번 구간 페이스 ${paceWords(S.splits[S.splits.length - 1])}.`);
      }
    } else {
      S.lastFix = { pt, t };
      S.route.push([+pt[0].toFixed(6), +pt[1].toFixed(6)]);
    }
  }

  // 1초마다: 시간 더하기, 10초가 차면 그 칸을 판정
  function everySecond() {
    if (!S) return;
    if (!S.paused) {
      S.sec += 1; S.win.sec += 1;
      if (S.win.sec >= C.windowSec) closeWindow();
    }
    drawLive();
  }

  function classify(w) {
    const cad = (w.steps / w.sec) * 60;
    const kmh = (w.m / w.sec) * 3.6;
    S.recentCad = cad; S.recentKmh = kmh;
    if (cad < 60) return 'still';
    if (S.gps && kmh > C.vehicleKmh) return 'vehicle';
    if (cad < C.minCadence) return 'walk';
    if (cad > C.maxCadence) return 'shake';
    if (!S.gps) return 'run';   // GPS 없이: 발걸음 빠르기로만 (개인 기록)
    const stride = w.steps ? w.m / w.steps : 0;
    if (kmh < 1.5 || stride < C.strideMin * 0.6) return 'shake';      // 걸음은 빠른데 거의 안 움직임
    if (kmh < C.minKmh || kmh > C.maxRunKmh || stride < C.strideMin || stride > C.strideMax) return 'walk';
    return 'run';
  }

  function closeWindow() {
    const w = S.win;
    const kind = classify(w);
    S.count[kind] += 1;
    const sg = S.seg;
    if (kind === 'run') {
      sg.runWins += 1; sg.steps += w.steps; sg.gap = 0;
    } else if (sg.runWins) {
      sg.gap += 1;
      if (sg.gap > C.graceWindows) endSegment();
    }
    // 이어진 지 1분이 넘으면 바로 인정해 화면 숫자를 올린다(그 뒤로는 칸마다 바로 더한다)
    if (sg.runWins >= C.sustainWindows && sg.steps) { creditSweat(sg.steps); sg.steps = 0; }
    S.stateText = kind === 'run' ? (sg.runWins >= C.sustainWindows ? '뛰는 중' : `뛰는 중 · ${Math.max(0, C.sustainWindows - sg.runWins) * C.windowSec}초 더 뛰면 세요`)
      : kind === 'walk' ? '걷는 중 (안 세요)' : kind === 'shake' ? '흔들림으로 보여요 (안 세요)' : kind === 'vehicle' ? '탈것으로 보여요 (안 세요)' : '멈춤';
    S.win = { steps: 0, m: 0, sec: 0 };
  }
  function endSegment() {
    const sg = S.seg;
    if (sg.runWins >= C.sustainWindows && sg.steps) creditSweat(sg.steps);   // 남은 것(이미 인정된 구간의 마지막 칸들)
    S.seg = { runWins: 0, steps: 0, gap: 0 };   // 1분이 안 된 구간의 걸음은 버린다
  }
  function creditSweat(k) {
    const todayUsed = runs.filter((r) => sameDay(r.start, Date.now())).reduce((x, r) => x + (r.sweat || 0), 0);
    S.sweat += Math.max(0, Math.min(k, C.dailyCap - todayUsed - S.sweat));
  }
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

  /* ---------- 음성 안내 ---------- */
  function say(text) {
    if (!opts.voice || !('speechSynthesis' in window)) return;
    try { const u = new SpeechSynthesisUtterance(text); u.lang = 'ko-KR'; u.rate = 1; window.speechSynthesis.speak(u); } catch (e) { /* 무시 */ }
  }

  /* ---------- 화면 꺼짐 막기 ---------- */
  async function holdScreen() { try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { wakeLock = null; } }
  document.addEventListener('visibilitychange', () => {
    if (!S) return;
    if (document.visibilityState === 'visible') { holdScreen(); $('lvWarn').textContent = '화면이 꺼진 동안은 세지 못했어요. 다시 세는 중이에요.'; }
    else { S.seg = { runWins: 0, steps: 0, gap: 0 }; S.win = { steps: 0, m: 0, sec: 0 }; S.lastFix = null; }
  });

  /* ---------- 시작 · 일시정지 · 끝 ---------- */
  async function start() {
    // 아이폰은 흔들림 센서 허락 창이 필요하다 (버튼을 누른 순간에만 물어볼 수 있다)
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      try { if ((await DeviceMotionEvent.requestPermission()) !== 'granted') { hint('움직임 센서 사용을 허락해야 걸음을 셀 수 있어요.'); return; } }
      catch (e) { hint('움직임 센서를 쓸 수 없어요.'); return; }
    }
    if (typeof DeviceMotionEvent === 'undefined') { hint('이 기기에는 움직임 센서가 없어요. 휴대폰에서 열어 주세요.'); return; }
    // 동의 (consent.js): 움직임 센서는 필수, GPS 는 선택
    if (window.MZConsent) {
      if (!(await window.MZConsent.ensure('motion', { purpose: '뛰어런: 슬로우 조깅 이상으로 뛴 걸음 세기' }))) { hint('움직임 센서 이용에 동의해야 걸음을 셀 수 있어요.'); return; }
      if (opts.gps && !(await window.MZConsent.ensure('location', { purpose: '뛰어런: 뛴 거리·달린 길 지도, 자전거·차 거르기' }))) { opts.gps = false; $('optGps').checked = false; saveOpts(); }
    }
    S = newRun();
    smooth = base = 9.8; above = false; lastStepAt = 0;
    window.addEventListener('devicemotion', onMotion);
    if (S.gps && navigator.geolocation) {
      geoId = navigator.geolocation.watchPosition(onFix, (err) => { $('lvWarn').textContent = err.code === 1 ? '위치 권한이 꺼져 있어요. 거리 없이 걸음만 세요.' : 'GPS 신호가 약해요. 걸음은 계속 세요.'; }, { enableHighAccuracy: true, maximumAge: 0 });
    }
    holdScreen();
    tick = setInterval(everySecond, 1000);
    show('vLive');
    $('lvWarn').textContent = '';
    say('뛰어런을 시작해요.');
    setTimeout(() => { if (S && !S.steps) $('lvWarn').textContent = '움직임 센서 값이 오지 않아요. 휴대폰에서 열어 주세요.'; }, 5000);
  }
  function togglePause() {
    if (!S) return;
    S.paused = !S.paused;
    if (S.paused) { S.seg.gap = C.graceWindows; S.lastFix = null; say('일시정지'); }   // 쉬는 동안은 이어진 것으로 보지 않는다
    else say('다시 시작해요');
    $('lvPause').textContent = S.paused ? '이어하기' : '일시정지';
    $('lvPause').classList.toggle('resume', S.paused);
    drawLive();
  }
  function finish() {
    if (!S) return;
    clearInterval(tick); tick = null;
    window.removeEventListener('devicemotion', onMotion);
    if (geoId != null) { navigator.geolocation.clearWatch(geoId); geoId = null; }
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    if (S.win.sec >= 5) closeWindow();
    endSegment();
    const r = {
      id: String(S.start), start: S.start, sec: S.sec, m: Math.round(S.m), sweat: S.sweat, steps: S.steps,
      splits: S.splits, route: S.route, gps: S.gps, count: S.count, ver: 2,
    };
    S = null;
    say(`수고했어요. ${kmText(r.m)}킬로미터, 땀 걸음 ${n(r.sweat)}.`);
    if (r.sec >= 30 || r.sweat > 0) {
      runs.unshift(r); saveRuns(runs);
      document.dispatchEvent(new CustomEvent('run:saved', { detail: r }));
      submit(r);
    }
    showSummary(r);
  }
  // 로그인했으면 서버에 요약만 보낸다(거리·시간·걸음·판정 칸 수). 달린 길 좌표는 보내지 않는다
  function submit(r) {
    const A = window.MZAuth;
    if (!A || !A.enabled || !A.user() || typeof A.submitRun !== 'function' || !r.gps || r.sec < 60) return;
    A.submitRun({ started_at: new Date(r.start).toISOString(), duration_s: r.sec, distance_m: r.m, sweat_steps: r.sweat, total_steps: r.steps, run_windows: r.count.run, shake_windows: r.count.shake, vehicle_windows: r.count.vehicle })
      .then((x) => {
        // 서버가 받았거나(ok) 검사에서 걸렀으면(이유 있음) 다시 보내지 않는다. 로그인·네트워크 문제면 다음에 다시
        if (x && (x.ok || (x.reason && !/no-login|onboarding|네트워크|fetch/i.test(x.reason)))) { r.synced = true; r.serverOk = !!x.ok; saveRuns(runs); }
      }).catch(() => { /* 다음에 */ });
  }

  // 로그인하거나 화면을 열 때: 아직 서버에 안 올린 달리기(48시간 안, GPS 기록)를 올린다
  function syncPending() {
    const A = window.MZAuth;
    if (!A || !A.enabled || !A.user() || (A.needsOnboarding && A.needsOnboarding())) return;
    runs.filter((r) => r.ver === 2 && r.gps && !r.synced && r.sec >= 60 && Date.now() - r.start < 47 * 3600000).slice(0, 5).forEach(submit);
  }
  document.addEventListener('auth:changed', syncPending);

  // 끝내기는 길게 눌러야 한다(1.2초) — 뛰다가 실수로 눌러 끝나지 않게
  function holdToStop(btn) {
    let timer = null;
    const down = (e) => { e.preventDefault(); btn.classList.add('holding'); timer = setTimeout(() => { btn.classList.remove('holding'); finish(); }, 1200); };
    const up = () => { clearTimeout(timer); btn.classList.remove('holding'); };
    btn.addEventListener('pointerdown', down);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, up));
    btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!timer || !btn.classList.contains('holding')) down(e); } });
    btn.addEventListener('keyup', up);
    btn.addEventListener('click', (e) => e.preventDefault());
  }

  /* ---------- 화면 ---------- */
  function show(id) {
    ['vHome', 'vLive', 'vSum'].forEach((v) => { $(v).hidden = v !== id; });
    document.body.classList.toggle('rn-running', id === 'vLive');
    window.scrollTo(0, 0);
  }
  function hint(t) { $('runHint').textContent = t; }

  function drawLive() {
    if (!S) return;
    $('lvKm').textContent = kmText(S.m);
    $('lvTime').textContent = hms(S.sec);
    $('lvPace').textContent = S.m >= 50 ? pace(S.sec / (S.m / 1000)) : `-'--"`;
    $('lvSteps').textContent = n(S.sweat);
    const st = S.paused ? '일시정지' : S.stateText;
    const el = $('lvState');
    el.textContent = st;
    el.dataset.state = S.paused ? 'pause' : /^뛰는 중$/.test(st) ? 'run' : /뛰는 중/.test(st) ? 'warm' : /걷는/.test(st) ? 'walk' : /흔들|탈것/.test(st) ? 'bad' : 'wait';
    $('lvSub').textContent = `발걸음 빠르기 ${S.recentCad ? Math.round(S.recentCad) : '-'}/분${S.gps ? ` · 속도 ${S.recentKmh ? S.recentKmh.toFixed(1) : '-'}km/h` : ' · GPS 끔(거리 없이 걸음만)'}`;
  }

  function weekStart() { const d = new Date(); d.setHours(0, 0, 0, 0); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return d.getTime(); }
  function drawHome() {
    const ws = weekStart();
    const wk = runs.filter((r) => r.start >= ws);
    $('wkKm').textContent = (wk.reduce((x, r) => x + r.m, 0) / 1000).toFixed(1);
    $('wkRuns').textContent = `${wk.filter((r) => !r.old).length}회`;
    $('wkTime').textContent = `${Math.round(wk.reduce((x, r) => x + r.sec, 0) / 60)}분`;
    $('wkSteps').textContent = n(wk.reduce((x, r) => x + (r.sweat || 0), 0));
    const longest = runs.reduce((x, r) => Math.max(x, r.m), 0);
    const fastest = runs.flatMap((r) => r.splits || []).filter((s) => s > 120).reduce((x, s) => Math.min(x, s), Infinity);
    $('bestKm').textContent = longest ? `${kmText(longest)}km` : '-';
    $('bestPace').textContent = isFinite(fastest) ? pace(fastest) : '-';
    $('allKm').textContent = `${(runs.reduce((x, r) => x + r.m, 0) / 1000).toFixed(1)}km`;
    const list = $('runList');
    list.innerHTML = runs.length ? runs.slice(0, 30).map((r) => {
      const d = new Date(r.start);
      const when = `${d.getMonth() + 1}월 ${d.getDate()}일 ${r.old ? '' : `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`}`;
      return `<li><button type="button" data-run="${r.id}"><span class="d">${when}${r.old ? ' · 이전 기록' : ''}</span><span class="km">${kmText(r.m)}<small>km</small></span><span class="s">${hms(r.sec)} · ${r.m >= 50 ? pace(r.sec / (r.m / 1000)) : `-'--"`} · 땀 걸음 ${n(r.sweat)}</span></button></li>`;
    }).join('') : '<li class="empty">아직 기록이 없어요. 위의 시작을 눌러 첫 달리기를 해 보세요.</li>';
    list.querySelectorAll('[data-run]').forEach((b) => b.addEventListener('click', () => { const r = runs.find((x) => x.id === b.dataset.run); if (r) showSummary(r); }));
    $('runRule').textContent = `땀 걸음은 분당 ${C.minCadence}걸음 이상으로 1분 넘게 뛴 걸음만 세요(신호등에서 20초까지는 쉬어도 이어져요). GPS 를 켜면 보폭과 속도로 흔들기·자전거·차를 걸러요. 하루 최대 ${n(C.dailyCap)}걸음. 화면을 끄거나 다른 앱으로 가면 그동안은 세지 못해요.`;
  }

  let sumMap = null, shown = null;
  function showSummary(r) {
    shown = r;
    show('vSum');
    const d = new Date(r.start);
    $('sumDate').textContent = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${['일', '월', '화', '수', '목', '금', '토'][d.getDay()]}요일${r.old ? '' : ` ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`}`;
    $('sumKm').textContent = kmText(r.m);
    $('sumTime').textContent = hms(r.sec);
    $('sumPace').textContent = r.m >= 50 ? pace(r.sec / (r.m / 1000)) : '-';
    $('sumSteps').textContent = n(r.sweat);
    $('sumStory').textContent = r.sweat > 0
      ? `땀 걸음 ${n(r.sweat)}걸음! 땀과 숨이 모기를 부르니, 뛰고 나면 바로 씻고 기피제를 다시 발라 주세요.`
      : '이번에는 땀 걸음이 없어요. 분당 145걸음 이상으로 1분 넘게 뛰면 세요.';
    // 구간 기록
    const sp = r.splits || [];
    const best = sp.length ? Math.min(...sp) : 0;
    $('sumSplits').innerHTML = sp.length ? sp.map((s, i) => `<li${s === best ? ' class="best"' : ''}><span class="k">${i + 1}km</span><span class="bar"><i style="width:${Math.max(18, Math.min(100, (best / s) * 100))}%"></i></span><span class="v">${pace(s)}</span></li>`).join('')
      : '<li class="empty">1km 를 넘게 달리면 구간마다 페이스가 나와요.</li>';
    const c = r.count || {};
    $('sumNote').textContent = r.old ? '이전 판에서 옮겨 온 기록이에요.' : `판정: 뛴 ${c.run || 0}칸 · 걷기 ${c.walk || 0}칸 · 흔들림 ${c.shake || 0}칸 · 탈것 ${c.vehicle || 0}칸 (한 칸 = ${C.windowSec}초)${r.gps ? '' : ' · GPS 없이 기록해 랭킹에는 올라가지 않아요'}`;
    // 지도
    const box = $('sumMap');
    const pts = r.route || [];
    box.hidden = pts.length < 2 || !window.L;
    if (!box.hidden) {
      if (sumMap) { sumMap.remove(); sumMap = null; }
      sumMap = window.L.map(box, { zoomControl: false, attributionControl: true, dragging: true, scrollWheelZoom: false });
      window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(sumMap);
      const line = window.L.polyline(pts, { color: '#0E9F6E', weight: 5, opacity: 0.9 }).addTo(sumMap);
      window.L.circleMarker(pts[0], { radius: 6, color: '#fff', weight: 2, fillColor: '#3182F6', fillOpacity: 1 }).addTo(sumMap);
      window.L.circleMarker(pts[pts.length - 1], { radius: 6, color: '#fff', weight: 2, fillColor: '#E5484D', fillOpacity: 1 }).addTo(sumMap);
      setTimeout(() => { sumMap.invalidateSize(); sumMap.fitBounds(line.getBounds(), { padding: [24, 24] }); }, 50);
    }
  }

  function saveOpts() { writeJSON(OPT_KEY, opts); }

  document.addEventListener('DOMContentLoaded', () => {
    if (!$('vHome')) return;
    $('optGps').checked = opts.gps; $('optVoice').checked = opts.voice;
    $('optGps').addEventListener('change', (e) => { opts.gps = e.target.checked; saveOpts(); });
    $('optVoice').addEventListener('change', (e) => { opts.voice = e.target.checked; saveOpts(); });
    $('runStart').addEventListener('click', start);
    $('lvPause').addEventListener('click', togglePause);
    holdToStop($('lvStop'));
    $('sumDone').addEventListener('click', () => { drawHome(); show('vHome'); });
    $('sumDelete').addEventListener('click', () => {
      if (!shown) return;
      const b = $('sumDelete');
      if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = '한 번 더 누르면 지워요'; setTimeout(() => { b.dataset.sure = ''; b.textContent = '이 기록 지우기'; }, 3000); return; }
      runs = runs.filter((r) => r.id !== shown.id); saveRuns(runs);
      b.dataset.sure = ''; b.textContent = '이 기록 지우기';
      drawHome(); show('vHome');
    });
    // 뛰는 중에 페이지를 떠나려 하면 묻는다
    window.addEventListener('beforeunload', (e) => { if (S) { e.preventDefault(); e.returnValue = ''; } });
    drawHome();
  });

  // 다른 화면(내 기록 등)에서 쓰는 요약
  window.MZRun = {
    runs: () => runs.slice(),
    week: () => { const ws = weekStart(); return runs.filter((r) => r.start >= ws).reduce((x, r) => ({ m: x.m + r.m, sweat: x.sweat + (r.sweat || 0), sec: x.sec + r.sec }), { m: 0, sweat: 0, sec: 0 }); },
  };
}());
