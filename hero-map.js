/* =============================================================
   모기제로 첫 화면 지도 (hero-map.js)
   -------------------------------------------------------------
   검정 첫 화면 오른쪽에 김해 지도를 가는 선으로 그리고, 17개 동네를 오늘 단계 색 원으로 띄운다.
     · 경계: data/gimhae-boundary.json (OpenStreetMap, ODbL). 시 경계는 항상 그리고, 동네 경계는 있는 것만 그린다.
     · 동네 경계가 부족하면 이웃 동네끼리 점선으로 이어 지도 느낌을 만든다.
     · 원 크기·색: 오늘 그 동네의 모기지수(김해 정밀 모델). 내 동네는 흰 테두리 + '내 동네' 표시.
     · script.js 가 계산을 끝내고 보내는 'mosquito:updated' 를 받아 그린다. 김해 밖이면 원만 없이 지도를 둔다.
   ============================================================= */
(function () {
  'use strict';
  const VB_W = 1000, VB_H = 760, PAD = 56;
  let boundaryPromise = null;

  function loadBoundary() {
    if (!boundaryPromise) {
      boundaryPromise = fetch('data/gimhae-boundary.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
    }
    return boundaryPromise;
  }

  // 위도·경도 → 화면 좌표. 김해 정도 크기면 단순 투영으로 충분하다.
  function makeProjection(points) {
    const lat0 = points.reduce((s, p) => s + p[1], 0) / points.length;
    const k = Math.cos((lat0 * Math.PI) / 180);
    const xs = points.map((p) => p[0] * k), ys = points.map((p) => -p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const scale = Math.min((VB_W - PAD * 2) / (maxX - minX), (VB_H - PAD * 2) / (maxY - minY));
    const ox = (VB_W - (maxX - minX) * scale) / 2, oy = (VB_H - (maxY - minY) * scale) / 2;
    return ([lng, lat]) => [ox + (lng * k - minX) * scale, oy + (-lat - minY) * scale];
  }
  const pathOf = (ring, proj) => ring.map((p, i) => (i ? 'L' : 'M') + proj(p).map((v) => v.toFixed(1)).join(' ')).join('') + 'Z';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function render(svg, boundary, districts, active) {
    const M = window.GimhaeMosquitoModel;
    const coords = M ? M.COORDS : {};
    const all = [];
    if (boundary && boundary.city) boundary.city.forEach((r) => all.push(...r));
    Object.values(coords).forEach(([lat, lng]) => all.push([lng, lat]));
    if (!all.length) return;
    const proj = makeProjection(all);

    const parts = [];
    parts.push(`<defs><filter id="hmGlow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="14"/></filter></defs>`);
    if (boundary && boundary.city) boundary.city.forEach((r) => parts.push(`<path class="hm-city" d="${pathOf(r, proj)}"/>`));
    const rings = (boundary && boundary.districts) || {};
    Object.values(rings).forEach((rs) => rs.forEach((r) => parts.push(`<path class="hm-d" d="${pathOf(r, proj)}"/>`)));

    // 동네 경계가 10개 미만이면 이웃끼리 점선으로 잇는다
    const names = Object.keys(coords);
    const pos = {};
    names.forEach((n) => { pos[n] = proj([coords[n][1], coords[n][0]]); });
    if (Object.keys(rings).length < 10) {
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

    // 동네 원: 오늘 모기지수 → 크기·색
    const byName = {};
    (districts || []).forEach((d) => { byName[d.district] = d; });
    names.forEach((n, i) => {
      const d = byName[n];
      const [x, y] = pos[n];
      const idx = d ? d.mosquito_index : null;
      const r = idx == null ? 7 : 8 + (idx / 100) * 34;
      const color = d ? d.color : 'rgba(255,255,255,.35)';
      const me = n === active;
      parts.push(`<g class="hm-node${me ? ' me' : ''}" style="--i:${i}">`);
      if (d) parts.push(`<circle class="hm-glow" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * 1.6).toFixed(1)}" fill="${color}"/>`);
      parts.push(`<circle class="hm-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${color}"/>`);
      if (me) parts.push(`<circle class="hm-me" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r + 9).toFixed(1)}"/>`);
      // 도심처럼 동네가 촘촘한 곳은 이름이 겹치므로, 이웃과 충분히 떨어진 동네와 내 동네만 이름을 쓴다
      const nearest = Math.min(...names.filter((m) => m !== n).map((m) => Math.hypot(pos[m][0] - x, pos[m][1] - y)));
      if (me) {
        const label = `${esc(n)} · 내 동네`;
        const w = label.length * 11 + 28, ly = y - r - 18;   // 도심은 아래쪽이 빽빽하므로 이름은 원 위에 둔다
        parts.push(`<rect class="hm-pill" x="${(x - w / 2).toFixed(1)}" y="${(ly - 19).toFixed(1)}" width="${w}" height="30" rx="15"/>`);
        parts.push(`<text class="hm-name me" x="${x.toFixed(1)}" y="${(ly + 2).toFixed(1)}" text-anchor="middle">${label}</text>`);
      } else if (nearest > 44) {
        parts.push(`<text class="hm-name" x="${x.toFixed(1)}" y="${(y + r + 22).toFixed(1)}" text-anchor="middle">${esc(n)}</text>`);
      }
      parts.push('</g>');
    });
    svg.innerHTML = parts.join('');
    svg.classList.add('is-on');
  }

  document.addEventListener('mosquito:updated', (event) => {
    const svg = document.getElementById('heroMap');
    if (!svg) return;
    const d = event.detail || {};
    let districts = [];
    try {
      if (window.GimhaeMosquitoModel && typeof window.gimhaeModelOptions === 'function') {
        districts = window.GimhaeMosquitoModel.allIndices(window.gimhaeModelOptions(d.weatherData));
      }
    } catch (e) { districts = []; }
    loadBoundary().then((boundary) => render(svg, boundary, districts, d.district || null));
  });
})();
