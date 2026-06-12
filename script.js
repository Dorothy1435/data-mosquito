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

let map;
let regionMarkers = [];
let currentLocationMarker = null;
let regionData = [];
let currentRegion = null;
let activeWeatherData = null;
let dataUpdatedAt = defaultRegionData.updatedAt;
let weatherCache = new Map();

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
    forecast_days: '1',
    timezone: 'Asia/Seoul',
    temperature_unit: 'celsius',
    wind_speed_unit: 'ms',
    precipitation_unit: 'mm',
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

function normalizeWeatherData(apiData, fallbackRegion) {
  const current = apiData.current_weather;
  const hourly = apiData.hourly || {};
  const times = hourly.time || [];
  const currentIndex = Math.max(0, times.indexOf(current.time));
  const humidity = hourly.relative_humidity_2m?.[currentIndex] ?? fallbackRegion.humidity;
  const apparentTemperature = hourly.apparent_temperature?.[currentIndex] ?? current.temperature;
  const precipitationNow = Number(hourly.precipitation?.[currentIndex] ?? 0);
  const precipitationProbability = hourly.precipitation_probability?.[currentIndex] ?? null;
  const recentValues = hourly.precipitation?.slice(Math.max(0, currentIndex - 23), currentIndex + 1) || [];
  const rainfall24h = recentValues.reduce((sum, value) => sum + (Number(value) || 0), 0);

  return {
    isLive: true,
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
  };
}

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

function calculateMosquitoIndex(region, weatherData = null) {
  const liveWeather = weatherData || createFallbackWeather(region);
  const temperature = Number(liveWeather.temperature ?? region.temperature);
  const humidity = Number(liveWeather.humidity ?? region.humidity);
  const rainfall24h = Number(liveWeather.rainfall24h ?? region.rainfall24h);
  const currentRain = Boolean(liveWeather.currentRain ?? region.currentRain);
  const windSpeed = Number(liveWeather.windSpeed ?? region.windSpeed);
  const temperatureScore = temperature <= 12
    ? 12
    : temperature <= 18
      ? 28
      : temperature <= 24
        ? 60
        : temperature <= 30
          ? 82
          : 68;

  const humidityScore = humidity < 40
    ? 18
    : humidity < 60
      ? 42
      : humidity < 80
        ? 74
        : 90;

  const rainScore = currentRain
    ? 62
    : rainfall24h >= 10
      ? 84
      : rainfall24h >= 3
        ? 58
        : 24;

  const windScore = windSpeed < 1.5
    ? 84
    : windSpeed < 3
      ? 66
      : windSpeed < 5
        ? 40
        : 18;

  const time = new Date().getHours();
  const timeScore = time >= 18 || time < 6 ? 78 : time >= 12 ? 45 : 36;

  const seasonScore = getSeasonScore(new Date().getMonth() + 1);
  const regionalScore = region.mosquitoDensity;

  const weightedValue = (
    temperatureScore * 0.24 +
    humidityScore * 0.24 +
    rainScore * 0.2 +
    windScore * 0.12 +
    timeScore * 0.1 +
    seasonScore * 0.05 +
    regionalScore * 0.05
  );

  return Math.round(clampValue(weightedValue, 0, 100));
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
      name: '습도',
      value: `${Math.round(liveWeather.humidity)}%`,
      note: liveWeather.humidity >= 60 ? '습도가 높아 모기가 활동하기 좋습니다.' : '습도가 낮아 활동성이 조금 줄어듭니다.',
    },
    {
      name: '최근 강수량',
      value: `${Number(liveWeather.rainfall24h).toFixed(1)}mm`,
      note: liveWeather.rainfall24h >= 3 ? '고인 물이 생겼을 가능성이 있습니다.' : '최근 비 영향은 크지 않습니다.',
    },
    {
      name: '풍속',
      value: `${Number(liveWeather.windSpeed).toFixed(1)}m/s`,
      note: liveWeather.windSpeed < 3 ? '바람이 약해 모기 활동 가능성이 높습니다.' : '바람이 있어 활동성이 줄 수 있습니다.',
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

  if (liveWeather.humidity >= 60) {
    reasons.push(`습도가 ${Math.round(liveWeather.humidity)}%로 높아 모기 활동에 유리합니다.`);
  }

  if (liveWeather.rainfall24h >= 3 || liveWeather.currentRain) {
    reasons.push('최근 강수 영향으로 고인 물이 생겼을 가능성이 있습니다.');
  }

  if (liveWeather.windSpeed < 3) {
    reasons.push(`풍속이 ${Number(liveWeather.windSpeed).toFixed(1)}m/s로 약해 활동성이 높아질 수 있습니다.`);
  }

  if (index >= 61) {
    reasons.push('저녁 시간대와 겹치면 모기 활동이 더 활발해질 수 있습니다.');
  } else {
    reasons.push('현재 조건은 비교적 안정적입니다.');
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

function updateCurrentLocationMarker(lat, lng, label) {
  if (!map) {
    return;
  }

  if (currentLocationMarker) {
    currentLocationMarker.remove();
  }

  currentLocationMarker = L.circleMarker([lat, lng], {
    radius: 13,
    color: '#0f6b57',
    weight: 4,
    fillColor: '#7dd3fc',
    fillOpacity: 0.92,
  }).addTo(map).bindPopup(`
    <strong>${label}</strong><br>
    현재 GPS 위치입니다.
  `);
}

async function loadAndRenderRegion(region, options = {}) {
  currentRegion = region;
  const lat = options.lat ?? region.lat;
  const lng = options.lng ?? region.lng;
  const isGps = Boolean(options.isGps);
  const label = options.label || region.name;

  statusText.textContent = isGps ? 'GPS 위치로 실제 날씨를 불러오는 중입니다.' : `${region.name}의 실제 날씨를 불러오는 중입니다.`;

  const weatherData = await loadWeatherData(lat, lng, region);
  activeWeatherData = weatherData;
  const index = calculateMosquitoIndex(region, weatherData);
  const stage = getCurrentStage(index);

  locationText.textContent = isGps ? `현재 위치 · ${region.name} 인근` : `${region.name} · 실제 날씨`;
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

  if (map) {
    map.setView([lat, lng], isGps ? 12 : 11, { animate: true });
    if (isGps) {
      updateCurrentLocationMarker(lat, lng, label);
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
    map = L.map('map', { scrollWheelZoom: false }).setView([36.5, 127.8], 7);

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
}

function populateSelect(regions) {
  regionSelect.innerHTML = regions.map((region) => `<option value="${region.name}">${region.name}</option>`).join('');
}

function findNearestRegion(lat, lng) {
  return regionData.reduce((nearest, region) => {
    const distance = Math.hypot(region.lat - lat, region.lng - lng);
    const nearestDistance = Math.hypot(nearest.lat - lat, nearest.lng - lng);
    return distance < nearestDistance ? region : nearest;
  }, regionData[0]);
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

  menuButton.addEventListener('click', () => {
    const isOpen = document.body.classList.toggle('menu-open');
    menuButton.setAttribute('aria-expanded', String(isOpen));
  });

  primaryNav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      document.body.classList.remove('menu-open');
      menuButton.setAttribute('aria-expanded', 'false');
    });
  });

  myLocationButton.addEventListener('click', () => {
    if (!navigator.geolocation) {
      alert('이 브라우저는 위치정보 기능을 지원하지 않습니다.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        const nearestRegion = findNearestRegion(latitude, longitude);
        regionSelect.value = nearestRegion.name;
        await loadAndRenderRegion(nearestRegion, {
          lat: latitude,
          lng: longitude,
          isGps: true,
          label: '현재 위치',
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
  await loadAndRenderRegion(regionData[0], { isGps: false });
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch((error) => {
    console.error('초기화 실패', error);
    locationText.textContent = '초기화 중 문제가 발생했습니다. 샘플 화면을 다시 불러와 주세요.';
  });
});