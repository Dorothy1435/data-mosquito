/*
 * 모기제로 메인 스크립트
 *
 * 이 파일은 크게 다음 순서로 구성되어 있습니다.
 *  1) 기본 데이터(샘플 지역, 위험 단계 정보)와 화면 요소 참조
 *  2) 날씨 API 호출 및 응답 가공 (open-meteo)
 *  3) 모기지수 계산 (기온·습도·강수·바람·시간·계절·지역 밀도를 점수화)
 *  4) 화면 렌더링 (게이지, 날씨 카드, 시간대별 예보 차트, 분석 근거, 전국 순위)
 *  5) 지도(Leaflet) 표시와 마커
 *  6) 이벤트 연결 및 초기화(init)
 *
 * 외부 데이터가 없거나 실패해도 멈추지 않도록, 실패 시 샘플 데이터로 대체합니다.
 */

// 날씨 API를 불러오지 못했을 때 사용하는 기본 지역 샘플 데이터
const defaultRegionData = {
  updatedAt: '2026-06-12T09:00:00+09:00',
  regions: [
    {
      name: '서울',
      lat: 37.5665,
      lng: 126.978,
      temperature: 28,
      humidity: 74,
      rainfall24h: 12,
      currentRain: false,
      windSpeed: 1.6,
      mosquitoDensity: 68,
      weatherText: '흐림',
      note: '습도와 최근 강수 영향으로 모기 활동 가능성이 높습니다.',
    },
    {
      name: '부산',
      lat: 35.1796,
      lng: 129.0756,
      temperature: 26,
      humidity: 69,
      rainfall24h: 4,
      currentRain: false,
      windSpeed: 3.8,
      mosquitoDensity: 47,
      weatherText: '맑음',
      note: '바람이 비교적 강해 모기 활동이 다소 줄어듭니다.',
    },
    {
      name: '제주',
      lat: 33.4996,
      lng: 126.5312,
      temperature: 29,
      humidity: 81,
      rainfall24h: 16,
      currentRain: true,
      windSpeed: 2.1,
      mosquitoDensity: 83,
      weatherText: '비',
      note: '현재 비와 높은 습도로 매우 위험 단계에 가깝습니다.',
    },
    {
      name: '대전',
      lat: 36.3504,
      lng: 127.3845,
      temperature: 25,
      humidity: 62,
      rainfall24h: 0,
      currentRain: false,
      windSpeed: 2.9,
      mosquitoDensity: 39,
      weatherText: '구름 많음',
      note: '기준치에 가까운 무난한 수준입니다.',
    },
    {
      name: '김해',
      lat: 35.243,
      lng: 128.901,
      temperature: 28,
      humidity: 79,
      rainfall24h: 10,
      currentRain: false,
      windSpeed: 2.2,
      mosquitoDensity: 77,
      weatherText: '흐림',
      note: '발생원·유충 데이터를 반영한 김해 정밀 모델이 적용되는 지역입니다.',
    },
  ],
};

const stageInfo = [
  {
    min: 0,
    max: 20,
    label: '매우 양호',
    className: 'stage-safe',
    advice: '모기 활동이 매우 낮아 일반적인 야외활동이 가능합니다.',
    color: '#2d87d6',
  },
  {
    min: 21,
    max: 40,
    label: '양호',
    className: 'stage-good',
    advice: '늦은 저녁에는 가벼운 주의가 필요합니다.',
    color: '#2f9e64',
  },
  {
    min: 41,
    max: 60,
    label: '보통',
    className: 'stage-normal',
    advice: '공원이나 물가 방문 시 모기 기피제를 준비하세요.',
    color: '#d7a21a',
  },
  {
    min: 61,
    max: 80,
    label: '위험',
    className: 'stage-risk',
    advice: '야외활동 시 긴소매와 모기 기피제를 권장합니다.',
    color: '#e6822d',
  },
  {
    min: 81,
    max: 100,
    label: '매우 위험',
    className: 'stage-danger',
    advice: '야간 야외활동을 최소화하고 방충망과 고인 물을 점검하세요.',
    color: '#d94c45',
  },
];

const regionSelect = document.getElementById('regionSelect');
const myLocationButton = document.getElementById('myLocationButton');
const menuButton = document.getElementById('menuButton');
const primaryNav = document.getElementById('primaryNav');
const locationText = document.getElementById('locationText');
const updatedText = document.getElementById('updatedText');
const indexValue = document.getElementById('indexValue');
const stageText = document.getElementById('stageText');
const adviceText = document.getElementById('adviceText');
const statusText = document.getElementById('statusText');
const weatherSourceBadge = document.getElementById('weatherSourceBadge');
const locationSourceBadge = document.getElementById('locationSourceBadge');
const confidenceBadge = document.getElementById('confidenceBadge');
const weatherGrid = document.getElementById('weatherGrid');
const analysisList = document.getElementById('analysisList');
const gauge = document.getElementById('gauge');
const rangeText = document.getElementById('rangeText');
const precisionBadge = document.getElementById('precisionBadge');
const heatmapButton = document.getElementById('heatmapButton');
const heatmapLegend = document.getElementById('heatmapLegend');
const forecastChartCanvas = document.getElementById('forecastChart');
const forecastSourceText = document.getElementById('forecastSourceText');
const peakDangerTime = document.getElementById('peakDangerTime');
const peakDangerNote = document.getElementById('peakDangerNote');
const peakSafeTime = document.getElementById('peakSafeTime');
const peakSafeNote = document.getElementById('peakSafeNote');

let map;
let regionMarkers = [];
let currentLocationMarker = null;
let selectedPointMarker = null;
let gimhaeSourceLayer = null; // 김해 발생원 히트맵 레이어 (켜면 생성, 끄면 null)
let gimhaeLayerWeather = null; // 히트맵용으로 한 번 받아온 김해 날씨 (재사용 캐시)
let regionData = [];
let currentRegion = null;
let activeWeatherData = null;
let dataUpdatedAt = defaultRegionData.updatedAt;
let weatherCache = new Map();
let forecastChart = null;

async function loadJsonWithFallback(path, fallbackData) {
  try {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`요청 실패: ${path}`);
    }

    return await response.json();
  } catch (error) {
    console.warn(`${path} 불러오기 실패, 기본 데이터를 사용합니다.`, error);
    return fallbackData;
  }
}

function getWeatherUrl(lat, lng) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    current_weather: 'true',
    hourly: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,precipitation_probability,windspeed_10m,weathercode',
    past_days: '3',
    forecast_days: '2',
    timezone: 'Asia/Seoul',
    temperature_unit: 'celsius',
    wind_speed_unit: 'ms',
    precipitation_unit: 'mm',
    daily: 'temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,uv_index_max,sunrise,sunset',
  });

  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

function isRainWeatherCode(code) {
  return [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(Number(code));
}

function getWeatherText(code) {
  const weatherCodeMap = {
    0: '맑음',
    1: '대체로 맑음',
    2: '부분적으로 흐림',
    3: '흐림',
    45: '안개',
    48: '짙은 안개',
    51: '이슬비',
    53: '약한 비',
    55: '비',
    61: '약한 비',
    63: '비',
    65: '강한 비',
    71: '눈',
    80: '소나기',
    81: '강한 소나기',
    82: '매우 강한 소나기',
    95: '뇌우',
  };

  return weatherCodeMap[code] || '날씨 정보';
}

function getSeasonScore(month) {
  if (month >= 6 && month <= 8) {
    return 88;
  }

  if (month === 5 || month === 9) {
    return 76;
  }

  if (month === 3 || month === 4 || month === 10) {
    return 60;
  }

  return 36;
}

// 위도/경도와 가장 가까운 등록 지역을 찾는다. (지도 클릭, 현재 위치 모두 사용)
function findNearestRegion(lat, lng) {
  return regionData.reduce((nearest, region) => {
    const distance = Math.hypot(region.lat - lat, region.lng - lng);
    const nearestDistance = Math.hypot(nearest.lat - lat, nearest.lng - lng);
    return distance < nearestDistance ? region : nearest;
  }, regionData[0]);
}

// ISO 시간 문자열을 "오후 7:30" 형식의 한국어 시각으로 변환한다.
function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function formatCoordinateLabel(lat, lng, accuracy) {
  const accuracyText = accuracy ? ` · 정확도 약 ${Math.round(accuracy)}m` : '';
  return `위도 ${lat.toFixed(5)}, 경도 ${lng.toFixed(5)}${accuracyText}`;
}

// 계산 결과를 얼마나 믿을 수 있는지(신뢰도)를 매긴다.
// 실제 날씨 연결 + 충분한 과거 데이터(24~72시간) + 최신 관측일수록 높아진다.
function computeConfidence({ isLive, historyHours, observedAt }) {
  let score = 0;
  const reasons = [];

  if (isLive) {
    score += 55;
    reasons.push('실시간 날씨 연결');
  } else {
    reasons.push('샘플 날씨 사용');
  }

  if (historyHours >= 72) {
    score += 25;
    reasons.push('최근 3일 데이터 확보');
  } else if (historyHours >= 24) {
    score += 15;
    reasons.push('최근 24시간 데이터 확보');
  }

  if (observedAt) {
    const ageHours = (Date.now() - new Date(observedAt).getTime()) / 3600000;
    if (ageHours <= 2) {
      score += 20;
      reasons.push('관측 시각 최신');
    } else if (ageHours <= 6) {
      score += 10;
    }
  }

  let level = 'low';
  let label = '낮음';
  if (score >= 75) {
    level = 'high';
    label = '높음';
  } else if (score >= 45) {
    level = 'medium';
    label = '보통';
  }

  return { level, label, score: Math.round(score), reasons };
}

// === 김해 정밀 모델 연결 ===
// 선택 좌표가 김해시 안이면, 일반 날씨 모델 대신 발생원·유충 데이터까지 반영한
// 김해 정밀 모델(GimhaeMosquitoModel)을 사용한다.

// 김해시 경계(근사 바운딩 박스). 이 범위 안이면 정밀 모델을 적용한다.
const GIMHAE_BOUNDS = { minLat: 35.10, maxLat: 35.40, minLng: 128.70, maxLng: 129.00 };
// 김해시 대표 좌표(시청 부근). 발생원 히트맵용 날씨를 한 번 받아올 때 사용한다.
const GIMHAE_CENTER = { lat: 35.2342, lng: 128.8811 };

// 좌표가 김해시 범위 안이면 가장 가까운 구역명을, 아니면 null을 돌려준다.
function getGimhaeDistrict(lat, lng) {
  if (!window.GimhaeMosquitoModel || typeof GimhaeMosquitoModel.nearestDistrict !== 'function') {
    return null;
  }
  if (lat < GIMHAE_BOUNDS.minLat || lat > GIMHAE_BOUNDS.maxLat
    || lng < GIMHAE_BOUNDS.minLng || lng > GIMHAE_BOUNDS.maxLng) {
    return null;
  }
  return GimhaeMosquitoModel.nearestDistrict(lat, lng);
}

// 날씨 데이터를 김해 정밀 모델 입력 옵션으로 변환한다.
function gimhaeModelOptions(weatherData) {
  const now = new Date();
  const options = {
    month: now.getMonth() + 1,
    hour: now.getHours(),
    weather_observed: weatherData && weatherData.isLive === true,
  };

  // 실시간 날씨가 있으면 정밀 모델에 그대로 넘긴다(없으면 모델이 월평년값 사용).
  if (weatherData && weatherData.isLive) {
    options.temp_c = Number(weatherData.temperature24h ?? weatherData.temperature);
    options.humidity = Number(weatherData.humidity24h ?? weatherData.humidity);
    options.rain_3d_mm = Number(weatherData.rainfall3d ?? weatherData.rainfall24h);
    options.wind_ms = Number(weatherData.windSpeed);
    options.precip_now = weatherData.currentRain ? 1.0 : 0.0;
  }

  return options;
}

// 김해 정밀 모델을 현재 날씨로 실행해 결과(모기지수·예상범위·신뢰도 등)를 돌려준다.
function computeGimhaePrecision(district, weatherData) {
  try {
    return GimhaeMosquitoModel.mosquitoIndex(district, gimhaeModelOptions(weatherData));
  } catch (error) {
    console.warn('김해 정밀 모델 계산에 실패해 일반 모델로 대체합니다.', error);
    return null;
  }
}

// 시간대별 예보의 한 시점(point)을 김해 정밀 모델 입력 옵션으로 변환한다.
function gimhaeForecastPointOptions(point, weatherData) {
  return {
    month: point.month,
    hour: point.hourOfDay,
    weather_observed: weatherData.isLive === true,
    temp_c: point.temperature,
    humidity: point.humidity,
    rain_3d_mm: point.rainfall3d,
    wind_ms: point.windSpeed,
    precip_now: point.precipNow,
  };
}

// 시간대별 예보 시리즈를 김해 정밀 모델로 다시 계산해 지수를 교체한다.
// (게이지와 같은 모델을 쓰게 되어 그래프와 현재 값이 일치한다)
function buildGimhaeForecastSeries(series, district, weatherData) {
  return series.map((point) => {
    try {
      const result = GimhaeMosquitoModel.mosquitoIndex(district, gimhaeForecastPointOptions(point, weatherData));
      return { ...point, index: Math.round(result.mosquito_index) };
    } catch (error) {
      return point;
    }
  });
}

// 발생원 위험(0~100)에 따른 히트맵 색상. 높을수록 진한 빨강.
function sourceRiskColor(score) {
  if (score >= 75) return '#b91c1c';
  if (score >= 50) return '#ef4444';
  if (score >= 30) return '#f59e0b';
  if (score >= 15) return '#facc15';
  return '#86efac';
}

function createFallbackWeather(region) {
  return {
    isLive: false,
    sourceLabel: '샘플 데이터',
    temperature: region.temperature,
    temperature24h: region.temperature,
    feelsLike: region.temperature,
    humidity: region.humidity,
    humidity24h: region.humidity,
    rainfall24h: region.rainfall24h,
    rainfall3d: region.rainfall24h,
    currentRain: region.currentRain,
    windSpeed: region.windSpeed,
    weatherText: region.weatherText,
    precipitationProbability: null,
    observedAt: dataUpdatedAt,
    confidence: computeConfidence({ isLive: false, historyHours: 0, observedAt: null }),
  };
}

// 실제 날씨 API의 시간별 데이터로 앞으로 24시간 모기지수 예보를 만든다.
function buildLiveHourlyForecast(hourly, times, currentIndex, region) {
  const points = [];
  const temps = hourly.temperature_2m || [];
  const humidities = hourly.relative_humidity_2m || [];
  const precipitations = hourly.precipitation || [];
  const probabilities = hourly.precipitation_probability || [];
  const winds = hourly.windspeed_10m || [];
  const codes = hourly.weathercode || [];
  const end = Math.min(currentIndex + 24, times.length);

  for (let i = currentIndex; i < end; i += 1) {
    const time = times[i];
    if (!time) {
      continue;
    }

    const date = new Date(time);
    // 해당 시각 직전 72시간(3일) 강수량 합계 (산란처 형성 판단에 사용)
    const recentRain = precipitations.slice(Math.max(0, i - 71), i + 1);
    const rainfall3d = recentRain.reduce((sum, value) => sum + (Number(value) || 0), 0);
    const code = codes[i];
    const precipitationNow = Number(precipitations[i] ?? 0);

    const index = computeIndexFromFactors({
      temperature: Number(temps[i] ?? region.temperature),
      humidity: Number(humidities[i] ?? region.humidity),
      rainfall3d,
      currentRain: precipitationNow > 0.1 || isRainWeatherCode(code),
      windSpeed: Number(winds[i] ?? region.windSpeed),
      hour: date.getHours(),
      month: date.getMonth() + 1,
      regionalDensity: region.mosquitoDensity,
    });

    points.push({
      time,
      hourLabel: `${date.getHours()}시`,
      index,
      temperature: Number(temps[i] ?? region.temperature),
      weatherText: getWeatherText(code),
      precipProbability: probabilities[i] ?? null,
      // 김해 정밀 모델로 다시 계산할 때 쓰는 원시 요소
      humidity: Number(humidities[i] ?? region.humidity),
      rainfall3d,
      windSpeed: Number(winds[i] ?? region.windSpeed),
      precipNow: precipitationNow,
      hourOfDay: date.getHours(),
      month: date.getMonth() + 1,
    });
  }

  return points;
}

// 실제 날씨를 불러오지 못했을 때, 샘플 날씨를 고정값으로 두고 시간대 변화만 반영한 예상 예보를 만든다.
function buildFallbackHourlyForecast(region) {
  const points = [];
  const base = new Date();
  base.setMinutes(0, 0, 0);

  for (let hourOffset = 0; hourOffset < 24; hourOffset += 1) {
    const date = new Date(base.getTime() + hourOffset * 3600000);
    const index = computeIndexFromFactors({
      temperature: region.temperature,
      humidity: region.humidity,
      rainfall3d: region.rainfall24h,
      currentRain: region.currentRain,
      windSpeed: region.windSpeed,
      hour: date.getHours(),
      month: date.getMonth() + 1,
      regionalDensity: region.mosquitoDensity,
    });

    points.push({
      time: date.toISOString(),
      hourLabel: `${date.getHours()}시`,
      index,
      temperature: region.temperature,
      weatherText: region.weatherText,
      precipProbability: null,
      // 김해 정밀 모델로 다시 계산할 때 쓰는 원시 요소
      humidity: region.humidity,
      rainfall3d: region.rainfall24h,
      windSpeed: region.windSpeed,
      precipNow: region.currentRain ? 1.0 : 0.0,
      hourOfDay: date.getHours(),
      month: date.getMonth() + 1,
    });
  }

  return points;
}

// 시간별 배열에서 "현재 시각"의 인덱스를 찾는다.
// current_weather.time은 분이 붙을 수 있어(예: T16:30) 정시 배열(T16:00)과 indexOf가 안 맞으므로,
// 정시(앞 13자리)로 맞추고, 그래도 없으면 현재 시각 이하의 가장 마지막 시간을 쓴다.
function findCurrentHourIndex(times, currentTime) {
  if (!times.length || !currentTime) {
    return 0;
  }

  const hourKey = currentTime.slice(0, 13); // "2026-06-12T16"
  const exact = times.findIndex((time) => time.slice(0, 13) === hourKey);
  if (exact !== -1) {
    return exact;
  }

  // ISO 문자열은 사전순 비교가 시간순과 같으므로, 현재 시각 이하의 마지막 인덱스를 찾는다.
  for (let i = times.length - 1; i >= 0; i -= 1) {
    if (times[i] <= currentTime) {
      return i;
    }
  }

  return 0;
}

// open-meteo API 응답을 화면에서 쓰기 쉬운 형태로 가공한다. (현재 값 + 오늘 요약 + 24시간 예보)
function normalizeWeatherData(apiData, fallbackRegion) {
  const current = apiData.current_weather;
  const hourly = apiData.hourly || {};
  const daily = apiData.daily || {};
  const times = hourly.time || [];
  const currentIndex = findCurrentHourIndex(times, current.time);
  const humidity = hourly.relative_humidity_2m?.[currentIndex] ?? fallbackRegion.humidity;
  const apparentTemperature = hourly.apparent_temperature?.[currentIndex] ?? current.temperature;
  const precipitationNow = Number(hourly.precipitation?.[currentIndex] ?? 0);
  const precipitationProbability = hourly.precipitation_probability?.[currentIndex] ?? null;
  const recentValues = hourly.precipitation?.slice(Math.max(0, currentIndex - 23), currentIndex + 1) || [];
  const rainfall24h = recentValues.reduce((sum, value) => sum + (Number(value) || 0), 0);
  // 최근 72시간(3일) 누적 강수량 — 산란처 형성을 더 잘 반영한다.
  const recent72Values = hourly.precipitation?.slice(Math.max(0, currentIndex - 71), currentIndex + 1) || [];
  const rainfall3d = recent72Values.reduce((sum, value) => sum + (Number(value) || 0), 0);
  // 일별 배열에서 "오늘"의 인덱스를 찾는다. (past_days=3이라 0번은 3일 전이므로 날짜로 맞춘다)
  const todayKey = (current.time || '').slice(0, 10);
  const dailyTimes = daily.time || [];
  const foundDailyIndex = dailyTimes.indexOf(todayKey);
  const dailyIndex = foundDailyIndex === -1 ? Math.min(3, Math.max(0, dailyTimes.length - 2)) : foundDailyIndex;

  // 최근 24시간 평균 기온·습도 — 순간값의 노이즈를 줄여 더 안정적인 지수를 만든다.
  const temp24Values = (hourly.temperature_2m?.slice(Math.max(0, currentIndex - 23), currentIndex + 1) || [])
    .map(Number).filter((value) => !Number.isNaN(value));
  const hum24Values = (hourly.relative_humidity_2m?.slice(Math.max(0, currentIndex - 23), currentIndex + 1) || [])
    .map(Number).filter((value) => !Number.isNaN(value));
  const temperature24h = temp24Values.length
    ? temp24Values.reduce((sum, value) => sum + value, 0) / temp24Values.length
    : current.temperature;
  const humidity24h = hum24Values.length
    ? hum24Values.reduce((sum, value) => sum + value, 0) / hum24Values.length
    : humidity;

  // 신뢰도: 과거 데이터가 얼마나 쌓였는지(현재 시각 앞의 시간 수)로 판단
  const historyHours = currentIndex;
  const confidence = computeConfidence({ isLive: true, historyHours, observedAt: current.time });

  // 현재 시각부터 앞으로 24시간 동안의 시간대별 예보 데이터를 만든다.
  const hourlyForecast = buildLiveHourlyForecast(hourly, times, currentIndex, fallbackRegion);

  return {
    isLive: true,
    hourlyForecast,
    confidence,
    sourceLabel: '실제 날씨',
    temperature: current.temperature,
    temperature24h: Math.round(temperature24h * 10) / 10,
    feelsLike: apparentTemperature,
    humidity,
    humidity24h: Math.round(humidity24h),
    rainfall24h: Math.round(rainfall24h * 10) / 10,
    rainfall3d: Math.round(rainfall3d * 10) / 10,
    currentRain: precipitationNow > 0.1 || isRainWeatherCode(current.weathercode),
    windSpeed: current.windspeed,
    weatherText: getWeatherText(current.weathercode),
    precipitationProbability,
    observedAt: current.time,
    temperatureMax: daily.temperature_2m_max?.[dailyIndex] ?? current.temperature,
    temperatureMin: daily.temperature_2m_min?.[dailyIndex] ?? current.temperature,
    apparentTemperatureMax: daily.apparent_temperature_max?.[dailyIndex] ?? apparentTemperature,
    apparentTemperatureMin: daily.apparent_temperature_min?.[dailyIndex] ?? apparentTemperature,
    dailyRainfall: daily.precipitation_sum?.[dailyIndex] ?? rainfall24h,
    dailyRainProbability: daily.precipitation_probability_max?.[dailyIndex] ?? precipitationProbability,
    windSpeedMax: daily.wind_speed_10m_max?.[dailyIndex] ?? current.windspeed,
    uvIndexMax: daily.uv_index_max?.[dailyIndex] ?? null,
    sunrise: daily.sunrise?.[dailyIndex] ?? null,
    sunset: daily.sunset?.[dailyIndex] ?? null,
  };
}

// 좌표로 실제 날씨를 불러온다. 같은 좌표는 캐시를 재사용하고, 실패하면 샘플 날씨로 대체한다.
async function loadWeatherData(lat, lng, fallbackRegion) {
  const cacheKey = `${Number(lat).toFixed(3)},${Number(lng).toFixed(3)}`;

  if (weatherCache.has(cacheKey)) {
    return weatherCache.get(cacheKey);
  }

  try {
    const response = await fetch(getWeatherUrl(lat, lng));
    if (!response.ok) {
      throw new Error(`날씨 요청 실패: ${response.status}`);
    }

    const apiData = await response.json();
    const normalized = normalizeWeatherData(apiData, fallbackRegion);
    weatherCache.set(cacheKey, normalized);
    return normalized;
  } catch (error) {
    console.warn('실제 날씨를 불러오지 못해 샘플 데이터를 사용합니다.', error);
    const fallback = createFallbackWeather(fallbackRegion);
    weatherCache.set(cacheKey, fallback);
    return fallback;
  }
}

function getCurrentStage(value) {
  return stageInfo.find((stage) => value >= stage.min && value <= stage.max) || stageInfo[stageInfo.length - 1];
}

function clampValue(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// === 연속(부드러운) 점수 곡선 ===
// 임계값으로 뚝뚝 끊기는 계단식 대신, 값이 조금만 변해도 점수가 자연스럽게 변하도록 곡선으로 설계했습니다.
// 모기 생태(약 28도 정점, 다습 선호, 적당한 비가 산란처를 만들고 폭우는 유실, 새벽·일몰 활동)를 반영합니다.

// 기온 점수: 약 28도에서 정점인 종 모양(가우시안) 곡선. 14도 미만은 추가로 감쇠.
function getTemperatureScore(temperature) {
  let base = Math.exp(-(((temperature - 28) / 8) ** 2));
  if (temperature < 14) {
    base *= clampValue((temperature - 8) / 6, 0, 1); // 8도 이하 거의 0 → 14도에서 정상
  }
  return clampValue(base * 100, 0, 100);
}

// 습도 점수: 62% 부근을 중심으로 부드럽게 오르는 S자(로지스틱) 곡선
function getHumidityScore(humidity) {
  return clampValue(100 / (1 + Math.exp(-(humidity - 62) / 8)), 0, 100);
}

// 강수 점수: 최근 3일 누적 강수 기준. 적당한 비가 산란처를 늘려 정점, 폭우는 유충 유실로 감소.
function getRainScore(currentRain, rainfall3d) {
  let score;
  if (rainfall3d <= 0) {
    score = 30; // 비 없음 — 기존 고인물 위주
  } else if (rainfall3d <= 35) {
    score = 30 + 60 * (rainfall3d / 35); // 0→30, 35mm→90 (산란처 증가)
  } else if (rainfall3d <= 90) {
    score = 90 - 45 * ((rainfall3d - 35) / 55); // 35→90, 90mm→45 (일부 유실)
  } else {
    score = 45 - 10 * clampValue((rainfall3d - 90) / 60, 0, 1); // 폭우 추가 감소
  }
  if (currentRain) {
    score *= 0.85; // 비가 내리는 동안에는 성충 활동이 일시적으로 줄어듦
  }
  return clampValue(score, 0, 100);
}

// 풍속 점수: 바람이 강할수록 부드럽게 감소(지수 감쇠). 약 3m/s에서 약 40점.
function getWindScore(windSpeed) {
  return clampValue(100 * Math.exp(-windSpeed / 3.2), 0, 100);
}

// 시간대 점수: 새벽(5시)과 일몰 후(20시) 두 정점을 갖는 부드러운 곡선
function getTimeScore(hour) {
  const dusk = Math.exp(-(((hour - 20) / 3) ** 2));
  const dawn = Math.exp(-(((hour - 5) / 2.5) ** 2));
  return 35 + 55 * Math.max(dusk, dawn);
}

// 여러 요소 점수를 가중치로 합산해 0~100 사이의 모기지수를 계산하는 핵심 함수
function computeIndexFromFactors({ temperature, humidity, rainfall3d, currentRain, windSpeed, hour, month, regionalDensity }) {
  const weightedValue = (
    getTemperatureScore(temperature) * 0.24 +
    getHumidityScore(humidity) * 0.24 +
    getRainScore(currentRain, rainfall3d) * 0.2 +
    getWindScore(windSpeed) * 0.12 +
    getTimeScore(hour) * 0.1 +
    getSeasonScore(month) * 0.05 +
    Number(regionalDensity || 0) * 0.05
  );

  return Math.round(clampValue(weightedValue, 0, 100));
}

// 현재 시각 기준 모기지수 계산 (지역 + 현재 날씨 사용)
// 기온·습도는 순간값 대신 최근 24시간 평균을 써서 잠깐 튀는 값에 흔들리지 않게 한다.
function calculateMosquitoIndex(region, weatherData = null) {
  const liveWeather = weatherData || createFallbackWeather(region);
  const now = new Date();

  return computeIndexFromFactors({
    temperature: Number(liveWeather.temperature24h ?? liveWeather.temperature ?? region.temperature),
    humidity: Number(liveWeather.humidity24h ?? liveWeather.humidity ?? region.humidity),
    rainfall3d: Number(liveWeather.rainfall3d ?? liveWeather.rainfall24h ?? region.rainfall24h),
    currentRain: Boolean(liveWeather.currentRain ?? region.currentRain),
    windSpeed: Number(liveWeather.windSpeed ?? region.windSpeed),
    hour: now.getHours(),
    month: now.getMonth() + 1,
    regionalDensity: region.mosquitoDensity,
  });
}

function buildWeatherCards(region, index) {
  const liveWeather = activeWeatherData || createFallbackWeather(region);
  const cards = [
    {
      name: '기온',
      value: `${Number(liveWeather.temperature).toFixed(1)}°C`,
      note: liveWeather.temperature >= 24 && liveWeather.temperature <= 30 ? '모기 활동에 적당한 기온입니다.' : '기온 영향이 상대적으로 적습니다.',
    },
    {
      name: '체감 기온',
      value: `${Number(liveWeather.feelsLike).toFixed(1)}°C`,
      note: '체감 기온은 모기 활동 체감에도 영향을 줍니다.',
    },
    {
      name: '최고 / 최저',
      value: `${Number(liveWeather.temperatureMax).toFixed(1)}° / ${Number(liveWeather.temperatureMin).toFixed(1)}°`,
      note: '하루 기온 범위를 함께 보면 모기 활동 시간대를 예측하기 쉽습니다.',
    },
    {
      name: '습도',
      value: `${Math.round(liveWeather.humidity)}%`,
      note: liveWeather.humidity >= 60 ? '습도가 높아 모기가 활동하기 좋습니다.' : '습도가 낮아 활동성이 조금 줄어듭니다.',
    },
    {
      name: '오늘 강수량',
      value: `${Number(liveWeather.dailyRainfall ?? liveWeather.rainfall24h).toFixed(1)}mm`,
      note: (liveWeather.dailyRainfall ?? liveWeather.rainfall24h) >= 3 ? '고인 물이 생겼을 가능성이 있습니다.' : '오늘 비 영향은 크지 않습니다.',
    },
    {
      name: '강수 확률',
      value: liveWeather.dailyRainProbability == null ? '정보 없음' : `${Math.round(liveWeather.dailyRainProbability)}%`,
      note: '비가 올 가능성이 높으면 이후 모기 활동이 더 활발해질 수 있습니다.',
    },
    {
      name: '풍속',
      value: `${Number(liveWeather.windSpeed).toFixed(1)}m/s`,
      note: liveWeather.windSpeed < 3 ? '바람이 약해 모기 활동 가능성이 높습니다.' : '바람이 있어 활동성이 줄 수 있습니다.',
    },
    {
      name: '최대 풍속',
      value: `${Number(liveWeather.windSpeedMax ?? liveWeather.windSpeed).toFixed(1)}m/s`,
      note: '하루 중 가장 강한 바람도 함께 참고할 수 있습니다.',
    },
    {
      name: '일출 / 일몰',
      value: liveWeather.sunrise && liveWeather.sunset
        ? `${formatTime(liveWeather.sunrise)} / ${formatTime(liveWeather.sunset)}`
        : '정보 없음',
      note: '해가 진 이후부터는 모기 활동이 늘기 쉬워집니다.',
    },
    {
      name: '자외선 최대',
      value: liveWeather.uvIndexMax == null ? '정보 없음' : `${Number(liveWeather.uvIndexMax).toFixed(1)}`,
      note: '자외선이 높을수록 낮 시간대 외출 체감이 달라질 수 있습니다.',
    },
    {
      name: '날씨 상태',
      value: liveWeather.weatherText,
      note: liveWeather.isLive ? '실제 날씨 API에서 받아온 값입니다.' : '실제 날씨를 불러오지 못해 샘플 데이터로 표시합니다.',
    },
  ];

  weatherGrid.innerHTML = cards.map((card) => `
    <article class="metric-card">
      <p class="metric-name">${card.name}</p>
      <p class="metric-value">${card.value}</p>
      <p class="metric-note">${card.note}</p>
    </article>
  `).join('');

  gauge.style.background = `conic-gradient(${getGaugeGradient(index)})`;
}

function getGaugeGradient(value) {
  const safe = stageInfo[0].color;
  const good = stageInfo[1].color;
  const normal = stageInfo[2].color;
  const risk = stageInfo[3].color;
  const danger = stageInfo[4].color;

  if (value <= 20) {
    return `${safe} 0deg, ${safe} ${value * 3.6}deg, rgba(255,255,255,0.18) ${value * 3.6}deg, rgba(255,255,255,0.18) 360deg`;
  }

  if (value <= 40) {
    return `${safe} 0deg, ${good} ${value * 3.6}deg, rgba(255,255,255,0.18) ${value * 3.6}deg, rgba(255,255,255,0.18) 360deg`;
  }

  if (value <= 60) {
    return `${safe} 0deg, ${good} 72deg, ${normal} ${value * 3.6}deg, rgba(255,255,255,0.18) ${value * 3.6}deg, rgba(255,255,255,0.18) 360deg`;
  }

  if (value <= 80) {
    return `${safe} 0deg, ${good} 72deg, ${normal} 144deg, ${risk} ${value * 3.6}deg, rgba(255,255,255,0.18) ${value * 3.6}deg, rgba(255,255,255,0.18) 360deg`;
  }

  return `${safe} 0deg, ${good} 72deg, ${normal} 144deg, ${risk} 216deg, ${danger} ${value * 3.6}deg, rgba(255,255,255,0.18) ${value * 3.6}deg, rgba(255,255,255,0.18) 360deg`;
}

function renderAnalysis(region, weatherData, index, precision) {
  const liveWeather = weatherData || createFallbackWeather(region);
  const reasons = [];

  reasons.push(`현재 지역은 ${region.name}이며, 지수 ${index}점으로 ${getCurrentStage(index).label} 단계입니다.`);

  // 김해 정밀 모델이 적용된 경우, 발생원·유충 근거를 먼저 안내한다.
  if (precision) {
    const sr = precision.source_risk;
    reasons.push(`김해 정밀 모델 적용: '${precision.district}' 구역의 발생원·유충 데이터를 반영했습니다. ${sr.comment}`);
    reasons.push(`예상 범위는 ${precision.index_range.low}~${precision.index_range.high}점이며, 발생원 위험은 ${sr.score}점(시내 ${precision.ranking.rank}/${precision.ranking.total_districts}위)입니다.`);
  }

  // 지수는 순간값이 아니라 최근 24시간 평균 기온·습도로 계산합니다.
  const avgTemp = Number(liveWeather.temperature24h ?? liveWeather.temperature);
  const avgHumidity = Number(liveWeather.humidity24h ?? liveWeather.humidity);
  const rain3d = Number(liveWeather.rainfall3d ?? liveWeather.rainfall24h);

  if (avgTemp >= 27) {
    reasons.push(`최근 24시간 평균 기온이 ${avgTemp.toFixed(1)}°C(현재 ${Number(liveWeather.temperature).toFixed(1)}°C)로 높아 모기 활동 환경에 가깝습니다.`);
  } else if (avgTemp <= 18) {
    reasons.push(`최근 24시간 평균 기온이 ${avgTemp.toFixed(1)}°C(현재 ${Number(liveWeather.temperature).toFixed(1)}°C)로 다소 낮아 활동성이 줄 수 있습니다.`);
  } else {
    reasons.push(`최근 24시간 평균 기온이 ${avgTemp.toFixed(1)}°C(현재 ${Number(liveWeather.temperature).toFixed(1)}°C)로 모기 활동에 무난한 범위입니다.`);
  }

  if (avgHumidity >= 60) {
    reasons.push(`최근 24시간 평균 습도가 ${Math.round(avgHumidity)}%로 높아 모기 활동에 유리합니다.`);
  } else {
    reasons.push(`최근 24시간 평균 습도가 ${Math.round(avgHumidity)}%로 비교적 낮아 활동성이 일부 줄어듭니다.`);
  }

  if (rain3d >= 10) {
    reasons.push(`최근 3일 누적 강수가 ${rain3d.toFixed(1)}mm라서 고인 물(산란처)이 생겼을 가능성이 높습니다.`);
  } else if (rain3d >= 3 || liveWeather.currentRain) {
    reasons.push(`최근 3일 누적 강수가 ${rain3d.toFixed(1)}mm로 일부 고인 물이 생겼을 수 있습니다.`);
  } else {
    reasons.push(`최근 3일 누적 강수가 ${rain3d.toFixed(1)}mm로 비교적 적습니다.`);
  }

  if (liveWeather.dailyRainProbability != null) {
    reasons.push(`강수 확률이 ${Math.round(liveWeather.dailyRainProbability)}%라 비 이후 모기 활동 변화도 함께 볼 수 있습니다.`);
  }

  if (liveWeather.windSpeed < 3) {
    reasons.push(`풍속이 ${Number(liveWeather.windSpeed).toFixed(1)}m/s로 약해 활동성이 높아질 수 있습니다.`);
  } else {
    reasons.push(`풍속이 ${Number(liveWeather.windSpeed).toFixed(1)}m/s로 있어 모기 활동이 일부 억제될 수 있습니다.`);
  }

  if (liveWeather.sunrise && liveWeather.sunset) {
    reasons.push(`일출은 ${formatTime(liveWeather.sunrise)}, 일몰은 ${formatTime(liveWeather.sunset)}입니다.`);
  }

  if (index >= 61) {
    reasons.push('저녁 시간대와 겹치면 모기 활동이 더 활발해질 수 있습니다.');
    reasons.push('긴소매, 모기 기피제, 방충망 점검을 함께 준비하는 것이 좋습니다.');
  } else {
    reasons.push('현재 조건은 비교적 안정적입니다.');
    reasons.push('낮 시간대라면 야외활동이 비교적 수월하지만, 저녁에는 다시 점검이 필요합니다.');
  }

  // 마지막에 이 계산을 얼마나 믿을 수 있는지(신뢰도)와 근거를 함께 안내한다.
  const confidence = liveWeather.confidence || computeConfidence({ isLive: liveWeather.isLive, historyHours: 0, observedAt: null });
  reasons.push(`이 계산의 신뢰도는 '${confidence.label}'입니다. (${confidence.reasons.join(', ')})`);

  analysisList.innerHTML = reasons.map((reason) => `<li>${reason}</li>`).join('');
}

function updateStageStyles(index) {
  const stage = getCurrentStage(index);
  stageText.textContent = stage.label;
  stageText.className = `gauge-stage ${stage.className}`;
  adviceText.textContent = stage.advice;
  gauge.style.setProperty('--stage-color', stage.color);
}

// 정밀 모델의 신뢰도 등급(한글) → 메인 페이지 배지 색 클래스로 변환
function confidenceLevelClass(koreanLabel) {
  if (koreanLabel === '높음') return 'high';
  if (koreanLabel === '보통') return 'medium';
  return 'low';
}

function updateDataBadges(weatherData, isGps, precision) {
  weatherSourceBadge.textContent = weatherData.isLive ? '실제 날씨' : '샘플 날씨';
  locationSourceBadge.textContent = isGps ? 'GPS 위치' : '지역 선택';

  // 신뢰도 배지 (높음/보통/낮음)와 근거를 표시한다.
  if (confidenceBadge) {
    if (precision) {
      // 정밀 모델은 자체 신뢰구간/신뢰도를 제공한다.
      const conf = precision.confidence;
      confidenceBadge.textContent = `신뢰도 ${conf.level}`;
      confidenceBadge.className = `data-pill confidence-pill confidence-${confidenceLevelClass(conf.level)}`;
      confidenceBadge.title = `김해 정밀 모델 · 불확실성 ±${conf.uncertainty_pct}% · 날씨 ${conf.reasons.weather} · 유충 표본 ${conf.reasons.larva_sample}건`;
    } else {
      const confidence = weatherData.confidence || computeConfidence({ isLive: weatherData.isLive, historyHours: 0, observedAt: null });
      confidenceBadge.textContent = `신뢰도 ${confidence.label}`;
      confidenceBadge.className = `data-pill confidence-pill confidence-${confidence.level}`;
      confidenceBadge.title = `계산 신뢰도 ${confidence.score}점 · ${confidence.reasons.join(', ')}`;
    }
  }

  statusText.textContent = weatherData.isLive
    ? '실제 날씨 데이터를 연결했습니다.'
    : '실제 날씨를 불러오지 못해 샘플 데이터로 표시합니다.';
}

// 게이지 아래 '예상 범위(신뢰구간)'와 정밀 모델 배지를 표시한다.
function renderRange(index, weatherData, precision) {
  if (!rangeText) return;

  if (precision) {
    // 정밀 모델은 실제 신뢰구간(low~high)을 돌려준다.
    const r = precision.index_range;
    rangeText.textContent = `예상 범위 ${r.low}~${r.high}점 · 신뢰도 ${precision.confidence.level}`;
    if (precisionBadge) {
      precisionBadge.hidden = false;
      precisionBadge.textContent = `김해 정밀 모델 · ${precision.district}`;
    }
    return;
  }

  // 일반 모델은 신뢰도 등급에 따라 예상 범위 폭을 추정한다.
  const confidence = weatherData.confidence || computeConfidence({ isLive: weatherData.isLive, historyHours: 0, observedAt: null });
  const uncertainty = confidence.level === 'high' ? 0.10 : (confidence.level === 'medium' ? 0.18 : 0.27);
  const low = Math.max(0, Math.round(index * (1 - uncertainty)));
  const high = Math.min(100, Math.round(index * (1 + uncertainty)));
  rangeText.textContent = `예상 범위 ${low}~${high}점 · 신뢰도 ${confidence.label}`;
  if (precisionBadge) {
    precisionBadge.hidden = true;
  }
}

function updateSelectedPointMarker(lat, lng, label, accuracy) {
  if (!map) {
    return;
  }

  if (selectedPointMarker) {
    selectedPointMarker.remove();
  }

  selectedPointMarker = L.circleMarker([lat, lng], {
    radius: 11,
    color: '#0f6b57',
    weight: 3,
    fillColor: '#0f6b57',
    fillOpacity: 0.85,
  }).addTo(map).bindPopup(`
    <strong>${label}</strong><br>
    ${formatCoordinateLabel(lat, lng, accuracy)}
  `);
}

function updateCurrentLocationMarker(lat, lng, accuracy, label) {
  if (!map) {
    return;
  }

  if (currentLocationMarker) {
    currentLocationMarker.remove();
  }

  currentLocationMarker = L.circle([lat, lng], {
    radius: Math.max(accuracy || 30, 20),
    color: '#0f6b57',
    weight: 2,
    fillColor: '#7dd3fc',
    fillOpacity: 0.18,
  }).addTo(map).bindPopup(`
    <strong>${label}</strong><br>
    ${formatCoordinateLabel(lat, lng, accuracy)}
  `);
}

// 시간대별 예보(차트 + 위험 시간대 안내)를 한 번에 갱신한다.
// series는 호출부에서 미리 만든 시리즈(김해면 정밀 모델로 다시 계산된 시리즈).
function renderForecast(series, weatherData, isGimhae) {
  renderForecastChart(series);
  renderPeakTimes(series);

  if (isGimhae) {
    forecastSourceText.textContent = weatherData.isLive
      ? '김해 정밀 모델 + 실제 날씨의 시간별 예보입니다. (게이지 값과 동일 모델)'
      : '실제 날씨를 불러오지 못해, 김해 정밀 모델에 시간대 변화만 반영한 예상값입니다.';
    return;
  }

  forecastSourceText.textContent = weatherData.isLive
    ? '실제 날씨 API의 시간별 예보로 계산한 모기지수입니다.'
    : '실제 날씨를 불러오지 못해, 샘플 날씨에 시간대 변화만 반영한 예상값입니다.';
}

// Chart.js로 24시간 모기지수 변화를 선 그래프로 그린다.
function renderForecastChart(series) {
  if (!window.Chart || !forecastChartCanvas) {
    forecastSourceText.textContent = '차트 라이브러리를 불러오지 못해 그래프를 표시할 수 없습니다.';
    return;
  }

  const labels = series.map((point) => point.hourLabel);
  const values = series.map((point) => point.index);
  const pointColors = series.map((point) => getCurrentStage(point.index).color);

  // 기존 차트가 있으면 제거하고 다시 그린다.
  if (forecastChart) {
    forecastChart.destroy();
  }

  forecastChart = new Chart(forecastChartCanvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: '모기지수',
          data: values,
          borderColor: '#0f6b57',
          borderWidth: 2,
          fill: true,
          backgroundColor: 'rgba(15, 107, 87, 0.12)',
          tension: 0.35,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: pointColors,
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1.5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        y: {
          min: 0,
          max: 100,
          ticks: { stepSize: 20, color: '#56706b' },
          grid: { color: 'rgba(22, 48, 45, 0.08)' },
          title: { display: true, text: '모기지수(점)', color: '#56706b' },
        },
        x: {
          ticks: { color: '#56706b', maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
          grid: { display: false },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            // 막대에 마우스를 올리면 단계와 날씨 정보를 함께 보여준다.
            label: (context) => {
              const point = series[context.dataIndex];
              const stage = getCurrentStage(point.index);
              return `모기지수 ${point.index}점 · ${stage.label}`;
            },
            afterLabel: (context) => {
              const point = series[context.dataIndex];
              const parts = [`${Number(point.temperature).toFixed(0)}°C · ${point.weatherText}`];
              if (point.precipProbability != null) {
                parts.push(`강수확률 ${Math.round(point.precipProbability)}%`);
              }
              return parts.join(' · ');
            },
          },
        },
      },
    },
  });
}

// 24시간 예보 중 가장 위험한 시간대와 가장 안전한 시간대를 찾아 안내한다.
function renderPeakTimes(series) {
  if (!series.length) {
    return;
  }

  const dangerPoint = series.reduce((max, point) => (point.index > max.index ? point : max), series[0]);
  const safePoint = series.reduce((min, point) => (point.index < min.index ? point : min), series[0]);
  const dangerStage = getCurrentStage(dangerPoint.index);
  const safeStage = getCurrentStage(safePoint.index);

  peakDangerTime.textContent = `${dangerPoint.hourLabel} · ${dangerPoint.index}점`;
  peakDangerNote.textContent = `${dangerStage.label} 단계로 가장 높습니다. 이 시간대 외출 시 모기 기피제와 긴소매를 준비하세요.`;
  peakSafeTime.textContent = `${safePoint.hourLabel} · ${safePoint.index}점`;
  peakSafeNote.textContent = `${safeStage.label} 단계로 가장 낮습니다. 야외활동을 한다면 이 시간대가 비교적 안전합니다.`;
}

// 한 지역(또는 좌표)의 날씨를 불러와 게이지·카드·예보·분석·지도까지 한 번에 갱신하는 핵심 함수
async function loadAndRenderRegion(region, options = {}) {
  currentRegion = region;
  const lat = options.lat ?? region.lat;
  const lng = options.lng ?? region.lng;
  const isGps = Boolean(options.isGps);
  const label = options.label || region.name;
  const accuracy = options.accuracy;
  const locationTitle = options.locationTitle || region.name;
  const preserveZoom = options.preserveZoom !== false;

  statusText.textContent = isGps ? 'GPS 위치로 실제 날씨를 불러오는 중입니다.' : `${region.name}의 실제 날씨를 불러오는 중입니다.`;

  const weatherData = await loadWeatherData(lat, lng, region);
  activeWeatherData = weatherData;

  // 시간대별 예보 시리즈를 먼저 만든다(실시간 시간별 예보 or 샘플 기반).
  let series = (weatherData.hourlyForecast && weatherData.hourlyForecast.length)
    ? weatherData.hourlyForecast
    : buildFallbackHourlyForecast(region);

  // 김해시 안이면 정밀 모델 결과를 우선 사용한다(밖이면 null → 일반 모델).
  // 예보 시리즈와 게이지를 같은 정밀 모델로 계산해 그래프와 현재 값이 일치하게 한다.
  const gimhaeDistrict = getGimhaeDistrict(lat, lng);
  let precision = null;
  let index;
  if (gimhaeDistrict) {
    series = buildGimhaeForecastSeries(series, gimhaeDistrict, weatherData);
    // 게이지는 '지금'에 해당하는 첫 시점(series[0])과 동일한 입력으로 계산한다.
    precision = series.length
      ? GimhaeMosquitoModel.mosquitoIndex(gimhaeDistrict, gimhaeForecastPointOptions(series[0], weatherData))
      : computeGimhaePrecision(gimhaeDistrict, weatherData);
    index = Math.round(precision.mosquito_index);
  } else {
    index = calculateMosquitoIndex(region, weatherData);
  }
  const stage = getCurrentStage(index);

  locationText.textContent = isGps
    ? `현재 위치 · ${region.name} 인근 · ${formatCoordinateLabel(lat, lng, accuracy)}`
    : `${locationTitle} · ${formatCoordinateLabel(lat, lng)}`;
  updatedText.textContent = weatherData.isLive
    ? `실제 날씨 갱신: ${new Date(weatherData.observedAt).toLocaleString('ko-KR')}`
    : `샘플 기준: ${new Date(dataUpdatedAt).toLocaleString('ko-KR')}`;
  indexValue.textContent = index;
  stageText.textContent = stage.label;
  stageText.className = `gauge-stage ${stage.className}`;
  adviceText.textContent = stage.advice;

  updateStageStyles(index);
  updateDataBadges(weatherData, isGps, precision);
  renderRange(index, weatherData, precision);
  buildWeatherCards(region, index);
  renderAnalysis(region, weatherData, index, precision);
  renderForecast(series, weatherData, Boolean(gimhaeDistrict));

  if (map) {
    const targetZoom = preserveZoom ? map.getZoom() : (isGps ? 12 : 11);
    map.setView([lat, lng], targetZoom, { animate: true });
    updateSelectedPointMarker(lat, lng, label, accuracy);
    if (isGps) {
      updateCurrentLocationMarker(lat, lng, accuracy, label);
    } else if (currentLocationMarker) {
      currentLocationMarker.remove();
      currentLocationMarker = null;
    }
  }

  highlightActiveRegion(region.name);
}

function renderRegion(region) {
  currentRegion = region;
  loadAndRenderRegion(region, { isGps: false }).catch((error) => {
    console.error('지역 표시 실패', error);
    statusText.textContent = '지역 표시 중 문제가 발생해 샘플 데이터로 다시 시도합니다.';
  });
}

function highlightActiveRegion(regionName) {
  regionMarkers.forEach(({ marker, data }) => {
    const active = data.name === regionName;
    marker.setStyle({
      radius: active ? 13 : 10,
      weight: active ? 4 : 2,
      fillOpacity: active ? 0.95 : 0.8,
    });
  });
}

function createRegionMarker(region) {
  // 김해시 안의 지역이면 정밀 모델로 지수를 계산하고 팝업에 발생원·유충 정보를 함께 보여준다.
  const gimhaeDistrict = getGimhaeDistrict(region.lat, region.lng);
  let index;
  let popupExtra = `날씨: ${region.weatherText}<br>${region.note}`;

  if (gimhaeDistrict) {
    const precision = GimhaeMosquitoModel.mosquitoIndex(gimhaeDistrict, gimhaeModelOptions(null));
    index = Math.round(precision.mosquito_index);
    const larva = precision.source_risk.larva;
    const larvaText = larva.detection_rate != null ? `유충 검출률 ${Math.round(larva.detection_rate * 100)}%` : '유충 미조사';
    popupExtra = `<span class="popup-precision">김해 정밀 모델 · ${gimhaeDistrict}</span><br>`
      + `발생원 위험: ${precision.source_risk.score}점 (시내 ${precision.ranking.rank}/${precision.ranking.total_districts}위)<br>`
      + `${larvaText} · 예상범위 ${precision.index_range.low}~${precision.index_range.high}점`;
  } else {
    index = calculateMosquitoIndex(region, createFallbackWeather(region));
  }

  const stage = getCurrentStage(index);

  return L.circleMarker([region.lat, region.lng], {
    radius: 10,
    color: '#ffffff',
    weight: 2,
    fillColor: stage.color,
    fillOpacity: 0.8,
  }).bindPopup(`
    <strong>${region.name}</strong><br>
    모기지수: ${index}점<br>
    단계: ${stage.label}<br>
    ${popupExtra}
  `);
}

function renderMap(regions) {
  if (!window.L) {
    locationText.textContent = '지도 라이브러리를 불러오지 못했습니다.';
    return;
  }

  if (!map) {
    map = L.map('map', { scrollWheelZoom: true }).setView([36.5, 127.8], 7);
    window.mosquitoMap = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap 기여자',
    }).addTo(map);
  }

  regionMarkers.forEach(({ marker }) => marker.remove());
  regionMarkers = regions.map((region) => {
    const marker = createRegionMarker(region).addTo(map);
    marker.on('click', () => {
      const selectValue = regionSelect.value;
      if (selectValue !== region.name) {
        regionSelect.value = region.name;
      }
      loadAndRenderRegion(region, { isGps: false }).catch((error) => {
        console.error('마커 선택 실패', error);
      });
    });

    return { marker, data: region };
  });

  map.on('click', (event) => {
    const nearestRegion = findNearestRegion(event.latlng.lat, event.latlng.lng);
    regionSelect.value = nearestRegion.name;
    loadAndRenderRegion(nearestRegion, {
      lat: event.latlng.lat,
      lng: event.latlng.lng,
      isGps: false,
      label: '지도 클릭 지점',
      locationTitle: `지도 클릭 지점 · 기준 지역 ${nearestRegion.name}`,
      preserveZoom: true,
    }).catch((error) => {
      console.error('지도 클릭 처리 실패', error);
    });
  });
}

// 김해시 17개 구역의 발생원 위험을 지도 위 원형 마커(히트맵)로 그린다.
// 같은 날씨에서도 발생원·유충 데이터가 달라 구역별 위험이 다르게 나타난다.
function buildGimhaeSourceLayer(weatherData) {
  const coords = GimhaeMosquitoModel.COORDS;
  const layer = L.layerGroup();
  const gimhaeRegion = regionData.find((region) => region.name === '김해') || currentRegion;

  Object.entries(coords).forEach(([district, point]) => {
    const precision = computeGimhaePrecision(district, weatherData);
    if (!precision) {
      return;
    }

    const score = precision.source_risk.score; // 발생원 위험(0~100)
    const todayIndex = Math.round(precision.mosquito_index);
    const larva = precision.source_risk.larva;
    const larvaText = larva.detection_rate != null
      ? `유충 검출률 ${Math.round(larva.detection_rate * 100)}% (표본 ${larva.surveyed}건)`
      : '유충 조사 미실시';

    // 발생원 위험이 클수록 원이 크고 진한 빨강이 된다.
    const circle = L.circleMarker(point, {
      radius: 10 + (score / 100) * 22,
      color: '#ffffff',
      weight: 1.5,
      fillColor: sourceRiskColor(score),
      fillOpacity: 0.55,
    }).bindPopup(`
      <strong>${district}</strong><br>
      발생원 위험: ${score}점 (시내 ${precision.ranking.rank}/${precision.ranking.total_districts}위)<br>
      오늘 모기지수: ${todayIndex}점 · ${precision.grade}<br>
      주요 발생원: ${precision.source_risk.top_sources[0] ? precision.source_risk.top_sources[0].source : '없음'}<br>
      ${larvaText}
    `);

    // 원을 누르면 해당 구역 좌표로 메인 게이지를 정밀 모델로 갱신한다.
    circle.on('click', () => {
      if (!gimhaeRegion) {
        return;
      }
      regionSelect.value = gimhaeRegion.name;
      loadAndRenderRegion(gimhaeRegion, {
        lat: point[0],
        lng: point[1],
        isGps: false,
        label: `${district} (김해)`,
        locationTitle: `김해시 ${district}`,
        preserveZoom: true,
      }).catch((error) => console.error('히트맵 구역 선택 실패', error));
    });

    circle.addTo(layer);
  });

  return layer;
}

// 발생원 히트맵을 켜고 끈다. 처음 켤 때 김해 날씨를 한 번만 받아 17개 구역에 적용한다.
async function toggleGimhaeHeatmap() {
  if (!map || !window.GimhaeMosquitoModel) {
    return;
  }

  // 이미 켜져 있으면 끈다.
  if (gimhaeSourceLayer) {
    gimhaeSourceLayer.remove();
    gimhaeSourceLayer = null;
    if (heatmapButton) {
      heatmapButton.textContent = '김해 발생원 히트맵 보기';
      heatmapButton.setAttribute('aria-pressed', 'false');
    }
    if (heatmapLegend) {
      heatmapLegend.hidden = true;
    }
    return;
  }

  // 켜기: 김해 대표 지점 날씨를 한 번 받아 둔다(실패 시 평년값으로 자동 대체).
  if (heatmapButton) {
    heatmapButton.textContent = '불러오는 중…';
  }
  if (!gimhaeLayerWeather) {
    const gimhaeRegion = regionData.find((region) => region.name === '김해')
      || { name: '김해', temperature: 28, humidity: 79, rainfall24h: 10, currentRain: false, windSpeed: 2.2, weatherText: '흐림', mosquitoDensity: 77 };
    gimhaeLayerWeather = await loadWeatherData(GIMHAE_CENTER.lat, GIMHAE_CENTER.lng, gimhaeRegion);
  }

  gimhaeSourceLayer = buildGimhaeSourceLayer(gimhaeLayerWeather).addTo(map);
  // 김해 영역으로 지도를 맞춰 히트맵이 잘 보이게 한다.
  map.fitBounds([
    [GIMHAE_BOUNDS.minLat, GIMHAE_BOUNDS.minLng],
    [GIMHAE_BOUNDS.maxLat, GIMHAE_BOUNDS.maxLng],
  ], { padding: [20, 20] });

  if (heatmapButton) {
    heatmapButton.textContent = '김해 발생원 히트맵 끄기';
    heatmapButton.setAttribute('aria-pressed', 'true');
  }
  if (heatmapLegend) {
    heatmapLegend.hidden = false;
  }
}

function populateSelect(regions) {
  regionSelect.innerHTML = regions.map((region) => `<option value="${region.name}">${region.name}</option>`).join('');
}

function setupEvents() {
  regionSelect.addEventListener('change', () => {
    const selectedRegion = regionData.find((region) => region.name === regionSelect.value);
    if (selectedRegion) {
      loadAndRenderRegion(selectedRegion, { isGps: false }).catch((error) => {
        console.error('지역 선택 실패', error);
      });
    }
  });

  if (heatmapButton) {
    heatmapButton.addEventListener('click', () => {
      toggleGimhaeHeatmap().catch((error) => {
        console.error('발생원 히트맵 처리 실패', error);
        heatmapButton.textContent = '김해 발생원 히트맵 보기';
      });
    });
  }

  myLocationButton.addEventListener('click', () => {
    if (!navigator.geolocation) {
      alert('이 브라우저는 위치정보 기능을 지원하지 않습니다.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        const accuracy = position.coords.accuracy;
        const nearestRegion = findNearestRegion(latitude, longitude);
        regionSelect.value = nearestRegion.name;
        await loadAndRenderRegion(nearestRegion, {
          lat: latitude,
          lng: longitude,
          isGps: true,
          label: '현재 위치',
          accuracy,
          preserveZoom: true,
        });
      },
      () => {
        alert('위치정보를 가져오지 못해 기본 지역의 실제 날씨로 표시합니다.');
        if (currentRegion) {
          loadAndRenderRegion(currentRegion, { isGps: false }).catch(() => {});
        }
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 },
    );
  });
}

// 페이지가 열릴 때 한 번 실행되어 데이터 로딩, 지도/이벤트 설정, 첫 화면 렌더링을 담당한다.
async function init() {
  const [sampleData, regionsData] = await Promise.all([
    loadJsonWithFallback('./data/mosquito-sample.json', defaultRegionData),
    loadJsonWithFallback('./data/regions.json', { regions: defaultRegionData.regions.map(({ name, lat, lng }) => ({ name, lat, lng })) }),
  ]);

  dataUpdatedAt = sampleData.updatedAt || defaultRegionData.updatedAt;

  const mergedRegions = regionsData.regions.map((region) => {
    const sampleRegion = sampleData.regions.find((item) => item.name === region.name) || sampleData.regions[0];
    return {
      ...sampleRegion,
      ...region,
    };
  });

  regionData = mergedRegions.map((region) => ({ ...region }));

  populateSelect(regionData);
  setupEvents();
  renderMap(regionData);
  regionSelect.value = regionData[0].name;
  await loadAndRenderRegion(regionData[0], { isGps: false, preserveZoom: false });
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch((error) => {
    console.error('초기화 실패', error);
    locationText.textContent = '초기화 중 문제가 발생했습니다. 샘플 화면을 다시 불러와 주세요.';
  });
});