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
const weatherGrid = document.getElementById('weatherGrid');
const analysisList = document.getElementById('analysisList');
const gauge = document.getElementById('gauge');
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
    past_days: '1',
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

function createFallbackWeather(region) {
  return {
    isLive: false,
    sourceLabel: '샘플 데이터',
    temperature: region.temperature,
    feelsLike: region.temperature,
    humidity: region.humidity,
    rainfall24h: region.rainfall24h,
    currentRain: region.currentRain,
    windSpeed: region.windSpeed,
    weatherText: region.weatherText,
    precipitationProbability: null,
    observedAt: dataUpdatedAt,
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
    // 해당 시각 직전 24시간 강수량 합계 (고인 물 판단에 사용)
    const recentRain = precipitations.slice(Math.max(0, i - 23), i + 1);
    const rainfall24h = recentRain.reduce((sum, value) => sum + (Number(value) || 0), 0);
    const code = codes[i];
    const precipitationNow = Number(precipitations[i] ?? 0);

    const index = computeIndexFromFactors({
      temperature: Number(temps[i] ?? region.temperature),
      humidity: Number(humidities[i] ?? region.humidity),
      rainfall24h,
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
      rainfall24h: region.rainfall24h,
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
    });
  }

  return points;
}

// open-meteo API 응답을 화면에서 쓰기 쉬운 형태로 가공한다. (현재 값 + 오늘 요약 + 24시간 예보)
function normalizeWeatherData(apiData, fallbackRegion) {
  const current = apiData.current_weather;
  const hourly = apiData.hourly || {};
  const daily = apiData.daily || {};
  const times = hourly.time || [];
  const currentIndex = Math.max(0, times.indexOf(current.time));
  const humidity = hourly.relative_humidity_2m?.[currentIndex] ?? fallbackRegion.humidity;
  const apparentTemperature = hourly.apparent_temperature?.[currentIndex] ?? current.temperature;
  const precipitationNow = Number(hourly.precipitation?.[currentIndex] ?? 0);
  const precipitationProbability = hourly.precipitation_probability?.[currentIndex] ?? null;
  const recentValues = hourly.precipitation?.slice(Math.max(0, currentIndex - 23), currentIndex + 1) || [];
  const rainfall24h = recentValues.reduce((sum, value) => sum + (Number(value) || 0), 0);
  const dailyIndex = 0;

  // 현재 시각부터 앞으로 24시간 동안의 시간대별 예보 데이터를 만든다.
  const hourlyForecast = buildLiveHourlyForecast(hourly, times, currentIndex, fallbackRegion);

  return {
    isLive: true,
    hourlyForecast,
    sourceLabel: '실제 날씨',
    temperature: current.temperature,
    feelsLike: apparentTemperature,
    humidity,
    rainfall24h: Math.round(rainfall24h * 10) / 10,
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

// 기온이 모기 활동에 미치는 점수 (24~30도에서 가장 높음)
function getTemperatureScore(temperature) {
  if (temperature <= 12) return 12;
  if (temperature <= 18) return 28;
  if (temperature <= 24) return 60;
  if (temperature <= 30) return 82;
  return 68;
}

// 습도 점수 (높을수록 모기 활동에 유리)
function getHumidityScore(humidity) {
  if (humidity < 40) return 18;
  if (humidity < 60) return 42;
  if (humidity < 80) return 74;
  return 90;
}

// 강수 점수 (최근 비로 고인 물이 생기면 높아짐, 현재 강수 중에는 활동이 잠시 줄어듦)
function getRainScore(currentRain, rainfall24h) {
  if (currentRain) return 62;
  if (rainfall24h >= 10) return 84;
  if (rainfall24h >= 3) return 58;
  return 24;
}

// 풍속 점수 (바람이 약할수록 모기 활동에 유리)
function getWindScore(windSpeed) {
  if (windSpeed < 1.5) return 84;
  if (windSpeed < 3) return 66;
  if (windSpeed < 5) return 40;
  return 18;
}

// 시간대 점수 (해 진 저녁~새벽에 모기 활동이 활발)
function getTimeScore(hour) {
  if (hour >= 18 || hour < 6) return 78;
  if (hour >= 12) return 45;
  return 36;
}

// 여러 요소 점수를 가중치로 합산해 0~100 사이의 모기지수를 계산하는 핵심 함수
function computeIndexFromFactors({ temperature, humidity, rainfall24h, currentRain, windSpeed, hour, month, regionalDensity }) {
  const weightedValue = (
    getTemperatureScore(temperature) * 0.24 +
    getHumidityScore(humidity) * 0.24 +
    getRainScore(currentRain, rainfall24h) * 0.2 +
    getWindScore(windSpeed) * 0.12 +
    getTimeScore(hour) * 0.1 +
    getSeasonScore(month) * 0.05 +
    Number(regionalDensity || 0) * 0.05
  );

  return Math.round(clampValue(weightedValue, 0, 100));
}

// 현재 시각 기준 모기지수 계산 (지역 + 현재 날씨 사용)
function calculateMosquitoIndex(region, weatherData = null) {
  const liveWeather = weatherData || createFallbackWeather(region);
  const now = new Date();

  return computeIndexFromFactors({
    temperature: Number(liveWeather.temperature ?? region.temperature),
    humidity: Number(liveWeather.humidity ?? region.humidity),
    rainfall24h: Number(liveWeather.rainfall24h ?? region.rainfall24h),
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

function renderAnalysis(region, weatherData, index) {
  const liveWeather = weatherData || createFallbackWeather(region);
  const reasons = [];

  reasons.push(`현재 지역은 ${region.name}이며, 지수 ${index}점으로 ${getCurrentStage(index).label} 단계입니다.`);

  if (liveWeather.temperature >= 27) {
    reasons.push(`기온이 ${Number(liveWeather.temperature).toFixed(1)}°C로 높아 모기 활동 환경에 가깝습니다.`);
  } else if (liveWeather.temperature <= 18) {
    reasons.push(`기온이 ${Number(liveWeather.temperature).toFixed(1)}°C로 다소 낮아 활동성이 줄 수 있습니다.`);
  } else {
    reasons.push(`기온이 ${Number(liveWeather.temperature).toFixed(1)}°C로 모기 활동에 무난한 범위입니다.`);
  }

  if (liveWeather.humidity >= 60) {
    reasons.push(`습도가 ${Math.round(liveWeather.humidity)}%로 높아 모기 활동에 유리합니다.`);
  } else {
    reasons.push(`습도가 ${Math.round(liveWeather.humidity)}%로 비교적 낮아 활동성이 일부 줄어듭니다.`);
  }

  if (liveWeather.rainfall24h >= 3 || liveWeather.currentRain) {
    reasons.push(`최근 강수량이 ${Number(liveWeather.rainfall24h).toFixed(1)}mm라서 고인 물이 생겼을 가능성이 있습니다.`);
  } else {
    reasons.push(`최근 강수량이 ${Number(liveWeather.rainfall24h).toFixed(1)}mm로 비교적 적습니다.`);
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

  analysisList.innerHTML = reasons.map((reason) => `<li>${reason}</li>`).join('');
}

function updateStageStyles(index) {
  const stage = getCurrentStage(index);
  stageText.textContent = stage.label;
  stageText.className = `gauge-stage ${stage.className}`;
  adviceText.textContent = stage.advice;
  gauge.style.setProperty('--stage-color', stage.color);
}

function updateDataBadges(weatherData, isGps) {
  weatherSourceBadge.textContent = weatherData.isLive ? '실제 날씨' : '샘플 날씨';
  locationSourceBadge.textContent = isGps ? 'GPS 위치' : '지역 선택';
  statusText.textContent = weatherData.isLive
    ? '실제 날씨 데이터를 연결했습니다.'
    : '실제 날씨를 불러오지 못해 샘플 데이터로 표시합니다.';
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
function renderForecast(region, weatherData) {
  const series = (weatherData.hourlyForecast && weatherData.hourlyForecast.length)
    ? weatherData.hourlyForecast
    : buildFallbackHourlyForecast(region);

  renderForecastChart(series);
  renderPeakTimes(series);

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
  const index = calculateMosquitoIndex(region, weatherData);
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
  updateDataBadges(weatherData, isGps);
  buildWeatherCards(region, index);
  renderAnalysis(region, weatherData, index);
  renderForecast(region, weatherData);

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
  const index = calculateMosquitoIndex(region, createFallbackWeather(region));
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
    날씨: ${region.weatherText}<br>
    ${region.note}
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