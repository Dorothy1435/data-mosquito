/* =============================================================
   나들이 지수 — 오늘 밖에 나가기 얼마나 좋은지 0~100점으로 계산한다.
   -------------------------------------------------------------
   모기지수가 '모기가 얼마나 많은가'라면,
   나들이 지수는 '지금 나가면 얼마나 쾌적한가'를 본다.
   점수가 높을수록 나가기 좋다. (모기지수와 반대 방향)

   보는 요소는 5가지다.
     기온    · 너무 덥거나 추우면 감점
     비      · 비가 오거나 올 가능성이 높으면 감점
     모기    · 모기지수가 높으면 감점
     자외선  · 강하면 감점
     바람    · 너무 세면 감점

   주의: 이 값은 공공기관이 발표하는 공식 지수가 아니라
   이 사이트가 날씨 데이터로 직접 계산한 참고용 예상값이다.
   화면에 반드시 '자체 산출'임을 함께 표시한다.

   외부 의존성 없음. window.OutingIndex 로 사용한다.
   ============================================================= */

(function (global) {
  'use strict';

  // 각 요소를 얼마나 중요하게 볼지 정한 가중치 (합계 1.0)
  const WEIGHTS = {
    temperature: 0.26,
    rain: 0.24,
    mosquito: 0.30,
    uv: 0.12,
    wind: 0.08,
  };

  // 가중평균만 쓰면 한 요소가 아주 나빠도 나머지가 덮어버린다.
  // (예: 비가 쏟아지는데 기온·바람이 좋아서 '좋음'으로 나오는 문제)
  // 그래서 '이 조건이면 아무리 좋아도 이 점수를 넘을 수 없다'는 상한을 둔다.
  const CAPS = [
    { when: (p, i) => (Number(i.rainMm) || 0) >= 1, limit: 28, why: '비가 오는 중' },
    { when: (p, i) => (Number(i.rainMm) || 0) >= 0.1, limit: 45, why: '비가 조금 옴' },
    { when: (p, i) => i.rainProbability >= 70, limit: 52, why: '비 올 가능성 높음' },
    { when: (p) => p.temperature <= 0.3, limit: 42, why: '기온이 너무 덥거나 추움' },
    { when: (p) => p.uv <= 0.45, limit: 58, why: '자외선이 매우 강함' },
    { when: (p) => p.mosquito <= 0.12, limit: 50, why: '모기가 매우 많음' },
    { when: (p) => p.wind <= 0.35, limit: 55, why: '바람이 매우 강함' },
  ];

  // 나들이 지수 4단계. 모기지수(5단계)와 헷갈리지 않도록 이름을 다르게 썼다.
  const GRADES = [
    { min: 80, label: '매우 좋음', className: 'outing-best', color: '#b5f2df' },
    { min: 60, label: '좋음', className: 'outing-good', color: '#7fe3c4' },
    { min: 40, label: '보통', className: 'outing-soso', color: '#f2c94c' },
    { min: 0, label: '나쁨', className: 'outing-bad', color: '#b7c0cf' },
  ];

  // 값을 최소~최대 사이로 자른다.
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /* ---------- 요소별 점수 (모두 0~1, 1이 가장 좋음) ---------- */

  // 기온: 18~26℃ 를 가장 쾌적하게 보고, 멀어질수록 점수가 떨어진다.
  function scoreTemperature(celsius) {
    if (celsius == null || Number.isNaN(celsius)) return 0.5;
    if (celsius >= 18 && celsius <= 26) return 1;
    // 쾌적 구간에서 몇 도 벗어났는지
    const gap = celsius < 18 ? 18 - celsius : celsius - 26;
    // 1도 벗어날 때마다 0.09점씩 깎는다. (11도 벗어나면 0점)
    return clamp(1 - gap * 0.09, 0, 1);
  }

  // 비: 지금 내리는 양과 올 가능성을 함께 본다.
  function scoreRain(rainMm, rainProbability) {
    const mm = Number(rainMm) || 0;
    // 이미 비가 오는 중이면 크게 감점
    if (mm >= 1) return 0;
    if (mm >= 0.1) return 0.25;

    const prob = rainProbability == null ? 0 : Number(rainProbability);
    if (prob >= 70) return 0.35;
    if (prob >= 40) return 0.6;
    if (prob >= 20) return 0.85;
    return 1;
  }

  // 모기: 모기지수가 높을수록 나들이엔 나쁘다.
  // 단순히 뒤집지 않고 모기지수 5단계에 맞춰 단을 둔다.
  // '위험' 단계부터는 체감상 확 나빠지므로 점수를 크게 떨어뜨린다.
  function scoreMosquito(mosquitoIndex) {
    if (mosquitoIndex == null || Number.isNaN(mosquitoIndex)) return 0.5;
    const m = clamp(mosquitoIndex, 0, 100);
    if (m <= 20) return 1;      // 매우 양호
    if (m <= 40) return 0.80;   // 양호
    if (m <= 60) return 0.55;   // 보통
    if (m <= 80) return 0.28;   // 위험
    return 0.08;                // 매우 위험
  }

  // 자외선: 기상청 UV 단계 기준으로 나눈다.
  function scoreUv(uvIndex) {
    if (uvIndex == null || Number.isNaN(uvIndex)) return 0.7;
    if (uvIndex < 3) return 1;      // 낮음
    if (uvIndex < 6) return 0.85;   // 보통
    if (uvIndex < 8) return 0.65;   // 높음
    if (uvIndex < 11) return 0.45;  // 매우 높음
    return 0.3;                     // 위험
  }

  // 바람: 산들바람은 오히려 좋고, 너무 세면 감점.
  function scoreWind(windSpeedMs) {
    const wind = Number(windSpeedMs);
    if (wind == null || Number.isNaN(wind)) return 0.85;
    if (wind <= 4) return 1;
    if (wind <= 7) return 0.8;
    if (wind <= 10) return 0.55;
    return 0.3;
  }

  /* ---------- 점수를 등급으로 ---------- */
  function gradeOf(score) {
    return GRADES.find((g) => score >= g.min) || GRADES[GRADES.length - 1];
  }

  /* ---------- 한 시점의 나들이 지수 ---------- */
  function compute(input) {
    const source = input || {};

    // 기온과 모기지수는 이 지수의 핵심이다. 둘 중 하나라도 없으면
    // 점수를 만들어내지 않고 '정보 없음'으로 돌려준다.
    // (데이터가 없는 것을 '좋음'처럼 보이게 하면 안 된다.)
    const hasTemperature = source.temperature != null && !Number.isNaN(Number(source.temperature));
    const hasMosquito = source.mosquitoIndex != null && !Number.isNaN(Number(source.mosquitoIndex));
    if (!hasTemperature || !hasMosquito) {
      return {
        available: false,
        score: null,
        grade: { label: '정보 없음', className: 'outing-none', color: '#8d99ad' },
        parts: null,
        capReason: null,
        conditions: describeConditions(source),
      };
    }

    return computeScore(source);
  }

  function computeScore(input) {
    const parts = {
      temperature: scoreTemperature(input.temperature),
      rain: scoreRain(input.rainMm, input.rainProbability),
      mosquito: scoreMosquito(input.mosquitoIndex),
      uv: scoreUv(input.uvIndex),
      wind: scoreWind(input.windSpeed),
    };

    let total = 0;
    Object.keys(WEIGHTS).forEach((key) => {
      total += parts[key] * WEIGHTS[key];
    });

    let score = Math.round(clamp(total * 100, 0, 100));

    // 치명적인 조건이 하나라도 있으면 점수에 상한을 씌운다.
    // 가장 낮은 상한을 적용하고, 그 이유도 함께 돌려준다.
    let capReason = null;
    CAPS.forEach((cap) => {
      if (cap.when(parts, input) && score > cap.limit) {
        score = cap.limit;
        capReason = cap.why;
      }
    });

    const grade = gradeOf(score);

    return { available: true, score, grade, parts, capReason, conditions: describeConditions(input) };
  }

  /* ---------- 화면 오른쪽 '오늘 나들이 조건' 4줄 ---------- */
  // 숫자 대신 사람이 읽을 문장으로 바꿔 준다.
  function describeConditions(input) {
    const rows = [];
    const t = input.temperature;
    const mm = Number(input.rainMm) || 0;
    const prob = input.rainProbability;
    const uv = input.uvIndex;
    const mosquito = input.mosquitoIndex;

    // 기온
    if (t == null) {
      rows.push({ icon: '🌡️', name: '기온', text: '정보 없음', tone: 'dim' });
    } else if (t >= 18 && t <= 26) {
      rows.push({ icon: '🌡️', name: '기온', text: `적당해요 · ${Math.round(t)}°`, tone: 'good' });
    } else if (t > 26) {
      rows.push({ icon: '🌡️', name: '기온', text: `더워요 · ${Math.round(t)}°`, tone: t > 31 ? 'bad' : 'warn' });
    } else {
      rows.push({ icon: '🌡️', name: '기온', text: `쌀쌀해요 · ${Math.round(t)}°`, tone: t < 8 ? 'bad' : 'warn' });
    }

    // 비
    if (mm >= 0.1) {
      rows.push({ icon: '🌧️', name: '비', text: '지금 오고 있어요', tone: 'bad' });
    } else if (prob != null && prob >= 60) {
      rows.push({ icon: '🌧️', name: '비', text: `올 수 있어요 · ${Math.round(prob)}%`, tone: 'warn' });
    } else if (prob != null && prob >= 30) {
      rows.push({ icon: '🌧️', name: '비', text: `조금 흐려요 · ${Math.round(prob)}%`, tone: 'warn' });
    } else {
      rows.push({ icon: '🌧️', name: '비', text: '걱정 없어요', tone: 'good' });
    }

    // 자외선
    if (uv == null) {
      rows.push({ icon: '☀️', name: '자외선', text: '정보 없음', tone: 'dim' });
    } else if (uv < 3) {
      rows.push({ icon: '☀️', name: '자외선', text: '낮아요', tone: 'good' });
    } else if (uv < 6) {
      rows.push({ icon: '☀️', name: '자외선', text: '보통 · 모자 챙기기', tone: 'warn' });
    } else if (uv < 8) {
      rows.push({ icon: '☀️', name: '자외선', text: '높아요 · 선크림 필수', tone: 'warn' });
    } else {
      rows.push({ icon: '☀️', name: '자외선', text: '매우 높아요 · 한낮 피하기', tone: 'bad' });
    }

    // 모기
    if (mosquito == null) {
      rows.push({ icon: '🦟', name: '모기', text: '정보 없음', tone: 'dim' });
    } else if (input.peakHourText) {
      // 시간대별 예보가 있으면 '언제부터 많은지'를 알려 준다.
      rows.push({
        icon: '🦟', name: '모기', text: input.peakHourText,
        tone: mosquito >= 61 ? 'bad' : (mosquito >= 41 ? 'warn' : 'good'),
      });
    } else if (mosquito >= 61) {
      rows.push({ icon: '🦟', name: '모기', text: '많은 편이에요', tone: 'bad' });
    } else if (mosquito >= 41) {
      rows.push({ icon: '🦟', name: '모기', text: '보통이에요', tone: 'warn' });
    } else {
      rows.push({ icon: '🦟', name: '모기', text: '적은 편이에요', tone: 'good' });
    }

    return rows;
  }

  /* ---------- 시간대별 나들이 지수 ---------- */
  // hours 는 '지금'부터 시간 순서대로 들어온 예보 배열이다.
  // 시계바늘 기준(6시·8시…)으로 고르면 지금이 늦은 오후일 때
  // '내일 오전'이 뽑혀 오늘 일정처럼 보이는 문제가 생긴다.
  // 그래서 순서대로 건너뛰며 고르고, 각 칸이 몇 시간 뒤인지도 함께 남긴다.
  function computeSeries(hours, options) {
    const opts = options || {};
    const step = opts.step == null ? 2 : opts.step;
    const max = opts.max == null ? 9 : opts.max;
    const list = hours || [];

    const series = [];
    for (let i = 0; i < list.length && series.length < max; i += step) {
      const source = list[i];
      if (!source) continue;
      const result = compute(source);
      // 점수를 못 낸 시간대는 막대를 그리지 않고 건너뛴다.
      if (!result.available) continue;
      series.push({
        hour: Number(source.hour),
        hoursAhead: i,            // 지금으로부터 몇 시간 뒤인지
        isToday: i === 0 ? true : source.isToday !== false,
        score: result.score,
        grade: result.grade,
      });
    }
    return series;
  }

  /* ---------- 가장 나가기 좋은 시간대 찾기 ---------- */
  // 연달아 붙어 있는 두 칸 중 평균이 가장 높은 구간을 고른다.
  function findBestWindow(series) {
    if (!series || series.length === 0) return null;
    if (series.length === 1) {
      return {
        from: series[0].hour, to: series[0].hour,
        score: series[0].score, tomorrow: !series[0].isToday,
      };
    }

    let best = null;
    for (let i = 0; i < series.length - 1; i += 1) {
      const avg = (series[i].score + series[i + 1].score) / 2;
      if (!best || avg > best.score) {
        best = {
          from: series[i].hour,
          to: series[i + 1].hour,
          score: Math.round(avg),
          // 오늘이 아니면 '내일'이라고 분명히 밝힌다.
          tomorrow: series[i].isToday === false,
        };
      }
    }
    return best;
  }

  // '오전 10–12시' 처럼 읽기 쉬운 문장으로 바꾼다.
  function formatWindow(window) {
    if (!window) return null;
    const day = window.tomorrow ? '내일 ' : '';
    const label = (h) => {
      if (h === 0) return '밤 12시';
      if (h === 12) return '낮 12시';
      if (h < 12) return `오전 ${h}시`;
      return `오후 ${h - 12}시`;
    };
    if (window.from === window.to) return day + label(window.from);
    return `${day}${label(window.from)}–${label(window.to)}`;
  }

  /* ---------- 한 줄 요약 문장 ---------- */
  // 홈 화면 칩과 예보 카드에서 같이 쓴다.
  function buildAdvice(score, bestWindow, mosquitoPeakText) {
    const window = formatWindow(bestWindow);
    const lines = [];

    if (score >= 80) lines.push('오늘은 나가기 아주 좋아요.');
    else if (score >= 60) lines.push(window ? `${window}에 나가면 딱 좋아요.` : '나들이하기 괜찮은 날이에요.');
    else if (score >= 40) lines.push('나쁘진 않지만 준비물을 챙기세요.');
    else lines.push('오늘은 실내가 더 편할 수 있어요.');

    if (mosquitoPeakText) lines.push(mosquitoPeakText);
    return lines;
  }

  const api = {
    WEIGHTS,
    GRADES,
    compute,
    computeSeries,
    gradeOf,
    findBestWindow,
    formatWindow,
    buildAdvice,
  };

  global.OutingIndex = api;
}(typeof window !== 'undefined' ? window : globalThis));
