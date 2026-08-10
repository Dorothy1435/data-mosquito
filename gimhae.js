/*
 * 김해시 모기 위험 모델 페이지 스크립트
 *
 * 흐름
 *  1) 17개 읍·면·동 좌표의 실시간 날씨(기온·습도·최근 3일 강수량)를 Open-Meteo
 *     멀티좌표 기능으로 "한 번의 호출"에 각각 받아온다. (구역마다 다른 날씨)
 *  2) 불러온 날씨를 mosquito-model.js(GimhaeMosquitoModel)에 입력해 구역별 모기지수를 계산한다.
 *  3) 게이지·기상분석·발생원분석·순위·행동요령·구역 순위표를 화면에 렌더링한다.
 *  4) 날씨를 못 불러오면 이번 달 평년값으로 자동 대체한다. (모델이 월별 평년값을 내장)
 */

// 17개 구역의 대표 좌표 (모델에서 가져옴: { 구역명: [위도, 경도] })
const DISTRICT_COORDS = GimhaeMosquitoModel.COORDS;

// 화면 요소 참조
const districtSelect = document.getElementById('districtSelect');
const weatherSourceBadge = document.getElementById('weatherSourceBadge');
const districtBadge = document.getElementById('districtBadge');
const weatherStatus = document.getElementById('weatherStatus');
const weatherInputText = document.getElementById('weatherInputText');
const updatedText = document.getElementById('updatedText');
const gimhaeGauge = document.getElementById('gimhaeGauge');
const indexValue = document.getElementById('indexValue');
const gradeText = document.getElementById('gradeText');
const summaryText = document.getElementById('summaryText');
const confidenceBadge = document.getElementById('confidenceBadge');
const rangeText = document.getElementById('rangeText');
const confidenceReason = document.getElementById('confidenceReason');
const larvaText = document.getElementById('larvaText');
const larvaFill = document.getElementById('larvaFill');
const weatherComponents = document.getElementById('weatherComponents');
const weatherComment = document.getElementById('weatherComment');
const diagnosisBody = document.getElementById('diagnosisBody');
const geoBreakdown = document.getElementById('geoBreakdown');
const sourceList = document.getElementById('sourceList');
const sourceComment = document.getElementById('sourceComment');
const areaTypeText = document.getElementById('areaTypeText');
const rankSummary = document.getElementById('rankSummary');
const citizenAdvice = document.getElementById('citizenAdvice');
const authorityAdvice = document.getElementById('authorityAdvice');
const extraInfoText = document.getElementById('extraInfoText');
const districtRankList = document.getElementById('districtRankList');

// 구역별 현재 날씨 보관소 { 구역명: {month, isLive, temp_c, humidity, ...} }
let districtWeather = {};
// 이번 실행에 실시간 날씨를 하나라도 받아왔는지 (화면 안내용)
let weatherIsLive = false;
// 이번 달 (평년값 대체 시 사용)
let currentMonth = 6;

// 여러 구역의 실시간 날씨를 Open-Meteo 멀티좌표 기능으로 한 번에 요청하는 주소를 만든다.
// (위도/경도를 콤마로 이어 보내면 좌표 개수만큼의 결과가 배열로 돌아온다)
function getBulkWeatherUrl(names) {
  const lats = names.map((name) => DISTRICT_COORDS[name][0]).join(',');
  const lngs = names.map((name) => DISTRICT_COORDS[name][1]).join(',');
  const params = new URLSearchParams({
    latitude: lats,
    longitude: lngs,
    current_weather: 'true',
    current: 'precipitation',
    hourly: 'relative_humidity_2m',
    // 누적온도(GDD) 계산을 위해 일별 기온 최고/최저를 14일치 함께 받는다.
    daily: 'precipitation_sum,temperature_2m_max,temperature_2m_min',
    past_days: '14',
    forecast_days: '1',
    timezone: 'Asia/Seoul',
    temperature_unit: 'celsius',
    wind_speed_unit: 'ms',
    precipitation_unit: 'mm',
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

// Open-Meteo 응답(한 좌표분)에서 모델 입력값(기온·습도·최근 3일 강수 등)을 뽑아낸다.
function parseLocationWeather(loc, month) {
  const current = loc.current_weather;
  const currentExtra = loc.current || {};
  const hourly = loc.hourly || {};
  const daily = loc.daily || {};

  // 현재 시각에 해당하는 습도 값을 찾는다.
  // current_weather.time은 분이 붙을 수 있어(T16:30) 정시 배열(T16:00)과 안 맞으므로 정시로 맞춘다.
  const times = hourly.time || [];
  const hourKey = (current.time || '').slice(0, 13);
  let currentIndex = times.findIndex((time) => time.slice(0, 13) === hourKey);
  if (currentIndex === -1) {
    currentIndex = Math.max(0, times.length - 1);
  }
  const humidity = hourly.relative_humidity_2m?.[currentIndex];

  // 최근 3일 강수량 합계 (가장 최근 3개 일별 강수량)
  const dailyRain = (daily.precipitation_sum || []).filter((value) => value != null);
  const recent3 = dailyRain.slice(-3);
  const rain3dMm = recent3.length
    ? Math.round(recent3.reduce((sum, value) => sum + Number(value || 0), 0) * 10) / 10
    : null;

  // 풍속(m/s): current_weather에 포함된 값을 그대로 사용한다.
  const windMs = current.windspeed == null
    ? null
    : Math.round(Number(current.windspeed) * 10) / 10;

  // 현재 강수량(mm/h): current=precipitation 응답에서 가져온다.
  const precipNow = currentExtra.precipitation == null
    ? null
    : Number(currentExtra.precipitation);

  // 현재 시각(0~23시): 관측 시각 문자열(예: 2026-06-12T16:30)에서 시(時)만 뽑는다.
  const hour = current.time
    ? Number(current.time.slice(11, 13))
    : new Date().getHours();

  // 최근 ~2주 누적온도(GDD, base 10.5℃) — 오늘 이전 최대 14일의 일평균 기온으로 계산.
  const dmax = daily.temperature_2m_max || [];
  const dmin = daily.temperature_2m_min || [];
  const dtime = daily.time || [];
  const todayKey = (current.time || '').slice(0, 10);
  let todayIdx = dtime.indexOf(todayKey);
  if (todayIdx === -1) todayIdx = dtime.length - 1;
  let gddSum = 0;
  let gddCount = 0;
  for (let i = Math.max(0, todayIdx - 14); i < todayIdx; i += 1) {
    const mx = Number(dmax[i]);
    const mn = Number(dmin[i]);
    if (!Number.isNaN(mx) && !Number.isNaN(mn)) {
      gddSum += Math.max(0, (mx + mn) / 2 - 10.5);
      gddCount += 1;
    }
  }
  const gdd14d = gddCount > 0 ? Math.round(gddSum) : null;

  return {
    month,
    isLive: true,
    temp_c: current.temperature,
    humidity: humidity == null ? null : Math.round(humidity),
    rain_3d_mm: rain3dMm,
    wind_ms: windMs,
    precip_now: precipNow,
    hour,
    gdd_14d: gdd14d,
    observedAt: current.time,
  };
}

// 17개 구역의 실시간 날씨를 "한 번의 호출"로 모두 받아와 districtWeather에 채운다.
// 실패하면 모든 구역을 평년값 모드로 둔다(서비스 중단 없음).
async function loadAllDistrictWeather() {
  const month = new Date().getMonth() + 1;
  currentMonth = month;
  const names = GimhaeMosquitoModel.listDistricts().filter((name) => DISTRICT_COORDS[name]);

  try {
    const response = await fetch(getBulkWeatherUrl(names));
    if (!response.ok) {
      throw new Error(`날씨 요청 실패: ${response.status}`);
    }

    let data = await response.json();
    // 좌표가 1개면 객체, 여러 개면 배열로 온다.
    if (!Array.isArray(data)) {
      data = [data];
    }

    const result = {};
    names.forEach((name, i) => {
      const loc = data[i];
      result[name] = (loc && loc.current_weather)
        ? parseLocationWeather(loc, month)
        : { month, isLive: false };
    });
    weatherIsLive = true;
    return result;
  } catch (error) {
    console.warn('구역별 실시간 날씨를 불러오지 못해 이번 달 평년값으로 계산합니다.', error);
    const result = {};
    names.forEach((name) => {
      result[name] = { month, isLive: false };
    });
    weatherIsLive = false;
    return result;
  }
}

// 한 구역의 날씨를 모델 옵션으로 만든다. (값이 없는 항목은 빼서 모델이 평년값을 쓰도록 한다)
function buildModelOptions(district) {
  const weather = districtWeather[district] || { month: currentMonth, isLive: false };
  const options = { month: weather.month || currentMonth };
  // 실시간 날씨를 반영했는지(신뢰도 계산용). 평년값 모드면 false.
  options.weather_observed = weather.isLive === true;
  if (weather.temp_c != null) options.temp_c = weather.temp_c;
  if (weather.humidity != null) options.humidity = weather.humidity;
  if (weather.rain_3d_mm != null) options.rain_3d_mm = weather.rain_3d_mm;
  // 시간대·풍속·현재강수는 실시간 모드에서만 전달한다(평년값 모드에선 빼서 보정 없이 계산).
  if (weather.hour != null) options.hour = weather.hour;
  if (weather.wind_ms != null) options.wind_ms = weather.wind_ms;
  if (weather.precip_now != null) options.precip_now = weather.precip_now;
  if (weather.gdd_14d != null) options.gdd_14d = weather.gdd_14d; // ③ 누적온도 발육 보정
  return options;
}

// === 발생원 지도 (김해 17개 구역) ===
let gimhaeMap = null;
let gimhaeMarkers = {};
let gimhaeParks = [];          // data/gimhae-parks.json (도시공원 245곳)
let parksLayer = null;         // 공원 마커 레이어(토글)
let larvaPoints = [];          // data/gimhae-larva-points.json (유충 실측 지점)
let larvaMonthly = [];         // data/gimhae-larva-monthly.json (월별 예측 vs 실측)
let larvaLayer = null;         // 유충 실측 지점 레이어(토글)

// 공원 유형별 서식 보정(곤충학적 근거): 물가·규모가 클수록 모기 서식 여지가 크다.
// 실측이 아니라 유형 기반 보정임을 명확히 한다.
const PARK_TYPE_ADJ = {
  '수변공원': 0.14,   // 물가 — 정체수·습지
  '근린공원': 0.05,   // 넓고 식생 많음
  '체육공원': 0.03,
  '역사공원': 0.02,
  '소공원': -0.02,     // 작고 관리됨
  '어린이공원': -0.03, // 작고 포장·관리됨
};

// 공원 1곳의 모기 위험(0~1) = 구역 밀도위험 + 공원 유형 보정. 실측값 아님(추정).
function parkRisk(park) {
  const d = GimhaeMosquitoModel.DISTRICTS[park.district];
  const base = d ? d.density_risk : 0.4;
  const adj = PARK_TYPE_ADJ[park.type] || 0;
  return Math.max(0, Math.min(1, base + adj));
}

// 0~1 위험을 한 단어 단계로. (모델 grade는 미노출이라 여기서 자체 라벨을 쓴다)
function parkGradeLabel(risk) {
  if (risk < 0.3) return '낮음';
  if (risk < 0.5) return '보통';
  if (risk < 0.7) return '다소 높음';
  return '높음';
}

// 발생원 위험(0~100)에 따른 원 색상. 높을수록 진한 빨강.
function sourceRiskColor(score) {
  if (score >= 75) return '#b91c1c';
  if (score >= 50) return '#ef4444';
  if (score >= 30) return '#f59e0b';
  if (score >= 15) return '#facc15';
  return '#86efac';
}

// A2: 김해시 전체 발생원 총량 요약(17개 구역 합산). 실제 데이터로 계산한다.
function renderSourceTotals() {
  const el = document.getElementById('sourceTotals');
  if (!el) return;
  const SRC_KOR = GimhaeMosquitoModel.SRC_KOR;
  const totals = {};
  Object.values(GimhaeMosquitoModel.DISTRICTS).forEach((d) => {
    Object.entries(d.sources || {}).forEach(([key, count]) => {
      totals[key] = (totals[key] || 0) + count;
    });
  });
  const parts = Object.entries(totals)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => `${SRC_KOR[key]} <strong>${count.toLocaleString('ko-KR')}</strong>곳`);
  el.innerHTML = `<span class="totals-label">김해시 전체 발생원</span> ${parts.join(' · ')}`;
}

// 지도를 처음 한 번 만든다(타일 + 김해 영역으로 맞춤).
function initGimhaeMap() {
  if (!window.L || gimhaeMap) return;
  const coords = GimhaeMosquitoModel.COORDS;
  gimhaeMap = L.map('gimhaeMap', { scrollWheelZoom: true }).setView([35.23, 128.87], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap 기여자',
  }).addTo(gimhaeMap);
  const lats = [];
  const lngs = [];
  Object.values(coords).forEach(([la, lo]) => { lats.push(la); lngs.push(lo); });
  gimhaeMap.fitBounds([[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]], { padding: [28, 28] });
}

// 17개 구역의 발생원 위험을 원형 마커로 그린다. 선택 구역은 강조하고, 누르면 이동한다.
function renderGimhaeMap(activeDistrict) {
  if (!gimhaeMap) return;
  Object.values(gimhaeMarkers).forEach((m) => m.remove());
  gimhaeMarkers = {};
  // 밀도위험(발생원+인구, 날씨 무관) 기준 순위 — 지도 원 색·크기·순위에 사용
  const densRanked = GimhaeMosquitoModel.listDistricts()
    .map((d) => [d, GimhaeMosquitoModel.mosquitoIndex(d, { month: 7 }).source_risk.density_risk])
    .sort((a, b) => b[1] - a[1]);
  const densRank = {};
  densRanked.forEach(([d], i) => { densRank[d] = i + 1; });

  Object.entries(GimhaeMosquitoModel.COORDS).forEach(([district, point]) => {
    const r = GimhaeMosquitoModel.mosquitoIndex(district, buildModelOptions(district));
    const risk = r.source_risk.density_risk;      // 0~1
    const riskPct = Math.round(risk * 100);
    const today = Math.round(r.mosquito_index);
    const isActive = district === activeDistrict;
    const marker = L.circleMarker(point, {
      radius: 9 + risk * 22,
      color: isActive ? '#0f6b57' : '#ffffff',
      weight: isActive ? 4 : 1.5,
      fillColor: sourceRiskColor(riskPct),
      fillOpacity: isActive ? 0.85 : 0.6,
    }).addTo(gimhaeMap).bindPopup(
      `<strong>${district}</strong><br>밀도위험 ${risk.toFixed(2)} (발생원·인구, 시내 ${densRank[district]}/17위)`
      + `<br>오늘 모기지수 ${today}점 · ${r.grade}`,
    ).bindTooltip(district, {
      permanent: true,
      direction: 'top',
      offset: [0, -4],
      className: `district-label${isActive ? ' district-label-active' : ''}`,
    });
    marker.on('click', () => {
      districtSelect.value = district;
      renderDistrict(district);
      document.getElementById('top').scrollIntoView({ behavior: 'smooth' });
    });
    gimhaeMarkers[district] = marker;
  });
  gimhaeMap.invalidateSize();
}

// 도시공원 245곳을 지도에 '네모' 마커로 그린다(토글). 기본은 숨김 — 난잡함 방지.
function buildParksLayer() {
  if (!window.L || !gimhaeMap || parksLayer) return;
  parksLayer = L.layerGroup();
  gimhaeParks.forEach((p) => {
    const risk = parkRisk(p);
    const areaText = p.area_m2 ? ` · ${Math.round(p.area_m2).toLocaleString('ko-KR')}㎡` : '';
    const icon = L.divIcon({
      className: 'shape-marker',
      html: `<span class="pk-square" style="background:${sourceRiskColor(Math.round(risk * 100))}"></span>`,
      iconSize: [10, 10], iconAnchor: [5, 5],
    });
    L.marker([p.lat, p.lon], { icon }).bindPopup(
      `<strong>${p.name}</strong> <span style="color:#64748b">${p.type}</span>`
      + `<br>${p.district} · 추정 위험 ${parkGradeLabel(risk)}`
      + `${areaText}`,
    ).bindTooltip(p.name, { direction: 'top', offset: [0, -6] })
      .addTo(parksLayer);
  });
}

// 공원 표시 토글 버튼 동작.
function setupParksToggle() {
  const btn = document.getElementById('parksToggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (!parksLayer) buildParksLayer();
    if (!parksLayer) return;
    const shown = gimhaeMap.hasLayer(parksLayer);
    if (shown) {
      gimhaeMap.removeLayer(parksLayer);
      btn.setAttribute('aria-pressed', 'false');
      btn.textContent = '🏞️ 도시공원 245곳 표시';
    } else {
      parksLayer.addTo(gimhaeMap);
      btn.setAttribute('aria-pressed', 'true');
      btn.textContent = '🏞️ 도시공원 숨기기';
    }
  });
}

// 유충 실측 지점(2년 채집)을 지도에 '세모' 마커로. 유충이 많이 나온 곳일수록 붉게.
function buildLarvaLayer() {
  if (!window.L || !gimhaeMap || larvaLayer || !larvaPoints.length) return;
  larvaLayer = L.layerGroup();
  larvaPoints.forEach((p) => {
    const perTry = p.tries ? p.larva / p.tries : 0;      // 채집당 유충 수
    // 색: 유충이 많이/자주 나온 지점일수록 붉게(실측 강도)
    const c = perTry >= 20 ? '#b91c1c' : perTry >= 8 ? '#ef4444' : perTry >= 2 ? '#f59e0b' : '#86efac';
    const icon = L.divIcon({
      className: 'shape-marker',
      html: `<span class="lv-tri" style="border-bottom-color:${c}"></span>`,
      iconSize: [12, 10], iconAnchor: [6, 8],
    });
    L.marker([p.lat, p.lon], { icon }).bindPopup(
      `<strong>유충 실측 지점</strong> · ${p.district}`
      + `<br>채집당 평균 ${perTry.toFixed(1)}마리 · 채집 ${p.tries}회 중 ${p.pos}회 검출`,
    ).addTo(larvaLayer);
  });
}

// 공통 토글 헬퍼(공원/유충 레이어에 재사용).
function bindLayerToggle(btnId, getLayer, build, onText, offText) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.addEventListener('click', () => {
    build();
    const layer = getLayer();
    if (!layer) return;
    if (gimhaeMap.hasLayer(layer)) {
      gimhaeMap.removeLayer(layer);
      btn.setAttribute('aria-pressed', 'false');
      btn.textContent = offText;
    } else {
      layer.addTo(gimhaeMap);
      btn.setAttribute('aria-pressed', 'true');
      btn.textContent = onText;
    }
  });
}

function setupLarvaToggle() {
  bindLayerToggle('larvaToggle', () => larvaLayer, buildLarvaLayer,
    '🔬 유충 실측 지점 숨기기', '🔬 유충 실측 지점 표시');
}

// === 시간 검증: 모델 예측 활동 ↔ 월별 실측 유충 (한 번만 그림) ===
let larvaChart = null;
function renderLarvaChart() {
  const canvas = document.getElementById('larvaChart');
  if (!canvas || !window.Chart || !larvaMonthly.length) return;
  const labels = larvaMonthly.map((m) => `${m.month}월`);
  const pred = larvaMonthly.map((m) => m.pred);                 // 0~1
  const maxL = Math.max(...larvaMonthly.map((m) => m.larva_per)) || 1;
  const actual = larvaMonthly.map((m) => Math.round((m.larva_per / maxL) * 1000) / 1000);
  if (larvaChart) larvaChart.destroy();
  larvaChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: '모델 예측(활동곡선)', data: pred, borderColor: '#0f6b57',
          backgroundColor: 'rgba(15,107,87,0.08)', borderWidth: 2.5, tension: 0.35, fill: true, pointRadius: 2 },
        { label: '실측 유충(정규화)', data: actual, borderColor: '#d9822d',
          borderWidth: 2.5, borderDash: [5, 4], tension: 0.35, fill: false, pointRadius: 2 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: '#56706b' }, grid: { color: 'rgba(22,48,45,0.06)' } },
        y: { min: 0, max: 1, title: { display: true, text: '상대 강도 (0~1)', color: '#56706b' },
          ticks: { color: '#56706b' }, grid: { color: 'rgba(22,48,45,0.08)' } },
      },
      plugins: {
        legend: { labels: { color: '#28413c', usePointStyle: true, boxWidth: 8 } },
        tooltip: { callbacks: { label: (ctx) => {
          const m = larvaMonthly[ctx.dataIndex];
          return ctx.datasetIndex === 0
            ? `모델 예측 ${m.pred} (평균 ${m.temp}℃)`
            : `실측 유충 ${m.larva_per}마리/채집`;
        } } },
      },
    },
  });
}

// === 검증 산점도: 예측 지역위험 ↔ 실제 방역민원 (한 번만 그림) ===
let verifyChart = null;
function renderVerifyChart() {
  const canvas = document.getElementById('verifyChart');
  if (!canvas || !window.Chart) return;
  const points = [];
  GimhaeMosquitoModel.listDistricts().forEach((d) => {
    if (GimhaeMosquitoModel.DISTRICTS[d].data_gap) return;   // 민원 미제공 구역은 검증 제외
    const r = GimhaeMosquitoModel.mosquitoIndex(d, { month: 7 });
    const area = r.area.area_km2;
    // v4 지표: 밀도위험(0~1) ↔ 실제 민원밀도(건/㎢), 스피어만 +0.951
    points.push({ x: r.source_risk.density_risk, y: Math.round((r.complaints_2025 / area) * 10) / 10, district: d });
  });

  // 추세선(단순 선형회귀) — 상관이 한눈에 보이도록 점 위에 겹쳐 그린다.
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let cov = 0;
  let varx = 0;
  points.forEach((p) => { cov += (p.x - mx) * (p.y - my); varx += (p.x - mx) ** 2; });
  const slope = varx ? cov / varx : 0;
  const intercept = my - slope * mx;
  const xmin = Math.min(...points.map((p) => p.x));
  const xmax = Math.max(...points.map((p) => p.x));
  const trend = [{ x: xmin, y: slope * xmin + intercept }, { x: xmax, y: slope * xmax + intercept }];

  if (verifyChart) verifyChart.destroy();
  verifyChart = new Chart(canvas, {
    type: 'scatter',
    data: {
      datasets: [
        {
          type: 'line', label: '추세', data: trend,
          borderColor: 'rgba(217, 130, 45, 0.9)', borderWidth: 2, borderDash: [6, 4],
          pointRadius: 0, fill: false, order: 2,
        },
        {
          label: '구역', data: points,
          backgroundColor: points.map((p) => (p.district === '회현동' ? '#ef4444' : 'rgba(15, 107, 87, 0.75)')),
          pointRadius: points.map((p) => (p.district === '회현동' ? 8 : 6)),
          pointHoverRadius: 9, order: 1,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { title: { display: true, text: '밀도위험 (발생원밀도+인구밀도, 0~1)', color: '#56706b' },
          min: 0, ticks: { color: '#56706b' }, grid: { color: 'rgba(22, 48, 45, 0.08)' } },
        y: { title: { display: true, text: '실제 방역민원 밀도 (건/㎢, 2025)', color: '#56706b' },
          min: 0, ticks: { color: '#56706b' }, grid: { color: 'rgba(22, 48, 45, 0.08)' } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => (ctx.raw.district
          ? `${ctx.raw.district} · 밀도위험 ${ctx.raw.x} · 민원밀도 ${ctx.raw.y}건/㎢`
          : `추세선`) } },
      },
    },
  });
}

// === 선택 구역의 24시간 예보 ===
const districtForecastCache = {};   // 구역별 시간별 날씨 응답 캐시
let gimhaeForecastChart = null;

// 선택한 구역의 '일별' 예보 날씨를 받아온다(구역당 1회, 캐시). v4는 일 단위 모델이라 7일 예보.
async function loadDistrictForecast(district) {
  if (district in districtForecastCache) return districtForecastCache[district];
  const coord = DISTRICT_COORDS[district];
  if (!coord) { districtForecastCache[district] = null; return null; }
  const params = new URLSearchParams({
    latitude: coord[0], longitude: coord[1],
    daily: 'temperature_2m_mean,precipitation_sum,wind_speed_10m_mean',
    past_days: '7', forecast_days: '7', timezone: 'Asia/Seoul',
    temperature_unit: 'celsius', wind_speed_unit: 'ms', precipitation_unit: 'mm',
  });
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
    if (!res.ok) throw new Error(`예보 요청 실패: ${res.status}`);
    const data = await res.json();
    districtForecastCache[district] = data;
    return data;
  } catch (error) {
    console.warn('구역 예보를 불러오지 못했습니다.', error);
    districtForecastCache[district] = null;
    return null;
  }
}

// 일별 날씨로 향후 7일 모기지수 시리즈를 만든다(유효기온=최근 7일 평균, 7일 누적강수).
function buildDistrictSeries(district, data) {
  const daily = (data && data.daily) || {};
  const dates = daily.time || [];
  if (!dates.length) return [];
  const temps = daily.temperature_2m_mean || [];
  const precs = daily.precipitation_sum || [];
  const winds = daily.wind_speed_10m_mean || [];
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  let ti = dates.indexOf(todayKey);
  if (ti === -1) ti = Math.min(7, Math.max(0, dates.length - 7));
  const series = [];
  const end = Math.min(ti + 7, dates.length);
  for (let i = ti; i < end; i += 1) {
    const d = new Date(dates[i]);
    const ta7arr = temps.slice(Math.max(0, i - 6), i + 1).map(Number).filter((x) => !Number.isNaN(x));
    const ta7 = ta7arr.length ? ta7arr.reduce((a, b) => a + b, 0) / ta7arr.length : Number(temps[i]);
    const rain7 = precs.slice(Math.max(0, i - 6), i + 1).map(Number).filter((x) => !Number.isNaN(x)).reduce((a, b) => a + b, 0);
    const opts = { month: d.getMonth() + 1, weather_observed: true,
      temp_c: Number(temps[i]), ta_7d_avg: Math.round(ta7 * 10) / 10, rain_7d_mm: Math.round(rain7 * 10) / 10 };
    const w = Number(winds[i]);
    if (!Number.isNaN(w)) opts.wind_ms = w;
    const r = GimhaeMosquitoModel.mosquitoIndex(district, opts);
    series.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, index: Math.round(r.mosquito_index), color: r.color });
  }
  return series;
}

// 실시간 실패 시: 이번 달 평년값으로 7일(평탄) 대체 시리즈.
function buildFallbackSeries(district) {
  const series = [];
  const now = new Date();
  for (let k = 0; k < 7; k += 1) {
    const d = new Date(now.getTime() + k * 86400000);
    const r = GimhaeMosquitoModel.mosquitoIndex(district, { month: d.getMonth() + 1 });
    series.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, index: Math.round(r.mosquito_index), color: r.color });
  }
  return series;
}

// 선택한 구역의 24시간 예보 차트를 그린다.
async function renderGimhaeForecast(district) {
  const canvas = document.getElementById('gimhaeForecastChart');
  const note = document.getElementById('gimhaeForecastNote');
  const peakEl = document.getElementById('gimhaeForecastPeak');
  if (!canvas || !window.Chart) return;

  const data = await loadDistrictForecast(district);
  // 사용자가 그새 다른 구역을 눌렀으면 이 렌더는 버린다(경합 방지).
  if (districtSelect.value !== district) return;

  let series = data ? buildDistrictSeries(district, data) : [];
  const live = series.length > 0;
  if (!series.length) series = buildFallbackSeries(district);

  if (peakEl && series.length) {
    const peak = series.reduce((mx, p) => (p.index > mx.index ? p : mx), series[0]);
    const safe = series.reduce((mn, p) => (p.index < mn.index ? p : mn), series[0]);
    peakEl.innerHTML = `가장 위험 <strong>${peak.label} ${peak.index}점</strong> · 가장 안전 ${safe.label} ${safe.index}점`;
  }
  if (note) {
    note.textContent = live
      ? `${district}의 일별 실시간 날씨(유효기온·7일 누적강수·풍속)로 계산한 향후 7일 예보입니다.`
      : `실시간 날씨를 불러오지 못해, ${district}의 이번 달 평년값 기준 추정값입니다.`;
  }

  const labels = series.map((p) => p.label);
  const values = series.map((p) => p.index);
  const colors = series.map((p) => p.color);
  if (gimhaeForecastChart) gimhaeForecastChart.destroy();
  gimhaeForecastChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '모기지수', data: values,
        borderColor: '#0f6b57', borderWidth: 2, fill: true,
        backgroundColor: 'rgba(15, 107, 87, 0.12)', tension: 0.35,
        pointRadius: 3, pointHoverRadius: 6,
        pointBackgroundColor: colors, pointBorderColor: '#ffffff', pointBorderWidth: 1.5,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        y: { min: 0, max: 100, ticks: { stepSize: 20, color: '#56706b' },
          grid: { color: 'rgba(22, 48, 45, 0.08)' },
          title: { display: true, text: '모기지수(점)', color: '#56706b' } },
        x: { ticks: { color: '#56706b', maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
          grid: { display: false } },
      },
      plugins: { legend: { display: false } },
    },
  });
}

// 0~1 적합도 점수를 퍼센트 막대로 그리는 작은 도우미
function scoreBar(score) {
  const pct = Math.round(score * 100);
  return `<span class="score-bar"><span class="score-bar-fill" style="width:${pct}%"></span></span>`;
}

// 상단 게이지와 요약을 갱신한다.
function renderGauge(result) {
  const deg = result.mosquito_index * 3.6;
  gimhaeGauge.style.background = `conic-gradient(${result.color} ${deg}deg, rgba(22, 48, 45, 0.1) ${deg}deg)`;
  indexValue.textContent = result.mosquito_index;
  gradeText.textContent = `${result.level}단계 ${result.grade}`;
  gradeText.style.background = result.color;
  summaryText.textContent = result.summary;

  // (D) 신뢰도 등급 + 예상 범위(신뢰구간)를 함께 보여 단일 점수의 '거짓 정밀도'를 막는다.
  const conf = result.confidence;
  const range = result.index_range;
  confidenceBadge.textContent = `신뢰도 ${conf.level}`;
  // 신뢰도 등급별로 배지 색을 달리한다(높음=초록, 보통=주황, 낮음=빨강).
  const confColor = conf.level === '높음' ? '#22c55e' : (conf.level === '보통' ? '#f59e0b' : '#ef4444');
  confidenceBadge.style.background = confColor;
  rangeText.textContent = `예상 범위 ${range.low}~${range.high}점`;
  confidenceReason.textContent =
    `날씨 ${conf.reasons.weather} · 민원자료 ${conf.reasons.complaint_data} · 인구 ${conf.reasons.population} (불확실성 ±${conf.uncertainty_pct}%)`;
}

// 기상 분석 카드(유효기온·습도·강수·풍속)를 그린다. v4는 시간대 항이 없다(7일 유효기온 기반).
function renderWeatherComponents(result) {
  const components = result.weather.components;
  const input = result.weather.input;

  const cards = [
    { name: '유효기온', data: components.temperature, input: `${components.temperature.effective_temp_c}℃` },
    { name: '습도', data: components.humidity, input: `${input.humidity}%` },
    { name: '최근 7일 강수', data: components.rainfall, input: `${input.rain_7d_mm}mm` },
    { name: '풍속', data: components.wind, input: input.wind_ms != null ? `${input.wind_ms}m/s` : '평년값' },
  ];

  weatherComponents.innerHTML = cards.map((card) => {
    // 점수가 없는 경우(평년값 모드의 시간대 등)는 막대 대신 안내만 표시한다.
    const hasScore = card.data.score != null;
    const valueText = hasScore ? `적합도 ${card.data.score.toFixed(2)}` : '적용 안 됨';
    const bar = hasScore ? scoreBar(card.data.score) : '';
    return `
    <article class="metric-card">
      <p class="metric-name">${card.name} <span class="metric-input">${card.input}</span></p>
      <p class="metric-value">${valueText}</p>
      ${bar}
      <p class="metric-note">${card.data.status}</p>
    </article>
  `;
  }).join('');

  weatherComment.textContent = result.weather.comment;
}

// 이 구역 핵심 진단: 발생원 원인 → 권장 방역 조치 (지자체가 가장 필요로 하는 부분).
function renderDiagnosis(result) {
  if (!diagnosisBody) return;
  const sr = result.source_risk;
  const ranking = result.ranking;

  // 주원인: 실제 시설 '개수'가 많은 발생원 상위 3개 + 유충 검출률
  // (보건소가 강조하는 정화조 등 '많은 시설'이 드러나도록 절대 개수 기준으로 보여준다)
  const rawSources = (GimhaeMosquitoModel.DISTRICTS[result.district] || {}).sources || {};
  const SRC_KOR = GimhaeMosquitoModel.SRC_KOR;
  const topByCount = Object.entries(rawSources)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key, count]) => `${SRC_KOR[key]} ${count.toLocaleString('ko-KR')}곳`)
    .join(' · ');
  const cause = topByCount ? topByCount : '등록된 발생원이 없습니다.';
  // 유충 검출률은 v4에서 위험지수와 별개(시설 관리상태 지표)로만 표기한다.
  const larva = result.larva_survey || {};
  const larvaLine = (larva.surveyed >= 10 && larva.detection_rate != null)
    ? `유충 검출률 ${Math.round(larva.detection_rate * 100)}%(${larva.surveyed}건) — 시설 관리상태 지표(위험 계산 미포함)`
    : '유충 조사 미실시';

  // 권장 방역 조치: 모델의 방제당국 행동요령 중 핵심 한 줄
  const action = (result.advice.authority && result.advice.authority[0])
    || '정기 방역 주기를 유지하세요.';

  diagnosisBody.innerHTML = `
    <div class="diag-row">
      <span class="diag-tag diag-tag-cause">원인</span>
      <p class="diag-value">${cause}</p>
    </div>
    <div class="diag-row">
      <span class="diag-tag diag-tag-action">권장 조치</span>
      <p class="diag-value">${action}</p>
    </div>
    <div class="diag-row">
      <span class="diag-tag diag-tag-larva">유충</span>
      <p class="diag-value">${larvaLine}</p>
    </div>
    <p class="diag-foot">밀도위험 순위 <strong>${ranking.rank}/${ranking.total_districts}위</strong>
      · 발생원 밀도 ${Math.round(sr.breed_density_per_km2)}개/㎢ · 밀도위험 ${sr.density_risk}</p>
  `;
}

// 발생원 분석(시설 유형별 위험 기여율)을 그린다.
function renderSources(result) {
  const sources = result.source_risk.top_sources;
  areaTypeText.textContent = `${result.source_risk.area_type} · 발생원 밀도 ${Math.round(result.source_risk.breed_density_per_km2)}개/㎢`;

  // (v4) 밀도위험 = 0.5×발생원밀도 + 0.5×인구밀도. 면적 확보로 '개수'→'밀도' 전환.
  if (geoBreakdown) {
    const sr = result.source_risk;
    const area = result.area;
    geoBreakdown.innerHTML = `
      <article class="geo-item">
        <p class="geo-label">발생원 밀도</p>
        <p class="geo-value">${Math.round(sr.breed_density_per_km2)}<span class="geo-unit">개/㎢</span></p>
        <p class="geo-note">정규화 ${sr.breed_density_norm.toFixed(2)}</p>
      </article>
      <span class="geo-op" aria-hidden="true">+</span>
      <article class="geo-item">
        <p class="geo-label">인구 밀도</p>
        <p class="geo-value">${Math.round(area.pop_density).toLocaleString('ko-KR')}<span class="geo-unit">명/㎢</span></p>
        <p class="geo-note">정규화 ${sr.pop_density_norm.toFixed(2)}${area.estimated ? ' (추정)' : ''}</p>
      </article>
      <span class="geo-op" aria-hidden="true">=</span>
      <article class="geo-item geo-result">
        <p class="geo-label">밀도위험</p>
        <p class="geo-value">${sr.density_risk.toFixed(2)}</p>
        <p class="geo-note">0.5×발생원 + 0.5×인구</p>
      </article>`;
  }

  let topCountName = null;
  if (!sources.length) {
    sourceList.innerHTML = '<li class="source-empty">등록된 발생원이 없습니다.</li>';
  } else {
    // A1: 핵심 진단(개수순)과 통일 — 시설 '개수' 많은 순으로 정렬하고 막대도 개수 기준.
    // %는 '시내 위험 기여도'로 보조 표기(순서·막대 혼란 방지).
    const byCount = sources.slice().sort((a, b) => b.count - a.count);
    topCountName = byCount[0].source;
    const maxCount = Math.max(...byCount.map((s) => s.count), 1);
    sourceList.innerHTML = byCount.map((item) => `
      <li class="source-item">
        <span class="source-name">${item.source}</span>
        <span class="source-bar"><span class="source-bar-fill" style="width:${Math.round((item.count / maxCount) * 100)}%"></span></span>
        <span class="source-count">${item.count.toLocaleString('ko-KR')}곳</span>
        <span class="source-pct">${item.risk_contribution_pct}%</span>
      </li>
    `).join('');
  }

  // (v4) 유충 검출률 = 위험 계산에 미포함. '시설 관리상태' 지표로만 표시.
  const larva = result.larva_survey || {};
  if (larva.surveyed >= 10 && larva.detection_rate != null) {
    const ratePct = Math.round(larva.detection_rate * 100);
    larvaText.textContent =
      `${larva.surveyed}건 조사 중 ${larva.positive}건 양성 (검출률 ${ratePct}%) · 시설 관리상태 지표(위험 계산 미포함)`;
    larvaFill.style.width = `${ratePct}%`;
    larvaFill.parentElement.style.visibility = 'visible';
  } else {
    larvaText.textContent = '유충 조사 미실시.';
    larvaFill.style.width = '0%';
    larvaFill.parentElement.style.visibility = 'hidden';
  }

  // 코멘트(밀도 기준).
  const area = result.area;
  if (topCountName) {
    sourceComment.textContent = `시설 수가 가장 많은 발생원은 ${topCountName}이며, 이 구역은 `
      + `${result.source_risk.area_type}입니다. 면적 ${area.area_km2}㎢에 발생원 `
      + `${result.source_risk.total_facilities.toLocaleString('ko-KR')}개소(밀도 ${Math.round(result.source_risk.breed_density_per_km2)}개/㎢).`;
  } else {
    sourceComment.textContent = result.source_risk.comment;
  }

  // (item 2) 구역 환경 — 면적·하천 수면비율·공원 면적(하천·공원 데이터 일부 반영)
  const envEl = document.getElementById('districtEnv');
  if (envEl && area) {
    envEl.innerHTML = `<span class="env-item"><b>면적</b> ${area.area_km2}㎢</span>`
      + `<span class="env-item"><b>인구밀도</b> ${Math.round(area.pop_density).toLocaleString('ko-KR')}명/㎢</span>`
      + `<span class="env-item"><b>하천 수면비율</b> ${(area.water_pct * 100).toFixed(1)}%</span>`
      + `<span class="env-item"><b>공원 면적</b> ${Math.round(area.park_m2_per_km2).toLocaleString('ko-KR')}㎡/㎢</span>`;
  }
}

// 시내 순위 요약 카드를 그린다.
function renderRankSummary(result) {
  const ranking = result.ranking;
  const vs = ranking.vs_city_avg;
  const vsText = `${vs >= 0 ? '+' : ''}${vs}점`;
  const sr = result.source_risk;
  const cards = [
    { name: '모기지수 순위', value: `${ranking.rank} / ${ranking.total_districts}위`, note: `시민용 · 밀도위험 기준 (1위 ${ranking.highest_district.name})` },
    { name: '방제 우선순위', value: `${sr.control_priority_rank} / ${ranking.total_districts}위`, note: `당국용 · 총부담(밀도위험×인구) 기준` },
    { name: '시평균 대비', value: vsText, note: `김해시 평균 ${ranking.city_avg_index}점` },
    { name: '2025년 방역민원', value: `${result.complaints_2025}건`, note: '실제 접수(검증 전용, 계산 미포함)' },
  ];

  rankSummary.innerHTML = cards.map((card) => `
    <article class="stat-tile">
      <p class="stat-name">${card.name}</p>
      <p class="stat-value">${card.value}</p>
      <p class="stat-note">${card.note}</p>
    </article>
  `).join('');
}

// 발생원 유형 → 시민이 조심할 '장소' 문구 매핑.
const SOURCE_PLACE = {
  septic_clean: '정화조·하수구 주변',
  septic_private: '정화조·하수구 주변',
  wwtp_private: '오수처리시설 주변',
  wwtp_public: '하수처리 구간 주변',
  livestock: '축사·가축 분뇨 주변',
  reservoir: '저수지·물웅덩이',
  tire_shop: '폐타이어 야적장',
  waste_tire: '폐타이어 적치장',
  waste_stk: '폐기물 처리장 주변',
  junk_shop: '고물상 야적지',
  water_feature: '분수·바닥분수 등 수경시설',
  toilet: '공중화장실 주변',
  park: '공원 인공연못·배수로',
  bathhouse: '목욕장 주변',
  waterpump: '배수펌프장·유수지',
  bee_farm: '',
};

// 물가·수풀이 많아 모기가 붙기 쉬운 유형 / 작고 관리돼 상대적으로 적은 유형
const PARK_RISKY_TYPES = ['수변공원', '근린공원', '체육공원', '역사공원'];
const PARK_MANAGED_TYPES = ['어린이공원', '소공원'];

// 지번주소에서 동/리 이름을 뽑아 '소공원' 같은 흔한 이름을 구분해 준다.
function parkLocHint(addr) {
  if (!addr) return '';
  const tokens = String(addr).split(/\s+/);
  let hint = '';
  tokens.forEach((t) => { if (/(동|리)$/.test(t) && t !== '김해시') hint = t; });
  return hint;
}
// 이름이 흔하면(소공원, 공원3-2 등) 동/리를 붙여 구분한다.
function parkLabel(p) {
  const generic = /^(소공원|어린이공원|근린공원|공원)$/.test(p.name) || /^공원[\d\s-]/.test(p.name);
  const hint = parkLocHint(p.addr);
  return generic && hint ? `${p.name}<span class="pk-dist">(${hint})</span>` : p.name;
}
// 공원명 + 유형 태그. 단, 이름이 곧 유형이면(예: '소공원') 중복 태그는 생략.
function parkPill(p) {
  const typeTag = p.name === p.type ? '' : ` <span class="pk-type">${p.type}</span>`;
  return `<strong>${parkLabel(p)}</strong>${typeTag}`;
}

// 모기박사 피드백: "A 공원은 위험하니 B 공원으로" — 실제 공원 이름으로 추천한다.
function renderSafeAreas(district) {
  const el = document.getElementById('safeAreas');
  if (!el) return;
  // 데이터 로딩 전이면 구역 단위 안내로 대체(깨지지 않게)
  if (!gimhaeParks.length) {
    const ranked0 = GimhaeMosquitoModel.listDistricts().map((d) => ({
      d, risk: GimhaeMosquitoModel.mosquitoIndex(d, { month: 7 }).source_risk.density_risk,
    })).sort((a, b) => a.risk - b.risk);
    el.innerHTML = `🏞️ 산책·야외활동은 위험 낮은 구역이 유리합니다: <strong>${ranked0.slice(0, 3).map((x) => x.d).join(' · ')}</strong>`;
    return;
  }

  const parks = gimhaeParks.filter((p) => p.district === district && p.name);
  const risky = parks.filter((p) => PARK_RISKY_TYPES.includes(p.type))
    .sort((a, b) => (b.area_m2 || 0) - (a.area_m2 || 0));   // 큰 물가·근린 먼저
  const managed = parks.filter((p) => PARK_MANAGED_TYPES.includes(p.type))
    .sort((a, b) => (a.area_m2 || 0) - (b.area_m2 || 0));   // 작은 관리형 먼저

  let html = '';
  // (1) 구역 안에서 유형으로 A→B 추천 (물가·수풀 vs 관리형)
  if (risky.length && managed.length) {
    html += `<div class="safe-line">🏞️ <b>${district}</b>에서 산책이라면 물가·수풀이 많은 `
      + `${parkPill(risky[0])} <span class="pk-warn">주의</span>보다, `
      + `관리형 ${parkPill(managed[0])} <span class="pk-arrow">추천</span></div>`;
  } else if (parks.length) {
    html += `<div class="safe-line">🏞️ <b>${district}</b>의 공원 ${parks.length}곳 — 해질녘엔 물가·수풀에 가까운 곳을 피하세요.</div>`;
  }

  // (2) 현재 구역이 위험 상위면, 가까운 '더 안전한 구역'의 공원을 제안
  const curRisk = (GimhaeMosquitoModel.DISTRICTS[district] || {}).density_risk || 0;
  const saferDistrict = GimhaeMosquitoModel.listDistricts()
    .map((d) => ({ d, risk: (GimhaeMosquitoModel.DISTRICTS[d] || {}).density_risk || 0 }))
    .filter((x) => x.risk < curRisk - 0.1 && gimhaeParks.some((p) => p.district === x.d && p.name))
    .sort((a, b) => a.risk - b.risk)[0];
  if (saferDistrict) {
    const pick = gimhaeParks
      .filter((p) => p.district === saferDistrict.d && p.name && !/^공원[\d\s-]/.test(p.name))
      .sort((a, b) => (b.area_m2 || 0) - (a.area_m2 || 0))[0];
    if (pick) {
      html += `<div class="safe-line">🟢 더 안전하게는 위험이 낮은 <b>${saferDistrict.d}</b>의 <strong>${parkLabel(pick)}</strong> 같은 공원을 권합니다.</div>`;
    }
  }

  html += `<div class="safe-line safe-sub">※ 물가의 <b>수변공원</b>·넓은 <b>근린공원</b>은 해질녘 모기가 많고, 작은 <b>어린이·소공원</b>은 상대적으로 적습니다.</div>`;
  el.innerHTML = html;
}

// 이 구역의 주요 발생원(개수 상위)에 맞춰 '조심할 장소' 칩을 구역별로 다르게 만든다.
function renderPlaceChips(district) {
  const el = document.getElementById('placeChips');
  if (!el) return;
  const raw = (GimhaeMosquitoModel.DISTRICTS[district] || {}).sources || {};
  const topPlaces = Object.entries(raw)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key]) => SOURCE_PLACE[key])
    .filter(Boolean);
  // 공원·물가·하천변은 어디나 해당하므로 항상 앞에 둔다. 중복은 제거.
  const chips = Array.from(new Set(['공원·물가·하천변', ...topPlaces]));
  el.innerHTML = chips.map((c) => `<span class="place-chip">${c}</span>`).join('');
}

// 발생원 유형(v4 16종) → (서식 매개모기·감염병) + 구체적 방제 지침. 논문(이동규, 2017) 기반.
const SOURCE_CONTROL = {
  septic_clean: { sp: '빨간집모기(웨스트나일 매개)', act: '정화조·오수받이 유충 서식면에 IGR(곤충성장조절제)·라바사이드 정기 투입, 환기구 방충망·봉인 상태 점검' },
  septic_private: { sp: '빨간집모기(웨스트나일 매개)', act: '개인하수처리시설 정체수에 라바사이드·IGR 투입, 배관·집수조 봉인 점검' },
  wwtp_private: { sp: '빨간집모기', act: '개인오수처리시설 주변 정체수 제거·유충구제' },
  wwtp_public: { sp: '빨간집모기', act: '공공하수처리 방류·집수 구간 정체수 관리' },
  livestock: { sp: '작은빨간집모기(일본뇌염)·얼룩날개모기(말라리아) 매개', act: '축사 주변 물웅덩이·분뇨처리조·수로 정비, 성충 대상 잔류분무·공간분무 병행' },
  reservoir: { sp: '얼룩날개모기(말라리아 매개)', act: '저수지 가장자리 정체수·수초대에 라바사이드, 수위 관리로 산란처 축소' },
  tire_shop: { sp: '흰줄숲모기(뎅기·지카 매개)', act: '폐타이어 실내 보관·구멍 내기로 물 고임 차단, 소량 정체수 라바사이드 처리' },
  waste_tire: { sp: '흰줄숲모기(뎅기·지카 매개)', act: '적치 폐타이어 빗물 고임 차단(덮개·구멍내기), 정체수 유충구제' },
  waste_stk: { sp: '흰줄숲모기 등', act: '폐기물 야적 용기·고인물 제거(발생원 정비) 및 소량수 유충구제' },
  junk_shop: { sp: '흰줄숲모기 등', act: '고물상 야적 폐기물의 빗물 고임 제거, 정체수 유충구제' },
  water_feature: { sp: '빨간집모기·흰줄숲모기', act: '분수·바닥분수 순환 가동·주기적 배수, 정체수 발생 구간 제거' },
  toilet: { sp: '빨간집모기', act: '공중화장실 정화조 유충구제, 주변 집수정·배수구 정체수 제거' },
  park: { sp: '', act: '공원 인공연못·배수로·화장실 정체수 유충구제, 시민 노출 구간 우선 방제' },
  bathhouse: { sp: '', act: '목욕장 배수·집수조 정체수 점검' },
  waterpump: { sp: '', act: '배수펌프장 집수정·유수지 정체수 라바사이드' },
  bee_farm: { sp: '', act: '(모기 발생원 관련성 낮음)' },
};

// 그 구역의 발생원·유충·순위를 바탕으로 '전문 방제 지침'을 생성한다(일반론 대신 구역 맞춤).
function buildAuthorityAdvice(result) {
  const rank = result.ranking;
  const larva = result.source_risk.larva;
  const rawSources = (GimhaeMosquitoModel.DISTRICTS[result.district] || {}).sources || {};
  const SRC_KOR = GimhaeMosquitoModel.SRC_KOR;
  const topSrc = Object.entries(rawSources)
    .filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).slice(0, 2);
  const out = [];

  // 1) 우선순위·검출률 기반 판단
  if (rank.rank <= Math.max(3, Math.floor(rank.total_districts / 5))) {
    out.push(`방제 우선순위 상위(${rank.rank}/${rank.total_districts}위) 구역 — 발생원 유충구제를 선제 시행하고 취약지 방역 주기를 단축하세요.`);
  }
  if (larva.surveyed > 0 && larva.detection_rate >= 0.4) {
    out.push(`유충 검출률 ${Math.round(larva.detection_rate * 100)}%로 높음 — 성충 방제보다 발생원 유충구제(라바사이드·IGR)를 우선하는 것이 효율적입니다.`);
  }

  // 2) 발생원별 매개종·전문 방제 (구역 실제 발생원에 맞춤)
  topSrc.forEach(([key, count]) => {
    const c = SOURCE_CONTROL[key];
    if (!c) return;
    const sp = c.sp ? ` — ${c.sp} 서식 가능` : '';
    out.push(`${SRC_KOR[key]} ${count.toLocaleString('ko-KR')}곳${sp}: ${c.act}.`);
  });

  // 3) 방제 원칙(IPM) + 모니터링
  out.push('방제 순서: ① 발생원 제거(고인물 정비) → ② 유충구제(라바사이드·IGR) → ③ 성충방제(공간·잔류분무). 유문등·CO₂ 유인 포집기로 개체 밀도를 모니터링해 방제 효과를 확인하세요.');

  // 4) 결측 구역
  if (result.confidence.reasons.data_gap) {
    out.push('현장 유충조사·민원 자료가 없는 구역 — 우선 현장 유충조사로 발생원·검출률을 확보한 뒤 방제 강도를 조정하세요.');
  }
  return out;
}

// 발생원 유형(v4) → 시민이 알아둘 '조심 포인트'(매개종·감염병 포함).
const SOURCE_CITIZEN = {
  septic_clean: '이 구역은 정화조·하수처리시설이 많습니다. 하수구·정화조 환기구 주변(빨간집모기 서식)을 특히 조심하세요.',
  septic_private: '개인하수처리시설이 많은 구역입니다. 정체수·배관 주변(빨간집모기 서식)을 조심하세요.',
  wwtp_private: '오수처리시설 주변 정체수(빨간집모기 서식)를 조심하세요.',
  wwtp_public: '하수처리 구간 주변 정체수를 조심하세요.',
  livestock: '축산농가 주변은 일본뇌염을 옮기는 작은빨간집모기가 많을 수 있습니다. 축사 근처 저녁 활동을 피하고, 일본뇌염 예방접종 대상(어린이 등)은 접종하세요.',
  reservoir: '저수지·물웅덩이 주변(말라리아 매개 얼룩날개모기 서식)에서는 해질녘 활동을 줄이세요.',
  tire_shop: '폐타이어·인공용기의 고인물(뎅기·지카 매개 흰줄숲모기 서식)을 조심하고, 집 주변 빈 용기는 뒤집어 두세요.',
  waste_tire: '적치된 폐타이어의 고인물(뎅기·지카 매개 흰줄숲모기 서식)을 조심하세요.',
  waste_stk: '폐기물 야적지의 고인물 주변을 조심하세요.',
  junk_shop: '고물상 야적 폐기물의 고인 빗물 주변을 조심하세요.',
  water_feature: '분수·바닥분수 등 수경시설 정체수 주변을 조심하세요.',
  toilet: '공중화장실 정화조 주변에 모기가 모일 수 있으니 야간 이용 시 주의하세요.',
  park: '공원 내 인공연못·배수로 정체수 주변을 조심하고, 해질녘 산책 시 기피제를 사용하세요.',
  bathhouse: '목욕장 주변 배수·정체수 구역을 조심하세요.',
  waterpump: '배수펌프장·유수지 주변 정체수 구역을 조심하세요.',
  bee_farm: '',
};

// 시민 행동요령을 구역 발생원·위험등급 기반으로 '항상 알차게' 생성한다.
function buildCitizenAdvice(result) {
  const lv = result.level;
  const rawSources = (GimhaeMosquitoModel.DISTRICTS[result.district] || {}).sources || {};
  const topKey = Object.entries(rawSources)
    .filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1])[0];
  const out = [];

  // 1) 시간대·복장·기피제 (등급별)
  if (lv >= 3) {
    out.push('해질녘(19~22시)·새벽(04~06시)엔 야외활동을 줄이고, 긴팔·긴바지에 DEET(10~20%)·이카리딘 기피제를 사용하세요.');
  } else if (lv === 2) {
    out.push('야간 외출 시 노출 부위에 기피제(이카리딘·시트로넬라 등)를 바르고, 밝은 색 옷을 입으세요.');
  } else {
    out.push('현재 위험은 낮지만, 해질녘·새벽에 물가·풀숲을 지날 때는 가벼운 기피제를 권장합니다.');
  }

  // 2) 이 구역 발생원 기반 조심 포인트(+매개종·감염병)
  if (topKey && SOURCE_CITIZEN[topKey[0]]) {
    out.push(SOURCE_CITIZEN[topKey[0]]);
  }

  // 3) 집 주변 예방(발생원 제거) — 항상 유효
  out.push('집 주변 화분받침·빈 용기·막힌 배수구의 고인물을 주 1회 비우면 모기 번식을 크게 줄일 수 있습니다.');

  // 4) 물림 대처
  out.push('물렸을 때는 긁지 말고 항히스타민·스테로이드 연고를 바르고, 붓기·발열이 심하면 진료를 받으세요.');

  return out;
}

// 시민·방제당국 행동요령과 부가 정보를 그린다.
function renderAdvice(result) {
  // 시민 행동요령: 구역 발생원·매개종 기반으로 항상 알차게 생성(등급만 보던 빈약함 해소).
  citizenAdvice.innerHTML = buildCitizenAdvice(result).map((text) => `<li>${text}</li>`).join('');
  // 방제당국 행동요령: 일반론 대신 구역 발생원·매개종 기반 전문 지침으로 대체.
  authorityAdvice.innerHTML = buildAuthorityAdvice(result).map((text) => `<li>${text}</li>`).join('');
  extraInfoText.textContent = `모기 활동 시간대: ${result.active_hours} · 추천 기피제: ${result.recommended_repellent}`;
}

// 김해시 17개 구역의 오늘 모기지수 순위표를 그린다.
// 구역마다 '자기 동네 날씨'로 계산해 정렬한다.
function renderDistrictRanking(activeDistrict) {
  const results = GimhaeMosquitoModel.listDistricts()
    .map((name) => GimhaeMosquitoModel.mosquitoIndex(name, buildModelOptions(name)))
    .sort((a, b) => b.mosquito_index - a.mosquito_index);

  districtRankList.innerHTML = results.map((item, position) => `
    <li>
      <button type="button" class="district-rank-item${item.district === activeDistrict ? ' is-active' : ''}" data-district="${item.district}">
        <span class="district-rank-num">${position + 1}</span>
        <span class="district-rank-name">${item.district}</span>
        <span class="district-rank-bar"><span class="district-rank-fill" style="width:${item.mosquito_index}%;background:${item.color}"></span></span>
        <span class="district-rank-score">${item.mosquito_index}점</span>
        <span class="district-rank-grade" style="background:${item.color}">${item.grade}</span>
      </button>
    </li>
  `).join('');

  // 항목을 누르면 해당 구역으로 이동한다.
  districtRankList.querySelectorAll('.district-rank-item').forEach((button) => {
    button.addEventListener('click', () => {
      const name = button.dataset.district;
      districtSelect.value = name;
      renderDistrict(name);
      document.getElementById('top').scrollIntoView({ behavior: 'smooth' });
    });
  });
}

// 선택한 구역에 대해 모델을 실행하고 전체 화면을 갱신한다.
function renderDistrict(district) {
  const result = GimhaeMosquitoModel.mosquitoIndex(district, buildModelOptions(district));
  // 이 구역의 날씨가 실시간인지 여부 (구역마다 다를 수 있다)
  const weather = districtWeather[district] || { month: currentMonth, isLive: false };

  districtBadge.textContent = district;
  weatherSourceBadge.textContent = weather.isLive ? '실시간 날씨' : '평년값(샘플)';
  weatherStatus.textContent = weather.isLive
    ? `${district}의 실시간 날씨를 반영해 계산했습니다.`
    : '실시간 날씨를 불러오지 못해 이번 달 평년값으로 계산했습니다.';

  const input = result.weather.input;
  const windText = input.wind_ms != null ? ` · 풍속 ${input.wind_ms}m/s` : '';
  weatherInputText.textContent = `유효기온 ${result.weather.effective_temp_c}℃ · 습도 ${input.humidity}% · 최근 7일 강수 ${input.rain_7d_mm}mm${windText}`;
  updatedText.textContent = weather.isLive && weather.observedAt
    ? `실시간 날씨 갱신: ${new Date(weather.observedAt).toLocaleString('ko-KR')}`
    : `기준: ${weather.month || currentMonth}월 평년값`;

  renderGauge(result);
  renderDiagnosis(result);
  renderGimhaeMap(district);
  renderWeatherComponents(result);
  renderSources(result);
  renderRankSummary(result);
  renderAdvice(result);
  renderPlaceChips(district);
  renderSafeAreas(district);
  renderDistrictRanking(district);
  renderGimhaeForecast(district).catch((error) => console.warn('예보 차트 실패', error));
}

// 구역 선택 드롭다운을 채운다.
function populateDistricts() {
  const districts = GimhaeMosquitoModel.listDistricts();
  districtSelect.innerHTML = districts.map((name) => `<option value="${name}">${name}</option>`).join('');
}

async function init() {
  // 모델 스크립트가 로드되지 않았으면 안내한다.
  if (!window.GimhaeMosquitoModel) {
    weatherStatus.textContent = '모델 스크립트를 불러오지 못했습니다. 페이지를 새로고침해 주세요.';
    return;
  }

  populateDistricts();
  renderSourceTotals();   // 김해시 전체 발생원 총량(정적)
  renderVerifyChart();    // 검증 산점도(정적)
  initGimhaeMap();        // 발생원 지도 생성(마커는 구역 렌더 시 채움)
  setupParksToggle();     // 도시공원 표시 토글
  setupLarvaToggle();     // 유충 실측 지점 표시 토글

  // 부가 데이터 로드(실패해도 나머지는 정상 동작)
  await Promise.all([
    fetch('data/gimhae-parks.json').then((r) => (r.ok ? r.json() : [])).then((d) => { gimhaeParks = d; }).catch(() => {}),
    fetch('data/gimhae-larva-points.json').then((r) => (r.ok ? r.json() : [])).then((d) => { larvaPoints = d; }).catch(() => {}),
    fetch('data/gimhae-larva-monthly.json').then((r) => (r.ok ? r.json() : [])).then((d) => { larvaMonthly = d; }).catch(() => {}),
  ]);
  renderLarvaChart();     // 시간 검증 곡선(정적)

  districtSelect.addEventListener('change', () => {
    renderDistrict(districtSelect.value);
  });

  // 먼저 17개 구역의 실시간 날씨를 한 번에 불러온 뒤, 기본 구역(활천동)을 보여준다.
  districtWeather = await loadAllDistrictWeather();
  const defaultDistrict = districtSelect.value || GimhaeMosquitoModel.listDistricts()[0];
  renderDistrict(defaultDistrict);
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch((error) => {
    console.error('김해 모델 초기화 실패', error);
    weatherStatus.textContent = '초기화 중 문제가 발생했습니다. 페이지를 새로고침해 주세요.';
  });
});
