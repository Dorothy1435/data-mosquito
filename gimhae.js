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
  Object.entries(GimhaeMosquitoModel.COORDS).forEach(([district, point]) => {
    const r = GimhaeMosquitoModel.mosquitoIndex(district, buildModelOptions(district));
    const score = r.source_risk.score;
    const today = Math.round(r.mosquito_index);
    const isActive = district === activeDistrict;
    const marker = L.circleMarker(point, {
      radius: 9 + (score / 100) * 20,
      color: isActive ? '#0f6b57' : '#ffffff',
      weight: isActive ? 4 : 1.5,
      fillColor: sourceRiskColor(score),
      fillOpacity: isActive ? 0.85 : 0.6,
    }).addTo(gimhaeMap).bindPopup(
      `<strong>${district}</strong><br>발생원 위험 ${score}점 (시내 ${r.ranking.rank}/${r.ranking.total_districts}위)`
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
    `날씨 ${conf.reasons.weather} · 유충 표본 ${conf.reasons.larva_sample}건 (불확실성 ±${conf.uncertainty_pct}%)`;
}

// 기상 분석 카드(기온·습도·강수 + 풍속·시간대)를 그린다.
function renderWeatherComponents(result) {
  const components = result.weather.components;
  const input = result.weather.input;

  // 풍속·시간대는 실시간 모드에서만 값이 들어온다(없으면 '평년값'으로 표시).
  const cards = [
    { name: '기온', data: components.temperature, input: `${input.temp_c}℃` },
    { name: '습도', data: components.humidity, input: `${input.humidity}%` },
    { name: '최근 3일 강수', data: components.rainfall, input: `${input.rain_3d_mm}mm` },
    { name: '풍속', data: components.wind, input: input.wind_ms != null ? `${input.wind_ms}m/s` : '평년값' },
    { name: '시간대', data: components.time_of_day, input: input.hour != null ? `${input.hour}시` : '평년값' },
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
  const larva = sr.larva;
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
  const larvaLine = larva.surveyed > 0
    ? `유충 검출률 <strong>${Math.round(larva.detection_rate * 100)}%</strong>(${larva.surveyed}건 조사)`
    : '유충 조사 미실시 — 발생원 시설 기반 추정';
  const cause = topByCount ? `${topByCount} · ${larvaLine}` : '등록된 발생원이 없습니다.';

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
    <p class="diag-foot">방제 우선순위 <strong>${ranking.rank}/${ranking.total_districts}위</strong>
      · 발생원 위험 ${sr.score}점 · 지역위험(발생잠재력×인구) ${sr.effective_geo}</p>
  `;
}

// 발생원 분석(시설 유형별 위험 기여율)을 그린다.
function renderSources(result) {
  const sources = result.source_risk.top_sources;
  areaTypeText.textContent = `${result.source_risk.area_type} · 발생원 위험 ${result.source_risk.score}점`;

  // (v3) 지역위험 = √(발생 잠재력 × 인구 노출). 새 모델의 핵심을 카드로 보여준다.
  if (geoBreakdown) {
    const ex = result.exposure;
    const breeding = result.source_risk.breeding_potential;
    const geo = result.source_risk.effective_geo;
    geoBreakdown.innerHTML = `
      <article class="geo-item">
        <p class="geo-label">발생 잠재력</p>
        <p class="geo-value">${Math.round(breeding * 100)}점</p>
        <p class="geo-note">발생원 시설 + 유충 검출률</p>
      </article>
      <span class="geo-op" aria-hidden="true">×</span>
      <article class="geo-item">
        <p class="geo-label">인구 노출도</p>
        <p class="geo-value">${ex.exposure_index.toFixed(2)}</p>
        <p class="geo-note">${Number(ex.population).toLocaleString('ko-KR')}명${ex.estimated ? ' (추정)' : ''}</p>
      </article>
      <span class="geo-op" aria-hidden="true">=</span>
      <article class="geo-item geo-result">
        <p class="geo-label">지역위험</p>
        <p class="geo-value">${geo.toFixed(2)}</p>
        <p class="geo-note">√(잠재력 × 노출)</p>
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

  // (A) 유충 실태조사 결과: 조사 건수와 양성률을 막대로 보여준다.
  const larva = result.source_risk.larva;
  if (larva.surveyed > 0) {
    const ratePct = Math.round(larva.detection_rate * 100);
    larvaText.textContent =
      `${larva.surveyed}건 조사 중 ${larva.positive}건 양성 (검출률 ${ratePct}%) · 위험도 반영 ${Math.round(larva.weight_in_geo * 100)}%`;
    larvaFill.style.width = `${ratePct}%`;
    larvaFill.parentElement.style.visibility = 'visible';
  } else {
    larvaText.textContent = '유충 조사 미실시 — 발생원 시설 기반으로 추정한 값입니다.';
    larvaFill.style.width = '0%';
    larvaFill.parentElement.style.visibility = 'hidden';
  }

  // 코멘트도 개수 기준으로 통일(막대·진단과 어긋나지 않게).
  if (topCountName) {
    const larvaNote = larva.surveyed > 0
      ? ` 유충 검출률 ${Math.round(larva.detection_rate * 100)}%로 실측 반영됨.`
      : ' (유충 조사 미실시 — 발생원 시설 기반 추정.)';
    sourceComment.textContent = `시설 수가 가장 많은 발생원은 ${topCountName}이며, `
      + `이 구역은 ${result.source_risk.area_type}입니다.${larvaNote}`;
  } else {
    sourceComment.textContent = result.source_risk.comment;
  }
}

// 시내 순위 요약 카드를 그린다.
function renderRankSummary(result) {
  const ranking = result.ranking;
  const vs = ranking.vs_city_avg;
  const vsText = `${vs >= 0 ? '+' : ''}${vs}점`;
  const cards = [
    { name: '시내 순위', value: `${ranking.rank} / ${ranking.total_districts}위`, note: `가장 높은 구역: ${ranking.highest_district.name}` },
    { name: '상위 백분위', value: `${ranking.percentile}%`, note: '값이 클수록 위험 상위 구역입니다.' },
    { name: '시평균 대비', value: vsText, note: `김해시 평균 ${ranking.city_avg_index}점` },
    { name: '2025년 방역민원', value: `${result.complaints_2025}건`, note: '실제 접수된 모기 민원 건수입니다.' },
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
  septic_sewage: '정화조·하수구 주변',
  public_toilet: '공중화장실 주변',
  livestock_farm: '축사·가축 분뇨 주변',
  reservoir: '저수지·물웅덩이',
  tire_shop: '폐타이어 야적장',
  waste_recycle: '폐기물 재활용장 주변',
  waste_treat: '폐기물 처리장 주변',
  water_feature: '분수·바닥분수 등 수경시설',
};

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

// 시민·방제당국 행동요령과 부가 정보를 그린다.
function renderAdvice(result) {
  // 모델 행동요령 + 물렸을 때 대처(보건소 요청 반영). '조심할 장소 유형'은 아래 칩으로 표시.
  const biteCare = ['물렸을 때는 긁지 말고 항히스타민·스테로이드 연고를 바르고, 붓기·통증이 심하면 진료를 받으세요.'];
  const citizen = result.advice.citizen.concat(biteCare);
  citizenAdvice.innerHTML = citizen.map((text) => `<li>${text}</li>`).join('');
  authorityAdvice.innerHTML = result.advice.authority.map((text) => `<li>${text}</li>`).join('');
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
  weatherInputText.textContent = `기온 ${input.temp_c}℃ · 습도 ${input.humidity}% · 최근 3일 강수 ${input.rain_3d_mm}mm${windText}`;
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
  renderDistrictRanking(district);
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
  initGimhaeMap();        // 발생원 지도 생성(마커는 구역 렌더 시 채움)

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
