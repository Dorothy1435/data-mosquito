/* =============================================================
   날씨 배경 — 지금 날씨에 맞는 사진을 화면 뒤에 깔아 준다.
   -------------------------------------------------------------
   사진 8장(인제대 운동장)을 낮/밤 × 날씨 종류로 골라 쓴다.
   고른 결과는 <body> 의 data-time / data-weather 에 적어 두고,
   빗줄기·눈·안개 같은 움직임은 CSS가 그 값을 보고 켠다.

   날씨 API를 새로 부르지 않는다.
   이미 받아 둔 Open-Meteo 응답의 weathercode / is_day / 일출·일몰을
   그대로 넘겨받아 쓰기만 한다.

   사용법
     WeatherBackground.mount();                       // 배경 자리 만들기
     WeatherBackground.apply({ weatherCode, isDay }); // 날씨 반영

   window.WeatherBackground 로 사용한다.
   ============================================================= */

(function (global) {
  'use strict';

  const BG_PATH = 'assets/bg/';

  // 쓸 수 있는 사진 8장
  const IMAGES = [
    'bg-clear', 'bg-cloudy', 'bg-rain', 'bg-storm',
    'bg-fog', 'bg-snow', 'bg-night-clear', 'bg-night-rain',
  ];

  /* ---------- Open-Meteo weathercode → 날씨 종류 ----------
     0~1 맑음 / 2~3 흐림 / 45·48 안개 / 51~67·80~82 비
     71~77·85~86 눈 / 95 이상 천둥번개                        */
  function toWeatherKind(code) {
    const c = Number(code);
    if (Number.isNaN(c)) return 'clear';
    if (c >= 95) return 'storm';
    if (c === 45 || c === 48) return 'fog';
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
    if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
    if (c >= 2 && c <= 3) return 'cloudy';
    return 'clear';
  }

  /* ---------- 날씨 종류 + 낮/밤 → 사진 파일 ----------
     밤 사진은 맑음과 비 두 장뿐이라, 나머지는 낮 사진을 어둡게 써서 채운다. */
  function pickImage(kind, isDay) {
    if (isDay) {
      return 'bg-' + kind;              // clear·cloudy·rain·storm·fog·snow
    }
    if (kind === 'clear' || kind === 'cloudy') return 'bg-night-clear';
    if (kind === 'rain' || kind === 'storm') return 'bg-night-rain';
    return 'bg-' + kind;                // 밤 안개·밤 눈은 낮 사진 + 어둡게 보정
  }

  /* ---------- 날씨 이름 (화면 칩에 쓰는 한국어) ---------- */
  const KIND_LABEL = {
    clear: '맑음', cloudy: '흐림', rain: '비',
    storm: '천둥번개', fog: '안개', snow: '눈',
  };

  /* ---------- 배경이 들어갈 자리를 만든다 ---------- */
  let bgLayer = null;
  let fxLayer = null;
  const imgNodes = {};

  function mount() {
    if (bgLayer) return;

    // 사진이 깔리는 층
    bgLayer = document.createElement('div');
    bgLayer.className = 'weather-bg';
    bgLayer.setAttribute('aria-hidden', 'true');

    // 사진 위에 덮는 어두운 막
    const tint = document.createElement('div');
    tint.className = 'weather-tint';
    bgLayer.appendChild(tint);

    // 빗줄기·눈 같은 움직임이 올라가는 층
    fxLayer = document.createElement('div');
    fxLayer.className = 'weather-fx';
    fxLayer.setAttribute('aria-hidden', 'true');

    document.body.insertBefore(fxLayer, document.body.firstChild);
    document.body.insertBefore(bgLayer, document.body.firstChild);
  }

  /* ---------- 사진 한 장을 만들어 붙인다 (처음 쓸 때만) ---------- */
  function ensureImage(name) {
    if (!IMAGES.includes(name) || !bgLayer) return null;
    if (imgNodes[name]) return imgNodes[name];

    const img = document.createElement('img');
    img.className = 'zoom';
    img.alt = '';                 // 배경 장식이라 설명이 필요 없다
    img.decoding = 'async';
    img.src = BG_PATH + name + '.jpg';
    // 어두운 막(.weather-tint)보다 뒤에 오도록 맨 앞에 넣는다.
    bgLayer.insertBefore(img, bgLayer.firstChild);
    imgNodes[name] = img;
    return img;
  }

  /* ---------- 움직임 층을 날씨에 맞게 다시 그린다 ---------- */
  function renderEffects(kind, isDay) {
    if (!fxLayer) return;
    fxLayer.innerHTML = '';

    const add = (className) => {
      const el = document.createElement('div');
      el.className = className;
      fxLayer.appendChild(el);
    };

    if (kind === 'rain' || kind === 'storm') {
      add('fx-rain far');
      add('fx-rain');
    }
    if (kind === 'storm') add('fx-flash');
    if (kind === 'snow') {
      add('fx-snow far');
      add('fx-snow');
    }
    if (kind === 'fog') add('fx-fog');
    if (kind === 'cloudy') add('fx-clouds');
    if (!isDay && (kind === 'clear' || kind === 'cloudy')) add('fx-stars');
  }

  /* ---------- 낮인지 밤인지 판단 ----------
     API가 is_day 를 주면 그대로 쓰고, 없으면 일출·일몰 시각으로 직접 따진다. */
  function decideIsDay(input) {
    if (input.isDay != null) return Boolean(input.isDay);

    if (input.sunrise && input.sunset) {
      const now = input.now ? new Date(input.now) : new Date();
      const rise = new Date(input.sunrise);
      const set = new Date(input.sunset);
      if (!Number.isNaN(rise.getTime()) && !Number.isNaN(set.getTime())) {
        return now >= rise && now < set;
      }
    }

    // 정보가 전혀 없으면 시각으로 대충 나눈다.
    const hour = new Date().getHours();
    return hour >= 6 && hour < 19;
  }

  /* ---------- 실제 적용 ---------- */
  let currentImage = null;

  function apply(input) {
    const data = input || {};
    mount();

    const kind = data.kind || toWeatherKind(data.weatherCode);
    const isDay = decideIsDay(data);
    const imageName = pickImage(kind, isDay);

    // CSS가 보고 배경 막 색과 움직임을 정한다.
    document.body.dataset.weather = kind;
    document.body.dataset.time = isDay ? 'day' : 'night';

    if (imageName !== currentImage) {
      // 필요한 사진만 그때 만들어 붙인다.
      // 쓰지도 않을 <img> 8개를 미리 만들어 두면 주소 없는 빈 이미지가 남는다.
      const next = ensureImage(imageName);
      if (next) {
        Object.keys(imgNodes).forEach((name) => {
          imgNodes[name].classList.toggle('is-active', name === imageName);
        });
        currentImage = imageName;
      }
    }

    renderEffects(kind, isDay);

    return { kind, isDay, image: imageName, label: KIND_LABEL[kind] || '맑음' };
  }

  /* ---------- 상단 칩에 쓸 문구 ---------- */
  function describe(input) {
    const data = input || {};
    const kind = data.kind || toWeatherKind(data.weatherCode);
    const isDay = decideIsDay(data);
    const label = KIND_LABEL[kind] || '맑음';
    if (data.temperature == null) return label;
    return `${Math.round(data.temperature)}° · ${label}`;
  }

  const api = { mount, apply, describe, toWeatherKind, pickImage, KIND_LABEL };
  global.WeatherBackground = api;
}(typeof window !== 'undefined' ? window : globalThis));
