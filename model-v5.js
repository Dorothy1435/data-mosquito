/* =============================================================
   모기제로 모델 v5 연결 (model-v5.js)
   -------------------------------------------------------------
   서버 함수 /api/model 이 돌려주는 v5(실측 학습 모형) 결과를 받아, 화면이 쓰는 자바스크립트 모델
   GimhaeMosquitoModel 의 답을 v5 기준으로 바꿔 끼운다. 화면 코드(script.js·gimhae.js)는 그대로 둔다.

   동작
     · '지금 조건' 계산(options._current 가 참)은 v5 결과를 그대로 돌려준다 (지수·단계·예상 채집수·요령·순위).
     · 시간별·일별 예보 계산은 v4 가 만든 하루 안의 흐름(모양)을 유지하되, 크기를 v5 수준에 맞춘다.
       (v5 는 하루 단위 모델이라 시간별 모양은 v4 의 것을 빌린다)  지수 = v4 지수 × (v5 오늘 / v4 오늘)
     · allIndices(순위·지도)는 v5 결과를 그대로 준다.
     · 서버가 실패하거나 느리면 v4 로 계속 동작하고, v5 가 도착하면 'model:v5' 이벤트로 화면을 한 번 더 그린다.
   ============================================================= */
(function () {
  'use strict';
  const M = window.GimhaeMosquitoModel;
  if (!M || M.__v5wrapped) return;
  M.__v5wrapped = true;

  const origIndex = M.mosquitoIndex;
  const origAll = M.allIndices;
  const v5 = {};            // district → v5 결과
  const ratio = {};         // district → v5 오늘 / v4 오늘
  const state = { ready: false, date: null, live: null, error: null };
  // 첫 응답(성공이든 실패든)을 기다릴 수 있게 한다 — 화면이 v4로 먼저 그려졌다가 v5로 바뀌어 숫자가 널뛰는 것을 막는다
  let settle;
  const firstAnswer = new Promise((r) => { settle = r; });

  // 홈 화면과 같은 5단계 (반올림 정수 판정)
  function grade(index) {
    const n = Math.round(index);
    if (n <= 20) return [1, '매우 낮음', '#5FD08A'];
    if (n <= 40) return [2, '낮음', '#B5D65A'];
    if (n <= 60) return [3, '보통', '#F2C94C'];
    if (n <= 80) return [4, '높음', '#F08A3E'];
    return [5, '매우 높음', '#E5484D'];
  }
  const clamp = (x) => Math.max(0, Math.min(100, x));
  const r1 = (x) => Math.round(x * 10) / 10;

  M.mosquitoIndex = function (district, options) {
    const base = origIndex(district, options);
    const cur = v5[district];
    if (!cur) return base;
    if (options && options._current) {
      // 비율(v5 오늘 / v4 오늘)은 실제 날씨로 계산한 호출에서 정한다. 평년값 호출(지도 마커 등)은 비율이 없을 때만 임시로 쓴다
      if (options.weather_observed || ratio[district] == null) ratio[district] = cur.mosquito_index / Math.max(base.mosquito_index, 1);
      // v5 결과를 그대로 쓰되, 화면이 기대하는 필드(예: source_risk.larva)가 빠졌으면 v4 것으로 채운다
      const merged = Object.assign({}, base, cur, { v4_index: base.mosquito_index });
      ['source_risk', 'weather', 'confidence', 'ranking', 'area', 'advice', 'larva_survey'].forEach((k) => {
        if (base[k] && cur[k] && typeof cur[k] === 'object') merged[k] = Object.assign({}, base[k], cur[k]);
      });
      if (base.weather && base.weather.components && cur.weather && cur.weather.components) merged.weather.components = Object.assign({}, base.weather.components, cur.weather.components);
      return merged;
    }
    const k = ratio[district];
    if (k == null) return base;
    const idx = r1(clamp(base.mosquito_index * k));
    const [lv, nm, col] = grade(idx);
    // 순위·신뢰도·예상 채집수는 v5 의 오늘 값을 그대로 쓴다 (시간별 모양만 v4 에서 빌린다)
    return Object.assign({}, base, {
      mosquito_index: idx, level: lv, grade: nm, color: col, model_version: 'v5-shape',
      index_range: { low: r1(clamp(base.index_range.low * k)), high: r1(clamp(base.index_range.high * k)) },
      ranking: cur.ranking, confidence: Object.assign({}, base.confidence, cur.confidence), expected_trap_count: cur.expected_trap_count,
    });
  };

  M.allIndices = function (options) {
    if (!state.ready) return origAll(options);
    return Object.keys(v5).map((d) => v5[d]).sort((a, b) => b.mosquito_index - a.mosquito_index);
  };

  function load() {
    return fetch('/api/model', { cache: 'default' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || !data.ok || !Array.isArray(data.districts) || !data.districts.length) {
          state.error = (data && data.error) || '응답 없음';
          settle(false);
          return false;
        }
        data.districts.forEach((row) => { v5[row.district] = row; });
        state.ready = true; state.date = data.date; state.live = data.live_weather;
        document.documentElement.dataset.model = 'v5';
        settle(true);
        document.dispatchEvent(new CustomEvent('model:v5', { detail: { date: data.date, live: data.live_weather } }));
        return true;
      })
      .catch((e) => { state.error = String(e && e.message || e); settle(false); return false; });
  }

  // ready(ms): 첫 응답이 올 때까지(최대 ms) 기다린다. 이미 답이 있으면 바로 끝난다.
  const ready = (ms) => Promise.race([firstAnswer, new Promise((r) => setTimeout(() => r(state.ready), ms || 4000))]);
  window.ModelV5 = { state, get: (d) => v5[d] || null, reload: load, ready };
  load();
  // 30분마다 서버 결과를 다시 받는다 (서버 캐시 주기와 같다). 받으면 'model:v5' 로 화면이 다시 그려진다
  setInterval(() => { if (document.visibilityState === 'visible') load(); }, 30 * 60 * 1000);
})();
