/* =============================================================
   새 디자인 화면을 그리는 부분 (홈 · 모기 예보 공통)
   -------------------------------------------------------------
   계산은 하지 않는다.
   script.js 가 계산을 끝내고 보내는 'mosquito:updated' 이벤트를 받아,
   그 값으로 화면만 채운다.

   여기서 채우는 것
     · 날씨 배경 사진 (weather-bg.js 에 넘김)
     · 상단 날씨 칩
     · 모기지수 5단계 눈금
     · 나들이 지수 (홈 요약 칩 / 예보 카드)
     · 시간대별 모기지수 막대
     · 5일 예보
     · 우리 동네 순위 점

   화면에 해당 요소가 없으면 조용히 건너뛴다.
   그래서 홈과 예보가 같은 파일을 함께 쓸 수 있다.
   ============================================================= */

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  /* ---------- 모기지수 5단계 ---------- */
  const STAGES = [
    { max: 20, label: '매우 양호', className: 'stage-safe' },
    { max: 40, label: '양호', className: 'stage-good' },
    { max: 60, label: '보통', className: 'stage-normal' },
    { max: 80, label: '위험', className: 'stage-risk' },
    { max: 100, label: '매우 위험', className: 'stage-danger' },
  ];

  function stageOf(index) {
    return STAGES.find((s) => index <= s.max) || STAGES[STAGES.length - 1];
  }

  /* ---------- 페이지가 열리면 배경부터 깔아 둔다 ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    if (window.WeatherBackground) {
      // 날씨를 아직 모르는 동안에는 시각만 보고 기본 배경을 깐다.
      window.WeatherBackground.apply({});
    }
    setupNavToggle();
    markCurrentNav();
  });

  /* ---------- 모바일 메뉴 ---------- */
  function setupNavToggle() {
    const button = $('menuButton');
    if (!button) return;
    button.addEventListener('click', () => {
      const open = document.body.classList.toggle('menu-open');
      button.setAttribute('aria-expanded', String(open));
    });
  }

  // 지금 보고 있는 메뉴에 표시를 남긴다.
  function markCurrentNav() {
    const here = location.pathname.replace(/\/$/, '').split('/').pop() || 'index';
    document.querySelectorAll('.navlinks a').forEach((link) => {
      const target = (link.getAttribute('href') || '').replace(/\.html$/, '').replace(/^\//, '') || 'index';
      if (target === here.replace(/\.html$/, '')) {
        link.classList.add('is-current');
        link.setAttribute('aria-current', 'page');
      }
    });
  }

  /* ---------- 계산 결과가 오면 화면을 채운다 ---------- */
  document.addEventListener('mosquito:updated', (event) => {
    const d = event.detail || {};
    try {
      applyBackground(d);
      renderWeatherChip(d);
      renderIndexScale(d);
      renderOuting(d);
      renderMosquitoHours(d);
      renderDailyOutlook(d);
      renderSideCard(d);
      renderRank(d);
    } catch (error) {
      // 한 군데가 실패해도 페이지 전체가 멈추지 않게 한다.
      console.warn('화면 갱신 중 문제가 발생했습니다.', error);
    }
  });

  /* ---------- 배경 사진 ---------- */
  function applyBackground(d) {
    if (!window.WeatherBackground) return;
    const w = d.weatherData || {};
    window.WeatherBackground.apply({
      weatherCode: w.weatherCode,
      isDay: w.isDay,
      sunrise: w.sunrise,
      sunset: w.sunset,
    });
  }

  /* ---------- 상단 날씨 칩 ---------- */
  function renderWeatherChip(d) {
    const chip = $('navWeather');
    if (!chip) return;
    const w = d.weatherData || {};
    const temp = w.temperature == null ? null : Math.round(w.temperature);
    const text = w.weatherText || '날씨 정보 없음';
    chip.textContent = temp == null ? text : `${temp}° · ${text}`;
    if (!w.isLive) chip.textContent += ' (샘플)';
  }

  /* ---------- 모기지수 5단계 눈금 ---------- */
  function renderIndexScale(d) {
    const knob = $('indexScaleKnob');
    const labels = $('indexScaleLabels');
    if (d.index == null) return;

    const stage = stageOf(d.index);
    if (knob) {
      knob.style.left = `${Math.min(100, Math.max(0, d.index))}%`;
    }
    if (labels) {
      Array.from(labels.children).forEach((el) => {
        const on = el.textContent.trim() === stage.label;
        el.classList.toggle('is-on', on);
      });
      labels.className = `scale-labels ${stage.className}`;
    }

    // 큰 숫자와 단계 배지에도 단계 색을 물려준다.
    const badge = $('stageBadge');
    if (badge) {
      badge.className = `stage-badge lg ${stage.className}`;
      badge.textContent = stage.label;
    }

    // 홈 스토리 마지막의 수식 결과도 같은 값으로 채운다.
    const formula = $('formulaResult');
    if (formula) formula.textContent = d.index;
  }

  /* ---------- 나들이 지수 ---------- */
  function renderOuting(d) {
    if (!window.OutingIndex) return;
    const O = window.OutingIndex;
    const w = d.weatherData || {};
    const series = d.series || [];

    // 시간대별 입력을 만든다. (모기지수는 이미 시간별로 계산돼 있다)
    // series 는 '지금'부터 시간 순서대로 들어 있다.
    const todayDate = new Date().getDate();
    const hours = series.map((point) => {
      const when = new Date(point.time);
      return {
        hour: point.hourOfDay,
        isToday: Number.isNaN(when.getTime()) ? true : when.getDate() === todayDate,
        temperature: point.temperature,
        rainMm: point.precipNow,
        rainProbability: point.precipProbability,
        windSpeed: point.windSpeed,
        uvIndex: point.uvIndex,
        mosquitoIndex: point.index,
      };
    });

    const outingSeries = O.computeSeries(hours);

    // 추천 시간대는 '해가 떠 있는 동안'에서만 고른다.
    // 새벽 3시가 조용하다고 나들이를 권할 수는 없다.
    const daylight = hoursOfDaylight(w);
    const daySeries = outingSeries.filter((p) => p.hour >= daylight.from && p.hour <= daylight.to);
    const best = O.findBestWindow(daySeries.length ? daySeries : outingSeries);

    // '지금'의 나들이 지수.
    // 자외선은 하루 최대값이 아니라 '지금 이 시각' 값을 쓴다.
    // (저녁인데 한낮의 최대 자외선을 보여 주면 사실과 다르다.)
    const nowPoint = series[0] || {};
    const now = O.compute({
      temperature: w.temperature,
      rainMm: w.currentRain ? 1 : 0,
      rainProbability: w.dailyRainProbability ?? w.precipitationProbability,
      windSpeed: w.windSpeed,
      uvIndex: nowPoint.uvIndex != null ? nowPoint.uvIndex : w.uvIndexMax,
      mosquitoIndex: d.index,
      peakHourText: buildMosquitoPeakText(series),
    });

    renderOutingChip(now, best, O);
    renderOutingCard(now, outingSeries, best, O);
  }

  // 해가 떠 있는 시간대를 구한다. 일출·일몰을 알면 그걸 쓰고, 없으면 7~19시로 본다.
  function hoursOfDaylight(weather) {
    const rise = weather.sunrise ? new Date(weather.sunrise) : null;
    const set = weather.sunset ? new Date(weather.sunset) : null;
    if (rise && set && !Number.isNaN(rise.getTime()) && !Number.isNaN(set.getTime())) {
      return { from: rise.getHours(), to: Math.max(rise.getHours(), set.getHours()) };
    }
    return { from: 7, to: 19 };
  }

  // 모기가 가장 많아지는 시간대를 문장으로.
  function buildMosquitoPeakText(series) {
    if (!series || !series.length) return null;
    let peak = series[0];
    series.forEach((p) => { if (p.index > peak.index) peak = p; });
    if (peak.index < 41) return '오늘은 적은 편이에요';
    return `${peak.hourOfDay}시부터 많아요`;
  }

  // 홈 화면의 한 줄 요약 칩
  function renderOutingChip(now, best, O) {
    const chip = $('outingChip');
    if (!chip) return;

    const score = $('outingChipScore');
    const grade = $('outingChipGrade');
    const advice = $('outingChipAdvice');

    chip.className = `glass outing-chip ${now.grade.className}`;

    if (!now.available) {
      if (score) score.textContent = '--';
      if (grade) grade.textContent = '정보 없음';
      if (advice) advice.textContent = '날씨를 불러오면 알려드릴게요.';
      return;
    }

    if (score) score.textContent = now.score;
    if (grade) grade.textContent = now.grade.label;
    if (advice) {
      const window = O.formatWindow(best);
      advice.textContent = window ? `${window}에 나가기 좋아요` : '오늘 나들이 참고하세요';
    }
  }

  // 예보 화면의 나들이 지수 카드
  function renderOutingCard(now, outingSeries, best, O) {
    const card = $('outingCard');
    if (!card) return;

    card.className = `glass outing-card ${now.grade.className}`;

    const score = $('outingScore');
    const grade = $('outingGrade');
    const advice = $('outingAdvice');

    if (score) score.textContent = now.available ? now.score : '--';
    if (grade) grade.textContent = now.grade.label;
    if (advice) {
      advice.innerHTML = now.available
        ? O.buildAdvice(now.score, best, null).join('<br>')
        : '날씨를 불러오면 알려드릴게요.';
    }

    // 4단계 눈금
    const bar = $('outingScaleBar');
    const labels = $('outingScaleLabels');
    const order = ['나쁨', '보통', '좋음', '매우 좋음'];
    const activeAt = order.indexOf(now.grade.label);
    if (bar) {
      Array.from(bar.children).forEach((el, i) => el.classList.toggle('is-on', i === activeAt));
    }
    if (labels) {
      Array.from(labels.children).forEach((el, i) => el.classList.toggle('is-on', i === activeAt));
    }

    // 추천 시간대
    const windowEl = $('outingBestWindow');
    if (windowEl) {
      const text = O.formatWindow(best);
      windowEl.textContent = text ? `추천 ${text}` : '추천 시간대 계산 중';
      windowEl.hidden = !text;
    }

    // 시간대별 막대
    const hoursEl = $('outingHours');
    if (hoursEl) {
      if (!outingSeries.length) {
        hoursEl.innerHTML = '<p class="outing-hours-title">시간대별 정보를 불러오지 못했습니다.</p>';
      } else {
        const maxBar = 110;
        hoursEl.innerHTML = outingSeries.map((point) => {
          const inBest = best && !best.tomorrow === point.isToday
            && point.hour >= best.from && point.hour <= best.to;
          const low = point.score < 50;
          const height = Math.max(6, Math.round((point.score / 100) * maxBar));
          // 날짜가 넘어가는 칸은 '내일'임을 밝힌다.
          const name = point.isToday ? `${point.hour}시` : `내일 ${point.hour}시`;
          return `
            <div class="outing-hour${inBest ? ' is-best' : ''}${low ? ' is-low' : ''}">
              <span class="outing-hour-score num">${point.score}</span>
              <div class="outing-hour-bar" style="height:${height}px"></div>
              <span class="outing-hour-name">${name}</span>
            </div>`;
        }).join('');
      }
    }

    // 오늘 나들이 조건 4줄
    const conditions = $('outingConditions');
    if (conditions) {
      conditions.innerHTML = now.conditions.map((row) => `
        <div class="outing-condition">
          <span class="outing-condition-icon" aria-hidden="true">${row.icon}</span>
          <span>${row.name}</span>
          <span class="outing-condition-value tone-${row.tone}">${row.text}</span>
        </div>`).join('');
    }
  }

  /* ---------- 시간대별 모기지수 막대 ---------- */
  function renderMosquitoHours(d) {
    const box = $('mosquitoHours');
    if (!box) return;
    const series = (d.series || []).slice(0, 7);
    if (!series.length) {
      box.innerHTML = '<p class="tile-note">시간대별 정보를 불러오지 못했습니다.</p>';
      return;
    }

    const maxBar = 110;
    box.innerHTML = series.map((point, i) => {
      const stage = stageOf(point.index);
      const height = Math.max(6, Math.round((point.index / 100) * maxBar));
      return `
        <div class="hour ${stage.className}${i === 0 ? ' is-now' : ''}">
          <span class="hour-value num">${point.index}</span>
          <div class="hour-bar" style="height:${height}px"></div>
          <span class="hour-name">${i === 0 ? '지금' : point.hourLabel}</span>
        </div>`;
    }).join('');
  }

  /* ---------- 지도 옆 '우리 동네' 카드 ---------- */
  function renderSideCard(d) {
    const name = $('sidePlaceName');
    const score = $('sideScore');
    const badge = $('sideStage');
    const rankTag = $('sidePlaceRank');
    if (!name && !score) return;

    const stage = d.index == null ? null : stageOf(d.index);
    // 김해 안이면 읍·면·동 이름을, 밖이면 지역 이름을 보여 준다.
    if (name) name.textContent = d.district || (d.region && d.region.name) || '우리 동네';
    if (score) score.textContent = d.index == null ? '--' : d.index;
    if (badge && stage) {
      badge.className = `stage-badge ${stage.className}`;
      badge.textContent = stage.label;
    }
    if (rankTag) {
      const rank = d.precision && d.precision.ranking;
      rankTag.textContent = rank ? `김해 ${rank.total_districts}곳 중 ${rank.rank}위` : '';
    }
  }

  /* ---------- 우리 동네 순위 점 ---------- */
  function renderRank(d) {
    const lead = $('rankLead');
    const dots = $('rankDots');
    const rank = d.precision && d.precision.ranking;

    if (!rank) {
      // 김해 밖이면 순위를 낼 수 없다. 없는 순위를 지어내지 않는다.
      if (lead) lead.innerHTML = '<span>김해 지역만 동네별 순위를 제공합니다.</span>';
      if (dots) dots.innerHTML = '';
      return;
    }

    if (lead) {
      lead.innerHTML = `<span class="num">${rank.rank}</span>`
        + `<span>번째로 모기가 많아요 <span class="of">/ ${rank.total_districts}곳</span></span>`;
    }
    if (dots) {
      const stage = stageOf(d.index);
      dots.className = `dots ${stage.className}`;
      dots.innerHTML = Array.from({ length: rank.total_districts }, (unused, i) =>
        `<i${i === rank.rank - 1 ? ' class="is-me"' : ''}></i>`).join('');
    }
  }

  /* ---------- 5일 예보 ---------- */
  function renderDailyOutlook(d) {
    const box = $('daysList');
    if (!box) return;
    const days = d.dailyOutlook || [];
    if (!days.length) {
      box.innerHTML = '<p class="tile-note">실제 날씨가 연결되면 5일 예보를 보여드립니다.</p>';
      return;
    }

    const names = ['일', '월', '화', '수', '목', '금', '토'];
    box.innerHTML = days.map((day, i) => {
      const stage = stageOf(day.index);
      const date = day.date;
      const label = i === 0 ? '오늘' : names[date.getDay()];
      return `
        <div class="day ${stage.className}">
          <span class="day-name">${label}</span>
          <span class="day-date num">${date.getMonth() + 1}/${date.getDate()}</span>
          <span class="day-track"><span class="day-fill" style="width:${day.index}%"></span></span>
          <span class="day-score num">${day.index}</span>
          <span class="day-stage">${stage.label}</span>
        </div>`;
    }).join('');
  }
}());
