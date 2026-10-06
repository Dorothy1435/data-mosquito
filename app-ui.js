/* =============================================================
   홈 화면을 그리는 부분 (v15 · 하늘)
   -------------------------------------------------------------
   계산은 하지 않는다.
   script.js 가 계산을 끝내고 보내는 'mosquito:updated' 이벤트를 받아
   그 값으로 화면만 채운다.

   여기서 채우는 것
     · 배경 사진 (weather-bg.js 에 넘김)
     · 상단 지금 상태 칩
     · 히어로 한 줄 결론 · 단계 · 오늘 24시간 띠 · 흐름 한 줄
     · 오늘 챙길 것 (준비물 5개)
     · 나들이 지수 · 시간대별 나들이 · 5일 예보
     · 시간대별 모기 막대 · 동네 순위
     · 오늘 가기 좋은 공원
     · 오늘의 한 마디 · 제보 버튼

   화면에 해당 요소가 없으면 조용히 건너뛴다.
   ============================================================= */

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  /* ---------- 모기지수 5단계 ---------- */
  const STAGES = [
    { max: 20, label: '매우 양호', className: 'stage-safe', word: '거의 없어요.' },
    { max: 40, label: '양호', className: 'stage-good', word: '적은 편이에요.' },
    { max: 60, label: '보통', className: 'stage-normal', word: '조금 있어요.' },
    { max: 80, label: '위험', className: 'stage-risk', word: '많은 편이에요.' },
    { max: 100, label: '매우 위험', className: 'stage-danger', word: '아주 많아요.' },
  ];
  const stageOf = (index) => STAGES.find((s) => index <= s.max) || STAGES[STAGES.length - 1];

  /* ---------- 단계 표시 아이콘 ----------
     색만으로 단계를 구분하지 않도록(CLAUDE.md 규칙) 5칸 막대 아이콘을 함께 쓴다.
     단계가 높을수록 칸이 더 많이 찬다. 찬 칸은 단계 색, 빈 칸은 옅은 색. */
  const LEVEL_OF = { 'stage-safe': 1, 'stage-good': 2, 'stage-normal': 3, 'stage-risk': 4, 'stage-danger': 5 };
  function faceSvg(className) {
    const level = LEVEL_OF[className] || 0;
    let bars = '';
    for (let i = 0; i < 5; i += 1) {
      const h = 6 + i * 3.5;
      bars += `<rect x="${1 + i * 5}" y="${22 - h}" width="3.4" height="${h}" rx="1.2" class="${i < level ? 'on' : 'off'}"/>`;
    }
    return `<svg viewBox="0 0 26 23" width="100%" height="100%" aria-hidden="true">${bars}</svg>`;
  }

  /* ---------- 준비물 아이콘 (같은 굵기의 선 아이콘 한 벌) ---------- */
  const KIT_ICONS = {
    spray: '<rect x="6.5" y="9" width="9" height="12" rx="2"/><path d="M8.5 9V6h5v3M13.5 6h2.5"/><path d="M19 4.5h.01M21 7h.01M18.5 8h.01"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
    umbrella: '<path d="M3 12a9 9 0 0 1 18 0Z"/><path d="M12 12v6.5a2 2 0 0 1-4 0M12 3v0"/>',
    drop: '<path d="M12 3.2s6 6.4 6 10.8a6 6 0 0 1-12 0c0-4.4 6-10.8 6-10.8Z"/><path d="M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5"/>',
    mask: '<path d="M5 8.5c2.4-.9 4.6-1.3 7-1.3s4.6.4 7 1.3v4.3c0 3-3.3 5-7 5s-7-2-7-5Z"/><path d="M5 10H3.5v2.2c0 1.2.9 2 2 2.1M19 10h1.5v2.2c0 1.2-.9 2-2 2.1M9 11h6M9 14h6"/>',
  };
  const kitIcon = (key) => `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${KIT_ICONS[key] || ''}</svg>`;

  /* ---------- 오늘의 한 마디 ---------- */
  // 널리 알려진 상식 수준의 문구만 넣는다. 날짜에 따라 하나씩 돌아간다.
  const QUIPS = [
    '무는 모기는 전부 암컷이에요. 알을 낳으려고 피를 먹어요.',
    '모기는 O형을 좋아한다는데, 혈액형보다 체온과 땀 냄새가 더 큰 이유예요.',
    '모기는 숨에 섞인 이산화탄소를 멀리서도 알아채요. 뛰고 나면 더 잘 물려요.',
    '모기는 느려서 선풍기 바람 하나로도 잘 못 다가와요.',
    '검은 옷은 모기 눈에 잘 띄어요. 밝은 옷이 덜 물려요.',
    '병뚜껑에 고인 물에도 모기가 알을 낳아요.',
    '알에서 어른 모기까지 열흘 안팎이에요. 일주일에 한 번 물을 비우면 끊을 수 있어요.',
    '물린 데를 긁으면 더 가려워져요. 차갑게 식히는 게 나아요.',
    '흰줄숲모기는 낮에도 물어요. 풀숲에 갈 땐 낮에도 기피제를.',
    '모기는 한낮보다 해 질 무렵에 가장 바빠요.',
    '기피제는 옷 위가 아니라 드러난 피부에 발라야 해요.',
    '모기는 보통 100m 넘게 날아가지 않아요. 우리 집 근처 고인 물이 범인일 때가 많아요.',
    '비 오는 날에도 모기는 날아요. 빗방울보다 훨씬 가볍거든요.',
    '방충망 구멍은 모기에게 문이에요. 손가락이 들어가면 모기도 들어와요.',
  ];

  /* ---------- 페이지가 열리면 ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    if (window.WeatherBackground) window.WeatherBackground.apply({});   // 날씨를 모를 땐 시각만으로
    setupNavToggle();
    renderQuip();
    // 제보 버튼은 citizen.js 가 맡는다 (시험판)
  });

  function setupNavToggle() {
    const button = $('menuButton');
    if (!button) return;
    button.addEventListener('click', () => {
      const open = document.body.classList.toggle('menu-open');
      button.setAttribute('aria-expanded', String(open));
    });
  }

  /* 상황에 맞는 한 마디 — 비·더위·밤·모기 많은 날엔 그날에 맞는 문구를 먼저 고른다 */
  const QUIPS_BY = {
    rain: ['비 오는 날에도 모기는 날아요. 빗방울보다 훨씬 가볍거든요.', '비 그친 다음 날이 진짜예요. 고인 물부터 비워 주세요.', '빗물받이 · 화분 받침에 물이 고였는지 오늘 한 번 봐 주세요.'],
    hot: ['땀 냄새와 체온은 모기를 부르는 신호예요. 운동 뒤엔 씻고 나가요.', '너무 더우면 모기도 쉬어요. 한낮보다 해 질 무렵이 더 위험해요.'],
    night: ['모기는 해 질 무렵부터 가장 바빠요. 지금이 그 시간이에요.', '방충망 구멍은 모기에게 문이에요. 자기 전에 한 번 확인해요.', '선풍기 바람 하나로도 모기가 잘 못 다가와요.'],
    high: ['오늘은 모기가 많은 날이에요. 기피제는 드러난 피부에 발라요.', '밝은 긴 옷이 제일 싸고 확실한 기피제예요.'],
    low: ['오늘은 모기가 적은 날이에요. 이럴 때 집 주변 물을 비워 두면 좋아요.'],
  };
  /* ---------- 오늘 한눈에 ----------
     여섯 칸에 핵심 숫자만 담는다. 칸마다 움직임이 다르다 (design.css 20번).
       · 지금 모기지수: 자릿수가 슬롯머신처럼 굴러 올라간다 (odometer)
       · 가장 많은 때: 24시간 선 그래프가 그려지고, 가장 높은 점이 맥박친다
       · 비 올 확률: 원형 게이지가 차오른다
       · 우리 동네: 점 17개가 차례로 튀어나오고 우리 동네만 파랗다
       · 챙길 것: 켜진 준비물 아이콘이 하나씩 튀어 오른다 */
  function odometer(value) {
    return String(value).split('').map((ch) => /d/.test(ch)
      ? `<span class="odo" style="--d:${ch}"><span>0<br>1<br>2<br>3<br>4<br>5<br>6<br>7<br>8<br>9</span></span>`
      : `<span>${ch}</span>`).join('');
  }

  function renderGlance(d) {
    const box = $('glance');
    if (!box || d.index == null) return;
    const w = d.weatherData || {};
    const series = (d.series || []).slice(0, 24);
    const stage = stageOf(d.index);
    const cells = [];

    cells.push(`<div class="gl-cell"><p class="gl-k">지금 모기지수</p>
      <p class="gl-v"><span class="odo-wrap" aria-label="${d.index}점">${odometer(d.index)}</span><small>점</small></p>
      <p class="gl-s"><span class="lvl lvl-sm ${stage.className}">${faceSvg(stage.className)}</span>${stage.label}</p></div>`);

    if (series.length) {
      const max = Math.max(...series.map((p) => p.index)), min = Math.min(...series.map((p) => p.index));
      const pi = series.findIndex((p) => p.index === max);
      const X = (i) => (i / (series.length - 1)) * 100;
      const Y = (v) => 34 - ((v - min) / Math.max(1, max - min)) * 28;
      const path = series.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(p.index).toFixed(1)}`).join(' ');
      cells.push(`<div class="gl-cell"><p class="gl-k">가장 많은 때</p>
        <p class="gl-v">${timeWord(series[pi].hourOfDay)}</p>
        <svg class="spark" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><path d="${path}" pathLength="1"/><circle cx="${X(pi)}" cy="${Y(max)}" r="3.2"/></svg>
        <p class="gl-s">${max}점 · 지금부터 24시간</p></div>`);
    }

    if (w.temperature != null) {
      const feels = w.feelsLike ?? w.apparentTemperature;
      cells.push(`<div class="gl-cell"><p class="gl-k">기온</p>
        <p class="gl-v"><span class="odo-wrap" aria-label="${Math.round(w.temperature)}도">${odometer(Math.round(w.temperature))}</span><small>°</small></p>
        <p class="gl-s">${feels != null ? `체감 ${Math.round(feels)}°` : (w.weatherText || '')}</p></div>`);
    }

    const rain = w.dailyRainProbability ?? w.precipitationProbability;
    if (rain != null) {
      const r = Math.round(rain);
      cells.push(`<div class="gl-cell gl-ring"><div><p class="gl-k">비 올 확률</p>
        <p class="gl-v">${r}<small>%</small></p><p class="gl-s">${r >= 40 ? '우산 챙기세요' : '우산은 괜찮아요'}</p></div>
        <svg class="ring" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="18" pathLength="100"/><circle class="fill" cx="22" cy="22" r="18" pathLength="100" style="--p:${r}"/></svg></div>`);
    }

    const rank = d.precision && d.precision.ranking;
    if (rank) {
      const dots = Array.from({ length: rank.total_districts }, (_, i) => `<i class="${i + 1 === rank.rank ? 'me' : ''}" style="--i:${i}"></i>`).join('');
      cells.push(`<div class="gl-cell"><p class="gl-k">우리 동네 순위</p>
        <p class="gl-v">${rank.rank}<small>번째</small></p>
        <p class="gl-dots" aria-hidden="true">${dots}</p>
        <p class="gl-s">모기 많은 순 · ${rank.total_districts}곳 중</p></div>`);
    }

    const on = Array.from(document.querySelectorAll('#kitList li.on'));
    const icons = on.map((li, i) => `<span class="gl-ico" style="--i:${i}" title="${li.querySelector('.nm').textContent}">${li.querySelector('.ico').innerHTML}</span>`).join('');
    cells.push(`<div class="gl-cell"><p class="gl-k">챙길 것</p>
      <p class="gl-v">${on.length}<small>개</small></p>
      ${on.length ? `<p class="gl-icons">${icons}</p>` : ''}
      <p class="gl-s">${on.length ? on.map((li) => li.querySelector('.nm').textContent).join(' · ') : '오늘은 없어요'}</p></div>`);

    box.innerHTML = cells.join('');
  }

  let lastQuipCtx = '';
  function renderContextQuip(d) {
    const el = $('quip');
    if (!el || d.index == null) return;
    const w = d.weatherData || {};
    const h = new Date().getHours();
    const ctx = w.currentRain || (w.weatherCode >= 51 && w.weatherCode <= 82) ? 'rain'
      : (w.temperature >= 30 ? 'hot' : (h >= 18 || h < 5 ? 'night' : (d.index >= 61 ? 'high' : (d.index <= 20 ? 'low' : ''))));
    if (!ctx || ctx === lastQuipCtx) return;
    lastQuipCtx = ctx;
    const list = QUIPS_BY[ctx];
    const day = Math.floor(Date.now() / 864e5);
    el.innerHTML = `${list[day % list.length]}<small>오늘의 한 마디 · 날씨에 맞춰 바뀌어요</small>`;
  }

  function renderQuip() {
    const el = $('quip');
    if (!el) return;
    const now = new Date();
    const day = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 864e5);
    const text = QUIPS[day % QUIPS.length];
    el.innerHTML = `${text}<small>오늘의 한 마디 · 매일 바뀝니다</small>`;
  }

  // 제보 버튼: 기능은 아직 없다. 저장하는 척하지 않고 준비 중이라고 말한다.
  function setupReport() {
    const btn = $('reportBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      try { if (navigator.vibrate) navigator.vibrate(20); } catch (e) { /* 진동 미지원 */ }
      toast('제보 기능은 준비 중이에요. 위치 정보 동의 절차를 확인한 뒤 열립니다.');
    });
  }

  let toastTimer = null;
  function toast(message) {
    const el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  /* ---------- 계산 결과가 오면 화면을 채운다 ---------- */
  let lastAir = null;         // 대기질 (script.js 가 'air:updated' 로 보낸다)
  let lastDetail = null;      // 마지막 계산 결과 (대기질이 늦게 오면 준비물을 다시 그린다)
  let lastOutingScore = null; // 공원 추천 기준

  document.addEventListener('air:updated', (event) => {
    lastAir = event.detail || null;
    if (lastDetail) renderKit(lastDetail);
  });

  document.addEventListener('mosquito:updated', (event) => {
    const d = event.detail || {};
    lastDetail = d;
    try {
      applyBackground(d);
      renderNow(d);
      renderHero(d);
      renderDayRibbon(d);
      renderFlowLine(d);
      renderOuting(d);
      renderKit(d);
      renderDoList();
      renderMosquitoHours(d);
      renderDailyOutlook(d);
      renderRank(d);
      renderParks(d);
      renderContextQuip(d);
      renderGlance(d);
    } catch (error) {
      console.warn('화면 갱신 중 문제가 발생했습니다.', error);   // 한 군데가 실패해도 페이지는 살아 있어야 한다
    }
  });

  /* ---------- 배경 사진 ---------- */
  function applyBackground(d) {
    if (!window.WeatherBackground) return;
    const w = d.weatherData || {};
    window.WeatherBackground.apply({ weatherCode: w.weatherCode, isDay: w.isDay, sunrise: w.sunrise, sunset: w.sunset });
  }

  /* ---------- 상단 지금 상태 ---------- */
  function renderNow(d) {
    const el = $('navWeather');
    if (!el) return;
    const w = d.weatherData || {};
    const now = new Date();
    const hh = now.getHours(), mm = String(now.getMinutes()).padStart(2, '0');
    const clock = (hh < 12 ? '오전 ' + hh : '오후 ' + (hh === 12 ? 12 : hh - 12)) + ':' + mm;
    const temp = w.temperature == null ? '' : ` · ${Math.round(w.temperature)}°`;
    const text = w.weatherText ? ` ${w.weatherText}` : '';
    const sample = w.isLive ? '' : ' (샘플)';
    el.textContent = `${clock}${temp}${text}${sample}`;
  }

  /* ---------- 히어로: 한 줄 결론 + 단계 + 눈금 ---------- */
  function renderHero(d) {
    if (d.index == null) return;
    const stage = stageOf(d.index);
    const series = d.series || [];

    // 첫 줄: 지금 얼마나 많은지. 둘째 줄: 그래서 뭘 하면 되는지.
    const l1 = $('heroLine1'), l2 = $('heroLine2'), l3 = $('heroLine3');
    if (l1) l1.textContent = '오늘 모기,';   // 예전 화면 호환
    if (l2) l2.textContent = stage.word;
    if (l3) l3.textContent = secondLine(d.index, series);

    // 스크롤 이야기 첫 문장 (index.html #story)
    const storyNow = $('storyNow');
    if (storyNow) storyNow.textContent = `지금은 ${d.index}점, ${stage.word}`;

    const face = $('stageFace');
    if (face) { face.className = `lvl lvl-lg ${stage.className}`; face.innerHTML = faceSvg(stage.className); }
    const card = document.querySelector('.hero-card');
    if (card) card.dataset.stage = stage.className;   // 첫 화면 바탕색이 단계를 따라간다

    const badge = $('stageBadge');
    if (badge) { badge.className = `stage ${stage.className}`; badge.innerHTML = `<i></i>${stage.label}`; }

    const knob = $('indexScaleKnob');
    if (knob) knob.style.left = `${Math.min(100, Math.max(0, d.index))}%`;
    const labels = $('indexScaleLabels');
    if (labels) Array.from(labels.children).forEach((el) => el.classList.toggle('is-on', el.textContent.trim() === stage.label));

    const why = $('whyScore');
    if (why) why.textContent = `${d.index}점일까`;
  }

  /* ---------- 오늘 24시간 띠 ----------
     지금부터 24시간의 모기지수를 색 칸 24개로 늘어놓는다.
     글을 읽지 않아도 '언제 많아지는지'가 색으로 보이게 하는 게 목적이다. */
  function renderDayRibbon(d) {
    const box = $('dayRibbon'), labels = $('dayRibbonLabels');
    if (!box) return;
    const series = (d.series || []).slice(0, 24);
    if (!series.length) { box.innerHTML = ''; if (labels) labels.innerHTML = ''; return; }
    const peakIndex = series.reduce((m, p, i) => (p.index > series[m].index ? i : m), 0);
    box.innerHTML = series.map((p, i) => {
      const stage = stageOf(p.index);
      const name = i === 0 ? '지금' : p.hourLabel;
      return `<span class="rc ${stage.className}${i === 0 ? ' is-now' : ''}${i === peakIndex ? ' is-peak' : ''}" style="--i:${i};--v:${p.index}" title="${name} ${p.index}점 · ${stage.label}"><b>${p.index}</b></span>`;
    }).join('');
    if (labels) {
      labels.innerHTML = series.map((p, i) => {
        const show = i === 0 || i % 3 === 0;          // 세 시간마다 시각을 적는다
        const big = i === 0 || i % 6 === 0;           // 좁은 화면에서는 여섯 시간마다만 남긴다
        return `<span class="${big ? 'big' : ''}${i === 0 ? ' now' : ''}">${show ? (i === 0 ? '지금' : shortHour(p.hourOfDay)) : ''}</span>`;
      }).join('');
    }
  }

  function shortHour(h) {
    if (h == null) return '';
    if (h === 0) return '자정';
    if (h === 12) return '정오';
    return h < 12 ? `오전${h}` : `오후${h - 12}`;
  }

  /* ---------- 흐름 한 줄: 언제부터 늘고 언제 가장 많은지 ---------- */
  function renderFlowLine(d) {
    const el = $('flowLine');
    if (!el || d.index == null) return;
    const series = (d.series || []).slice(0, 24);
    if (!series.length) { el.textContent = '시간대별 예보를 불러오지 못했어요.'; return; }
    const now = d.index;
    const peak = series.reduce((m, p) => (p.index > m.index ? p : m), series[0]);
    const low = series.reduce((m, p) => (p.index < m.index ? p : m), series[0]);
    if (peak.index >= now + 8) {
      const rise = series.find((p) => p.index >= now + 5) || peak;
      el.textContent = `${timeWord(rise.hourOfDay)}부터 늘어나서 ${timeWord(peak.hourOfDay)}에 가장 많아요 (${peak.index}점 · ${stageOf(peak.index).label})`;
    } else if (low.index <= now - 8) {
      el.textContent = `${timeWord(low.hourOfDay)}엔 ${low.index}점까지 줄어요. 지금이 오늘 많은 편이에요.`;
    } else {
      el.textContent = `하루 종일 크게 달라지지 않아요. ${timeWord(peak.hourOfDay)}쯤 ${peak.index}점으로 가장 높아요.`;
    }
  }

  // 21 → '밤 9시', 6 → '새벽 6시'
  function timeWord(h) {
    if (h == null) return '저녁';
    const hh = h === 0 ? 12 : (h > 12 ? h - 12 : h);
    return `${hourWord(h)} ${hh}시`;
  }

  // 앞으로 몇 시간 안에 모기가 크게 늘면 그걸 먼저 말한다.
  function secondLine(index, series) {
    const peak = peakAhead(series);
    if (peak && peak.index >= 61 && peak.index > index + 10) return `${hourWord(peak.hourOfDay)}엔 긴 옷 하나.`;
    if (index >= 81) return '오늘은 되도록 실내에서.';
    if (index >= 61) return '긴 옷과 기피제 챙기세요.';
    if (index >= 41) return '기피제 하나면 충분해요.';
    return '가볍게 다녀오세요.';
  }

  function peakAhead(series) {
    let peak = null;
    (series || []).slice(0, 12).forEach((p) => { if (!peak || p.index > peak.index) peak = p; });
    return peak;
  }

  function hourWord(h) {
    if (h == null) return '저녁';
    if (h >= 4 && h < 8) return '새벽';
    if (h >= 8 && h < 12) return '오전';
    if (h >= 12 && h < 17) return '낮';
    if (h >= 17 && h < 21) return '저녁';
    return '밤';
  }

  /* ---------- 나들이 지수 ---------- */
  function renderOuting(d) {
    if (!window.OutingIndex) return;
    const O = window.OutingIndex;
    const w = d.weatherData || {};
    const series = d.series || [];

    const todayDate = new Date().getDate();
    const hours = series.map((point) => {
      const when = new Date(point.time);
      return {
        hour: point.hourOfDay,
        isToday: Number.isNaN(when.getTime()) ? true : when.getDate() === todayDate,
        temperature: point.temperature, rainMm: point.precipNow, rainProbability: point.precipProbability,
        windSpeed: point.windSpeed, uvIndex: point.uvIndex, mosquitoIndex: point.index,
      };
    });
    const outingSeries = O.computeSeries(hours);

    // 추천 시간대는 해가 떠 있는 동안에서만 고른다.
    const daylight = hoursOfDaylight(w);
    const daySeries = outingSeries.filter((p) => p.hour >= daylight.from && p.hour <= daylight.to);
    const best = O.findBestWindow(daySeries.length ? daySeries : outingSeries);

    const nowPoint = series[0] || {};
    const now = O.compute({
      temperature: w.temperature,
      rainMm: w.currentRain ? 1 : 0,
      rainProbability: w.dailyRainProbability ?? w.precipitationProbability,
      windSpeed: w.windSpeed,
      uvIndex: nowPoint.uvIndex != null ? nowPoint.uvIndex : w.uvIndexMax,   // 지금 시각의 자외선
      mosquitoIndex: d.index,
      peakHourText: mosquitoPeakText(series),
    });
    lastOutingScore = now.available ? now.score : null;
    d.outingNow = now; d.outingBest = best;

    const score = $('outingScore'), grade = $('outingGrade'), advice = $('outingAdvice');
    if (score) score.textContent = now.available ? now.score : '--';
    if (grade) { grade.textContent = now.grade.label; grade.dataset.tone = now.grade.label; }
    if (advice) advice.innerHTML = now.available ? O.buildAdvice(now.score, best, null).join('<br>') : '날씨를 불러오면 알려드릴게요.';

    const order = ['나쁨', '보통', '좋음', '매우 좋음'];
    const at = order.indexOf(now.grade.label);
    [$('outingScaleBar'), $('outingScaleLabels')].forEach((box) => {
      if (box) Array.from(box.children).forEach((el, i) => el.classList.toggle('is-on', i === at));
    });

    const windowEl = $('outingBestWindow');
    if (windowEl) { const t = O.formatWindow(best); windowEl.textContent = t ? `추천 ${t}` : ''; windowEl.hidden = !t; }

    const hoursEl = $('outingHours');
    if (hoursEl) {
      hoursEl.innerHTML = outingSeries.length ? outingSeries.map((p) => {
        const inBest = best && !best.tomorrow === p.isToday && p.hour >= best.from && p.hour <= best.to;
        const height = Math.max(6, Math.round((p.score / 100) * 90));
        const name = p.isToday ? `${p.hour}시` : `내일 ${p.hour}`;
        return `<div class="outing-hour${inBest ? ' is-best' : ''}${p.score < 50 ? ' is-low' : ''}">
          <span class="outing-hour-score">${p.score}</span><div class="outing-hour-bar" style="height:${height}px"></div><span class="outing-hour-name">${name}</span></div>`;
      }).join('') : '<p class="dim">시간대별 정보를 불러오지 못했습니다.</p>';
    }

    const cond = $('outingConditions');
    if (cond) {
      cond.innerHTML = now.conditions.map((row) => `<div class="outing-condition">
        <span class="outing-condition-icon" aria-hidden="true">${row.icon}</span><span>${row.name}</span>
        <span class="outing-condition-value tone-${row.tone}">${row.text}</span></div>`).join('');
    }
  }

  function hoursOfDaylight(weather) {
    const rise = weather.sunrise ? new Date(weather.sunrise) : null;
    const set = weather.sunset ? new Date(weather.sunset) : null;
    if (rise && set && !Number.isNaN(rise.getTime()) && !Number.isNaN(set.getTime())) {
      return { from: rise.getHours(), to: Math.max(rise.getHours(), set.getHours()) };
    }
    return { from: 7, to: 19 };
  }

  function mosquitoPeakText(series) {
    const peak = peakAhead(series);
    if (!peak) return null;
    if (peak.index < 41) return '오늘은 적은 편이에요';
    return `${peak.hourOfDay}시부터 많아요`;
  }

  /* ---------- 오늘 챙길 것 (준비물) ----------
     기준을 넘은 것만 켠다. 기준은 기상청·환경부 단계를 따른다.
       기피제  모기지수 41점 이상, 또는 앞으로 12시간 안에 61점 이상
       선크림  지금(낮이면 앞으로) 자외선 3 이상 (기상청 '보통' 이상)
       우산    비가 오는 중, 또는 강수확률 40% 이상
       물      체감온도 28도 이상
       마스크  초미세먼지 36 이상 또는 미세먼지 81 이상 (환경부 '나쁨')      */
  function renderKit(d) {
    const list = $('kitList');
    if (!list || d.index == null) return;
    const w = d.weatherData || {};
    const series = d.series || [];
    const peak = peakAhead(series);

    const uvAhead = Math.max(...series.slice(0, 8).map((p) => (p.uvIndex == null ? -1 : p.uvIndex)), -1);
    const uv = uvAhead >= 0 ? uvAhead : (w.uvIndexMax ?? null);
    const rainProb = w.dailyRainProbability ?? w.precipitationProbability ?? null;
    const feels = w.feelsLike ?? w.temperature ?? null;
    const air = lastAir;

    const items = [
      { key: 'spray', name: '기피제',
        on: d.index >= 41 || (peak && peak.index >= 61),
        why: d.index >= 41 ? `지금 ${d.index}점` : (peak && peak.index >= 61 ? `${peak.hourOfDay}시 ${peak.index}점` : '오늘은 적어요') },
      { key: 'sun', name: '선크림',
        on: uv != null && uv >= 3,
        why: uv == null ? '정보 없음' : `자외선 ${Math.round(uv)}` },
      { key: 'umbrella', name: '우산',
        on: Boolean(w.currentRain) || (rainProb != null && rainProb >= 40),
        why: w.currentRain ? '지금 비' : (rainProb == null ? '정보 없음' : `비 ${Math.round(rainProb)}%`) },
      { key: 'drop', name: '물',
        on: feels != null && feels >= 28,
        why: feels == null ? '정보 없음' : `체감 ${Math.round(feels)}도` },
      { key: 'mask', name: '마스크',
        on: air && ((air.pm25 != null && air.pm25 >= 36) || (air.pm10 != null && air.pm10 >= 81)),
        why: !air ? '확인 중' : (air.pm25 == null ? '정보 없음' : `초미세먼지 ${air.pm25}`) },
    ];

    list.innerHTML = items.map((it) => `<li class="${it.on ? 'on' : ''}">
      <span class="top"><span class="ico">${kitIcon(it.key)}</span></span>
      <span class="nm">${it.name}</span><span class="st">${it.on ? '챙기세요' : '안 챙겨도 돼요'}</span><span class="why">${it.why}</span></li>`).join('');

    // 한 줄 요약: 나들이 등급 + 켜진 준비물
    const line = $('kitLine');
    if (line) {
      const on = items.filter((it) => it.on).map((it) => it.name);
      const outing = d.outingNow;
      const head = outing && outing.available ? `나들이 <em>${outing.grade.label}.</em> ` : '';
      const tail = on.length === 0 ? '오늘은 챙길 게 없어요.'
        : on.length === 1 ? `${on[0]}만 챙기세요.`
        : `${on.slice(0, -1).join(', ')}${on.length > 2 ? '' : ''} 그리고 ${on[on.length - 1]} 챙기세요.`;
      line.innerHTML = head + tail;
    }

    // 스크롤 이야기 마지막 문장: 무엇을 챙기면 되는지
    const storyKit = $('storyKit');
    if (storyKit) {
      const on = items.filter((it) => it.on).map((it) => it.name);
      storyKit.textContent = on.length === 0 ? '오늘은 따로 챙길 게 없어요.'
        : on.length === 1 ? `${on[0]} 하나만 챙기면 돼요.`
        : `${on.slice(0, -1).join(', ')}이랑 ${on[on.length - 1]}, 챙겨 가세요.`;
    }
  }

  /* ---------- 오늘 이렇게 하세요 (script.js 의 행동요령을 줄 목록으로) ---------- */
  function renderDoList() {
    const box = $('doGrid'), source = $('actionTips');
    if (!box || !source) return;
    const tips = Array.from(source.querySelectorAll('li')).map((li) => li.textContent.trim()).filter(Boolean).slice(0, 3);
    box.innerHTML = tips.map((t, i) => `<p><i aria-hidden="true">${i + 1}</i>${t}</p>`).join('');
  }

  /* ---------- 시간대별 모기 막대 ---------- */
  function renderMosquitoHours(d) {
    const box = $('mosquitoHours');
    if (!box) return;
    const all = d.series || [];
    // 지금, 그리고 두 시간마다 하나씩 → 최대 12개로 하루를 훑는다
    const series = all.filter((p, i) => i === 0 || i % 2 === 0).slice(0, 12);
    if (!series.length) { box.innerHTML = '<p class="dim">시간대별 정보를 불러오지 못했습니다.</p>'; return; }
    const peakAt = series.reduce((m, p, i) => (p.index > series[m].index ? i : m), 0);
    box.innerHTML = series.map((p, i) => {
      const stage = stageOf(p.index);
      const height = Math.max(8, Math.round((p.index / 100) * 150));
      return `<div class="hour ${stage.className}${i === 0 ? ' is-now' : ''}${i === peakAt ? ' is-peak' : ''}">
        <span class="hour-value">${p.index}</span><div class="hour-bar" style="height:${height}px"></div><span class="hour-name">${i === 0 ? '지금' : p.hourLabel}</span></div>`;
    }).join('');
  }

  /* ---------- 5일 예보 ---------- */
  function renderDailyOutlook(d) {
    const box = $('daysList');
    if (!box) return;
    const days = d.dailyOutlook || [];
    if (!days.length) { box.innerHTML = '<p class="dim">실제 날씨가 연결되면 5일 예보를 보여드립니다.</p>'; return; }
    const names = ['일', '월', '화', '수', '목', '금', '토'];
    box.innerHTML = days.map((day, i) => {
      const stage = stageOf(day.index);
      return `<div class="day ${stage.className}">
        <span class="day-name">${i === 0 ? '오늘' : names[day.date.getDay()]}</span>
        <span class="day-date num">${day.date.getMonth() + 1}/${day.date.getDate()}</span>
        <span class="day-track"><span class="day-fill" style="width:${day.index}%"></span></span>
        <span class="day-score num">${day.index}</span><span class="day-stage"><span class="lvl lvl-sm ${stage.className}">${faceSvg(stage.className)}</span>${stage.label}</span></div>`;
    }).join('');
  }

  /* ---------- 우리 동네 순위 ---------- */
  function renderRank(d) {
    const lead = $('rankLead');
    if (!lead) return;
    const rank = d.precision && d.precision.ranking;
    // 김해 밖이면 순위를 낼 수 없다. 없는 순위를 지어내지 않는다.
    lead.innerHTML = rank
      ? `<span class="num">${rank.rank}</span><span>번째로 모기가 많아요 · ${rank.total_districts}곳 중</span>`
      : '<span class="dim">김해 지역만 동네별 순위를 제공합니다.</span>';
  }

  /* ---------- 오늘 가기 좋은 공원 ---------- */
  let parkData = null;
  async function loadParks() {
    if (parkData) return parkData;
    try {
      const res = await fetch('./data/gimhae-parks.json');
      if (!res.ok) throw new Error('공원 자료를 받지 못했습니다.');
      parkData = await res.json();
    } catch (error) { console.warn('공원 자료 불러오기 실패', error); parkData = []; }
    return parkData;
  }

  function renderParks(d) {
    const grid = $('parksGrid'), note = $('parksNote');
    if (!grid || !window.ParkPicks) return;
    if (lastOutingScore == null) { grid.innerHTML = '<p class="dim">날씨를 불러오면 공원을 골라드립니다.</p>'; return; }
    loadParks().then((parks) => {
      const picks = window.ParkPicks.pick(parks, lastOutingScore, { from: { lat: d.lat, lng: d.lng }, limit: 3 });
      if (!picks.length) { grid.innerHTML = '<p class="dim">공원 정보를 불러오지 못했습니다.</p>'; return; }
      grid.innerHTML = picks.map((s, i) => {
        const q = encodeURIComponent(`${s.park.name} 김해`);
        // 자유 이용 사진이 있으면 사진, 없으면 그 공원 자리의 지도 조각을 보여 준다 (park-picks.js pictureOf)
        const pic = s.picture || {};
        const img = pic.src
          ? `<span class="pk-img${pic.isMap ? ' is-map' : ''}"><img src="${pic.src}" alt="${pic.isMap ? `${s.park.name} 위치 지도` : `${s.park.name} 사진`}" loading="lazy" style="object-position:${pic.fx}% ${pic.fy}%">${pic.isMap ? '<i class="pk-pin" aria-hidden="true"></i>' : ''}${s.park.credit ? `<small class="pk-credit">${s.park.credit}</small>` : ''}</span>`
          : '';
        return `<a href="https://www.openstreetmap.org/?mlat=${s.park.lat}&mlon=${s.park.lon}#map=17/${s.park.lat}/${s.park.lon}" target="_blank" rel="noopener" aria-label="${s.park.name} 지도 열기 (새 창)">
          ${img}<span class="pk-txt"><span class="r">${i + 1}위 · ${s.park.district}</span><span class="nm">${s.park.name}</span><span class="m">${s.reason}</span></span></a>`;
      }).join('');
      if (note) note.textContent = '공원별 모기 실측값은 없으며, 공원 유형과 동네 자료로 계산한 참고값입니다. 공원을 누르면 지도가 열립니다.';
    });
  }
}());
