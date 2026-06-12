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
const locationText = document.getElementById('locationText');
const updatedText = document.getElementById('updatedText');
const indexValue = document.getElementById('indexValue');
const stageText = document.getElementById('stageText');
const adviceText = document.getElementById('adviceText');
const weatherGrid = document.getElementById('weatherGrid');
const analysisList = document.getElementById('analysisList');
const gauge = document.getElementById('gauge');

let map;
let regionMarkers = [];
let regionData = [];
let currentRegion = null;
let dataUpdatedAt = defaultRegionData.updatedAt;

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

function getCurrentStage(value) {
  return stageInfo.find((stage) => value >= stage.min && value <= stage.max) || stageInfo[stageInfo.length - 1];
}

function clampValue(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function calculateMosquitoIndex(region) {
  const temperatureScore = region.temperature <= 12
    ? 12
    : region.temperature <= 18
      ? 28
      : region.temperature <= 24
        ? 60
        : region.temperature <= 30
          ? 82
          : 68;

  const humidityScore = region.humidity < 40
    ? 18
    : region.humidity < 60
      ? 42
      : region.humidity < 80
        ? 74
        : 90;

  const rainScore = region.currentRain
    ? 62
    : region.rainfall24h >= 10
      ? 84
      : region.rainfall24h >= 3
        ? 58
        : 24;

  const windScore = region.windSpeed < 1.5
    ? 84
    : region.windSpeed < 3
      ? 66
      : region.windSpeed < 5
        ? 40
        : 18;

  const time = new Date().getHours();
  const timeScore = time >= 18 || time < 6 ? 78 : time >= 12 ? 45 : 36;

  const seasonScore = 76;
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
  const cards = [
    {
      name: '기온',
      value: `${region.temperature}°C`,
      note: region.temperature >= 24 && region.temperature <= 30 ? '모기 활동에 적당한 기온입니다.' : '기온 영향이 상대적으로 적습니다.',
    },
    {
      name: '습도',
      value: `${region.humidity}%`,
      note: region.humidity >= 60 ? '습도가 높아 모기가 활동하기 좋습니다.' : '습도가 낮아 활동성이 조금 줄어듭니다.',
    },
    {
      name: '최근 강수량',
      value: `${region.rainfall24h}mm`,
      note: region.rainfall24h >= 3 ? '고인 물이 생겼을 가능성이 있습니다.' : '최근 비 영향은 크지 않습니다.',
    },
    {
      name: '풍속',
      value: `${region.windSpeed.toFixed(1)}m/s`,
      note: region.windSpeed < 3 ? '바람이 약해 모기 활동 가능성이 높습니다.' : '바람이 있어 활동성이 줄 수 있습니다.',
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

function renderAnalysis(region, index) {
  const reasons = [];

  if (region.humidity >= 60) {
    reasons.push(`습도가 ${region.humidity}%로 높아 모기 활동에 유리합니다.`);
  }

  if (region.rainfall24h >= 3 || region.currentRain) {
    reasons.push('최근 강수 영향으로 고인 물이 생겼을 가능성이 있습니다.');
  }

  if (region.windSpeed < 3) {
    reasons.push(`풍속이 ${region.windSpeed.toFixed(1)}m/s로 약해 활동성이 높아질 수 있습니다.`);
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

function renderRegion(region) {
  currentRegion = region;
  const index = calculateMosquitoIndex(region);
  const stage = getCurrentStage(index);

  locationText.textContent = `${region.name} 기준 샘플 데이터`;
  updatedText.textContent = `최종 갱신: ${new Date(dataUpdatedAt).toLocaleString('ko-KR')}`;
  indexValue.textContent = index;
  stageText.textContent = stage.label;
  stageText.className = `gauge-stage ${stage.className}`;
  adviceText.textContent = stage.advice;

  updateStageStyles(index);
  buildWeatherCards(region, index);
  renderAnalysis(region, index);

  if (map) {
    map.setView([region.lat, region.lng], 11, { animate: true });
  }

  highlightActiveRegion(region.name);
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
  const index = calculateMosquitoIndex(region);
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
      renderRegion(region);
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
      renderRegion(selectedRegion);
    }
  });

  myLocationButton.addEventListener('click', () => {
    if (!navigator.geolocation) {
      alert('이 브라우저는 위치정보 기능을 지원하지 않습니다.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        const nearestRegion = findNearestRegion(latitude, longitude);
        regionSelect.value = nearestRegion.name;
        renderRegion(nearestRegion);
      },
      () => {
        alert('위치정보를 가져오지 못해 기본 샘플 지역으로 표시합니다.');
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
  renderRegion(regionData[0]);
  regionSelect.value = regionData[0].name;
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch((error) => {
    console.error('초기화 실패', error);
    locationText.textContent = '초기화 중 문제가 발생했습니다. 샘플 화면을 다시 불러와 주세요.';
  });
});