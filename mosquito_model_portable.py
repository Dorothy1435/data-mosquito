# -*- coding: utf-8 -*-
"""
김해시 모기지수 모델 v4 (PORTABLE)
==================================
이 파일 하나만 복사하면 됩니다. 외부 파일·패키지 의존성 없음(표준 math/json만).

사용 예:
    from mosquito_model_portable import mosquito_index, all_indices, list_districts
    r = mosquito_index('활천동', temp_c=29, humidity=80, rain_3d_mm=50)
    r = mosquito_index('활천동', live_weather=True)      # 실시간 기상 자동 조회
    r = mosquito_index('활천동', month=7)                # 미입력 시 실측 월평년값

────────────────────────────────────────────────────────────────────────────
v4 변경점 (v3 대비) — 근거: 김해시 방역현황보고 시스템(sodamap) 실데이터
────────────────────────────────────────────────────────────────────────────
[1] 면적 확보 → '개수'가 아니라 '밀도'로 전환  ★가장 큰 변화
    v3는 면적 데이터가 없어 발생원 '개수'와 인구 '수'만 썼다. 그 결과
    한림면(정화조 2,384개, 59.7㎢)이 위험 1위였다. 실제로는 넓은 면적에
    흩어진 것이라 단위면적당 위험은 낮다.
    v4는 공식 행정동 경계 폴리곤에서 면적을 계산해 모든 지표를 밀도로 바꿨다.

[2] 검증 결과 (독립 타겟 = 2025년 좌표기반 방역민원 383건)
        지표                              민원밀도(건/㎢)와의 스피어만
        v4 밀도위험 (0.5·발생원밀도 + 0.5·인구밀도)      +0.951
        v3 sqrt(발생잠재력 × 인구노출)                  -0.258   ← 부호가 반대였음
        v3 control_priority                          -0.335
    방제 우선순위(총부담 = 밀도위험 × 인구) ↔ 민원 건수: v4 +0.765 / v3 +0.479

[3] 유충 검출률을 위험지수에서 제거
    보건소 유충 실태조사 검출률은 민원밀도와 오히려 음의 상관(-0.715)이다.
    농촌(생림 87%, 대동 82%)이 높고 도심(내외 27%)이 낮은데, 민원은 정반대.
    이는 '조사 대상 시설의 오염도'이지 '그 지역 모기 밀도'가 아니기 때문.
    v3는 이걸 위험지수에 최대 60%까지 섞었다(역효과). v4는 위험지수에서 빼고
    '발생원 관리상태' 참고지표로만 별도 출력한다.

[4] 기온 반응곡선 재적합 (실측 기상 731일)
    v3: 가우시안 exp(-((T-27)/7.5)^2) — 27℃ 정점, 34℃에서 0.42로 급감(임의 설정).
    v4: Brière 곡선 (T0=10.5℃, Tm=40℃) — 30℃ 정점, 34℃에서 0.88.
        하한 T0=10.5℃는 Culex 발육영점(문헌 10~11℃)과 일치.
        상한 Tm은 한국 일평균기온이 33℃를 넘지 않아 데이터로 제약되지 않으므로
        문헌값 40℃로 고정했다.
    일별 채집수 설명력: R² 0.500 → 0.710, 스피어만 0.879 → 0.907

[5] 7일 누적기온 도입 — 유충 발육 지연 반영
    유효기온 = 0.29 × 당일평균기온 + 0.71 × 최근 7일 평균기온.
    당일 기온만 쓰는 것보다 설명력이 높다(모기는 어제까지의 날씨로 자란다).

[6] 풍속 억제항 추가 / 습도·강수 가중치 대폭 축소
    v3는 습도 0.6 + 강수 0.4로 환경계수를 만들었으나, 기온을 통제하면
    습도·강수의 잔여 기여는 거의 0이었다. 반면 풍속은 음의 기여가 확인됐다.

[7] 월평년값을 실측으로 교체
    v3의 SEASON은 손으로 넣은 값이었다. v4는 2024-08~2026-08 실측 기상
    (기온/7일기온/습도/7일강수/풍속) 월평균으로 교체.

[8] 발생원·인구·민원 데이터 전면 교체 (좌표 기반)
    시설 20,129개소를 좌표로 읍면동에 배정(v3는 문서상 소속 기재값).
    인구는 공식 행정동 주민등록 인구, 100m 인구격자 8,393셀로 화목동 분리.
    민원은 2025년 383건을 좌표로 배정(v3는 구역 집계값).

────────────────────────────────────────────────────────────────────────────
알려진 한계 (반드시 읽을 것)
────────────────────────────────────────────────────────────────────────────
· 성충 포집 이력 114,050건 중 113,623건(99.6%)이 source_type='SAMPLE'
  즉 합성 샘플 데이터다. 지점 평균의 전반기↔후반기 스피어만이 0.994로,
  '지점별 고정 배율 × 공통 시계열' 구조였다. 따라서 구역별 모기 밀도 학습에
  쓰지 않았다. 기온 반응곡선의 '형태'를 잡는 데만 썼고, 실측 장비(MOSCOM/TEMP)
  427건·102일로 방향을 교차확인했다(신규 +0.376 / v3 +0.402 — n이 작아
  통계적으로 구분되지 않음). 기온 반응곡선은 v3보다 문헌 정합성이 높다는
  근거로 채택한 것이지, 실측으로 우월이 입증된 것은 아니다.
· sodamap 유충 이력 54,232건도 구역별 검출률이 93.9~96.5%로 균일해 신호가
  없다(합성 추정). 위험지수에 쓰지 않았다.
· 민원 383건은 표본이 작고 13개 구역만 커버한다(진영읍·진례면·한림면·장유는
  민원 자료 미제공 = 결측). 검증 결과의 신뢰도는 그만큼 제한된다.
· 결합 가중치 0.5/0.5는 13개 구역에 대한 탐색으로 정한 값이다. LOO 재평가에서
  최소 +0.937로 안정적이었으나, 구역 수가 적어 과적합 가능성은 남아 있다.
· 민원은 '사람이 신고한 것'이라 인구가 많은 곳에서 더 많이 발생한다. 인구밀도가
  위험식에 들어가 있으므로 검증에 부분적 순환이 있다. 발생원밀도 단독으로도
  민원밀도와 +0.692였고, 인구밀도 단독은 +0.824로, 둘 다 독립적으로 기여한다.
"""
import math
import json

# ---------------------------------------------------------------------------
# 기상 활동 모형 파라미터 — 실측 기상 731일(2024-08-05~2026-08-05)로 적합
# ---------------------------------------------------------------------------
BRIERE = {'a': 0.000501846, 'T0': 10.50, 'Tm': 40.0, 'm': 1.164}
BRIERE_NORM = 2.124484          # 곡선 최대값(정규화용)
TA_TODAY_W   = 0.287            # 유효기온 = 0.287*당일 + 0.713*7일평균
HUM_BASE     = 0.648            # 습도 계수 절편
HUM_SLOPE    = 0.020            # 습도 계수 기울기 (v3의 0.6 → 사실상 무시 수준)
RAIN_W       = 0.038            # 강수 계수 진폭 (v3 대비 대폭 축소)
WIND_W       = 0.096            # 풍속 억제 계수 (v3에는 없던 항)

# 밀도위험 정규화 상수 (log1p 스케일 min/max, 17개 구역 기준)
BREED_LOG_RANGE = (3.2027, 6.2613)
POPD_LOG_RANGE  = (3.7548, 9.4315)
W_BREED, W_POPD = 0.5, 0.5

# 실측 월평년값: (기온, 7일평균기온, 습도, 7일누적강수, 풍속)
# 2024-08 ~ 2026-08 김해 관측 기준. v3의 임의 SEASON 값을 대체.
SEASON = {
    1: (1.9,  2.1, 43.7,  0.5, 2.0),  2: (3.7,  3.0, 45.6,  5.9, 2.0),
    3: (9.6,  9.2, 58.6,  8.2, 1.7),  4: (14.2, 13.7, 58.7, 27.8, 2.0),
    5: (18.5, 18.0, 72.2, 25.1, 1.8), 6: (23.3, 22.9, 76.2, 32.5, 1.8),
    7: (27.2, 27.0, 79.3, 51.5, 1.7), 8: (26.8, 26.9, 78.4, 45.2, 2.1),
    9: (23.1, 23.7, 74.3, 40.9, 1.9), 10:(16.7, 17.6, 68.8, 19.4, 2.0),
    11:(9.8, 10.1, 56.9,  8.1, 2.0),  12:(4.7,  5.3, 49.9, 11.5, 2.1),
}

SRC_KOR = {
    'septic_clean': '정화조(청소대상)', 'septic_private': '개인하수처리시설',
    'wwtp_private': '개인오수처리시설', 'wwtp_public': '공공하수처리시설',
    'livestock': '축산농가', 'reservoir': '저수지', 'tire_shop': '타이어가게',
    'waste_tire': '폐타이어적치', 'waste_stk': '폐기물처리업', 'junk_shop': '고물상',
    'water_feature': '수경시설', 'toilet': '공중화장실', 'park': '도시공원',
    'bathhouse': '목욕장', 'waterpump': '배수펌프장', 'bee_farm': '양봉농가',
}
# 발생원별 유충 서식 적합도 가중치 (밀도 점수 계산에 사용)
RISK_W = {
    'septic_clean': 3.0, 'septic_private': 3.0, 'wwtp_private': 2.5, 'wwtp_public': 1.0,
    'livestock': 2.0, 'reservoir': 2.5, 'tire_shop': 2.0, 'waste_tire': 2.5,
    'waste_stk': 1.5, 'junk_shop': 1.5, 'water_feature': 1.5, 'toilet': 0.5,
    'park': 1.0, 'bathhouse': 0.5, 'waterpump': 1.5, 'bee_farm': 0.3,
}

KIMHAE_CENTER = (35.2285, 128.8894)
COORDS = {
    '활천동':   (35.243, 128.901), '북부동':   (35.262, 128.869),
    '내외동':   (35.228, 128.869), '부원동':   (35.231, 128.884),
    '동상동':   (35.234, 128.879), '회현동':   (35.224, 128.883),
    '칠산서부동': (35.213, 128.860), '화목동':   (35.222, 128.857),
    '불암동':   (35.207, 128.927), '장유':     (35.180, 128.804),
    '주촌면':   (35.227, 128.829), '진례면':   (35.270, 128.787),
    '진영읍':   (35.310, 128.741), '한림면':   (35.328, 128.804),
    '생림면':   (35.337, 128.889), '상동면':   (35.323, 128.946),
    '대동면':   (35.234, 128.984),
}

# 민원·현장조사 자료 미제공 구역 — '0건'을 안전으로 해석하면 안 되는 결측
DATA_GAP = {'진영읍', '진례면', '한림면', '장유'}
# 인구가 100m 격자로 추정된 구역(공식 행정동 인구표 미수록 법정동)
POP_ESTIMATED = {'화목동'}

DISTRICTS = {
    '활천동': {
        'area_km2': 17.2,
        'population': 71086,
        'pop_density': 4133.0,
        'breed_density': 112.9,
        'density_risk': 0.6532,
        'control_priority': 86.4,
        'complaints_2025': 87,
        'water_pct': 0.251,
        'park_m2_per_km2': 11664,
        'larva_surveyed': 212,
        'larva_positive': 87,
        'sources': {
            'septic_clean': 232,
            'septic_private': 308,
            'wwtp_private': 58,
            'wwtp_public': 0,
            'livestock': 1,
            'reservoir': 0,
            'tire_shop': 14,
            'waste_tire': 0,
            'waste_stk': 6,
            'junk_shop': 21,
            'water_feature': 13,
            'toilet': 69,
            'park': 38,
            'bathhouse': 18,
            'waterpump': 4,
            'bee_farm': 0,
        },
    },
    '북부동': {
        'area_km2': 13.79,
        'population': 80819,
        'pop_density': 5859.7,
        'breed_density': 36.2,
        'density_risk': 0.501,
        'control_priority': 84.2,
        'complaints_2025': 42,
        'water_pct': 0.101,
        'park_m2_per_km2': 22038,
        'larva_surveyed': 46,
        'larva_positive': 23,
        'sources': {
            'septic_clean': 45,
            'septic_private': 61,
            'wwtp_private': 29,
            'wwtp_public': 0,
            'livestock': 0,
            'reservoir': 3,
            'tire_shop': 6,
            'waste_tire': 0,
            'waste_stk': 3,
            'junk_shop': 5,
            'water_feature': 10,
            'toilet': 53,
            'park': 30,
            'bathhouse': 12,
            'waterpump': 0,
            'bee_farm': 0,
        },
    },
    '내외동': {
        'area_km2': 5.41,
        'population': 67448,
        'pop_density': 12474.7,
        'breed_density': 85.6,
        'density_risk': 0.7057,
        'control_priority': 87.0,
        'complaints_2025': 35,
        'water_pct': 0.495,
        'park_m2_per_km2': 41414,
        'larva_surveyed': 74,
        'larva_positive': 20,
        'sources': {
            'septic_clean': 34,
            'septic_private': 88,
            'wwtp_private': 8,
            'wwtp_public': 0,
            'livestock': 0,
            'reservoir': 1,
            'tire_shop': 6,
            'waste_tire': 1,
            'waste_stk': 0,
            'junk_shop': 3,
            'water_feature': 3,
            'toilet': 38,
            'park': 26,
            'bathhouse': 11,
            'waterpump': 0,
            'bee_farm': 1,
        },
    },
    '부원동': {
        'area_km2': 2.0,
        'population': 8811,
        'pop_density': 4408.9,
        'breed_density': 282.7,
        'density_risk': 0.8081,
        'control_priority': 40.7,
        'complaints_2025': 25,
        'water_pct': 0.027,
        'park_m2_per_km2': 4307,
        'larva_surveyed': 146,
        'larva_positive': 41,
        'sources': {
            'septic_clean': 47,
            'septic_private': 127,
            'wwtp_private': 7,
            'wwtp_public': 0,
            'livestock': 0,
            'reservoir': 0,
            'tire_shop': 1,
            'waste_tire': 0,
            'waste_stk': 0,
            'junk_shop': 2,
            'water_feature': 1,
            'toilet': 25,
            'park': 5,
            'bathhouse': 3,
            'waterpump': 0,
            'bee_farm': 0,
        },
    },
    '동상동': {
        'area_km2': 1.74,
        'population': 8403,
        'pop_density': 4826.7,
        'breed_density': 178.1,
        'density_risk': 0.7409,
        'control_priority': 38.5,
        'complaints_2025': 9,
        'water_pct': 0.03,
        'park_m2_per_km2': 4899,
        'larva_surveyed': 36,
        'larva_positive': 11,
        'sources': {
            'septic_clean': 27,
            'septic_private': 65,
            'wwtp_private': 1,
            'wwtp_public': 0,
            'livestock': 0,
            'reservoir': 0,
            'tire_shop': 6,
            'waste_tire': 0,
            'waste_stk': 0,
            'junk_shop': 4,
            'water_feature': 0,
            'toilet': 13,
            'park': 5,
            'bathhouse': 3,
            'waterpump': 0,
            'bee_farm': 2,
        },
    },
    '회현동': {
        'area_km2': 1.14,
        'population': 7981,
        'pop_density': 6979.1,
        'breed_density': 522.9,
        'density_risk': 0.9488,
        'control_priority': 41.7,
        'complaints_2025': 32,
        'water_pct': 0.377,
        'park_m2_per_km2': 102946,
        'larva_surveyed': 23,
        'larva_positive': 10,
        'sources': {
            'septic_clean': 58,
            'septic_private': 123,
            'wwtp_private': 12,
            'wwtp_public': 0,
            'livestock': 0,
            'reservoir': 0,
            'tire_shop': 1,
            'waste_tire': 0,
            'waste_stk': 0,
            'junk_shop': 1,
            'water_feature': 2,
            'toilet': 13,
            'park': 6,
            'bathhouse': 3,
            'waterpump': 3,
            'bee_farm': 0,
        },
    },
    '칠산서부동': {
        'area_km2': 11.94,
        'population': 7362,
        'pop_density': 616.8,
        'breed_density': 76.8,
        'density_risk': 0.4235,
        'control_priority': 28.8,
        'complaints_2025': 27,
        'water_pct': 0.229,
        'park_m2_per_km2': 1603,
        'larva_surveyed': 4,
        'larva_positive': 1,
        'sources': {
            'septic_clean': 121,
            'septic_private': 82,
            'wwtp_private': 67,
            'wwtp_public': 0,
            'livestock': 13,
            'reservoir': 0,
            'tire_shop': 10,
            'waste_tire': 0,
            'waste_stk': 3,
            'junk_shop': 34,
            'water_feature': 1,
            'toilet': 30,
            'park': 12,
            'bathhouse': 1,
            'waterpump': 6,
            'bee_farm': 2,
        },
    },
    '화목동': {
        'area_km2': 7.82,
        'population': 1250,
        'pop_density': 159.9,
        'breed_density': 61.2,
        'density_risk': 0.2685,
        'control_priority': 12.0,
        'complaints_2025': 10,
        'water_pct': 0.011,
        'park_m2_per_km2': 1631,
        'larva_surveyed': 11,
        'larva_positive': 6,
        'sources': {
            'septic_clean': 81,
            'septic_private': 36,
            'wwtp_private': 15,
            'wwtp_public': 2,
            'livestock': 15,
            'reservoir': 0,
            'tire_shop': 2,
            'waste_tire': 0,
            'waste_stk': 2,
            'junk_shop': 28,
            'water_feature': 1,
            'toilet': 1,
            'park': 7,
            'bathhouse': 0,
            'waterpump': 0,
            'bee_farm': 0,
        },
    },
    '불암동': {
        'area_km2': 2.55,
        'population': 6458,
        'pop_density': 2528.9,
        'breed_density': 184.7,
        'density_risk': 0.6899,
        'control_priority': 33.9,
        'complaints_2025': 29,
        'water_pct': 0.0,
        'park_m2_per_km2': 1836,
        'larva_surveyed': 10,
        'larva_positive': 5,
        'sources': {
            'septic_clean': 49,
            'septic_private': 69,
            'wwtp_private': 30,
            'wwtp_public': 0,
            'livestock': 0,
            'reservoir': 0,
            'tire_shop': 4,
            'waste_tire': 0,
            'waste_stk': 1,
            'junk_shop': 12,
            'water_feature': 1,
            'toilet': 12,
            'park': 5,
            'bathhouse': 2,
            'waterpump': 1,
            'bee_farm': 0,
        },
    },
    '장유': {
        'area_km2': 55.52,
        'population': 177769,
        'pop_density': 3201.9,
        'breed_density': 23.6,
        'density_risk': 0.3802,
        'control_priority': 100.0,
        'complaints_2025': 0,
        'water_pct': 0.205,
        'park_m2_per_km2': 12022,
        'larva_surveyed': 0,
        'larva_positive': 0,
        'sources': {
            'septic_clean': 119,
            'septic_private': 116,
            'wwtp_private': 154,
            'wwtp_public': 0,
            'livestock': 8,
            'reservoir': 7,
            'tire_shop': 14,
            'waste_tire': 0,
            'waste_stk': 7,
            'junk_shop': 4,
            'water_feature': 21,
            'toilet': 84,
            'park': 62,
            'bathhouse': 0,
            'waterpump': 2,
            'bee_farm': 14,
        },
    },
    '주촌면': {
        'area_km2': 31.29,
        'population': 19804,
        'pop_density': 632.8,
        'breed_density': 56.7,
        'density_risk': 0.3769,
        'control_priority': 42.9,
        'complaints_2025': 32,
        'water_pct': 0.655,
        'park_m2_per_km2': 3301,
        'larva_surveyed': 112,
        'larva_positive': 87,
        'sources': {
            'septic_clean': 162,
            'septic_private': 150,
            'wwtp_private': 236,
            'wwtp_public': 1,
            'livestock': 25,
            'reservoir': 18,
            'tire_shop': 5,
            'waste_tire': 1,
            'waste_stk': 42,
            'junk_shop': 22,
            'water_feature': 5,
            'toilet': 28,
            'park': 13,
            'bathhouse': 1,
            'waterpump': 5,
            'bee_farm': 4,
        },
    },
    '진례면': {
        'area_km2': 44.65,
        'population': 5474,
        'pop_density': 122.6,
        'breed_density': 53.1,
        'density_risk': 0.2224,
        'control_priority': 21.3,
        'complaints_2025': 0,
        'water_pct': 0.855,
        'park_m2_per_km2': 380,
        'larva_surveyed': 0,
        'larva_positive': 0,
        'sources': {
            'septic_clean': 189,
            'septic_private': 215,
            'wwtp_private': 364,
            'wwtp_public': 2,
            'livestock': 40,
            'reservoir': 26,
            'tire_shop': 4,
            'waste_tire': 0,
            'waste_stk': 37,
            'junk_shop': 9,
            'water_feature': 0,
            'toilet': 31,
            'park': 3,
            'bathhouse': 0,
            'waterpump': 0,
            'bee_farm': 14,
        },
    },
    '진영읍': {
        'area_km2': 39.8,
        'population': 52844,
        'pop_density': 1327.6,
        'breed_density': 100.0,
        'density_risk': 0.5336,
        'control_priority': 71.9,
        'complaints_2025': 0,
        'water_pct': 0.476,
        'park_m2_per_km2': 9332,
        'larva_surveyed': 0,
        'larva_positive': 0,
        'sources': {
            'septic_clean': 329,
            'septic_private': 539,
            'wwtp_private': 421,
            'wwtp_public': 1,
            'livestock': 46,
            'reservoir': 13,
            'tire_shop': 21,
            'waste_tire': 0,
            'waste_stk': 28,
            'junk_shop': 24,
            'water_feature': 9,
            'toilet': 66,
            'park': 25,
            'bathhouse': 0,
            'waterpump': 3,
            'bee_farm': 9,
        },
    },
    '한림면': {
        'area_km2': 59.71,
        'population': 6405,
        'pop_density': 107.3,
        'breed_density': 165.6,
        'density_risk': 0.3946,
        'control_priority': 26.2,
        'complaints_2025': 0,
        'water_pct': 0.298,
        'park_m2_per_km2': 14,
        'larva_surveyed': 0,
        'larva_positive': 0,
        'sources': {
            'septic_clean': 1005,
            'septic_private': 787,
            'wwtp_private': 1362,
            'wwtp_public': 8,
            'livestock': 380,
            'reservoir': 22,
            'tire_shop': 2,
            'waste_tire': 1,
            'waste_stk': 142,
            'junk_shop': 25,
            'water_feature': 0,
            'toilet': 34,
            'park': 1,
            'bathhouse': 0,
            'waterpump': 2,
            'bee_farm': 19,
        },
    },
    '생림면': {
        'area_km2': 50.74,
        'population': 3331,
        'pop_density': 65.6,
        'breed_density': 96.2,
        'density_risk': 0.2637,
        'control_priority': 18.0,
        'complaints_2025': 12,
        'water_pct': 0.152,
        'park_m2_per_km2': 2701,
        'larva_surveyed': 158,
        'larva_positive': 138,
        'sources': {
            'septic_clean': 565,
            'septic_private': 326,
            'wwtp_private': 673,
            'wwtp_public': 6,
            'livestock': 177,
            'reservoir': 9,
            'tire_shop': 1,
            'waste_tire': 5,
            'waste_stk': 58,
            'junk_shop': 12,
            'water_feature': 1,
            'toilet': 27,
            'park': 3,
            'bathhouse': 0,
            'waterpump': 0,
            'bee_farm': 13,
        },
    },
    '상동면': {
        'area_km2': 68.83,
        'population': 2872,
        'pop_density': 41.7,
        'breed_density': 73.5,
        'density_risk': 0.1812,
        'control_priority': 14.4,
        'complaints_2025': 26,
        'water_pct': 0.104,
        'park_m2_per_km2': 78,
        'larva_surveyed': 107,
        'larva_positive': 75,
        'sources': {
            'septic_clean': 569,
            'septic_private': 498,
            'wwtp_private': 662,
            'wwtp_public': 5,
            'livestock': 31,
            'reservoir': 12,
            'tire_shop': 2,
            'waste_tire': 3,
            'waste_stk': 38,
            'junk_shop': 10,
            'water_feature': 0,
            'toilet': 20,
            'park': 4,
            'bathhouse': 0,
            'waterpump': 3,
            'bee_farm': 14,
        },
    },
    '대동면': {
        'area_km2': 48.77,
        'population': 4918,
        'pop_density': 100.8,
        'breed_density': 73.4,
        'density_risk': 0.2574,
        'control_priority': 20.8,
        'complaints_2025': 17,
        'water_pct': 0.291,
        'park_m2_per_km2': 0,
        'larva_surveyed': 83,
        'larva_positive': 68,
        'sources': {
            'septic_clean': 491,
            'septic_private': 458,
            'wwtp_private': 249,
            'wwtp_public': 3,
            'livestock': 27,
            'reservoir': 9,
            'tire_shop': 0,
            'waste_tire': 1,
            'waste_stk': 2,
            'junk_shop': 5,
            'water_feature': 0,
            'toilet': 19,
            'park': 0,
            'bathhouse': 1,
            'waterpump': 1,
            'bee_farm': 20,
        },
    },
}

# ---------------------------------------------------------------------------
# 파생값 계산
# ---------------------------------------------------------------------------
def _clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))

def _norm_log(v, rng):
    lo, hi = rng
    return _clamp((math.log1p(max(v, 0.0)) - lo) / (hi - lo))

for _d, _r in DISTRICTS.items():
    _r['data_gap'] = _d in DATA_GAP
    _r['pop_estimated'] = _d in POP_ESTIMATED
    _r['breed_norm'] = round(_norm_log(_r['breed_density'], BREED_LOG_RANGE), 4)
    _r['popd_norm'] = round(_norm_log(_r['pop_density'], POPD_LOG_RANGE), 4)

_MAX_SRC_DEN = {}
for _k in SRC_KOR:
    _MAX_SRC_DEN[_k] = max((_r['sources'].get(_k, 0) / _r['area_km2']
                            for _r in DISTRICTS.values()), default=0.0)

# ---------------------------------------------------------------------------
# (1) 기상 → 모기 활동지수
# ---------------------------------------------------------------------------
def _briere(T):
    """Brière 곡선. 발육영점 T0 이하 / 치사상한 Tm 이상에서 0."""
    if T <= BRIERE['T0'] or T >= BRIERE['Tm']:
        return 0.0
    v = (BRIERE['a'] * T * (T - BRIERE['T0'])
         * ((BRIERE['Tm'] - T) ** (1.0 / BRIERE['m'])))
    return _clamp(v / BRIERE_NORM)

def _temp_suit(temp_c, ta_7d_avg=None):
    """유효기온(당일 29% + 7일평균 71%) 기반 기온 적합도."""
    t7 = temp_c if ta_7d_avg is None else ta_7d_avg
    te = TA_TODAY_W * temp_c + (1 - TA_TODAY_W) * t7
    v = _briere(te)
    if   te < 11: s = '발육영점 이하 — 모기 활동 거의 정지'
    elif te < 16: s = '저온 — 활동 저조, 월동개체 위주'
    elif te < 22: s = '상승기 — 발생 시작'
    elif te < 26: s = '양호 — 번식·흡혈 활발'
    elif te <= 32: s = '최적 — 발생 정점 구간'
    elif te <= 36: s = '고온 — 활동 다소 둔화'
    else: s = '극한 폭염 — 활동 급감'
    return round(v, 3), s, round(te, 1)

def _hum_suit(H):
    v = _clamp(HUM_BASE + HUM_SLOPE * (H - 40) / 50.0, 0.30, 1.05)
    if   H < 50: s = '건조 — 성충 수명 단축'
    elif H < 70: s = '보통'
    else: s = '다습 — 성충 생존에 유리'
    return round(v, 3), s

def _rain_suit(rain_7d_mm, rain_today_mm=0.0):
    """최근 7일 누적강수는 산란처를 늘리고(+), 당일 폭우는 유충을 씻어낸다(-)."""
    v = (1.0 + RAIN_W * math.tanh(rain_7d_mm / 40.0)
         - 0.9 * RAIN_W * math.tanh(rain_today_mm / 25.0))
    v = _clamp(v, 0.85, 1.15)
    if   rain_today_mm >= 30: s = '당일 폭우 — 유충 유실로 일시 감소'
    elif rain_7d_mm >= 40: s = '최근 강수 많음 — 산란처 확대'
    elif rain_7d_mm >= 10: s = '적당한 강수 — 고인물 유지'
    else: s = '건조 지속 — 기존 정체수 위주'
    return round(v, 3), s

def _wind_suit(ws):
    v = _clamp(1.0 - WIND_W * (ws - 1.5) / 3.0, 0.55, 1.15)
    if   ws >= 4.0: s = '강풍 — 비행·흡혈 억제'
    elif ws >= 2.5: s = '바람 다소 강함 — 활동 일부 억제'
    else: s = '약풍 — 활동에 지장 없음'
    return round(v, 3), s

def weather_activity(temp_c, humidity, rain_7d_mm, wind_ms=1.8, ta_7d_avg=None,
                     rain_today_mm=0.0):
    """0~1 기상 활동지수. v3의 weather_activity(t,h,r) 호출도 그대로 동작한다."""
    t = _temp_suit(temp_c, ta_7d_avg)[0]
    h = _hum_suit(humidity)[0]
    r = _rain_suit(rain_7d_mm, rain_today_mm)[0]
    w = _wind_suit(wind_ms)[0]
    return _clamp(t * h * r * w)

# ---------------------------------------------------------------------------
# (2) 실시간 기상 — Open-Meteo (무료/키 불필요, 표준 라이브러리만)
# ---------------------------------------------------------------------------
def _parse_meteo(loc):
    temps = loc['hourly']['temperature_2m']
    hums  = loc['hourly']['relative_humidity_2m']
    winds = loc['hourly'].get('wind_speed_10m') or []
    temp_c   = next(v for v in reversed(temps) if v is not None)
    humidity = next(v for v in reversed(hums) if v is not None)
    wind = next((v for v in reversed(winds) if v is not None), 1.8)
    tvals = [v for v in temps if v is not None]
    ta_7d = sum(tvals) / len(tvals) if tvals else temp_c      # 최근 7일 시간별 평균
    daily = [x for x in loc['daily']['precipitation_sum'] if x is not None]
    rain_7d = sum(daily[:7])
    rain_today = daily[-1] if daily else 0.0
    return {'temp_c': round(temp_c, 1), 'humidity': round(humidity),
            'ta_7d_avg': round(ta_7d, 1), 'rain_7d_mm': round(rain_7d, 1),
            'rain_today_mm': round(rain_today, 1),
            'wind_ms': round(wind / 3.6, 1),      # km/h → m/s
            'source': 'open-meteo'}

def _meteo_url(lats, lons):
    import urllib.parse
    return 'https://api.open-meteo.com/v1/forecast?' + urllib.parse.urlencode({
        'latitude': lats, 'longitude': lons,
        'hourly': 'temperature_2m,relative_humidity_2m,wind_speed_10m',
        'daily': 'precipitation_sum',
        'past_days': 7, 'forecast_days': 1, 'timezone': 'Asia/Seoul',
    })

def fetch_weather(district=None, lat=None, lon=None, timeout=8):
    """현재 기온/습도/풍속 + 최근 7일 기온평균·누적강수. 실패 시 None."""
    import urllib.request
    if lat is None or lon is None:
        lat, lon = COORDS.get(district, KIMHAE_CENTER)
    try:
        with urllib.request.urlopen(_meteo_url(lat, lon), timeout=timeout) as resp:
            data = json.loads(resp.read().decode('utf-8'))
        out = _parse_meteo(data)
        out['lat'], out['lon'] = lat, lon
        return out
    except Exception:
        return None

def fetch_weather_bulk(districts, timeout=12):
    """여러 구역 날씨를 한 번의 호출로. 실패 시 None."""
    import urllib.request
    lats, lons = [], []
    for d in districts:
        la, lo = COORDS.get(d, KIMHAE_CENTER)
        lats.append(str(la)); lons.append(str(lo))
    try:
        with urllib.request.urlopen(_meteo_url(','.join(lats), ','.join(lons)),
                                    timeout=timeout) as resp:
            data = json.loads(resp.read().decode('utf-8'))
        if isinstance(data, dict):
            data = [data]
        return {d: _parse_meteo(loc) for d, loc in zip(districts, data)}
    except Exception:
        return None

# ---------------------------------------------------------------------------
# (3) 지역 위험 — 밀도 기반
# ---------------------------------------------------------------------------
def grade(index):
    if index < 25: return (1, '쾌적', '#3b82f6')
    if index < 50: return (2, '관심', '#22c55e')
    if index < 75: return (3, '주의', '#f59e0b')
    return (4, '불쾌', '#ef4444')

def _source_breakdown(rec):
    """발생원별 위험 기여도 — '개수'가 아니라 '밀도(개/㎢)' 기준."""
    contrib = {}
    area = rec['area_km2']
    for k, cnt in rec['sources'].items():
        den = cnt / area
        mx = _MAX_SRC_DEN.get(k, 0.0)
        contrib[k] = (den / mx if mx > 0 else 0.0) * RISK_W.get(k, 1.0)
    tot = sum(contrib.values()) or 1.0
    rows = []
    for k in sorted(contrib, key=lambda x: -contrib[x]):
        if rec['sources'].get(k, 0) > 0:
            rows.append({'source': SRC_KOR[k], 'count': rec['sources'][k],
                         'per_km2': round(rec['sources'][k] / area, 1),
                         'risk_contribution_pct': round(100 * contrib[k] / tot, 1)})
    return rows

def _confidence(weather_observed, rec):
    """불확실성: 기상 실측 여부 + 민원 결측 + 인구 추정 여부."""
    wu = 0.06 if weather_observed else 0.20
    gu = 0.22 if rec['data_gap'] else 0.08     # 민원 미제공 = 검증 불가
    pu = 0.10 if rec['pop_estimated'] else 0.0
    u = (wu ** 2 + gu ** 2 + pu ** 2) ** 0.5
    label = '높음' if u < 0.13 else ('보통' if u < 0.21 else '낮음')
    return u, label

def _citizen_advice(level, top_source_name):
    base = {
        1: ['특별한 조치가 필요 없습니다.'],
        2: ['야간 외출 시 가벼운 기피제를 사용하세요.',
            '집 주변 화분받침·빈 용기의 고인물을 비우세요.'],
        3: ['방충망·기피제를 사용하고 야간 활동을 줄이세요.',
            '집 주변 정화조·하수구 뚜껑 주변을 점검하세요.',
            '고인물 용기를 뒤집어 두세요.'],
        4: ['야외활동을 자제하고 긴팔·긴바지를 착용하세요.',
            '농도 높은 기피제(DEET·이카리딘)를 사용하세요.',
            '집 안팎 모든 고인물을 즉시 제거하세요.'],
    }[level]
    tip = {
        '정화조(청소대상)': '하수구·정화조 환기구 주변에 모기가 모입니다.',
        '개인하수처리시설': '오수처리시설 주변 정체수가 주요 산란처입니다.',
        '개인오수처리시설': '오수처리시설 주변 정체수가 주요 산란처입니다.',
        '타이어가게': '야적된 폐타이어에 빗물이 고이지 않게 관리가 필요합니다.',
        '폐타이어적치': '적치된 타이어의 빗물이 대표적 산란처입니다.',
        '수경시설': '분수·바닥분수 등 정체수 주변을 피하세요.',
        '축산농가': '축사 주변 분뇨·물웅덩이에서 모기가 다량 발생합니다.',
        '저수지': '저수지 가장자리 정체수 구역을 주의하세요.',
        '공중화장실': '공중화장실 주변 정화조에서 유충이 생길 수 있습니다.',
        '도시공원': '공원 내 인공연못·배수로 정체수를 주의하세요.',
        '고물상': '야적 폐기물에 고인 빗물이 산란처가 됩니다.',
    }.get(top_source_name)
    return base + ([tip] if tip and level >= 2 else [])

def _authority_advice(rec, level, rank, total, larva_rate):
    a = []
    if level >= 3:
        a.append('취약구역 방역 주기를 단축하고 유문등·포충기 가동을 강화하세요.')
    if rank <= max(3, total // 5):
        a.append('본 구역은 밀도위험 상위(%d/%d)입니다. 정화조·하수구 유충구제'
                 '(라바사이드)를 선제 시행하세요.' % (rank, total))
    if rec['data_gap']:
        a.append('민원·현장조사 자료가 미제공된 결측 구역입니다 — 인구·발생원 밀도로만 '
                 '추정했으므로 우선 현장 조사로 데이터를 확보하세요.')
    elif rec['complaints_2025'] == 0 and level >= 3:
        a.append('발생원 밀도는 높으나 민원 기록이 없는 사각지대입니다 — 선제 점검을 권장합니다.')
    if larva_rate is not None and larva_rate >= 0.6:
        a.append('유충 실태조사 검출률이 %d%%로 높습니다 — 발생원 시설 자체의 관리상태가 '
                 '불량합니다(모기지수와 별개로 시설 개선 대상).' % round(100 * larva_rate))
    if not a:
        a.append('정기 방역 주기를 유지하세요.')
    return a

# ---------------------------------------------------------------------------
# (4) 메인 API
# ---------------------------------------------------------------------------
def _index_of(district, act):
    rec = DISTRICTS[district]
    geo = W_BREED * rec['breed_norm'] + W_POPD * rec['popd_norm']
    return round(100 * act * (0.30 + 0.70 * geo), 1), geo

def mosquito_index(district, month=None, temp_c=None, humidity=None, rain_3d_mm=None,
                   live_weather=False, wind_ms=None, ta_7d_avg=None, rain_7d_mm=None,
                   rain_today_mm=None):
    """구역의 모기지수와 부가정보를 반환.

    rain_3d_mm 은 v3 호환용 별칭이며, 값이 주어지면 rain_7d_mm 으로 취급한다.
    """
    if district not in DISTRICTS:
        raise KeyError('unknown district: ' + str(district))
    if month is None:
        month = 6
    if rain_7d_mm is None:
        rain_7d_mm = rain_3d_mm

    caller_provided = temp_c is not None
    weather_observed = False
    weather_src = 'manual' if caller_provided else 'climatology'

    if live_weather and temp_c is None and humidity is None and rain_7d_mm is None:
        live = fetch_weather(district)
        if live is not None:
            temp_c, humidity = live['temp_c'], live['humidity']
            rain_7d_mm, ta_7d_avg = live['rain_7d_mm'], live['ta_7d_avg']
            wind_ms, rain_today_mm = live['wind_ms'], live['rain_today_mm']
            weather_observed = True
            weather_src = live['source']

    st, st7, sh, sr, sw = SEASON.get(month, (22.0, 22.0, 70.0, 30.0, 1.9))
    temp_c        = st  if temp_c        is None else temp_c
    ta_7d_avg     = st7 if ta_7d_avg     is None else ta_7d_avg
    humidity      = sh  if humidity      is None else humidity
    rain_7d_mm    = sr  if rain_7d_mm    is None else rain_7d_mm
    wind_ms       = sw  if wind_ms       is None else wind_ms
    rain_today_mm = 0.0 if rain_today_mm is None else rain_today_mm

    tv, ts, te = _temp_suit(temp_c, ta_7d_avg)
    hv, hs = _hum_suit(humidity)
    rv, rs = _rain_suit(rain_7d_mm, rain_today_mm)
    wv, ws = _wind_suit(wind_ms)
    act = _clamp(tv * hv * rv * wv)

    rec = DISTRICTS[district]
    index, geo = _index_of(district, act)
    lv, nm, col = grade(index)

    u, conf_label = _confidence(weather_observed or caller_provided, rec)
    band_low  = round(max(0.0, index * (1 - u)), 1)
    band_high = round(min(100.0, index * (1 + u)), 1)

    breakdown = _source_breakdown(rec)
    top_name = breakdown[0]['source'] if breakdown else None
    surveyed = rec.get('larva_surveyed', 0)
    larva_rate = (rec.get('larva_positive', 0) / surveyed) if surveyed >= 10 else None

    all_idx = sorted(((d, _index_of(d, act)[0]) for d in DISTRICTS), key=lambda x: -x[1])
    ranked = [d for d, _ in all_idx]
    rank = ranked.index(district) + 1
    total = len(all_idx)
    city_avg = round(sum(v for _, v in all_idx) / total, 1)
    top_district, top_val = all_idx[0]
    pri_rank = sorted(DISTRICTS, key=lambda d: -DISTRICTS[d]['control_priority']).index(district) + 1

    area_type = ('농촌형(축산·정화조 산재)' if district.endswith(('읍', '면'))
                 else '도심형(생활하수·수경시설·공원)')
    act_txt = ('고온다습한 날씨로 모기 활동이 왕성' if act >= 0.6
               else ('선선한 날씨로 활동이 제한적' if act < 0.3 else '보통 수준의 활동'))
    active_hours = ('일몰 직후(19~22시)와 새벽(04~06시)에 가장 활발' if lv >= 2 else '활동 미약')
    repellent = {1: '불필요', 2: '가벼운 기피제(시트로넬라 등)',
                 3: 'DEET 10~20% 또는 이카리딘 + 긴팔 권장',
                 4: 'DEET 20%+ 또는 이카리딘 고농도, 노출 최소화'}[lv]

    return {
        'district': district,
        'mosquito_index': index,
        'index_range': {'low': band_low, 'high': band_high},
        'level': lv, 'grade': nm, 'color': col,
        'confidence': {
            'level': conf_label,
            'uncertainty_pct': round(100 * u, 1),
            'reasons': {
                'weather': ('실측(Open-Meteo)' if weather_observed
                            else ('직접입력' if caller_provided else '실측 월평년값')),
                'population': '100m 격자 추정' if rec['pop_estimated'] else '주민등록',
                'complaint_data': '미제공(결측)' if rec['data_gap'] else '보유',
            },
            'note': ('⚠ 민원·현장조사 미제공 구역 — 인구·발생원 밀도로만 추정한 값입니다'
                     '(민원 0건을 안전으로 해석하지 마세요).' if rec['data_gap'] else None),
        },
        'summary': (district + '의 모기지수는 ' + str(index) + '점(' + str(lv) + '단계 '
                    + nm + ', 신뢰도 ' + conf_label + ', ' + str(band_low) + '~'
                    + str(band_high) + '점)입니다. ' + act_txt + '하며, 발생원 밀도 '
                    + str(round(rec['breed_density'])) + '개/㎢ · 인구밀도 '
                    + format(int(rec['pop_density']), ',') + '명/㎢를 결합해 시내 '
                    + str(rank) + '/' + str(total) + '위입니다.'
                    + (' ※ 민원 자료 미제공 구역으로 추정치입니다.' if rec['data_gap'] else '')),
        'weather': {
            'input': {'temp_c': temp_c, 'ta_7d_avg': ta_7d_avg, 'humidity': humidity,
                      'rain_7d_mm': rain_7d_mm, 'rain_today_mm': rain_today_mm,
                      'wind_ms': wind_ms, 'month': month},
            'source': weather_src,
            'observed': weather_observed,
            'effective_temp_c': te,
            'activity_index': round(act, 3),
            'components': {
                'temperature': {'score': tv, 'status': ts, 'effective_temp_c': te},
                'humidity':    {'score': hv, 'status': hs},
                'rainfall':    {'score': rv, 'status': rs},
                'wind':        {'score': wv, 'status': ws},
            },
            'comment': ('유효기온 ' + str(te) + '℃(당일 ' + str(temp_c) + '℃, 7일평균 '
                        + str(ta_7d_avg) + '℃), 습도 ' + str(humidity) + '%, 최근7일 강수 '
                        + str(rain_7d_mm) + 'mm, 풍속 ' + str(wind_ms) + 'm/s → 활동지수 '
                        + str(round(act, 2))),
        },
        'area': {
            'area_km2': rec['area_km2'],
            'population': rec['population'],
            'pop_density': rec['pop_density'],
            'pop_density_norm': rec['popd_norm'],
            'estimated': rec['pop_estimated'],
            'water_pct': rec['water_pct'],
            'park_m2_per_km2': rec['park_m2_per_km2'],
        },
        'source_risk': {
            'density_risk': round(geo, 3),
            'breed_density_per_km2': rec['breed_density'],
            'breed_density_norm': rec['breed_norm'],
            'pop_density_norm': rec['popd_norm'],
            'control_priority': rec['control_priority'],
            'control_priority_rank': pri_rank,
            'area_type': area_type,
            'top_sources': breakdown[:5],
            'total_facilities': sum(rec['sources'].values()),
            'comment': (('주요 발생원은 ' + top_name + '이며, 이 구역은 ' + area_type
                         + '입니다. 발생원 ' + format(sum(rec['sources'].values()), ',')
                         + '개소 / ' + str(rec['area_km2']) + '㎢.')
                        if top_name else '등록 발생원 없음'),
        },
        'larva_survey': {
            'surveyed': surveyed,
            'positive': rec.get('larva_positive', 0),
            'detection_rate': round(larva_rate, 3) if larva_rate is not None else None,
            'used_in_index': False,
            'note': ('발생원 시설의 관리상태 지표입니다. 민원밀도와 음의 상관(-0.715)이어서 '
                     '모기지수 산출에는 쓰지 않고, 시설 개선 우선순위 참고용으로만 제공합니다.'),
        },
        'ranking': {
            'rank': rank, 'total_districts': total,
            'percentile': round(100 * (total - rank + 1) / total, 1),
            'city_avg_index': city_avg,
            'vs_city_avg': round(index - city_avg, 1),
            'highest_district': {'name': top_district, 'index': top_val},
        },
        'complaints_2025': rec['complaints_2025'],
        'advice': {
            'citizen': _citizen_advice(lv, top_name),
            'authority': _authority_advice(rec, lv, rank, total, larva_rate),
        },
        'active_hours': active_hours,
        'recommended_repellent': repellent,
    }

def all_indices(month=None, live_weather=False, **wx):
    if live_weather and not wx:
        bulk = fetch_weather_bulk(list(DISTRICTS))
        if bulk is not None:
            res = []
            for d in DISTRICTS:
                w = bulk.get(d)
                if w:
                    res.append(mosquito_index(
                        d, month=month, temp_c=w['temp_c'], humidity=w['humidity'],
                        rain_7d_mm=w['rain_7d_mm'], ta_7d_avg=w['ta_7d_avg'],
                        wind_ms=w['wind_ms'], rain_today_mm=w['rain_today_mm']))
                else:
                    res.append(mosquito_index(d, month=month))
            return sorted(res, key=lambda x: -x['mosquito_index'])
    res = [mosquito_index(d, month=month, **wx) for d in DISTRICTS]
    return sorted(res, key=lambda x: -x['mosquito_index'])

def control_priority_ranking():
    """방제 우선순위(총부담 = 밀도위험 × 인구). 민원 건수와 스피어만 +0.765."""
    rows = [{'district': d, 'control_priority': DISTRICTS[d]['control_priority'],
             'density_risk': round(W_BREED * DISTRICTS[d]['breed_norm']
                                   + W_POPD * DISTRICTS[d]['popd_norm'], 3),
             'population': DISTRICTS[d]['population'],
             'area_km2': DISTRICTS[d]['area_km2'],
             'complaints_2025': DISTRICTS[d]['complaints_2025'],
             'data_gap': DISTRICTS[d]['data_gap']}
            for d in DISTRICTS]
    rows.sort(key=lambda r: -r['control_priority'])
    for i, r in enumerate(rows, 1):
        r['rank'] = i
    return rows

def list_districts():
    return list(DISTRICTS.keys())

if __name__ == '__main__':
    print(json.dumps(mosquito_index('활천동', temp_c=29, humidity=80, rain_7d_mm=50,
                                    ta_7d_avg=28, wind_ms=1.6),
                     ensure_ascii=False, indent=2))
    print('\n[7월 전 구역 모기지수]')
    for r in all_indices(month=7):
        print('  %-8s %5.1f  (%s)  민원 %d건%s'
              % (r['district'], r['mosquito_index'], r['grade'],
                 r['complaints_2025'], '  ※결측' if r['confidence']['reasons']['complaint_data'] != '보유' else ''))
    print('\n[방제 우선순위]')
    for r in control_priority_ranking():
        print('  %2d. %-8s 우선도 %5.1f  밀도위험 %.3f  인구 %s'
              % (r['rank'], r['district'], r['control_priority'],
                 r['density_risk'], format(r['population'], ',')))
