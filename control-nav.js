/* =============================================================
   방역 내비게이션 (control-nav.js) — 전문가 화면(expert.html)
   -------------------------------------------------------------
   오늘 모기지수로 '어느 동부터, 그 동의 어느 지점으로' 방역을 갈지 순서를 짜 준다.

   0) 방역 대상 기준(CRITERIA) — 오늘 지수 61+, 유충 양성률 50%+, 면적당 민원 상위 1/3 중 하나라도 넘은 동 (초안, 보건소와 확정)
   1) 동 고르기 — 기준을 넘은 동(기본) 또는 우선 점수 상위 N. 우선 점수로 순서를 매긴다.
        우선 점수 = 0.50 × 오늘 모기지수(모델 v5.1)        ← 오늘 모기가 많은 곳
                  + 0.20 × 발생원 밀도위험                ← 번식할 곳이 많은 곳
                  + 0.15 × 유충 조사 양성률(누적)          ← 실제로 유충이 나온 곳
                  + 0.15 × 2025 방역민원(면적당, 상대값)   ← 주민 불편이 큰 곳
      (모두 0~1 로 맞춘 뒤 더한다. 가중치는 WEIGHTS 에서 고친다)
   2) 들를 지점 — 고른 동 안에서 유충 조사 지점 중 '양성률 × 유충 수'가 큰 곳 2곳 (data/gimhae-larva-points.json)
   3) 순서·경로 — 실제 도로 기준(OSRM 공개 경로 서버). 안 되면 가까운 곳 먼저 + 2-opt 직선 어림
   4) 현장용 — 출발 시각·지점당 작업 시간으로 도착 예정 시각, 주소, 앞 지점에서 길찾기(카카오/네이버), 완료 체크, 작업 목록 복사
   5) 할 일 — 그 동에 많은 발생원 종류에 맞춘 방역 요령, 성충 방제는 그날 일몰 직후가 좋다
   지금은 누구나 볼 수 있다. 로그인이 켜지면 직원 계정만 보이게 바꾼다(사용자 결정 2026-10-12).
   ============================================================= */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const WEIGHTS = { today: 0.5, density: 0.2, larva: 0.15, complaint: 0.15 };
  // 방역 대상 기준 (초안 — 보건소와 숫자를 맞춘다)
  //   오늘 모기지수 index 이상이면 대상. 또는 오늘 watch 이상이면서 유충·민원 기준을 하나라도 넘으면 대상.
  //   (유충·민원은 날마다 바뀌지 않는 값이라 그것만으로 고르면 겨울에도 매일 같은 동이 뽑힌다)
  const CRITERIA = {
    index: 61,          // 오늘 모기지수 '높음' 이상 → 바로 대상
    watch: 41,          // 오늘 '보통' 이상이면서 아래 바탕 기준을 넘으면 대상
    larvaRate: 0.5,     // 유충 조사 양성률 50% 이상 (조사 5곳 이상인 동만)
    larvaMinSurvey: 5,
    complaintTop: 1 / 3, // 면적당 민원 상위 3분의 1
    // (앞으로 며칠 '높음' 예보 기준은 실제 날씨 예보를 이 화면에 연결한 뒤 추가 — 지금 값은 월평균 추정이라 예보가 아님)
    maxDistricts: 8,    // 기준을 넘은 동이 많아도 하루에 이만큼까지
  };
  const STOPS_PER_DISTRICT = 2;
  const CITY_KMH = 30;   // 시내 이동 평균 속도(대략) — 걸리는 시간 어림용

  // 발생원 종류별 방역 요령 (모델 설명서·방제 지침의 일반 요령)
  const ACTION = {
    septic_clean: '정화조 환기구·맨홀 유충 구제(IGR·라바사이드)',
    septic_private: '개인하수처리시설 정체수 유충 구제',
    wwtp_private: '개인오수처리시설 침전조 유충 구제',
    wwtp_public: '하수처리시설 침전지 점검',
    livestock: '축사 주변 웅덩이·분뇨 저류조 유충 구제, 해질녘 성충 방제',
    reservoir: '저수지 가장자리 수초대 유충 구제',
    tire_shop: '타이어 적치 고인 물 제거',
    waste_tire: '폐타이어 덮개·고인 물 제거',
    waste_stk: '폐기물 적치장 고인 물 제거',
    junk_shop: '고물상 용기류 고인 물 제거',
    water_feature: '수경시설·인공연못 점검(물 순환·유충 구제)',
    toilet: '공중화장실 정화조·하수구 점검',
    park: '공원 배수로·연못·우수받이 점검',
    bathhouse: '목욕장 배수 정체수 점검',
    waterpump: '배수펌프장 유수지 유충 구제',
    bee_farm: '양봉농가 주변 물통 관리 안내',
  };

  let larvaPoints = [];
  let map = null, layer = null;
  let userStart = null;   // 사용자가 고른 출발점 { lat, lng, label }. 비어 있으면 그때그때 1순위 동

  function km(a, b) {
    const R = 6371, toR = (d) => (d * Math.PI) / 180;
    const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const norm = (v, min, max) => (max > min ? (v - min) / (max - min) : 0);
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  /* ---------- 1) 동 우선 점수 ---------- */
  function rankDistricts() {
    const M = window.GimhaeMosquitoModel;
    const today = {};
    let activeHours = null;
    (M.allIndices() || []).forEach((r) => {
      today[r.district] = r.mosquito_index;
      // v5.1 은 그날 일몰 기준 시간을 준다. 예전 v4 문구(고정 시각)는 쓰지 않는다
      if (!activeHours && r.active_hours && /^v5/.test(r.model_version || '')) activeHours = r.active_hours;
    });
    const names = Object.keys(M.DISTRICTS);
    const larvaRate = {}, complaint = {};
    names.forEach((d) => {
      const rec = M.DISTRICTS[d];
      larvaRate[d] = rec.larva_surveyed ? rec.larva_positive / rec.larva_surveyed : 0;
      complaint[d] = rec.area_km2 ? (rec.complaints_2025 || 0) / rec.area_km2 : 0;
    });
    const cMax = Math.max(...names.map((d) => complaint[d]));
    const cSorted = names.map((d) => complaint[d]).sort((a, b) => b - a);
    const cCut = cSorted[Math.max(0, Math.ceil(names.length * CRITERIA.complaintTop) - 1)];

    const rows = names.map((d) => {
      const rec = M.DISTRICTS[d];
      const parts = {
        today: (today[d] || 0) / 100,
        density: rec.density_risk || 0,
        larva: larvaRate[d],
        complaint: norm(complaint[d], 0, cMax),
      };
      const score = Object.keys(WEIGHTS).reduce((s, k) => s + WEIGHTS[k] * parts[k], 0);
      const topSources = Object.entries(rec.sources || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
      // 어떤 기준을 넘었는지
      const flags = [];
      if ((today[d] || 0) >= CRITERIA.index) flags.push(`오늘 ${Math.round(today[d])}점(높음 이상)`);
      if (rec.larva_surveyed >= CRITERIA.larvaMinSurvey && larvaRate[d] >= CRITERIA.larvaRate) flags.push(`유충 양성률 ${Math.round(larvaRate[d] * 100)}%`);
      if (complaint[d] > 0 && complaint[d] >= cCut) flags.push('민원 밀도 상위');
      const t = today[d] || 0;
      const eligible = t >= CRITERIA.index || (t >= CRITERIA.watch && flags.length > 0);
      if (eligible && t >= CRITERIA.watch && t < CRITERIA.index) flags.unshift(`오늘 ${Math.round(t)}점(보통)`);
      return { district: d, score: Math.round(score * 100), index: Math.round(t), parts, topSources, rec, flags, eligible };
    }).sort((a, b) => b.score - a.score);
    return { rows, activeHours: activeHours || '그날 일몰 직후 약 3시간과 일출 전 2시간' };
  }

  /* ---------- 2) 동 안의 들를 지점 ---------- */
  function stopsIn(district) {
    const M = window.GimhaeMosquitoModel;
    const pts = larvaPoints.filter((p) => p.district === district && p.tries > 0)
      .map((p) => ({ lat: p.lat, lng: p.lon, rate: p.pos / p.tries, larva: p.larva, tries: p.tries, pos: p.pos }))
      .sort((a, b) => b.rate * Math.log1p(b.larva) - a.rate * Math.log1p(a.larva));
    const out = [];
    for (const p of pts) {   // 너무 붙어 있는 지점(300m 안)은 하나만
      if (out.every((q) => km(p, q) > 0.3)) out.push(p);
      if (out.length >= STOPS_PER_DISTRICT) break;
    }
    if (!out.length) {       // 유충 조사 지점이 없는 동은 동 중심
      const c = M.COORDS[district];
      out.push({ lat: c[0], lng: c[1], center: true });
    }
    return out.map((p, i) => ({ ...p, district, name: p.center ? `${district} 중심` : `${district} 유충 지점 ${i + 1}` }));
  }

  /* ---------- 3) 순서 (가까운 곳 먼저) ---------- */
  function orderStops(stops, from) {
    const left = stops.slice(), route = [];
    let cur = from, total = 0;
    while (left.length) {
      let bi = 0, bd = Infinity;
      left.forEach((s, i) => { const d = km(cur, s); if (d < bd) { bd = d; bi = i; } });
      route.push(left.splice(bi, 1)[0]);
      cur = route[route.length - 1];
    }
    // 2-opt: 두 구간을 뒤집어 더 짧아지면 바꾼다 (가까운 곳 먼저 방식이 남긴 먼 되돌아가기를 줄인다)
    const pts = [from, ...route];
    let better = true;
    while (better) {
      better = false;
      for (let i = 1; i < pts.length - 1; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i - 1], b = pts[i], c = pts[j], d = pts[j + 1];
          const before = km(a, b) + (d ? km(c, d) : 0);
          const after = km(a, c) + (d ? km(b, d) : 0);
          if (after + 1e-9 < before) { pts.splice(i, j - i + 1, ...pts.slice(i, j + 1).reverse()); better = true; }
        }
      }
    }
    const out = pts.slice(1).map((p, i) => { const leg = km(pts[i], p); total += leg; return { ...p, legKm: leg }; });
    return { route: out, totalKm: total };
  }

  /* ---------- 4) 실제 도로 경로 (OSRM) ----------
     OpenStreetMap 도로 자료로 길을 찾는 공개 경로 서버(router.project-osrm.org)에
     '출발 → 들를 곳들' 을 보내 도로 기준 가장 짧은 순서와 길 모양·거리·운전 시간을 받는다.
     공개 서버는 시험용이라 직원이 가끔 쓰는 정도는 괜찮지만, 정식 운영 때는 카카오모빌리티 길찾기 API(키 필요)로 바꾼다.
     응답이 없거나 실패하면 위의 직선 순서(가까운 곳 먼저)로 보여 준다. */
  const OSRM = 'https://router.project-osrm.org/trip/v1/driving/';
  const roadCache = new Map();
  async function roadTrip(start, stops) {
    const pts = [start, ...stops];
    const key = pts.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
    if (roadCache.has(key)) return roadCache.get(key);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    try {
      const r = await fetch(`${OSRM}${key}?source=first&roundtrip=false&destination=any&overview=full&geometries=geojson`, { signal: ctrl.signal });
      const j = await r.json();
      if (j.code !== 'Ok' || !j.trips || !j.trips.length) return null;
      const trip = j.trips[0];
      // waypoints[i].waypoint_index = 입력 i 번째 점이 경로에서 몇 번째인지
      const order = j.waypoints.map((w, i) => ({ i, at: w.waypoint_index })).sort((a, b) => a.at - b.at).map((x) => x.i);
      const route = order.slice(1).map((i, k) => ({ ...stops[i - 1], legKm: trip.legs[k].distance / 1000, legMin: trip.legs[k].duration / 60 }));
      const out = { route, line: trip.geometry.coordinates.map(([lng, lat]) => [lat, lng]), km: trip.distance / 1000, min: trip.duration / 60 };
      roadCache.set(key, out);
      return out;
    } catch (_) { return null; } finally { clearTimeout(timer); }
  }

  /* ---------- 5) 지점 주소 (지도 자료에서 찾기, 1초에 한 번, 이 기기에 저장) ---------- */
  const ADDR_KEY = 'mz-nav-addr';
  let addrCache = {};
  try { addrCache = JSON.parse(localStorage.getItem(ADDR_KEY) || '{}'); } catch (_) { addrCache = {}; }
  let addrQueue = [], addrBusy = false;
  const addrKey = (s) => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`;
  function queueAddresses(route) {
    addrQueue = route.filter((s) => !addrCache[addrKey(s)]);
    if (!addrBusy) nextAddress();
  }
  async function nextAddress() {
    const s = addrQueue.shift();
    if (!s) { addrBusy = false; return; }
    addrBusy = true;
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&accept-language=ko&lat=${s.lat}&lon=${s.lng}`);
      const j = await r.json();
      const a = j.address || {};
      // 동·리 + 길 이름 + 번지 (같은 이름이 두 번 나오지 않게)
      const parts = [a.suburb || a.quarter || a.village || a.town, a.road || a.neighbourhood, a.house_number].filter(Boolean);
      const txt = [...new Set(parts)].join(' ') || (j.display_name || '').split(',').slice(0, 2).join(' ');
      if (txt) {
        addrCache[addrKey(s)] = txt;
        try { localStorage.setItem(ADDR_KEY, JSON.stringify(addrCache)); } catch (_) { /* 무시 */ }
        document.querySelectorAll(`[data-addr="${addrKey(s)}"]`).forEach((el) => { el.textContent = addrCache[addrKey(s)]; });
      }
    } catch (_) { /* 주소를 못 찾아도 좌표·길찾기는 된다 */ }
    setTimeout(nextAddress, 1100);   // 지도 자료 서버 규칙: 1초에 한 번
  }

  /* ---------- 6) 완료 체크 (오늘 날짜로 이 기기에 저장) ---------- */
  const DONE_KEY = 'mz-nav-done';
  const todayStr = () => new Date().toISOString().slice(0, 10);
  function loadDone() { try { const d = JSON.parse(localStorage.getItem(DONE_KEY) || '{}'); return d.date === todayStr() ? d : { date: todayStr(), ids: [] }; } catch (_) { return { date: todayStr(), ids: [] }; } }
  let done = loadDone();
  function saveDone() { try { localStorage.setItem(DONE_KEY, JSON.stringify(done)); } catch (_) { /* 무시 */ } }

  /* ---------- 그리기 ---------- */
  const MODE = {
    larva: { name: '유충 구제', todo: '고인 물 제거 · 유충 구제제(IGR·라바사이드) 투입', when: '낮 시간에 해도 돼요' },
    adult: { name: '성충 연무', todo: '주변 수풀·그늘 연무(분무) 방역, 주민 안내', when: '모기가 활발한 해 질 무렵이 효과적이에요' },
  };
  const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  let planSeq = 0;
  let lastPlan = null;

  async function plan() {
    const M = window.GimhaeMosquitoModel;
    if (!M) return;
    const mine = ++planSeq;
    const count = Number($('navCount').value) || 5;
    const workMin = Number($('navWork').value) || 15;
    const mode = MODE[$('navMode').value] || MODE.larva;
    const { rows, activeHours } = rankDistricts();
    // 고르는 방식: 기준을 넘은 동(기본) 또는 우선 점수 상위 N
    let picked;
    if ($('navPick').value === 'top') picked = rows.slice(0, count);
    else {
      picked = rows.filter((r) => r.eligible).slice(0, CRITERIA.maxDistricts);
      if (!picked.length) {
        $('navSummary').innerHTML = '<b>오늘은 방역 기준을 넘은 동이 없어요.</b> 예방 점검이 필요하면 고르는 방식을 \'우선 점수 상위\'로 바꿔 주세요.';
        $('navRoute').innerHTML = ''; $('navDistricts').innerHTML = ''; $('navProgress').textContent = '';
        if (layer) layer.remove();
        return;
      }
    }
    const first = M.COORDS[picked[0].district];
    const start = userStart || { lat: first[0], lng: first[1], label: `${picked[0].district} 중심` };
    const stops = picked.flatMap((r) => stopsIn(r.district));

    // 먼저 직선 순서로 바로 그리고, 도로 경로가 오면 바꿔 그린다
    const straight = orderStops(stops, start);
    let result = { route: straight.route.map((s) => ({ ...s, legMin: (s.legKm * 1.3 / CITY_KMH) * 60 })), line: null, km: straight.totalKm * 1.3, min: (straight.totalKm * 1.3 / CITY_KMH) * 60, road: false };
    render(picked, start, result, workMin, mode, activeHours, '도로 경로를 찾는 중이에요…');
    const road = await roadTrip(start, stops);
    if (mine !== planSeq) return;   // 그사이 조건을 바꿨으면 버린다
    if (road) result = { ...road, road: true };
    render(picked, start, result, workMin, mode, activeHours, road ? '' : '도로 경로 서버가 응답하지 않아 직선 거리로 어림했어요. 길찾기 버튼은 그대로 실제 길로 안내해요.');
  }

  function startTime() {
    const v = $('navTime').value;   // 'HH:MM' 또는 '' (지금)
    const d = new Date();
    if (v) { const [h, m] = v.split(':').map(Number); d.setHours(h, m, 0, 0); }
    return d;
  }

  function render(picked, start, result, workMin, mode, activeHours, note) {
    const M = window.GimhaeMosquitoModel;
    const route = result.route;
    // 도착 예정 시각: 출발 시각 + 앞까지 운전 시간 + 앞 지점들 작업 시간
    let t = startTime().getTime();
    route.forEach((s) => { t += s.legMin * 60000; s.eta = new Date(t); t += workMin * 60000; });
    const end = new Date(t);
    const driveMin = Math.round(result.min);
    lastPlan = { start, route, mode, workMin, end };

    $('navSummary').innerHTML = `<b>${esc(mode.name)}</b> · 출발 <b>${esc(start.label)}</b> ${hm(startTime())} → ${picked.length}개 동 ${route.length}곳 → 끝 예정 <b>${hm(end)}</b>`
      + `<br>이동 <b>${result.km.toFixed(1)}km</b> · 운전 약 ${driveMin}분${result.road ? '(실제 도로)' : '(직선 어림)'} · 작업 ${workMin}분 × ${route.length}곳`
      + (mode === MODE.adult && activeHours ? `<br>성충 연무는 ${esc(activeHours)}에 효과적이에요.` : `<br>${esc(mode.when)}.`)
      + (note ? `<br><span class="dim">${esc(note)}</span>` : '');

    // 동별 이유·할 일
    $('navDistricts').innerHTML = picked.map((r, i) => {
      const why = [
        `오늘 지수 ${r.index}점`,
        `발생원 밀도위험 ${Math.round(r.parts.density * 100)}`,
        r.rec.larva_surveyed ? `유충 양성 ${r.rec.larva_positive}/${r.rec.larva_surveyed}곳` : '유충 조사 없음',
        `민원 ${r.rec.complaints_2025 || 0}건(2025)`,
      ].join(' · ');
      const todo = r.topSources.map(([k, n]) => `<li>${esc(ACTION[k] || k)} <span class="dim">(${(M.SRC_KOR || {})[k] || k} ${n}곳)</span></li>`).join('');
      const flags = r.eligible && r.flags.length ? `<p class="nav-flags">${r.flags.map((f) => `<span>${esc(f)}</span>`).join('')}</p>` : '<p class="nav-flags is-none"><span>기준 미달 · 예방 점검</span></p>';
      return `<li class="nav-d"><p class="nav-d-h"><b>${i + 1}. ${esc(r.district)}</b><span class="nav-score">우선 ${r.score}</span></p>${flags}<p class="dim">${why}</p><ul class="nav-todo">${todo}</ul></li>`;
    }).join('');

    // 들를 순서: 도착 예정·주소·할 일·앞 지점에서 길찾기·완료
    let prev = { name: start.label, lat: start.lat, lng: start.lng };
    $('navRoute').innerHTML = route.map((s, i) => {
      const id = addrKey(s);
      const isDone = done.ids.includes(id);
      const detail = s.center ? '유충 조사 지점 없음 · 동 중심' : `유충 조사 ${s.tries}회 중 ${s.pos}회 검출 · 누적 ${s.larva.toLocaleString('ko-KR')}마리`;
      const link = routeLink(prev, s);
      prev = s;
      return `<li class="${isDone ? 'is-done' : ''}">
        <span class="nav-no">${i + 1}</span>
        <span class="nav-txt"><b>${esc(s.name)}</b><span class="nav-eta">도착 예정 ${hm(s.eta)} · 앞에서 ${s.legKm.toFixed(1)}km, ${Math.max(1, Math.round(s.legMin))}분</span>
          <small data-addr="${id}">${esc(addrCache[id] || '주소 찾는 중…')}</small>
          <small>${detail}</small><small class="nav-do">할 일: ${esc(mode.todo)}</small></span>
        <span class="nav-acts"><a class="btn-main nav-go" href="${link}" target="_blank" rel="noopener">길찾기</a>
          <label class="nav-check"><input type="checkbox" data-done="${id}" ${isDone ? 'checked' : ''}> 완료</label></span>
      </li>`;
    }).join('');
    $('navRoute').querySelectorAll('[data-done]').forEach((cb) => cb.addEventListener('change', () => {
      const id = cb.dataset.done;
      done.ids = cb.checked ? [...new Set([...done.ids, id])] : done.ids.filter((x) => x !== id);
      saveDone();
      cb.closest('li').classList.toggle('is-done', cb.checked);
      $('navProgress').textContent = `${done.ids.filter((x) => route.some((s) => addrKey(s) === x)).length}/${route.length}곳 완료`;
    }));
    $('navProgress').textContent = `${done.ids.filter((x) => route.some((s) => addrKey(s) === x)).length}/${route.length}곳 완료`;
    queueAddresses(route);
    drawMap(route, start, result.line);
  }

  // 단톡방에 붙여 넣을 작업 목록
  function copyPlan() {
    if (!lastPlan) return;
    const { start, route, mode, workMin, end } = lastPlan;
    const lines = [`[모기제로 방역 경로] ${todayStr()} · ${mode.name} · 지점당 ${workMin}분`, `출발: ${start.label} ${hm(startTime())} → 끝 예정 ${hm(end)}`];
    route.forEach((s, i) => {
      lines.push(`${i + 1}. ${hm(s.eta)} ${s.name}${addrCache[addrKey(s)] ? ` (${addrCache[addrKey(s)]})` : ''}`);
      lines.push(`   https://map.kakao.com/link/to/${encodeURIComponent(s.name)},${s.lat},${s.lng}`);
    });
    lines.push('※ 오늘 모기지수·유충 조사 자료로 고른 참고 경로예요. 현장 상황에 맞게 조정하세요.');
    const text = lines.join('\n');
    const msg = $('navCopyMsg');
    navigator.clipboard.writeText(text).then(() => { msg.textContent = '작업 목록을 복사했어요. 단톡방에 붙여 넣으세요.'; })
      .catch(() => { const ta = $('navCopyText'); ta.hidden = false; ta.value = text; ta.select(); msg.textContent = '아래 글을 길게 눌러 복사해 주세요.'; });
  }

  function drawMap(route, start, line) {
    if (typeof L === 'undefined' || !$('navMap')) return;
    if (!map) {
      map = L.map('navMap', { scrollWheelZoom: false });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap · 경로 OSRM' }).addTo(map);
    }
    if (layer) layer.remove();
    layer = L.layerGroup().addTo(map);
    const pts = [[start.lat, start.lng], ...route.map((s) => [s.lat, s.lng])];
    if (line) {
      L.polyline(line, { color: '#fff', weight: 8, opacity: 0.9 }).addTo(layer);          // 흰 테두리
      L.polyline(line, { color: '#E5484D', weight: 5, opacity: 0.95 }).addTo(layer);       // 실제 도로
    } else {
      L.polyline(pts, { color: '#E5484D', weight: 4, opacity: 0.8, dashArray: '6 6' }).addTo(layer);
    }
    L.marker([start.lat, start.lng], { icon: L.divIcon({ className: 'nav-pin nav-start', html: '<span>출발</span>', iconSize: [44, 28] }) }).bindTooltip(start.label).addTo(layer);
    route.forEach((s, i) => {
      L.marker([s.lat, s.lng], { icon: L.divIcon({ className: 'nav-pin', html: `<span>${i + 1}</span>`, iconSize: [28, 28] }) })
        .bindPopup(`<b>${i + 1}. ${esc(s.name)}</b><br>도착 예정 ${s.eta ? hm(s.eta) : ''}`).addTo(layer);
    });
    map.fitBounds(L.latLngBounds(line || pts).pad(0.1));
    setTimeout(() => map.invalidateSize(), 100);
  }

  /* ---------- 길찾기 앱: 카카오맵(웹·앱) 또는 네이버 지도(폰 앱) ----------
     카카오: map.kakao.com/link/from/이름,위도,경도/to/이름,위도,경도 — PC·폰 모두 열린다.
     네이버: nmap://route/car?... — 네이버 지도 앱이 있는 폰에서 열린다. PC 에서는 앱이 없어 카카오 웹으로 대신 연다. */
  const isPhone = () => window.matchMedia('(pointer: coarse)').matches;
  function routeLink(from, to) {
    if ($('navApp').value === 'naver' && isPhone()) {
      const q = new URLSearchParams({ slat: from.lat, slng: from.lng, sname: from.name || from.label || '출발', dlat: to.lat, dlng: to.lng, dname: to.name, appname: location.host || 'mosquito-zero' });
      return `nmap://route/car?${q.toString()}`;
    }
    return `https://map.kakao.com/link/from/${encodeURIComponent(from.name || from.label || '출발')},${from.lat},${from.lng}/to/${encodeURIComponent(to.name)},${to.lat},${to.lng}`;
  }

  /* ---------- 출발점·조건 ---------- */
  // 김해시보건소 위치: OpenStreetMap 기준(분성로). 담당자 확인 필요
  const HEALTH_CENTER = { lat: 35.231808, lng: 128.871109, label: '김해시보건소' };
  function setupStart() {
    const M = window.GimhaeMosquitoModel;
    const sel = $('navStart');
    sel.innerHTML = '<option value="hc">김해시보건소에서 출발</option><option value="">1순위 동에서 출발</option><option value="gps">내 위치에서 출발</option>'
      + Object.keys(M.COORDS).map((d) => `<option value="${d}">${d}에서 출발</option>`).join('');
    userStart = HEALTH_CENTER;
    sel.addEventListener('change', () => {
      const v = sel.value;
      if (v === 'gps') {
        if (!navigator.geolocation) { $('navSummary').textContent = '이 기기에서는 위치를 쓸 수 없어요.'; return; }
        $('navSummary').textContent = '위치를 확인하는 중이에요…';
        navigator.geolocation.getCurrentPosition((p) => { userStart = { lat: p.coords.latitude, lng: p.coords.longitude, label: '내 위치' }; plan(); },
          () => { $('navSummary').textContent = '위치를 찾지 못했어요. 출발지를 골라 주세요.'; }, { enableHighAccuracy: true, timeout: 12000 });
        return;
      }
      if (v === 'hc') userStart = HEALTH_CENTER;
      else if (v) { const c = M.COORDS[v]; userStart = { lat: c[0], lng: c[1], label: `${v} 중심` }; } else userStart = null;
      plan();
    });
    ['navCount', 'navWork', 'navMode', 'navTime', 'navPick', 'navApp'].forEach((id) => $(id).addEventListener('change', plan));
    $('navCopy').addEventListener('click', copyPlan);
    $('navReset').addEventListener('click', () => { done = { date: todayStr(), ids: [] }; saveDone(); plan(); });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    if (!$('controlNav') || !window.GimhaeMosquitoModel) return;
    setupStart();
    try { larvaPoints = await (await fetch('data/gimhae-larva-points.json')).json(); } catch (_) { larvaPoints = []; }
    if (window.ModelV5 && window.ModelV5.ready) { try { await window.ModelV5.ready(4000); } catch (_) { /* v4 로 */ } }
    plan();
    document.addEventListener('model:v5', plan);   // v5.1 값이 늦게 오면 다시 계산
  });
}());
