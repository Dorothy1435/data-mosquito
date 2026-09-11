/**
 * about.js — 사이트 소개 페이지 전용 스크립트
 *
 * 발생원 시설 16종을 모델(mosquito-model.js)에서 직접 집계해 그린다.
 * 숫자를 HTML에 적어 두면 모델이 바뀔 때 어긋나므로, 항상 모델 값을 쓴다.
 */
(function () {
  // 시설 종류별 아이콘. 모델의 영문 키와 짝을 맞춘다.
  const SOURCE_ICON = {
    septic_clean: '🕳️',
    septic_private: '🚿',
    wwtp_private: '🚰',
    wwtp_public: '🏭',
    livestock: '🐄',
    reservoir: '🏞️',
    tire_shop: '🔧',
    waste_tire: '🛞',
    waste_stk: '🗑️',
    junk_shop: '♻️',
    water_feature: '⛲',
    toilet: '🚽',
    park: '🌳',
    bathhouse: '🛁',
    waterpump: '⚙️',
    bee_farm: '🐝',
  };

  // 곤충학적 위험 가중치를 3단계로 묶어 색을 정한다.
  function riskTier(weight) {
    if (weight >= 2.5) return { key: 'high', label: '높음' };
    if (weight >= 1.5) return { key: 'mid', label: '보통' };
    return { key: 'low', label: '낮음' };
  }

  function renderSourceGrid() {
    const el = document.getElementById('sourceGrid');
    const model = window.GimhaeMosquitoModel;
    if (!el || !model) return;

    // 17개 구역의 시설 개수를 종류별로 모두 더한다.
    const totals = {};
    Object.values(model.DISTRICTS).forEach((district) => {
      Object.entries(district.sources || {}).forEach(([key, count]) => {
        totals[key] = (totals[key] || 0) + count;
      });
    });

    const rows = Object.entries(totals)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]);
    if (!rows.length) return;

    const sum = rows.reduce((acc, [, count]) => acc + count, 0);

    el.innerHTML = rows.map(([key, count]) => {
      const tier = riskTier(model.RISK_W[key] ?? 1);
      const name = model.SRC_KOR[key] || key;
      return `<article class="source-tile source-${tier.key}">
        <span class="source-icon" aria-hidden="true">${SOURCE_ICON[key] || '📍'}</span>
        <span class="source-name">${name}</span>
        <span class="source-count">${count.toLocaleString('ko-KR')}<span class="source-unit">곳</span></span>
        <span class="source-risk">모기 위험 ${tier.label}</span>
      </article>`;
    }).join('');

    const note = document.getElementById('sourceGridNote');
    if (note) {
      note.innerHTML = `총 <strong>${sum.toLocaleString('ko-KR')}곳</strong>을 좌표로 읍·면·동에 배정했습니다. `
        + '색은 <strong>곤충학적 위험 가중치</strong>(정화조 3.0 · 저수지 2.5 · 축산 2.0 등)를 세 단계로 묶은 것입니다.';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderSourceGrid);
  } else {
    renderSourceGrid();
  }
})();
