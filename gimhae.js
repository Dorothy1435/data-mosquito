/*
 * 김해시 모기 위험 모델 페이지 스크립트
 *
 * 흐름
 *  1) 김해시 대표 지점의 실시간 날씨(기온·습도·최근 3일 강수량)를 Open-Meteo로 불러온다.
 *  2) 불러온 날씨를 mosquito-model.js(GimhaeMosquitoModel)에 입력해 구역별 모기지수를 계산한다.
 *  3) 게이지·기상분석·발생원분석·순위·행동요령·구역 순위표를 화면에 렌더링한다.
 *  4) 날씨를 못 불러오면 이번 달 평년값으로 자동 대체한다. (모델이 월별 평년값을 내장)
 */

// 김해시청 부근 대표 좌표 (날씨는 시 단위라 구역마다 따로 받지 않고 대표 지점 하나를 사용)
const GIMHAE_CENTER = { lat: 35.2342, lng: 128.8811 };

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
const weatherComponents = document.getElementById('weatherComponents');
const weatherComment = document.getElementById('weatherComment');
const sourceList = document.getElementById('sourceList');
const sourceComment = document.getElementById('sourceComment');
const areaTypeText = document.getElementById('areaTypeText');
const rankSummary = document.getElementById('rankSummary');
const citizenAdvice = document.getElementById('citizenAdvice');
const authorityAdvice = document.getElementById('authorityAdvice');
const extraInfoText = document.getElementById('extraInfoText');
const districtRankList = document.getElementById('districtRankList');

// 현재 적용 중인 날씨 입력값 (isLive: 실시간 여부)
let currentWeather = { month: 6, isLive: false };

// 실시간 날씨 요청 주소 (현재 기온 + 시간별 습도 + 일별 강수량 + 최근 3일)
function getWeatherUrl(lat, lng) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    current_weather: 'true',
    hourly: 'relative_humidity_2m',
    daily: 'precipitation_sum',
    past_days: '3',
    forecast_days: '1',
    timezone: 'Asia/Seoul',
    temperature_unit: 'celsius',
    wind_speed_unit: 'ms',
    precipitation_unit: 'mm',
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

// Open-Meteo 응답에서 모델 입력값(기온·습도·최근 3일 강수)을 뽑아낸다.
async function loadGimhaeWeather() {
  const month = new Date().getMonth() + 1;

  try {
    const response = await fetch(getWeatherUrl(GIMHAE_CENTER.lat, GIMHAE_CENTER.lng));
    if (!response.ok) {
      throw new Error(`날씨 요청 실패: ${response.status}`);
    }

    const data = await response.json();
    const current = data.current_weather;
    const hourly = data.hourly || {};
    const daily = data.daily || {};

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

    return {
      month,
      isLive: true,
      temp_c: current.temperature,
      humidity: humidity == null ? null : Math.round(humidity),
      rain_3d_mm: rain3dMm,
      observedAt: current.time,
    };
  } catch (error) {
    console.warn('김해 실시간 날씨를 불러오지 못해 이번 달 평년값으로 계산합니다.', error);
    // 날씨 입력을 비워두면 모델이 월별 평년값(SEASON)을 사용한다.
    return { month, isLive: false };
  }
}

// 모델에 넘길 옵션을 만든다. (값이 없는 항목은 빼서 모델이 평년값을 쓰도록 한다)
function buildModelOptions() {
  const options = { month: currentWeather.month };
  if (currentWeather.temp_c != null) options.temp_c = currentWeather.temp_c;
  if (currentWeather.humidity != null) options.humidity = currentWeather.humidity;
  if (currentWeather.rain_3d_mm != null) options.rain_3d_mm = currentWeather.rain_3d_mm;
  return options;
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
}

// 기상 분석 카드 3개(기온·습도·강수)를 그린다.
function renderWeatherComponents(result) {
  const components = result.weather.components;
  const cards = [
    { name: '기온', data: components.temperature, input: `${result.weather.input.temp_c}℃` },
    { name: '습도', data: components.humidity, input: `${result.weather.input.humidity}%` },
    { name: '최근 3일 강수', data: components.rainfall, input: `${result.weather.input.rain_3d_mm}mm` },
  ];

  weatherComponents.innerHTML = cards.map((card) => `
    <article class="metric-card">
      <p class="metric-name">${card.name} <span class="metric-input">${card.input}</span></p>
      <p class="metric-value">적합도 ${card.data.score.toFixed(2)}</p>
      ${scoreBar(card.data.score)}
      <p class="metric-note">${card.data.status}</p>
    </article>
  `).join('');

  weatherComment.textContent = result.weather.comment;
}

// 발생원 분석(시설 유형별 위험 기여율)을 그린다.
function renderSources(result) {
  const sources = result.source_risk.top_sources;
  areaTypeText.textContent = `${result.source_risk.area_type} · 발생원 위험 ${result.source_risk.score}점`;

  if (!sources.length) {
    sourceList.innerHTML = '<li class="source-empty">등록된 발생원이 없습니다.</li>';
  } else {
    sourceList.innerHTML = sources.map((item) => `
      <li class="source-item">
        <span class="source-name">${item.source}</span>
        <span class="source-bar"><span class="source-bar-fill" style="width:${item.risk_contribution_pct}%"></span></span>
        <span class="source-pct">${item.risk_contribution_pct}%</span>
        <span class="source-count">${item.count.toLocaleString('ko-KR')}곳</span>
      </li>
    `).join('');
  }

  sourceComment.textContent = result.source_risk.comment;
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
    <article class="metric-card">
      <p class="metric-name">${card.name}</p>
      <p class="metric-value">${card.value}</p>
      <p class="metric-note">${card.note}</p>
    </article>
  `).join('');
}

// 시민·방제당국 행동요령과 부가 정보를 그린다.
function renderAdvice(result) {
  citizenAdvice.innerHTML = result.advice.citizen.map((text) => `<li>${text}</li>`).join('');
  authorityAdvice.innerHTML = result.advice.authority.map((text) => `<li>${text}</li>`).join('');
  extraInfoText.textContent = `모기 활동 시간대: ${result.active_hours} · 추천 기피제: ${result.recommended_repellent}`;
}

// 김해시 17개 구역의 오늘 모기지수 순위표를 그린다.
function renderDistrictRanking(activeDistrict) {
  const results = GimhaeMosquitoModel.allIndices(buildModelOptions());

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
  const result = GimhaeMosquitoModel.mosquitoIndex(district, buildModelOptions());

  districtBadge.textContent = district;
  weatherSourceBadge.textContent = currentWeather.isLive ? '실시간 날씨' : '평년값(샘플)';
  weatherStatus.textContent = currentWeather.isLive
    ? '김해시 실시간 날씨를 반영해 계산했습니다.'
    : '실시간 날씨를 불러오지 못해 이번 달 평년값으로 계산했습니다.';

  const input = result.weather.input;
  weatherInputText.textContent = `기온 ${input.temp_c}℃ · 습도 ${input.humidity}% · 최근 3일 강수 ${input.rain_3d_mm}mm`;
  updatedText.textContent = currentWeather.isLive && currentWeather.observedAt
    ? `실시간 날씨 갱신: ${new Date(currentWeather.observedAt).toLocaleString('ko-KR')}`
    : `기준: ${currentWeather.month}월 평년값`;

  renderGauge(result);
  renderWeatherComponents(result);
  renderSources(result);
  renderRankSummary(result);
  renderAdvice(result);
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

  districtSelect.addEventListener('change', () => {
    renderDistrict(districtSelect.value);
  });

  // 먼저 실시간 날씨를 불러온 뒤, 방제 우선순위가 가장 높은 구역(활천동)을 기본으로 보여준다.
  currentWeather = await loadGimhaeWeather();
  const defaultDistrict = districtSelect.value || GimhaeMosquitoModel.listDistricts()[0];
  renderDistrict(defaultDistrict);
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch((error) => {
    console.error('김해 모델 초기화 실패', error);
    weatherStatus.textContent = '초기화 중 문제가 발생했습니다. 페이지를 새로고침해 주세요.';
  });
});
