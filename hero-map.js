/* =============================================================
   모기제로 첫 화면 지도 (hero-map.js)
   -------------------------------------------------------------
   첫 화면 오른쪽에 지도를 가는 선으로 그린다. 보기 두 가지를 '경남 한눈에' 버튼으로 오간다.
     · 동네 보기(김해): 시 경계 + 17개 동네 원(오늘 모기지수 색·크기). 내 동네는 흰 테두리 + '내 동네' 이름표.
     · 경남 한눈에: 18개 시·군 경계 위에 시·군마다 오늘 점수 색 점. 김해는 동네별 정밀 자료, 그 밖은 날씨로 추정.
       지역을 김해가 아닌 시·군으로 고르면 이 보기가 기본이고 그 시·군이 강조된다.
     · 경계 자료: data/gimhae-boundary.json, data/city-boundaries.json (통계청 2013 행정경계)
     · script.js 가 계산을 끝내고 보내는 'mosquito:updated' 를 받아 그린다.
     · 시·군 점수는 script.js 의 loadWeatherData·calculateMosquitoIndex(날씨 기반 일반식)를 그대로 쓴다. 10분 캐시.
   ============================================================= */
(function () {
  'use strict';
  const VB_W = 1000, VB_H = 760, PAD = 56;
  const cache = {};
  let view = 'local';          // 'local'(동네 보기) | 'gn'(경남 한눈에)
  let lastDetail = null;       // 마지막 'mosquito:updated' 내용
  let gnScores = null;         // { name: { index, color } }, 경남 18곳
  let gnScoresAt = 0;

  function loadJson(url) {
    if (!cache[url]) cache[url] = fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    return cache[url];
  }

  // 위도·경도 → 화면 좌표. 도 하나 크기까지는 단순 투영으로 충분하다.
  function makeProjection(points) {
    const lat0 = points.reduce((s, p) => s + p[1], 0) / points.length;
    const k = Math.cos((lat0 * Math.PI) / 180);
    const xs = points.map((p) => p[0] * k), ys = points.map((p) => -p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const scale = Math.min((VB_W - PAD * 2) / (maxX - minX || 1), (VB_H - PAD * 2) / (maxY - minY || 1));
    const ox = (VB_W - (maxX - minX) * scale) / 2, oy = (VB_H - (maxY - minY) * scale) / 2;
    return ([lng, lat]) => [ox + (lng * k - minX) * scale, oy + (-lat - minY) * scale];
  }
  const pathOf = (ring, proj) => ring.map((p, i) => (i ? 'L' : 'M') + proj(p).map((v) => v.toFixed(1)).join(' ')).join('') + 'Z';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const GLOW = '<defs><filter id="hmGlow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="14"/></filter></defs>';

  // 이름표(알약 + 글자). 빽빽한 곳은 원 위에 둔다.
  function pillLabel(x, y, r, text) {
    const w = text.length * 11 + 28, ly = y - r - 18;
    return `<rect class="hm-pill" x="${(x - w / 2).toFixed(1)}" y="${(ly - 19).toFixed(1)}" width="${w}" height="30" rx="15"/>`
      + `<text class="hm-name me" x="${x.toFixed(1)}" y="${(ly + 2).toFixed(1)}" text-anchor="middle">${text}</text>`;
  }
  function dot(parts, x, y, r, color, me, i, glow) {
    parts.push(`<g class="hm-node${me ? ' me' : ''}" style="--i:${i}">`);
    if (glow) parts.push(`<circle class="hm-glow" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * 1.6).toFixed(1)}" fill="${color}"/>`);
    parts.push(`<circle class="hm-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${color}"/>`);
    if (me) parts.push(`<circle class="hm-me" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r + 9).toFixed(1)}"/>`);
  }

  /* ---------- 동네 보기(김해): 시 경계 + 17개 동네 원 ---------- */
  function renderGimhae(svg, boundary, districts, active) {
    const M = window.GimhaeMosquitoModel;
    const coords = M ? M.COORDS : {};
    const all = [];
    if (boundary && boundary.city) boundary.city.forEach((r) => all.push(...r));
    Object.values(coords).forEach(([lat, lng]) => all.push([lng, lat]));
    if (!all.length) return;
    const proj = makeProjection(all);

    const parts = [GLOW];
    const rings = (boundary && boundary.districts) || {};
    const hasDistricts = Object.keys(rings).length >= 10;
    // 동네 경계가 다 있으면 시 경계를 따로 그리지 않는다 (두 자료의 점이 달라 선이 겹쳐 보인다)
    if (boundary && boundary.city && !hasDistricts) boundary.city.forEach((r) => parts.push(`<path class="hm-city" d="${pathOf(r, proj)}"/>`));
    Object.values(rings).forEach((rs) => rs.forEach((r) => parts.push(`<path class="hm-d${hasDistricts ? ' hm-d2' : ''}" d="${pathOf(r, proj)}"/>`)));

    const names = Object.keys(coords);
    const pos = {};
    names.forEach((n) => { pos[n] = proj([coords[n][1], coords[n][0]]); });
    if (!hasDistricts) {
      const seen = new Set();
      names.forEach((n) => {
        names.map((m) => [m, Math.hypot(pos[m][0] - pos[n][0], pos[m][1] - pos[n][1])])
          .filter(([m, d]) => m !== n && d > 0).sort((a, b) => a[1] - b[1]).slice(0, 2)
          .forEach(([m]) => {
            const key = [n, m].sort().join('|');
            if (seen.has(key)) return; seen.add(key);
            parts.push(`<line class="hm-link" x1="${pos[n][0].toFixed(1)}" y1="${pos[n][1].toFixed(1)}" x2="${pos[m][0].toFixed(1)}" y2="${pos[m][1].toFixed(1)}"/>`);
          });
      });
    }

    const byName = {};
    (districts || []).forEach((d) => { byName[d.district] = d; });
    names.forEach((n, i) => {
      const d = byName[n];
      const [x, y] = pos[n];
      const idx = d ? d.mosquito_index : null;
      const r = idx == null ? 7 : 8 + (idx / 100) * 34;
      const color = d ? d.color : 'rgba(255,255,255,.35)';
      const me = n === active;
      dot(parts, x, y, r, color, me, i, Boolean(d));
      const nearest = Math.min(...names.filter((m) => m !== n).map((m) => Math.hypot(pos[m][0] - x, pos[m][1] - y)));
      if (me) parts.push(pillLabel(x, y, r, `${esc(n)} · 내 동네`));
      else if (nearest > 44) parts.push(`<text class="hm-name" x="${x.toFixed(1)}" y="${(y + r + 22).toFixed(1)}" text-anchor="middle">${esc(n)}</text>`);
      parts.push('</g>');
    });
    svg.innerHTML = parts.join('');
    svg.classList.add('is-on');
  }

  /* ---------- 경남 한눈에: 18개 시·군 경계 + 시·군마다 오늘 점수 점 ---------- */
  function renderGyeongnam(svg, data, regions, scores, active, kimhaeIndex, kimhaeColor) {
    const cities = (data && data.cities) || {};
    const all = [];
    Object.values(cities).forEach((rs) => rs.forEach((r) => all.push(...r)));
    if (!all.length) return;
    const proj = makeProjection(all);
    const parts = [GLOW];
    Object.entries(cities).forEach(([name, rs]) => rs.forEach((r) => parts.push(`<path class="hm-d hm-d2${name === active ? ' hm-act' : ''}" d="${pathOf(r, proj)}"/>`)));
    const pos = {};
    regions.forEach((rg) => { pos[rg.name] = proj([rg.lng, rg.lat]); });
    // 알약 이름표가 붙는 곳(지금 보는 곳·김해) 근처의 작은 이름은 겹치지 않게 생략한다
    const pills = regions.filter((rg) => rg.name === active || rg.name === '김해').map((rg) => pos[rg.name]);
    const nearPill = (x, y) => pills.some(([px, py]) => Math.abs(px - x) < 120 && Math.abs(py - y) < 60);
    regions.forEach((rg, i) => {
      const [x, y] = pos[rg.name];
      const isK = rg.name === '김해';
      const sc = isK && kimhaeIndex != null ? { index: kimhaeIndex, color: kimhaeColor } : (scores && scores[rg.name]);
      const idx = sc ? sc.index : null;
      const r = idx == null ? 7 : 7 + (idx / 100) * 26;
      const color = sc ? sc.color : 'rgba(255,255,255,.35)';
      const me = rg.name === active;
      dot(parts, x, y, r, color, me, i, Boolean(sc));
      if (isK) parts.push(`<circle class="hm-kim" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r + 16).toFixed(1)}"/>`);   // 정밀 자료가 있는 곳 표시
      const others = regions.filter((o) => o.name !== rg.name);
      const nearest = Math.min(...others.map((o) => Math.hypot(pos[o.name][0] - x, pos[o.name][1] - y)));
      const label = me ? `${esc(rg.name)} · 지금 보는 곳` : (isK ? `${esc(rg.name)} · 동네별 정밀` : null);
      if (label) parts.push(pillLabel(x, y, r, label));
      else if (nearest > 40 && !nearPill(x, y)) parts.push(`<text class="hm-name" x="${x.toFixed(1)}" y="${(y + r + 20).toFixed(1)}" text-anchor="middle">${esc(rg.name)}</text>`);
      parts.push('</g>');
    });
    parts.push(`<text class="hm-cap" x="${VB_W - 8}" y="${VB_H - 10}" text-anchor="end">경남 18개 시·군 · 김해는 동네별 정밀 자료, 그 밖은 날씨로 추정 (참고용)</text>`);
    svg.innerHTML = parts.join('');
    svg.classList.add('is-on');
  }

  // 시·군 18곳의 오늘 점수 (날씨 기반 일반식). 10분 캐시. script.js 의 전역 함수를 쓴다.
  async function loadGnScores(regions) {
    if (gnScores && Date.now() - gnScoresAt < 10 * 60 * 1000) return gnScores;
    if (typeof window.loadWeatherData !== 'function' || typeof window.calculateMosquitoIndex !== 'function') return null;
    const out = {};
    await Promise.all(regions.map(async (rg) => {
      try {
        const w = await window.loadWeatherData(rg.lat, rg.lng, rg);
        const idx = Math.round(window.calculateMosquitoIndex(rg, w));
        const st = typeof window.getCurrentStage === 'function' ? window.getCurrentStage(idx) : null;
        out[rg.name] = { index: idx, color: (st && st.color) || '#B5D65A', live: w && w.isLive };
      } catch (e) { /* 그 시·군은 점만 회색 */ }
    }));
    gnScores = out; gnScoresAt = Date.now();
    return out;
  }

  function draw() {
    const svg = document.getElementById('heroMap');
    const btn = document.getElementById('heroViewBtn');
    const d = lastDetail;
    if (!svg || !d) return;
    const regionName = d.region && d.region.name;
    const isKimhae = regionName === '김해' || Boolean(d.district);
    if (btn) { btn.hidden = false; btn.textContent = view === 'gn' ? (isKimhae ? '김해 동네 보기' : '시·군만 보기') : '경남 한눈에'; btn.setAttribute('aria-pressed', view === 'gn' ? 'true' : 'false'); }

    if (view === 'gn') {
      Promise.all([loadJson('data/city-boundaries.json'), loadJson('data/regions.json')]).then(async ([data, rj]) => {
        const regions = (rj && rj.regions) || [];
        // 먼저 점수 없이 그리고(바로 보이게), 점수가 오면 다시 그린다
        renderGyeongnam(svg, data, regions, gnScores, regionName, d.index, d.stage && d.stage.color);
        const scores = await loadGnScores(regions);
        if (view === 'gn' && lastDetail === d) renderGyeongnam(svg, data, regions, scores, regionName, d.index, d.stage && d.stage.color);
      });
      return;
    }
    if (isKimhae) {
      let districts = [];
      try {
        if (window.GimhaeMosquitoModel && typeof window.gimhaeModelOptions === 'function') {
          districts = window.GimhaeMosquitoModel.allIndices(window.gimhaeModelOptions(d.weatherData));
        }
      } catch (e) { districts = []; }
      loadJson('data/gimhae-boundary.json').then((boundary) => renderGimhae(svg, boundary, districts, d.district || null));
      return;
    }
    // 김해 밖 시·군의 '시·군만 보기': 그 시·군 경계 + 지금 보는 지점
    const color = (d.stage && d.stage.color) || 'rgba(255,255,255,.6)';
    loadJson('data/city-boundaries.json').then((data) => {
      const rings = (data && data.cities && data.cities[regionName]) || [];
      const all = []; rings.forEach((r) => all.push(...r));
      const lat = d.lat != null ? d.lat : (d.region && d.region.lat), lng = d.lng != null ? d.lng : (d.region && d.region.lng);
      if (lat != null) all.push([lng, lat]);
      if (!all.length) return;
      const proj = makeProjection(all);
      const parts = [GLOW];
      rings.forEach((r) => parts.push(`<path class="hm-city" d="${pathOf(r, proj)}"/>`));
      if (lat != null) { const [x, y] = proj([lng, lat]); const r = d.index == null ? 10 : 10 + (d.index / 100) * 34; dot(parts, x, y, r, color, true, 0, true); parts.push(pillLabel(x, y, r, `${esc(regionName)} · 지금 보는 곳`)); parts.push('</g>'); }
      svg.innerHTML = parts.join('');
      svg.classList.add('is-on');
    });
  }

  document.addEventListener('mosquito:updated', (event) => {
    const d = event.detail || {};
    const regionName = d.region && d.region.name;
    const wasKimhae = lastDetail && (lastDetail.region && lastDetail.region.name === '김해' || lastDetail.district);
    const isKimhae = regionName === '김해' || Boolean(d.district);
    // 지역이 김해 ↔ 다른 시·군으로 바뀌면 기본 보기로 돌아간다: 김해는 동네 보기, 다른 시·군은 경남 한눈에
    if (!lastDetail || wasKimhae !== isKimhae) view = isKimhae ? 'local' : 'gn';
    lastDetail = d;
    draw();
  });
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('heroViewBtn');
    if (btn) btn.addEventListener('click', () => { view = view === 'gn' ? 'local' : 'gn'; draw(); });
  });
})();
