/*
 * 김해시 모기 발생 위험도 모델 (브라우저용 JavaScript 포팅)
 * ============================================================
 * 원본: mosquito_model_portable.py (표준 라이브러리만 사용하는 자체 완결형 모델)
 *
 * 김해시 17개 읍·면·동의 행정 데이터(발생원 시설 수 + 2025년 방역민원 + 위험지수)를
 * 내장하고 있으며, 날씨(기온·습도·최근 3일 강수량)를 입력하면 다음 정보를 한 번에 돌려줍니다.
 *   - 모기지수(0~100) / 등급 / 단계 / 색상 / 요약문
 *   - 기상 분석(기온·습도·강수 적합도 분해)
 *   - 발생원 분석(시설 유형별 위험 기여율)
 *   - 김해시 내 지역 순위 / 시평균 대비
 *   - 2025년 방역민원 이력
 *   - 시민 / 방제당국 행동요령, 모기 활동시간대, 추천 기피제
 *
 * 외부 의존성이 없어 이 파일 하나만 불러오면 window.GimhaeMosquitoModel 로 사용할 수 있습니다.
 * Python 원본과 계산식·가중치·데이터가 동일하도록 그대로 옮겼습니다.
 */
(function (global) {
  'use strict';

const SRC_KOR = {
  "septic_sewage": "정화조/오수",
  "livestock_farm": "축산농가",
  "reservoir": "저수지",
  "tire_shop": "타이어가게",
  "waste_recycle": "폐기물재활용",
  "waste_treat": "폐기물처리",
  "water_feature": "수경시설",
  "public_toilet": "공중화장실"
};

const RISK_W = {
  "septic_sewage": 3.0,
  "livestock_farm": 2.0,
  "reservoir": 2.5,
  "tire_shop": 2.0,
  "waste_recycle": 1.5,
  "waste_treat": 1.0,
  "water_feature": 1.5,
  "public_toilet": 0.5
};

const SEASON = {
  "1": [
    3,
    50,
    5
  ],
  "2": [
    5,
    50,
    5
  ],
  "3": [
    10,
    55,
    10
  ],
  "4": [
    16,
    60,
    15
  ],
  "5": [
    21,
    65,
    20
  ],
  "6": [
    25,
    75,
    40
  ],
  "7": [
    28,
    82,
    60
  ],
  "8": [
    29,
    80,
    50
  ],
  "9": [
    24,
    75,
    30
  ],
  "10": [
    18,
    65,
    15
  ],
  "11": [
    11,
    60,
    10
  ],
  "12": [
    5,
    52,
    5
  ]
};

const DISTRICTS = {
  "활천동": {
    "control_priority": 100.0,
    "risk_index": 38.5,
    "complaints": 37,
    "sources": {
      "septic_sewage": 427,
      "livestock_farm": 1,
      "reservoir": 0,
      "tire_shop": 16,
      "waste_recycle": 3,
      "waste_treat": 2,
      "water_feature": 10,
      "public_toilet": 69
    }
  },
  "한림면": {
    "control_priority": 83.1,
    "risk_index": 100.0,
    "complaints": 0,
    "sources": {
      "septic_sewage": 2384,
      "livestock_farm": 380,
      "reservoir": 22,
      "tire_shop": 2,
      "waste_recycle": 140,
      "waste_treat": 160,
      "water_feature": 0,
      "public_toilet": 35
    }
  },
  "상동면": {
    "control_priority": 74.8,
    "risk_index": 43.6,
    "complaints": 21,
    "sources": {
      "septic_sewage": 1286,
      "livestock_farm": 31,
      "reservoir": 12,
      "tire_shop": 8,
      "waste_recycle": 38,
      "waste_treat": 45,
      "water_feature": 0,
      "public_toilet": 19
    }
  },
  "주촌면": {
    "control_priority": 73.6,
    "risk_index": 37.7,
    "complaints": 23,
    "sources": {
      "septic_sewage": 492,
      "livestock_farm": 25,
      "reservoir": 19,
      "tire_shop": 5,
      "waste_recycle": 42,
      "waste_treat": 42,
      "water_feature": 0,
      "public_toilet": 27
    }
  },
  "북부동": {
    "control_priority": 69.4,
    "risk_index": 32.6,
    "complaints": 23,
    "sources": {
      "septic_sewage": 248,
      "livestock_farm": 11,
      "reservoir": 0,
      "tire_shop": 13,
      "waste_recycle": 7,
      "waste_treat": 5,
      "water_feature": 8,
      "public_toilet": 90
    }
  },
  "생림면": {
    "control_priority": 52.8,
    "risk_index": 43.6,
    "complaints": 9,
    "sources": {
      "septic_sewage": 1120,
      "livestock_farm": 175,
      "reservoir": 9,
      "tire_shop": 1,
      "waste_recycle": 58,
      "waste_treat": 69,
      "water_feature": 0,
      "public_toilet": 26
    }
  },
  "대동면": {
    "control_priority": 50.4,
    "risk_index": 20.8,
    "complaints": 18,
    "sources": {
      "septic_sewage": 864,
      "livestock_farm": 27,
      "reservoir": 9,
      "tire_shop": 0,
      "waste_recycle": 2,
      "waste_treat": 7,
      "water_feature": 0,
      "public_toilet": 18
    }
  },
  "진영읍": {
    "control_priority": 46.6,
    "risk_index": 56.1,
    "complaints": 0,
    "sources": {
      "septic_sewage": 1064,
      "livestock_farm": 46,
      "reservoir": 13,
      "tire_shop": 21,
      "waste_recycle": 28,
      "waste_treat": 35,
      "water_feature": 0,
      "public_toilet": 65
    }
  },
  "부원동": {
    "control_priority": 46.3,
    "risk_index": 4.9,
    "complaints": 23,
    "sources": {
      "septic_sewage": 242,
      "livestock_farm": 0,
      "reservoir": 0,
      "tire_shop": 1,
      "waste_recycle": 0,
      "waste_treat": 0,
      "water_feature": 1,
      "public_toilet": 29
    }
  },
  "내외동": {
    "control_priority": 39.5,
    "risk_index": 14.4,
    "complaints": 15,
    "sources": {
      "septic_sewage": 170,
      "livestock_farm": 0,
      "reservoir": 0,
      "tire_shop": 6,
      "waste_recycle": 1,
      "waste_treat": 0,
      "water_feature": 4,
      "public_toilet": 44
    }
  },
  "진례면": {
    "control_priority": 38.6,
    "risk_index": 46.4,
    "complaints": 0,
    "sources": {
      "septic_sewage": 649,
      "livestock_farm": 40,
      "reservoir": 26,
      "tire_shop": 4,
      "waste_recycle": 37,
      "waste_treat": 46,
      "water_feature": 0,
      "public_toilet": 30
    }
  },
  "장유": {
    "control_priority": 20.3,
    "risk_index": 24.4,
    "complaints": 0,
    "sources": {
      "septic_sewage": 142,
      "livestock_farm": 8,
      "reservoir": 0,
      "tire_shop": 10,
      "waste_recycle": 1,
      "waste_treat": 1,
      "water_feature": 7,
      "public_toilet": 68
    }
  },
  "회현동": {
    "control_priority": 19.6,
    "risk_index": 3.7,
    "complaints": 9,
    "sources": {
      "septic_sewage": 122,
      "livestock_farm": 0,
      "reservoir": 0,
      "tire_shop": 1,
      "waste_recycle": 0,
      "waste_treat": 0,
      "water_feature": 2,
      "public_toilet": 8
    }
  },
  "불암동": {
    "control_priority": 11.8,
    "risk_index": 0.9,
    "complaints": 6,
    "sources": {
      "septic_sewage": 74,
      "livestock_farm": 1,
      "reservoir": 0,
      "tire_shop": 2,
      "waste_recycle": 0,
      "waste_treat": 0,
      "water_feature": 0,
      "public_toilet": 5
    }
  },
  "동상동": {
    "control_priority": 11.0,
    "risk_index": 0.0,
    "complaints": 6,
    "sources": {
      "septic_sewage": 107,
      "livestock_farm": 0,
      "reservoir": 0,
      "tire_shop": 0,
      "waste_recycle": 0,
      "waste_treat": 0,
      "water_feature": 0,
      "public_toilet": 17
    }
  },
  "칠산서부동": {
    "control_priority": 10.3,
    "risk_index": 5.7,
    "complaints": 3,
    "sources": {
      "septic_sewage": 44,
      "livestock_farm": 0,
      "reservoir": 0,
      "tire_shop": 7,
      "waste_recycle": 0,
      "waste_treat": 0,
      "water_feature": 0,
      "public_toilet": 12
    }
  },
  "화목동": {
    "control_priority": 8.8,
    "risk_index": 3.9,
    "complaints": 3,
    "sources": {
      "septic_sewage": 144,
      "livestock_farm": 16,
      "reservoir": 0,
      "tire_shop": 2,
      "waste_recycle": 0,
      "waste_treat": 0,
      "water_feature": 1,
      "public_toilet": 1
    }
  }
};
  // --- (A) 유충 실태조사 결과: [조사건수, 양성건수]. 실제 모기 번식의 직접 증거 ---
  // 진영읍/진례면/한림면/장유는 조사 데이터가 없어([0,0]) 발생원 기반으로만 추정한다.
  const LARVA = {
    "활천동": [212, 87], "한림면": [0, 0], "진영읍": [0, 0], "진례면": [0, 0],
    "상동면": [107, 75], "생림면": [158, 138], "주촌면": [112, 87], "북부동": [46, 23],
    "대동면": [83, 68], "내외동": [74, 20], "부원동": [146, 41], "회현동": [23, 10],
    "불암동": [10, 5], "동상동": [36, 11], "칠산서부동": [4, 1], "화목동": [11, 6],
    "장유": [0, 0]
  };
  // 유충 조사 결과를 각 구역 데이터에 붙인다.
  Object.entries(LARVA).forEach(([name, pair]) => {
    if (DISTRICTS[name]) {
      DISTRICTS[name].larva_surveyed = pair[0];
      DISTRICTS[name].larva_positive = pair[1];
    }
  });

  // --- (v3 인구=노출도) 2026.6 주민등록 인구(외국인 제외). '누가 얼마나 물리나'를 보정 ---
  // 모델 구역 기준 통합: 활천동 = 활천동+삼안동(행정동 병합), 장유 = 장유1·2·3동 합산.
  // 화목동은 행정동 인구표에 없는 법정동 → 근사 추정값(★). POP_ESTIMATED로 표기.
  const POPULATION = {
    "활천동": 70234, "한림면": 6310, "상동면": 2852, "주촌면": 21646, "북부동": 80471,
    "생림면": 3294, "대동면": 4848, "진영읍": 52201, "부원동": 8722, "내외동": 66323,
    "진례면": 5370, "장유": 179538, "회현동": 7917, "불암동": 6393, "동상동": 8231,
    "칠산서부동": 8427, "화목동": 3000
  };
  const POP_ESTIMATED = new Set(["화목동"]); // 행정동 인구표 미수록 → 근사 추정(신뢰도↓)

  // 인구를 로그 정규화해 노출도(0.15~1.0)를 만든다. 인구가 많을수록 물릴 사람이 많다.
  const LOGP = {};
  Object.keys(DISTRICTS).forEach((d) => { LOGP[d] = Math.log(POPULATION[d]); });
  const LGMIN = Math.min(...Object.values(LOGP));
  const LGMAX = Math.max(...Object.values(LOGP));
  function exposureOf(district) {
    return 0.15 + 0.85 * (LOGP[district] - LGMIN) / (LGMAX - LGMIN);
  }
  // 보건소 현장 유충조사·민원이 미제공(결측)인 구역: 민원 0/조사 0을 '안전'이 아니라
  // '결측'으로 취급 → 위험은 인구·발생원으로 추정하고 신뢰도는 낮게 표기한다.
  const DATA_GAP = new Set();
  Object.keys(DISTRICTS).forEach((d) => {
    DISTRICTS[d].population = POPULATION[d];
    DISTRICTS[d].exposure = roundTo(exposureOf(d), 3);
    if ((DISTRICTS[d].larva_surveyed || 0) === 0) DATA_GAP.add(d);
    DISTRICTS[d].data_gap = DATA_GAP.has(d);
  });

  // 각 발생원 시설의 김해시 전체 최댓값 (정규화 기준)
  const MAXS = {};
  Object.keys(SRC_KOR).forEach((key) => {
    MAXS[key] = Math.max(0, ...Object.values(DISTRICTS).map((d) => d.sources[key] || 0));
  });

  // === (v3) 산식 보정 상수 ===
  // 발생원 배율: 지역위험(geo)이 0이어도 날씨최대치의 35%는 나오고, geo=1이면 최대 100%.
  //   파이썬 원본(mosquito_model_portable.py)과 동일: 100 × 날씨 × (0.35 + 0.65 × geo).
  //   ※ 인구 과대평가 교정은 이제 geo 자체(√(발생잠재력×인구))가 담당한다.
  const GEO_FLOOR = 0.35;
  const GEO_WEIGHT = 0.65;

  // 파이썬 round()와 동일하게 "반올림(소수 자리)"을 맞추기 위한 도우미
  function roundTo(value, digits) {
    const factor = Math.pow(10, digits);
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  // 파이썬 str(float) 표기를 흉내낸다. (예: 100.0 → "100.0", 83.6 → "83.6")
  // 자바스크립트는 정수형 실수에서 ".0"을 떼어버리므로, 안내 문구가 원본과 같도록 맞춘다.
  function pyNum(value, decimals) {
    let s = Number(value).toFixed(decimals);
    if (s.indexOf('.') !== -1) {
      s = s.replace(/0+$/, '');
      if (s.endsWith('.')) {
        s += '0';
      }
    }
    return s;
  }

  function clamp(value, lo = 0, hi = 1) {
    return Math.max(lo, Math.min(hi, value));
  }

  // 기온 적합도: 27℃ 부근에서 가장 높고, 저온/폭염에서 급감
  function tempSuit(t) {
    let v;
    if (t <= 10 || t >= 42) {
      v = 0.0;
    } else {
      v = Math.exp(-(((t - 27.0) / 7.5) ** 2));
      if (t < 14) {
        v *= Math.max(0.0, (t - 10) / 4.0);
      }
    }
    v = clamp(v);

    let s;
    if (t < 13) s = '저온 — 모기 활동 거의 정지';
    else if (t < 18) s = '다소 낮음 — 활동 저조';
    else if (t <= 30) s = '최적 — 번식·흡혈 활발';
    else if (t <= 34) s = '고온 — 활동 다소 둔화';
    else s = '폭염 — 활동 급감';

    return [roundTo(v, 3), s];
  }

  // 습도 적합도: 높을수록 모기 활동에 유리
  function humSuit(h) {
    const v = clamp((h - 40) / 50.0);
    let s;
    if (h < 50) s = '건조 — 모기 활동 억제';
    else if (h < 70) s = '보통 — 활동 가능';
    else s = '다습 — 활동 매우 활발';
    return [roundTo(v, 3), s];
  }

  // 강수 적합도: 적당한 비는 산란처를 늘리고, 폭우는 유충을 유실시킴
  function rainSuit(r) {
    let v;
    let s;
    if (r <= 0) {
      v = 0.5;
      s = '강수 없음 — 기존 고인물 위주';
    } else if (r < 30) {
      v = 0.6 + 0.4 * (r / 30.0);
      s = '적당한 비 — 고인물 증가로 산란처 확대';
    } else if (r < 80) {
      v = 1.0 - 0.3 * ((r - 30) / 50.0);
      s = '많은 비 — 일부 유충 유실';
    } else {
      v = 0.5;
      s = '폭우 — 유충 다수 유실(일시적 감소)';
    }
    return [roundTo(clamp(v, 0.3, 1.0), 3), s];
  }

  // 시간대 적합도: 모기(주로 빨간집모기·숲모기)는 일몰 직후와 새벽에 가장 활발하고
  // 한낮·심야에는 활동이 저조하다. 0~1 값으로 시각별 활동 강도를 표현한다.
  // 0시부터 23시까지 24개 값. (피크 1.0, 한낮·심야 약 0.5)
  const HOUR_ACTIVITY = [
    0.55, 0.50, 0.50, 0.55, 0.80, 0.95, // 0~5시 (4~5시 새벽 피크 시작)
    0.90, 0.70, 0.60, 0.55, 0.50, 0.50, // 6~11시 (아침→한낮 하강)
    0.50, 0.50, 0.50, 0.50, 0.55, 0.65, // 12~17시 (한낮 저조)
    0.85, 1.00, 1.00, 0.95, 0.85, 0.70, // 18~23시 (일몰 직후 피크)
  ];
  function timeSuit(hour) {
    const raw = HOUR_ACTIVITY[((Math.floor(hour) % 24) + 24) % 24];
    let s;
    if (raw >= 0.85) s = '활동 피크 — 일몰 직후·새벽';
    else if (raw <= 0.55) s = '활동 저조 — 한낮·심야';
    else s = '활동 보통 시간대';
    return [roundTo(raw, 3), s];
  }

  // 풍속 적합도: 바람이 강하면 모기가 비행을 못 해 흡혈 활동이 줄어든다.
  // 약 2m/s 이하는 영향이 거의 없고, 6m/s 이상은 활동이 크게 억제된다.
  function windSuit(windMs) {
    if (windMs == null) return [1.0, '풍속 정보 없음'];
    let v;
    let s;
    if (windMs <= 2) {
      v = 1.0;
      s = '미풍 — 활동에 영향 적음';
    } else if (windMs <= 6) {
      v = 1.0 - 0.4 * ((windMs - 2) / 4.0);
      s = '바람 — 비행 다소 억제';
    } else {
      v = 0.6;
      s = '강풍 — 비행 억제';
    }
    return [roundTo(v, 3), s];
  }

  // 현재 강수 적합도: 지금 비가 내리는 중이면 모기가 날지 못해 활동이 일시적으로 줄어든다.
  // (비가 그친 뒤에는 산란처가 늘어 오히려 증가하는데, 그 효과는 '최근 3일 강수'가 담당한다)
  function rainNowSuit(precipNow) {
    if (precipNow == null) return [1.0, '실시간 강수 정보 없음'];
    let v;
    let s;
    if (precipNow <= 0.1) {
      v = 1.0;
      s = '현재 비 없음';
    } else if (precipNow < 1.0) {
      v = 0.85;
      s = '약한 비 — 활동 다소 감소';
    } else {
      v = 0.65;
      s = '비 내리는 중 — 활동 감소';
    }
    return [roundTo(v, 3), s];
  }

  // 현재 활동 보정값(0.45~1.0): 번식 환경과 별개로, '지금 이 순간' 모기가
  // 실제로 날아다니며 흡혈할 수 있는지를 시간대·풍속·현재강수로 보정한다.
  // 값이 없으면(평년값 모드 등) 1.0이 되어 기존 계산과 동일하게 동작한다.
  function behaviorFactor(opts) {
    if (!opts) return 1.0;
    // 시간대 효과는 너무 과하지 않게 0.6~1.0 범위로 완화해서 적용한다.
    const tm = opts.hour == null ? 1.0 : (0.6 + 0.4 * timeSuit(opts.hour)[0]);
    const wm = windSuit(opts.wind_ms == null ? null : opts.wind_ms)[0];
    const rm = rainNowSuit(opts.precip_now == null ? null : opts.precip_now)[0];
    return clamp(tm * wm * rm, 0.45, 1.0);
  }

  // 날씨 종합 활동지수(0~1): 기온이 기본, 습도·강수가 환경 보정,
  // 시간대·풍속·현재강수가 '현재 활동 가능성'을 추가로 보정한다.
  function weatherActivity(tempC, humidity, rain3dMm, opts) {
    const t = tempSuit(tempC)[0];
    const h = humSuit(humidity)[0];
    const r = rainSuit(rain3dMm)[0];
    const env = 0.6 * h + 0.4 * r;
    const base = clamp(t * (0.5 + 0.5 * env));
    return clamp(base * behaviorFactor(opts));
  }

  // 모기지수 → 4단계 등급(번호, 이름, 색상)
  function grade(index) {
    if (index < 25) return [1, '쾌적', '#3b82f6'];
    if (index < 50) return [2, '관심', '#22c55e'];
    if (index < 75) return [3, '주의', '#f59e0b'];
    return [4, '불쾌', '#ef4444'];
  }

  // 구역 내 발생원별 위험 기여율 분해 (큰 순서대로, 0개인 시설은 제외)
  function sourceBreakdown(rec) {
    const contrib = {};
    Object.entries(rec.sources).forEach(([key, cnt]) => {
      const mx = MAXS[key] || 0;
      contrib[key] = (mx > 0 ? cnt / mx : 0.0) * (RISK_W[key] || 1.0);
    });

    const total = Object.values(contrib).reduce((sum, v) => sum + v, 0) || 1.0;
    const rows = [];
    Object.keys(contrib)
      .sort((a, b) => contrib[b] - contrib[a])
      .forEach((key) => {
        if ((rec.sources[key] || 0) > 0) {
          rows.push({
            source: SRC_KOR[key],
            count: rec.sources[key],
            risk_contribution_pct: roundTo((100 * contrib[key]) / total, 1),
          });
        }
      });
    return rows;
  }

  // 시민 행동요령 (등급 + 주요 발생원 기준)
  function citizenAdvice(level, topSourceName) {
    const base = {
      1: ['특별한 조치가 필요 없습니다.'],
      2: ['야간 외출 시 가벼운 기피제를 사용하세요.', '집 주변 화분받침·빈 용기의 고인물을 비우세요.'],
      3: ['방충망·기피제를 사용하고 야간 활동을 줄이세요.', '집 주변 정화조·하수구 뚜껑 주변을 점검하세요.', '고인물 용기를 뒤집어 두세요.'],
      4: ['야외활동을 자제하고 긴팔·긴바지를 착용하세요.', '농도 높은 기피제(DEET·이카리딘)를 사용하세요.', '집 안팎 모든 고인물을 즉시 제거하세요.'],
    }[level];

    const tips = {
      '정화조/오수': '하수구·정화조 환기구 주변에 모기가 모일 수 있습니다.',
      '타이어가게': '야적된 폐타이어에 빗물이 고이지 않게 관리가 필요합니다.',
      '수경시설': '분수·바닥분수 등 정체수 주변을 피하세요.',
      '축산농가': '축사 주변 분뇨·물웅덩이에서 모기가 다량 발생할 수 있습니다.',
      '저수지': '저수지 가장자리 정체수 구역을 주의하세요.',
      '공중화장실': '공중화장실 주변 정화조에서 유충이 생길 수 있습니다.',
    };
    const tip = tips[topSourceName];
    return tip && level >= 2 ? base.concat([tip]) : base.slice();
  }

  // 방제당국 행동요령 (등급 + 순위 + 민원 + 결측 기준)
  function authorityAdvice(level, rank, total, complaints, dataGap) {
    const a = [];
    if (level >= 3) a.push('취약구역 방역 주기를 단축하고 유문등·포충기 가동을 강화하세요.');
    if (rank <= Math.max(3, Math.floor(total / 5))) {
      a.push('본 구역은 방제 우선순위 상위(' + rank + '/' + total + ')입니다. 정화조·하수구 유충구제(라바사이드)를 선제 시행하세요.');
    }
    if (dataGap) {
      a.push('보건소 현장 유충조사·민원 자료가 없는 결측 구역입니다 — 인구·발생원 기반 추정치이므로, 우선 현장 유충조사를 실시해 데이터를 확보하세요.');
    } else if (complaints === 0 && level >= 3) {
      a.push('발생원은 많으나 민원 기록이 없는 사각지대입니다 — 민원 발생 전 선제 점검을 권장합니다.');
    }
    if (a.length === 0) a.push('정기 방역 주기를 유지하세요.');
    return a;
  }

  // (A) 발생 잠재력(breeding) — 발생원 시설(risk_index)에 '실제 유충 검출률'을 결합한다.
  //     민원은 넣지 않는다(검증 타겟이므로 순환 방지). 표본 많을수록 경험비중↑(최대 60%).
  //     반환: { breeding: 발생잠재력(0~1), weight: 유충 비중, basis, larvaRate }
  function breedingOf(rec) {
    const facility = rec.risk_index / 100.0; // 순수 발생원 시설(0~1, 민원 미포함)
    const surveyed = rec.larva_surveyed || 0;
    const positive = rec.larva_positive || 0;
    const larvaRate = surveyed > 0 ? positive / surveyed : null;
    if (surveyed >= 10) {
      const w = Math.min(1.0, surveyed / 100.0) * 0.6; // 표본 100건이면 경험 비중 60%
      const b = (1 - w) * facility + w * larvaRate;
      return { breeding: clamp(b), weight: w, basis: 'facility+larva', larvaRate };
    }
    // 조사 미실시(서부 결측 등): 발생원 시설만으로 추정
    return { breeding: clamp(facility), weight: 0.0, basis: 'facility_only', larvaRate };
  }

  // (v3 인구 결합) 최종 지역위험 = √(발생잠재력 × 인구노출).
  //   "많이 생기고(breeding) + 많이 물리는(exposure)" 곳이 진짜 위험.
  //   ⇒ 발생원만 많고 인구 적은 농촌(한림 등) 과대평가를 자동 교정.
  //   반환: { geo: 지역위험(0~1), weight, basis, larvaRate, breeding, exposure }
  function geoEffective(rec) {
    const { breeding, weight, basis, larvaRate } = breedingOf(rec);
    const exposure = rec.exposure == null ? 0.15 : rec.exposure;
    const geo = Math.sqrt(breeding * exposure);
    return { geo: clamp(geo), weight, basis, larvaRate, breeding, exposure };
  }

  // ③ 발육 보정 — 최근 ~2주 누적온도(GDD, base 10.5℃)로 '지금 성충이 나올 만큼 따뜻했는가'를 0~1로.
  //    gdd가 없으면 1.0(보정 없음). 봄·가을엔 누적온도가 부족해 활동 적합일이라도 개체수가 적다.
  function devFactor(gdd14d) {
    if (gdd14d == null) return 1.0;
    return clamp((gdd14d - 40.0) / 140.0, 0.2, 1.0);
  }

  // (D) 불확실성 — 날씨 실측 여부 + 유충표본 수 + 인구 추정 여부로 신뢰구간 폭을 정한다.
  //     반환: { uncertainty: 상대 불확실성(0~1), label: 신뢰도 등급 }
  function confidence(weatherObserved, surveyed, popEstimated) {
    const wu = weatherObserved ? 0.06 : 0.22; // 날씨 불확실성(실측 vs 평년값)
    let su;
    if (surveyed >= 100) su = 0.06;
    else if (surveyed >= 30) su = 0.12;
    else if (surveyed >= 1) su = 0.18;
    else su = 0.25; // 유충 조사 없음(서부 결측 등) → 추정 의존
    const pu = popEstimated ? 0.10 : 0.0; // 인구 추정값(화목동 등) 불확실성
    const u = Math.sqrt(wu * wu + su * su + pu * pu); // 결합 상대 불확실성
    const label = u < 0.13 ? '높음' : (u < 0.21 ? '보통' : '낮음');
    return { uncertainty: u, label };
  }

  // 한 구역의 모기지수와 풍부한 분석 정보를 계산한다.
  function mosquitoIndex(district, options = {}) {
    if (!DISTRICTS[district]) {
      throw new Error('unknown district: ' + district);
    }

    const month = options.month == null ? 6 : options.month;
    const season = SEASON[String(month)] || [22, 65, 20];
    const tempC = options.temp_c == null ? season[0] : options.temp_c;
    const humidity = options.humidity == null ? season[1] : options.humidity;
    const rain3dMm = options.rain_3d_mm == null ? season[2] : options.rain_3d_mm;

    // 현재 활동 보정 입력(시간대·풍속·현재강수). 값이 없으면 보정 없음(1.0).
    const behaviorOpts = {
      hour: options.hour == null ? null : options.hour,
      wind_ms: options.wind_ms == null ? null : options.wind_ms,
      precip_now: options.precip_now == null ? null : options.precip_now,
    };

    const [tv, ts] = tempSuit(tempC);
    const [hv, hs] = humSuit(humidity);
    const [rv, rs] = rainSuit(rain3dMm);
    const [wv, ws] = windSuit(behaviorOpts.wind_ms);
    const [nv, ns] = rainNowSuit(behaviorOpts.precip_now);
    const [timeV, timeS] = behaviorOpts.hour == null ? [null, '시간대 정보 없음'] : timeSuit(behaviorOpts.hour);
    const act = weatherActivity(tempC, humidity, rain3dMm, behaviorOpts);
    // ③ 발육 보정(누적온도). gdd_14d가 없으면 1.0(보정 없음).
    const dev = devFactor(options.gdd_14d == null ? null : Number(options.gdd_14d));
    const rec = DISTRICTS[district];
    // (A) 발생원 위험에 유충 검출률을 결합한 '실효 발생원위험'을 사용한다.
    const geoInfo = geoEffective(rec);
    const geo = geoInfo.geo;
    // 지역위험(발생잠재력×인구) × 날씨 × 발육 보정
    const index = roundTo(100 * act * dev * (GEO_FLOOR + GEO_WEIGHT * geo), 1);
    const [lv, nm, col] = grade(index);

    const dataGap = !!rec.data_gap;
    const popEstimated = POP_ESTIMATED.has(district);

    // (D) 신뢰구간: 날씨 실측/직접입력 여부 + 유충 표본 수 + 인구 추정 여부
    // weather_observed 옵션이 없으면 기온이 직접 입력됐는지로 판단한다.
    const weatherObserved = options.weather_observed != null
      ? !!options.weather_observed
      : (options.temp_c != null);
    const conf = confidence(weatherObserved, rec.larva_surveyed || 0, popEstimated);
    const bandLow = roundTo(Math.max(0.0, index * (1 - conf.uncertainty)), 1);
    const bandHigh = roundTo(Math.min(100.0, index * (1 + conf.uncertainty)), 1);

    const breakdown = sourceBreakdown(rec);
    const topName = breakdown.length ? breakdown[0].source : null;
    const areaType = (district.endsWith('읍') || district.endsWith('면'))
      ? '농촌형(축산·정화조 밀집)'
      : '도심형(생활하수·타이어·수경시설)';

    // 모든 구역의 오늘 지수를 계산해 순위를 매긴다(실효 발생원위험 기준).
    const allIdx = Object.keys(DISTRICTS)
      .map((d) => [d, roundTo(100 * act * dev * (GEO_FLOOR + GEO_WEIGHT * geoEffective(DISTRICTS[d]).geo), 1)])
      .sort((a, b) => b[1] - a[1]);
    const rank = allIdx.findIndex(([d]) => d === district) + 1;
    const total = allIdx.length;
    const cityAvg = roundTo(allIdx.reduce((sum, [, v]) => sum + v, 0) / total, 1);
    const [topDistrict, topVal] = allIdx[0];

    const activeHours = lv >= 2 ? '일몰 직후(19~22시)와 새벽(04~06시)에 가장 활발' : '활동 미약';
    const repellent = {
      1: '불필요',
      2: '가벼운 기피제(시트로넬라 등)',
      3: 'DEET 10~20% 또는 이카리딘 + 긴팔 권장',
      4: 'DEET 20%+ 또는 이카리딘 고농도, 노출 최소화',
    }[lv];

    const actTxt = act >= 0.6 ? '고온다습한 날씨로 모기 활동이 왕성' : (act < 0.3 ? '선선한 날씨로 활동이 제한적' : '보통 수준의 활동');

    const larvaRate = geoInfo.larvaRate;
    return {
      district,
      mosquito_index: index,
      // (D) 신뢰구간(low~high)과 신뢰도 등급
      index_range: { low: bandLow, high: bandHigh },
      confidence: {
        level: conf.label,
        uncertainty_pct: roundTo(100 * conf.uncertainty, 1),
        reasons: {
          weather: weatherObserved ? '실측/실시간' : '월평년값(추정)',
          larva_sample: rec.larva_surveyed || 0,
          population: popEstimated ? '추정값' : '주민등록',
          data_gap: dataGap,
        },
        note: dataGap
          ? '⚠ 보건소 현장조사·민원 미제공 구역 — 위험은 인구·발생원으로 추정(민원 0을 안전으로 보지 마세요).'
          : null,
      },
      level: lv,
      grade: nm,
      color: col,
      summary: district + '의 모기지수는 ' + pyNum(index, 1) + '점(' + lv + '단계 ' + nm
        + ', 신뢰도 ' + conf.label + ', ' + pyNum(bandLow, 1) + '~' + pyNum(bandHigh, 1) + '점)입니다. '
        + actTxt + '하며, 발생 잠재력 ' + Math.round(geoInfo.breeding * 100) + '점 × 인구노출('
        + rec.population.toLocaleString('en-US') + '명)을 결합해 시내 ' + rank + '/' + total + '위입니다.'
        + (dataGap ? ' ※ 서부 등 현장조사 미제공 구역으로 추정치입니다.' : ''),
      weather: {
        input: {
          temp_c: tempC,
          humidity,
          rain_3d_mm: rain3dMm,
          month,
          wind_ms: behaviorOpts.wind_ms,
          precip_now: behaviorOpts.precip_now,
          hour: behaviorOpts.hour,
        },
        activity_index: roundTo(act, 3),
        behavior_factor: roundTo(behaviorFactor(behaviorOpts), 3),
        // ③ 발육 보정(최근 2주 누적온도 기반). gdd 미제공 시 1.0.
        development_factor: roundTo(dev, 3),
        gdd_14d: options.gdd_14d == null ? null : Number(options.gdd_14d),
        components: {
          temperature: { score: tv, status: ts },
          humidity: { score: hv, status: hs },
          rainfall: { score: rv, status: rs },
          // 시간대·풍속은 점수가 없을 수 있으므로(평년값 모드) score가 null일 수 있다.
          wind: { score: wv, status: ws },
          time_of_day: { score: timeV, status: timeS },
          current_rain: { score: nv, status: ns },
        },
        comment: '기온 ' + tempC + '℃, 습도 ' + humidity + '%, 최근3일 강수 '
          + rain3dMm + 'mm'
          + (behaviorOpts.wind_ms != null ? (', 풍속 ' + behaviorOpts.wind_ms + 'm/s') : '')
          + (behaviorOpts.hour != null ? (', ' + behaviorOpts.hour + '시') : '')
          + ' 기준 활동지수 ' + pyNum(act, 2)
          + (behaviorFactor(behaviorOpts) < 0.999
            ? ' (시간대·바람·현재 강수로 ' + Math.round((1 - behaviorFactor(behaviorOpts)) * 100) + '% 하향)'
            : ''),
      },
      // (v3) 인구 노출도 — 발생 잠재력과 결합해 실제 피해규모를 보정
      exposure: {
        population: rec.population,
        exposure_index: roundTo(geoInfo.exposure, 3),
        estimated: popEstimated,
        comment: '인구 ' + rec.population.toLocaleString('en-US') + '명 → 노출도 '
          + pyNum(geoInfo.exposure, 2)
          + (popEstimated ? ' (인구표 미수록, 추정)' : '')
          + '. 발생 잠재력과 결합해 실제 피해규모를 보정.',
      },
      source_risk: {
        score: rec.control_priority,
        raw_risk_index: rec.risk_index,
        breeding_potential: roundTo(geoInfo.breeding, 3),
        exposure_index: roundTo(geoInfo.exposure, 3),
        effective_geo: roundTo(geo, 3),
        // (A) 유충 실태조사 결과(있으면 실측 반영, 없으면 발생원 추정)
        larva: {
          surveyed: rec.larva_surveyed || 0,
          positive: rec.larva_positive || 0,
          detection_rate: larvaRate != null ? roundTo(larvaRate, 3) : null,
          weight_in_geo: roundTo(geoInfo.weight, 2),
          basis: geoInfo.basis,
        },
        area_type: areaType,
        top_sources: breakdown.slice(0, 5),
        comment: topName
          ? ('주요 발생원은 ' + topName + '이며, 이 구역은 ' + areaType + '입니다.'
            + (larvaRate != null
              ? ' 유충 검출률 ' + Math.round(100 * larvaRate) + '%로 실측 반영됨.'
              : ' (유충 조사 미실시 — 발생원 추정.)'))
          : '등록 발생원 없음',
      },
      ranking: {
        rank,
        total_districts: total,
        percentile: roundTo((100 * (total - rank + 1)) / total, 1),
        city_avg_index: cityAvg,
        vs_city_avg: roundTo(index - cityAvg, 1),
        highest_district: { name: topDistrict, index: topVal },
      },
      complaints_2025: rec.complaints,
      advice: {
        citizen: citizenAdvice(lv, topName),
        authority: authorityAdvice(lv, rank, total, rec.complaints, dataGap),
      },
      active_hours: activeHours,
      recommended_repellent: repellent,
    };
  }

  // 모든 구역을 오늘 날씨로 계산해 모기지수 높은 순으로 정렬해 돌려준다.
  function allIndices(options = {}) {
    return Object.keys(DISTRICTS)
      .map((d) => mosquitoIndex(d, options))
      .sort((a, b) => b.mosquito_index - a.mosquito_index);
  }

  function listDistricts() {
    return Object.keys(DISTRICTS);
  }

  // 구역별 대표 좌표(읍·면·동 중심부 근사값, [위도, 경도]).
  // 메인 페이지가 위경도로 "김해 어느 구역인지"를 판별하는 데 사용한다.
  const COORDS = {
    "활천동": [35.243, 128.901], "북부동": [35.262, 128.869], "내외동": [35.228, 128.869],
    "부원동": [35.231, 128.884], "동상동": [35.234, 128.879], "회현동": [35.224, 128.883],
    "칠산서부동": [35.213, 128.860], "화목동": [35.222, 128.857], "불암동": [35.207, 128.927],
    "장유": [35.180, 128.804], "주촌면": [35.227, 128.829], "진례면": [35.270, 128.787],
    "진영읍": [35.310, 128.741], "한림면": [35.328, 128.804], "생림면": [35.337, 128.889],
    "상동면": [35.323, 128.946], "대동면": [35.234, 128.984]
  };

  // 주어진 좌표에서 가장 가까운 김해시 구역명을 돌려준다.
  function nearestDistrict(lat, lng) {
    let best = null;
    let bestDist = Infinity;
    Object.entries(COORDS).forEach(([name, c]) => {
      const dist = Math.hypot(c[0] - lat, c[1] - lng);
      if (dist < bestDist) {
        bestDist = dist;
        best = name;
      }
    });
    return best;
  }

  const api = { mosquitoIndex, allIndices, listDistricts, nearestDistrict, COORDS, DISTRICTS, SRC_KOR };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.GimhaeMosquitoModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
