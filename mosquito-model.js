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
  // 각 발생원 시설의 김해시 전체 최댓값 (정규화 기준)
  const MAXS = {};
  Object.keys(SRC_KOR).forEach((key) => {
    MAXS[key] = Math.max(0, ...Object.values(DISTRICTS).map((d) => d.sources[key] || 0));
  });

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

  // 날씨 종합 활동지수(0~1): 기온이 기본, 습도·강수가 환경 보정
  function weatherActivity(tempC, humidity, rain3dMm) {
    const t = tempSuit(tempC)[0];
    const h = humSuit(humidity)[0];
    const r = rainSuit(rain3dMm)[0];
    const env = 0.6 * h + 0.4 * r;
    return clamp(t * (0.5 + 0.5 * env));
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

  // 방제당국 행동요령 (등급 + 순위 + 민원 기준)
  function authorityAdvice(level, rank, total, complaints) {
    const a = [];
    if (level >= 3) a.push('취약구역 방역 주기를 단축하고 유문등·포충기 가동을 강화하세요.');
    if (rank <= Math.max(3, Math.floor(total / 5))) {
      a.push('본 구역은 방제 우선순위 상위(' + rank + '/' + total + ')입니다. 정화조·하수구 유충구제(라바사이드)를 선제 시행하세요.');
    }
    if (complaints === 0 && level >= 3) a.push('발생원은 많으나 민원 기록이 없는 사각지대입니다 — 민원 발생 전 선제 점검을 권장합니다.');
    if (a.length === 0) a.push('정기 방역 주기를 유지하세요.');
    return a;
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

    const [tv, ts] = tempSuit(tempC);
    const [hv, hs] = humSuit(humidity);
    const [rv, rs] = rainSuit(rain3dMm);
    const act = weatherActivity(tempC, humidity, rain3dMm);
    const rec = DISTRICTS[district];
    const geo = rec.control_priority / 100.0;
    const index = roundTo(100 * act * (0.35 + 0.65 * geo), 1);
    const [lv, nm, col] = grade(index);

    const breakdown = sourceBreakdown(rec);
    const topName = breakdown.length ? breakdown[0].source : null;
    const areaType = (district.endsWith('읍') || district.endsWith('면'))
      ? '농촌형(축산·정화조 밀집)'
      : '도심형(생활하수·타이어·수경시설)';

    // 모든 구역의 오늘 지수를 계산해 순위를 매긴다.
    const allIdx = Object.keys(DISTRICTS)
      .map((d) => [d, roundTo(100 * act * (0.35 + 0.65 * DISTRICTS[d].control_priority / 100.0), 1)])
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

    return {
      district,
      mosquito_index: index,
      level: lv,
      grade: nm,
      color: col,
      summary: district + '의 모기지수는 ' + pyNum(index, 1) + '점(' + lv + '단계 ' + nm + ')입니다. '
        + actTxt + '하며, 발생원 위험은 ' + pyNum(rec.control_priority, 1)
        + '점(시내 ' + rank + '/' + total + '위)입니다.',
      weather: {
        input: { temp_c: tempC, humidity, rain_3d_mm: rain3dMm, month },
        activity_index: roundTo(act, 3),
        components: {
          temperature: { score: tv, status: ts },
          humidity: { score: hv, status: hs },
          rainfall: { score: rv, status: rs },
        },
        comment: '기온 ' + tempC + '℃, 습도 ' + humidity + '%, 최근3일 강수 '
          + rain3dMm + 'mm 기준 활동지수 ' + pyNum(act, 2),
      },
      source_risk: {
        score: rec.control_priority,
        raw_risk_index: rec.risk_index,
        area_type: areaType,
        top_sources: breakdown.slice(0, 5),
        comment: topName ? ('주요 발생원은 ' + topName + '이며, 이 구역은 ' + areaType + '입니다.') : '등록 발생원 없음',
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
        authority: authorityAdvice(lv, rank, total, rec.complaints),
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

  const api = { mosquitoIndex, allIndices, listDistricts, DISTRICTS, SRC_KOR };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.GimhaeMosquitoModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
