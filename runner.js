/* =============================================================
   뛰어런 (runner.js) — 슬로우 조깅 이상만 걸음으로 센다
   -------------------------------------------------------------
   모기는 땀과 숨(이산화탄소)에 끌린다. 그래서 '땀 나는 활동'만 세는 것이 이 기능의 규칙이다.
     · 걸음: 휴대폰 흔들림 센서(DeviceMotion)에서 큰 흔들림의 꼭대기를 한 걸음으로 센다.
     · 뛰는 중: 최근 10초 발걸음 빠르기가 분당 140걸음 이상. 이 상태가 30초 넘게 이어져야 그동안의 걸음을 인정한다.
       (슬로우 조깅은 걷는 속도와 비슷해서 속도가 아니라 발걸음 빠르기로 가른다. 걷기는 보통 분당 100~120)
     · GPS(선택): 속도가 시속 20km 를 넘으면(자전거·차) 세지 않고, 뛴 거리를 보여 준다. 위치는 이 폰 안에서만 쓰고 보내지 않는다.
     · 화면: 뛰는 동안 화면이 꺼지지 않게 잡아 둔다(Wake Lock). 웹은 화면이 꺼지거나 다른 앱으로 가면
       휴대폰이 센서를 멈추므로 그동안은 세지 못한다(앱 버전에서 해결 예정). 돌아오면 이어서 센다.
     · 저장: 이 기기(localStorage 'mz-run')에 날짜별 걸음·뛴 시간·거리. 로그인 서버가 켜지면 랭킹에 올린다.
   숫자는 game-config.js 의 RUN.
   ============================================================= */
(function () {
  'use strict';
  const C = Object.assign({ minCadence: 140, sustainSec: 30, maxCadence: 230, maxKmh: 20, dailyCap: 30000, stepThreshold: 2.2, minStepMs: 260 },
    (window.MZ_GAME_CONFIG || {}).RUN || {});
  const KEY = 'mz-run';
  const $ = (id) => document.getElementById(id);
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  /* ---------- 기록 ---------- */
  function load() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { s = null; }
    if (!s || typeof s !== 'object' || !s.days) s = { days: {} };
    return s;
  }
  const rec = load();
  function day(d) { return rec.days[d || today()] || (rec.days[d || today()] = { steps: 0, sec: 0, km: 0 }); }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(rec)); } catch (e) { /* 저장 못 해도 센다 */ } }
  function weekSteps() {
    let n = 0;
    for (let i = 0; i < 7; i++) { const d = new Date(Date.now() - i * 86400000); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; n += (rec.days[k] || {}).steps || 0; }
    return n;
  }

  /* ---------- 상태 ---------- */
  let on = false;
  let wakeLock = null;
  let geoId = null;
  let lastFix = null;          // 마지막 GPS { lat, lng, t }
  let kmh = 0;                 // 최근 GPS 속도
  let smooth = 9.8, base = 9.8, above = false, lastStepAt = 0;
  const stepTimes = [];        // 최근 걸음 시각 (빠르기 계산용)
  let pending = 0;             // '뛰는 중'이 30초 이어지기 전까지 모아 두는 걸음
  let runSince = 0;            // '뛰는 중'이 시작된 시각
  let pendingSec = 0;
  let ticker = null;

  function cadence(now) {
    while (stepTimes.length && now - stepTimes[0] > 10000) stepTimes.shift();
    return stepTimes.length * 6;   // 10초 걸음 × 6 = 분당
  }

  // 센서 값이 올 때마다: 흔들림 크기를 부드럽게 만든 뒤, 기준선보다 크게 솟는 꼭대기를 한 걸음으로
  function onMotion(e) {
    if (!on) return;
    const a = e.accelerationIncludingGravity || e.acceleration;
    if (!a || a.x == null) return;
    const mag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
    smooth += (mag - smooth) * 0.35;      // 잔떨림 줄이기
    base += (mag - base) * 0.02;          // 천천히 따라가는 기준선(중력)
    const now = performance.now();
    if (!above && smooth - base > C.stepThreshold) {
      above = true;
      if (now - lastStepAt >= C.minStepMs) { lastStepAt = now; onStep(now); }
    } else if (above && smooth - base < C.stepThreshold * 0.4) {
      above = false;
    }
  }

  function onStep(now) {
    stepTimes.push(now);
    const cad = cadence(now);
    const running = cad >= C.minCadence && cad <= C.maxCadence && kmh <= C.maxKmh;
    if (!running) return;
    if (!runSince) runSince = now;
    pending += 1;
  }

  // 1초마다: 뛰는 중인지 판단하고, 30초 넘게 이어졌으면 모아 둔 걸음을 인정한다
  function everySecond() {
    const now = performance.now();
    const cad = cadence(now);
    const running = cad >= C.minCadence && cad <= C.maxCadence && kmh <= C.maxKmh;
    const d = day();
    if (running && runSince) {
      pendingSec += 1;
      if ((now - runSince) / 1000 >= C.sustainSec) {
        const room = Math.max(0, C.dailyCap - d.steps);
        d.steps += Math.min(room, pending);
        d.sec += pendingSec;
        pending = 0; pendingSec = 0;
        save();
      }
    } else {
      // 30초를 못 채우고 멈추면 모아 둔 걸음은 버린다 (잠깐 뛴 건 안 셈)
      if (runSince && (now - runSince) / 1000 < C.sustainSec) { pending = 0; pendingSec = 0; }
      runSince = running ? runSince : 0;
    }
    draw(cad, running);
  }

  /* ---------- GPS (선택) ---------- */
  function km(a, b) {
    const R = 6371, r = (x) => (x * Math.PI) / 180;
    const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function startGps() {
    if (!navigator.geolocation) return;
    geoId = navigator.geolocation.watchPosition((p) => {
      const fix = { lat: p.coords.latitude, lng: p.coords.longitude, t: Date.now(), acc: p.coords.accuracy };
      if (typeof p.coords.speed === 'number' && p.coords.speed >= 0) kmh = p.coords.speed * 3.6;
      if (lastFix && fix.acc < 50) {
        const dKm = km(lastFix, fix), hrs = (fix.t - lastFix.t) / 3600000;
        if (typeof p.coords.speed !== 'number' && hrs > 0) kmh = dKm / hrs;
        // 뛰는 중일 때만 거리를 더한다 (GPS 튐 방지: 한 번에 200m 이상은 무시)
        if (runSince && dKm < 0.2 && kmh <= C.maxKmh) { day().km = Math.round((day().km + dKm) * 1000) / 1000; save(); }
      }
      lastFix = fix;
    }, () => { /* 위치를 안 줘도 걸음은 센다 */ }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 });
  }

  /* ---------- 화면 꺼짐 막기 ---------- */
  async function holdScreen() {
    try { if ('wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); } } catch (e) { wakeLock = null; }
  }
  document.addEventListener('visibilitychange', () => {
    if (!on) return;
    if (document.visibilityState === 'visible') { holdScreen(); setStatus('다시 세는 중이에요'); }
    else { runSince = 0; pending = 0; pendingSec = 0; }   // 안 보이는 동안엔 센서가 멈추므로 끊는다
  });

  /* ---------- 시작·멈춤 ---------- */
  async function start() {
    // 아이폰은 흔들림 센서를 쓰려면 허락 창이 필요하다 (버튼을 누른 순간에만 물어볼 수 있다)
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      try { if ((await DeviceMotionEvent.requestPermission()) !== 'granted') { setStatus('움직임 센서 사용을 허락해야 걸음을 셀 수 있어요.'); return; } }
      catch (e) { setStatus('움직임 센서를 쓸 수 없어요.'); return; }
    }
    if (typeof DeviceMotionEvent === 'undefined') { setStatus('이 기기에는 움직임 센서가 없어요. 휴대폰에서 열어 주세요.'); return; }
    on = true;
    window.addEventListener('devicemotion', onMotion);
    holdScreen();   // 기다리지 않는다 (응답이 늦거나 없는 기기에서도 바로 센다)
    if ($('runGps').checked) startGps();
    ticker = setInterval(everySecond, 1000);
    $('runBtn').textContent = '멈추기';
    $('runBtn').classList.add('is-on');
    $('runCard').classList.add('is-on');
    setStatus('폰을 주머니나 손에 들고 뛰어 보세요. 화면은 켜 둘게요.');
    // 잠깐 기다려도 센서 값이 안 오면 (PC 등) 알려 준다
    setTimeout(() => { if (on && !stepTimes.length && smooth === 9.8) setStatus('움직임 센서 값이 오지 않아요. 휴대폰에서 열어 주세요.'); }, 4000);
  }
  function stop() {
    on = false;
    window.removeEventListener('devicemotion', onMotion);
    if (geoId != null) { navigator.geolocation.clearWatch(geoId); geoId = null; }
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    clearInterval(ticker); ticker = null;
    runSince = 0; pending = 0; pendingSec = 0; lastFix = null; kmh = 0;
    $('runBtn').textContent = '뛰기 시작';
    $('runBtn').classList.remove('is-on');
    $('runCard').classList.remove('is-on');
    save(); draw(0, false);
    setStatus('멈췄어요. 오늘 기록은 이 기기에 저장됐어요.');
  }

  /* ---------- 그리기 ---------- */
  function setStatus(t) { const el = $('runStatus'); if (el) el.textContent = t; }
  function draw(cad, running) {
    const d = day();
    $('runSteps').textContent = d.steps.toLocaleString('ko-KR');
    $('runTime').textContent = `${Math.floor(d.sec / 60)}분`;
    $('runKm').textContent = `${d.km.toFixed(2)}km`;
    $('runWeek').textContent = weekSteps().toLocaleString('ko-KR');
    const cadEl = $('runCad');
    if (cadEl) cadEl.textContent = on ? `${cad}` : '-';
    const st = $('runState');
    if (st) {
      st.textContent = !on ? '대기' : running ? (runSince && (performance.now() - runSince) / 1000 < C.sustainSec ? `뛰는 중 · ${Math.ceil(C.sustainSec - (performance.now() - runSince) / 1000)}초 뒤부터 셈` : '뛰는 중 · 세는 중') : (cad > 0 ? '걷는 중 · 안 셈' : '멈춤');
      st.dataset.state = !on ? 'off' : running ? 'run' : 'walk';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!$('runCard')) return;
    $('runRule').textContent = `분당 ${C.minCadence}걸음 이상으로 ${C.sustainSec}초 넘게 뛰면 그때부터 세요. 시속 ${C.maxKmh}km 를 넘으면(자전거·차) 세지 않아요. 하루 최대 ${C.dailyCap.toLocaleString('ko-KR')}걸음.`;
    $('runBtn').addEventListener('click', () => (on ? stop() : start()));
    draw(0, false);
  });

  window.MZRun = { today: () => Object.assign({}, day()), week: weekSteps, days: () => JSON.parse(JSON.stringify(rec.days)) };
}());
