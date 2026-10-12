/* =============================================================
   방역 내비게이션 (control-nav.js) — 전문가 화면(expert.html)
   -------------------------------------------------------------
   오늘 모기지수로 '어느 동부터, 그 동의 어느 지점으로' 방역을 갈지 순서를 짜 준다.

   1) 동 고르기 — 동마다 우선 점수를 매겨 높은 순으로 고른다.
        우선 점수 = 0.50 × 오늘 모기지수(모델 v5.1)        ← 오늘 모기가 많은 곳
                  + 0.20 × 발생원 밀도위험                ← 번식할 곳이 많은 곳
                  + 0.15 × 유충 조사 양성률(누적)          ← 실제로 유충이 나온 곳
                  + 0.15 × 2025 방역민원(면적당, 상대값)   ← 주민 불편이 큰 곳
      (모두 0~1 로 맞춘 뒤 더한다. 가중치는 WEIGHTS 에서 고친다)
   2) 들를 지점 — 고른 동 안에서 유충 조사 지점 중 '양성률 × 유충 수'가 큰 곳 2곳 (data/gimhae-larva-points.json)
   3) 순서 — 출발점(현재 위치 또는 고른 동)에서 가장 가까운 곳부터 차례로 (가까운 곳 먼저 방식)
   4) 길찾기 — 지점마다 카카오맵 길찾기 링크 (map.kakao.com/link/to/이름,위도,경도)
   5) 할 일 — 그 동에 많은 발생원 종류에 맞춘 방역 요령, 성충 방제는 그날 일몰 직후가 좋다
   지금은 누구나 볼 수 있다. 로그인이 켜지면 직원 계정만 보이게 바꾼다(사용자 결정 2026-10-12).
   ============================================================= */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const WEIGHTS = { today: 0.5, density: 0.2, larva: 0.15, complaint: 0.15 };
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
      return { district: d, score: Math.round(score * 100), index: Math.round(today[d] || 0), parts, topSources, rec };
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

  /* ---------- 그리기 ---------- */
  function plan() {
    const M = window.GimhaeMosquitoModel;
    if (!M) return;
    const count = Number($('navCount').value) || 5;
    const { rows, activeHours } = rankDistricts();
    const picked = rows.slice(0, count);
    const first = M.COORDS[picked[0].district];
    const start = userStart || { lat: first[0], lng: first[1], label: `${picked[0].district} 중심` };
    const stops = picked.flatMap((r) => stopsIn(r.district));
    const { route, totalKm } = orderStops(stops, start);
    const minutes = Math.round((totalKm / CITY_KMH) * 60);

    $('navSummary').innerHTML = `출발 <b>${esc(start.label)}</b> → ${picked.length}개 동 · ${route.length}곳 · 이동 약 <b>${totalKm.toFixed(1)}km</b>(차로 약 ${minutes}분, 직선거리 기준 어림)`
      + (activeHours ? `<br>성충 방제(연무)는 모기가 활발한 때가 효과적이에요: <b>${esc(activeHours)}</b>. 유충 구제는 낮에 해도 돼요.` : '');

    // 동별 이유·할 일
    $('navDistricts').innerHTML = picked.map((r, i) => {
      const why = [
        `오늘 지수 ${r.index}점`,
        `발생원 밀도위험 ${Math.round(r.parts.density * 100)}`,
        r.rec.larva_surveyed ? `유충 양성 ${r.rec.larva_positive}/${r.rec.larva_surveyed}곳` : '유충 조사 없음',
        `민원 ${r.rec.complaints_2025 || 0}건(2025)`,
      ].join(' · ');
      const todo = r.topSources.map(([k, n]) => `<li>${esc(ACTION[k] || k)} <span class="dim">(${(M.SRC_KOR || {})[k] || k} ${n}곳)</span></li>`).join('');
      return `<li class="nav-d"><p class="nav-d-h"><b>${i + 1}. ${esc(r.district)}</b><span class="nav-score">우선 ${r.score}</span></p><p class="dim">${why}</p><ul class="nav-todo">${todo}</ul></li>`;
    }).join('');

    // 들를 순서 + 길찾기
    $('navRoute').innerHTML = route.map((s, i) => {
      const detail = s.center ? '조사 지점 없음 · 동 중심으로 안내' : `유충 양성 ${s.pos}/${s.tries}회 · 누적 유충 ${s.larva.toLocaleString('ko-KR')}마리`;
      const link = `https://map.kakao.com/link/to/${encodeURIComponent(s.name)},${s.lat},${s.lng}`;
      return `<li><span class="nav-no">${i + 1}</span><span class="nav-txt"><b>${esc(s.name)}</b><small>${detail} · 앞 지점에서 ${s.legKm.toFixed(1)}km</small></span><a class="btn-sub nav-go" href="${link}" target="_blank" rel="noopener">길찾기</a></li>`;
    }).join('');

    drawMap(route, start);
  }

  function drawMap(route, start) {
    if (typeof L === 'undefined' || !$('navMap')) return;
    if (!map) {
      map = L.map('navMap', { scrollWheelZoom: false });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap' }).addTo(map);
    }
    if (layer) layer.remove();
    layer = L.layerGroup().addTo(map);
    const pts = [[start.lat, start.lng], ...route.map((s) => [s.lat, s.lng])];
    L.polyline(pts, { color: '#E5484D', weight: 4, opacity: 0.8, dashArray: '6 6' }).addTo(layer);
    L.circleMarker([start.lat, start.lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#191F28', fillOpacity: 1 }).bindTooltip('출발').addTo(layer);
    route.forEach((s, i) => {
      L.marker([s.lat, s.lng], { icon: L.divIcon({ className: 'nav-pin', html: `<span>${i + 1}</span>`, iconSize: [28, 28] }) })
        .bindPopup(`<b>${i + 1}. ${esc(s.name)}</b>`).addTo(layer);
    });
    map.fitBounds(L.latLngBounds(pts).pad(0.15));
    setTimeout(() => map.invalidateSize(), 100);
  }

  /* ---------- 출발점 ---------- */
  function setupStart() {
    const M = window.GimhaeMosquitoModel;
    const sel = $('navStart');
    sel.innerHTML = '<option value="">1순위 동에서 출발</option><option value="gps">내 위치에서 출발</option>'
      + Object.keys(M.COORDS).map((d) => `<option value="${d}">${d}에서 출발</option>`).join('');
    sel.addEventListener('change', () => {
      const v = sel.value;
      if (v === 'gps') {
        if (!navigator.geolocation) { $('navSummary').textContent = '이 기기에서는 위치를 쓸 수 없어요.'; return; }
        $('navSummary').textContent = '위치를 확인하는 중이에요…';
        navigator.geolocation.getCurrentPosition((p) => { userStart = { lat: p.coords.latitude, lng: p.coords.longitude, label: '내 위치' }; plan(); },
          () => { $('navSummary').textContent = '위치를 찾지 못했어요. 출발 동을 골라 주세요.'; }, { enableHighAccuracy: true, timeout: 12000 });
        return;
      }
      if (v) { const c = M.COORDS[v]; userStart = { lat: c[0], lng: c[1], label: `${v} 중심` }; } else userStart = null;
      plan();
    });
    $('navCount').addEventListener('change', plan);
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
