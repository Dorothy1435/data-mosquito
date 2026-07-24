# -*- coding: utf-8 -*-
"""
김해시 모기지수 모델 (PORTABLE / 리치 출력 버전)
================================================
이 파일 하나만 다른 앱/백엔드에 복사하면 됩니다. 외부 파일 의존성 없음(표준 math만).
날씨를 입력으로 받아 "최대한 풍부한 정보"를 한 번에 반환합니다.

사용 예:
    from mosquito_model_portable import mosquito_index, all_indices, list_districts
    r = mosquito_index('활천동', temp_c=29, humidity=80, rain_3d_mm=50)
    # 날씨 미입력 시 월별 평년값 사용:  mosquito_index('활천동', month=7)

반환 정보(요약):
    모기지수/등급/단계/색상/요약문, 기상분석(기온·습도·강수 적합도 분해),
    발생원분석(유형·주요발생원·위험기여율), 지역순위/시평균대비, 민원이력,
    행동요령(시민·방제당국), 모기 활동시간대, 추천 기피제

실서비스 전환:
  - (자동) live_weather=True 로 호출하면 Open-Meteo에서 실시간 날씨를 받아옵니다(표준 urllib만 사용).
  - (수동) SEASON(월평년값) 대신 기상청 값을 temp_c/humidity/rain_3d_mm 인자로 직접 넣어도 됩니다.

v2 보완점:
  A. 위험지수 실제화 — 발생원 '개수'뿐 아니라 실제 '유충 검출률'을 위험지수에 직접 반영.
  C. 실시간 기상 API — Open-Meteo 연동(fetch_weather), 표준 라이브러리만으로 동작.
  D. 불확실성 출력 — 단일 점수 대신 신뢰구간(low~high)과 신뢰도 등급을 함께 반환.

v3 보완점(인구 결합):
  E. 인구 노출도 결합 — 지역위험 = sqrt(발생잠재력 × 인구노출).
     발생원만 많고 인구 적은 농촌(한림 등) 과대평가를 자동 교정.
     발생잠재력(발생원+유충, 민원 미포함)은 민원과 스피어만 +0.58였으나,
     인구노출을 곱하면 +0.81로 개선(민원은 검증에만 사용 → 순환 없음).
  F. 서부 결측 처리 — 보건소 현장조사·민원 미제공 구역(DATA_GAP)은 '민원 0/조사 0'을
     안전이 아니라 결측으로 보고, 위험을 인구·발생원으로 추정 + 신뢰도 낮게 표기.
  주의: 면적(㎢) 데이터가 없어 '인구밀도'가 아닌 '인구수(노출 규모)'로 반영함.
        면적이 확보되면 발생원 밀도(발생원/면적)까지 추가 교정 가능.
"""
import math
import json

SRC_KOR = {'septic_sewage': '정화조/오수', 'livestock_farm': '축산농가', 'reservoir': '저수지', 'tire_shop': '타이어가게', 'waste_recycle': '폐기물재활용', 'waste_treat': '폐기물처리', 'water_feature': '수경시설', 'public_toilet': '공중화장실'}
RISK_W  = {'septic_sewage': 3.0, 'livestock_farm': 2.0, 'reservoir': 2.5, 'tire_shop': 2.0, 'waste_recycle': 1.5, 'waste_treat': 1.0, 'water_feature': 1.5, 'public_toilet': 0.5}

# 김해시 기본 좌표(시 중심). 구역별 정밀 좌표는 COORDS에 추가하면 우선 사용됨.
KIMHAE_CENTER = (35.2285, 128.8894)
# 구역별 대표 좌표(읍면동 중심부 근사값, lat, lon). Open-Meteo 격자(~1~11km)에 맞춰
# 구역별로 다른 날씨를 받아오게 함. ※ 근사 중심점이므로, 정밀도가 더 필요하면
# 통계청 행정동 경계의 공식 중심좌표로 교체 권장.
COORDS = {
    '활천동':   (35.243, 128.901),   # 시내 동부
    '북부동':   (35.262, 128.869),   # 시내 북부(삼계)
    '내외동':   (35.228, 128.869),   # 시내 중심
    '부원동':   (35.231, 128.884),   # 시내
    '동상동':   (35.234, 128.879),   # 시내(원도심)
    '회현동':   (35.224, 128.883),   # 시내 남부
    '칠산서부동': (35.213, 128.860),   # 남부
    '화목동':   (35.222, 128.857),   # 시내 서남
    '불암동':   (35.207, 128.927),   # 남동부(낙동강변)
    '장유':     (35.180, 128.804),   # 남부(율하·무계)
    '주촌면':   (35.227, 128.829),   # 서부
    '진례면':   (35.270, 128.787),   # 서부
    '진영읍':   (35.310, 128.741),   # 서부 끝
    '한림면':   (35.328, 128.804),   # 북서부
    '생림면':   (35.337, 128.889),   # 북부
    '상동면':   (35.323, 128.946),   # 북동부(낙동강변)
    '대동면':   (35.234, 128.984),   # 동부 끝(낙동강)
}

SEASON = {1:(3,50,5),2:(5,50,5),3:(10,55,10),4:(16,60,15),5:(21,65,20),6:(25,75,40),
          7:(28,82,60),8:(29,80,50),9:(24,75,30),10:(18,65,15),11:(11,60,10),12:(5,52,5)}

DISTRICTS = {
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
}

# --- (A) 유충 실태조사 결과: (조사건수, 양성건수). 실제 모기 번식의 직접 증거. ---
# 진영읍/진례면/한림면/장유는 조사 데이터가 없어(0,0) 발생원 기반으로만 추정함.
_LARVA = {
    '활천동': (212, 87), '한림면': (0, 0),   '진영읍': (0, 0),   '진례면': (0, 0),
    '상동면': (107, 75), '생림면': (158, 138), '주촌면': (112, 87), '북부동': (46, 23),
    '대동면': (83, 68),  '내외동': (74, 20),  '부원동': (146, 41), '회현동': (23, 10),
    '불암동': (10, 5),   '동상동': (36, 11),  '칠산서부동': (4, 1), '화목동': (11, 6),
    '장유': (0, 0),
}
for _d, (_s, _p) in _LARVA.items():
    if _d in DISTRICTS:
        DISTRICTS[_d]['larva_surveyed'] = _s
        DISTRICTS[_d]['larva_positive'] = _p

# --- (인구=노출도) 2026.6 주민등록 인구(외국인 제외). '누가 얼마나 물리나'를 보정 ---
# 모델 구역 기준 통합: 활천동 = 활천동+삼안동(행정동 병합), 장유 = 장유1·2·3동 합산.
# 화목동은 행정동 인구표에 없는 법정동 → 근사 추정값(★). POP_ESTIMATED로 표기.
POPULATION = {
    '활천동': 70234, '한림면': 6310, '상동면': 2852, '주촌면': 21646, '북부동': 80471,
    '생림면': 3294, '대동면': 4848, '진영읍': 52201, '부원동': 8722, '내외동': 66323,
    '진례면': 5370, '장유': 179538, '회현동': 7917, '불암동': 6393, '동상동': 8231,
    '칠산서부동': 8427, '화목동': 3000,
}
POP_ESTIMATED = {'화목동'}     # 행정동 인구표 미수록 → 근사 추정(신뢰도↓)

# 보건소 자료상 서부 등 일부 구역은 현장 유충조사·민원이 미제공(결측).
# 이들의 '민원 0 / 조사 0'은 안전이 아니라 결측이므로, 위험은 인구+발생원으로 추정하고
# 신뢰도는 낮게 표기한다(0을 안전으로 오판 금지).
DATA_GAP = {_d for _d in DISTRICTS if DISTRICTS[_d].get('larva_surveyed', 0) == 0}

_LOGP  = {_d: math.log(POPULATION[_d]) for _d in DISTRICTS}
_LGMIN, _LGMAX = min(_LOGP.values()), max(_LOGP.values())
def _exposure(district):
    """인구 노출도(0.15~1.0). 로그 정규화 — 인구가 많을수록 물릴 사람이 많다."""
    return 0.15 + 0.85 * (_LOGP[district] - _LGMIN) / (_LGMAX - _LGMIN)
for _d in DISTRICTS:
    DISTRICTS[_d]['population'] = POPULATION[_d]
    DISTRICTS[_d]['exposure']  = round(_exposure(_d), 3)
    DISTRICTS[_d]['data_gap']  = _d in DATA_GAP

_MAXS = {k: max((d['sources'].get(k,0) for d in DISTRICTS.values()), default=0) for k in SRC_KOR}

def _clamp(x, lo=0.0, hi=1.0): return max(lo, min(hi, x))

def _temp_suit(T):
    if T <= 10 or T >= 42:
        v = 0.0
    else:
        v = math.exp(-((T - 27.0) / 7.5) ** 2)
        if T < 14: v *= max(0.0, (T - 10) / 4.0)
    v = _clamp(v)
    if   T < 13: s = '저온 — 모기 활동 거의 정지'
    elif T < 18: s = '다소 낮음 — 활동 저조'
    elif T <= 30: s = '최적 — 번식·흡혈 활발'
    elif T <= 34: s = '고온 — 활동 다소 둔화'
    else: s = '폭염 — 활동 급감'
    return round(v,3), s

def _hum_suit(H):
    v = _clamp((H - 40) / 50.0)
    if   H < 50: s = '건조 — 모기 활동 억제'
    elif H < 70: s = '보통 — 활동 가능'
    else: s = '다습 — 활동 매우 활발'
    return round(v,3), s

def _rain_suit(R):
    if R <= 0:    v = 0.5; s = '강수 없음 — 기존 고인물 위주'
    elif R < 30:  v = 0.6 + 0.4 * (R / 30.0); s = '적당한 비 — 고인물 증가로 산란처 확대'
    elif R < 80:  v = 1.0 - 0.3 * ((R - 30) / 50.0); s = '많은 비 — 일부 유충 유실'
    else:         v = 0.5; s = '폭우 — 유충 다수 유실(일시적 감소)'
    return round(_clamp(v,0.3,1.0),3), s

# --- (웹 JS와 동일) '지금 이 순간' 보정: 시간대·풍속·현재강수·발육(GDD) ---
# 시간대별 활동 강도(0~1). 일몰 직후(19~22시)·새벽(04~06시) 피크, 한낮·심야 저조.
_HOUR_ACTIVITY = [
    0.55, 0.50, 0.50, 0.55, 0.80, 0.95,   # 0~5시 (4~5시 새벽 피크 시작)
    0.90, 0.70, 0.60, 0.55, 0.50, 0.50,   # 6~11시 (아침→한낮 하강)
    0.50, 0.50, 0.50, 0.50, 0.55, 0.65,   # 12~17시 (한낮 저조)
    0.85, 1.00, 1.00, 0.95, 0.85, 0.70,   # 18~23시 (일몰 직후 피크)
]
def _time_suit(hour):
    raw = _HOUR_ACTIVITY[(int(math.floor(hour)) % 24 + 24) % 24]
    if   raw >= 0.85: s = '활동 피크 — 일몰 직후·새벽'
    elif raw <= 0.55: s = '활동 저조 — 한낮·심야'
    else: s = '활동 보통 시간대'
    return round(raw, 3), s

def _wind_suit(wind_ms):
    """풍속 적합도: 강풍이면 모기가 비행을 못 해 흡혈 활동이 준다."""
    if wind_ms is None: return 1.0, '풍속 정보 없음'
    if   wind_ms <= 2: v, s = 1.0, '미풍 — 활동에 영향 적음'
    elif wind_ms <= 6: v, s = 1.0 - 0.4 * ((wind_ms - 2) / 4.0), '바람 — 비행 다소 억제'
    else: v, s = 0.6, '강풍 — 비행 억제'
    return round(v, 3), s

def _rain_now_suit(precip_now):
    """현재 강수 적합도: 지금 비가 오면 모기가 못 날아 활동이 일시적으로 준다."""
    if precip_now is None: return 1.0, '실시간 강수 정보 없음'
    if   precip_now <= 0.1: v, s = 1.0, '현재 비 없음'
    elif precip_now < 1.0:  v, s = 0.85, '약한 비 — 활동 다소 감소'
    else: v, s = 0.65, '비 내리는 중 — 활동 감소'
    return round(v, 3), s

def _behavior_factor(hour=None, wind_ms=None, precip_now=None):
    """번식 환경과 별개로 '지금 실제로 날아다니며 흡혈 가능한가'를 0.45~1.0으로 보정.
    입력이 없으면 1.0(보정 없음)이라 기존 계산과 동일하게 동작한다."""
    tm = 1.0 if hour is None else (0.6 + 0.4 * _time_suit(hour)[0])
    wm = _wind_suit(wind_ms)[0]
    rm = _rain_now_suit(precip_now)[0]
    return _clamp(tm * wm * rm, 0.45, 1.0)

def _dev_factor(gdd_14d=None):
    """발육 보정 — 최근 ~2주 누적온도(GDD, base 10.5℃)로 '성충이 나올 만큼 따뜻했나'.
    gdd 미제공 시 1.0(보정 없음). 봄·가을엔 누적온도 부족으로 활동 적합일이라도 개체수↓."""
    if gdd_14d is None: return 1.0
    return _clamp((gdd_14d - 40.0) / 140.0, 0.2, 1.0)

def weather_activity(temp_c, humidity, rain_3d_mm, hour=None, wind_ms=None, precip_now=None):
    t,_ = _temp_suit(temp_c); h,_ = _hum_suit(humidity); r,_ = _rain_suit(rain_3d_mm)
    env = 0.6 * h + 0.4 * r
    base = _clamp(t * (0.5 + 0.5 * env))
    return _clamp(base * _behavior_factor(hour, wind_ms, precip_now))

# ---------------------------------------------------------------------------
# (C) 실시간 기상 연동 — Open-Meteo (무료/키 불필요). 표준 라이브러리만 사용.
# ---------------------------------------------------------------------------
def fetch_weather(district=None, lat=None, lon=None, timeout=8):
    """Open-Meteo에서 현재 기온/습도 + 최근 3일 누적강수를 받아온다.
    실패 시 None을 반환 → 호출부가 월평년값(SEASON)으로 자동 대체."""
    import urllib.request, urllib.parse
    if lat is None or lon is None:
        lat, lon = COORDS.get(district, KIMHAE_CENTER)
    params = {
        'latitude': lat, 'longitude': lon,
        'hourly': 'temperature_2m,relative_humidity_2m',
        'daily': 'precipitation_sum',
        'past_days': 3, 'forecast_days': 1, 'timezone': 'Asia/Seoul',
    }
    url = 'https://api.open-meteo.com/v1/forecast?' + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            data = json.loads(resp.read().decode('utf-8'))
        temps = data['hourly']['temperature_2m']
        hums  = data['hourly']['relative_humidity_2m']
        temp_c   = next(v for v in reversed(temps) if v is not None)
        humidity = next(v for v in reversed(hums)  if v is not None)
        rain_3d  = sum(x for x in data['daily']['precipitation_sum'][:3] if x is not None)
        return {'temp_c': round(temp_c, 1), 'humidity': round(humidity),
                'rain_3d_mm': round(rain_3d, 1), 'source': 'open-meteo',
                'lat': lat, 'lon': lon}
    except Exception:
        return None

def fetch_weather_bulk(districts, timeout=12):
    """여러 구역의 날씨를 Open-Meteo 멀티좌표 기능으로 '한 번의 호출'에 받아온다.
    반환: {구역명: {temp_c, humidity, rain_3d_mm, source}}. 실패 시 None."""
    import urllib.request, urllib.parse
    lats, lons = [], []
    for d in districts:
        la, lo = COORDS.get(d, KIMHAE_CENTER)
        lats.append(str(la)); lons.append(str(lo))
    params = {
        'latitude': ','.join(lats), 'longitude': ','.join(lons),
        'hourly': 'temperature_2m,relative_humidity_2m',
        'daily': 'precipitation_sum',
        'past_days': 3, 'forecast_days': 1, 'timezone': 'Asia/Seoul',
    }
    url = 'https://api.open-meteo.com/v1/forecast?' + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            data = json.loads(resp.read().decode('utf-8'))
        if isinstance(data, dict):   # 좌표 1개면 dict, 여러 개면 list로 옴
            data = [data]
        out = {}
        for d, loc in zip(districts, data):
            temps = loc['hourly']['temperature_2m']
            hums  = loc['hourly']['relative_humidity_2m']
            temp_c   = next(v for v in reversed(temps) if v is not None)
            humidity = next(v for v in reversed(hums)  if v is not None)
            rain_3d  = sum(x for x in loc['daily']['precipitation_sum'][:3] if x is not None)
            out[d] = {'temp_c': round(temp_c, 1), 'humidity': round(humidity),
                      'rain_3d_mm': round(rain_3d, 1), 'source': 'open-meteo'}
        return out
    except Exception:
        return None

def grade(index):
    if index < 25: return (1,'쾌적','#3b82f6')
    if index < 50: return (2,'관심','#22c55e')
    if index < 75: return (3,'주의','#f59e0b')
    return (4,'불쾌','#ef4444')

def _source_breakdown(rec):
    contrib = {}
    for k, cnt in rec['sources'].items():
        mx = _MAXS.get(k, 0)
        contrib[k] = (cnt / mx if mx > 0 else 0.0) * RISK_W.get(k, 1.0)
    tot = sum(contrib.values()) or 1.0
    rows = []
    for k in sorted(contrib, key=lambda x: -contrib[x]):
        if rec['sources'].get(k,0) > 0:
            rows.append({'source': SRC_KOR[k], 'count': rec['sources'][k],
                         'risk_contribution_pct': round(100*contrib[k]/tot, 1)})
    return rows

def _citizen_advice(level, top_source_name):
    base = {1:['특별한 조치가 필요 없습니다.'],
            2:['야간 외출 시 가벼운 기피제를 사용하세요.','집 주변 화분받침·빈 용기의 고인물을 비우세요.'],
            3:['방충망·기피제를 사용하고 야간 활동을 줄이세요.','집 주변 정화조·하수구 뚜껑 주변을 점검하세요.','고인물 용기를 뒤집어 두세요.'],
            4:['야외활동을 자제하고 긴팔·긴바지를 착용하세요.','농도 높은 기피제(DEET·이카리딘)를 사용하세요.','집 안팎 모든 고인물을 즉시 제거하세요.']}[level]
    tip = {'정화조/오수':'하수구·정화조 환기구 주변에 모기가 모일 수 있습니다.',
           '타이어가게':'야적된 폐타이어에 빗물이 고이지 않게 관리가 필요합니다.',
           '수경시설':'분수·바닥분수 등 정체수 주변을 피하세요.',
           '축산농가':'축사 주변 분뇨·물웅덩이에서 모기가 다량 발생할 수 있습니다.',
           '저수지':'저수지 가장자리 정체수 구역을 주의하세요.',
           '공중화장실':'공중화장실 주변 정화조에서 유충이 생길 수 있습니다.'}.get(top_source_name)
    return base + ([tip] if tip and level >= 2 else [])

def _authority_advice(level, rank, total, complaints, data_gap=False):
    a = []
    if level >= 3: a.append('취약구역 방역 주기를 단축하고 유문등·포충기 가동을 강화하세요.')
    if rank <= max(3, total//5): a.append('본 구역은 방제 우선순위 상위(' + str(rank) + '/' + str(total) + ')입니다. 정화조·하수구 유충구제(라바사이드)를 선제 시행하세요.')
    if data_gap:
        a.append('보건소 현장 유충조사·민원 자료가 없는 결측 구역입니다 — 인구·발생원 기반 추정치이므로, 우선 현장 유충조사를 실시해 데이터를 확보하세요.')
    elif complaints == 0 and level >= 3:
        a.append('발생원은 많으나 민원 기록이 없는 사각지대입니다 — 민원 발생 전 선제 점검을 권장합니다.')
    if not a: a.append('정기 방역 주기를 유지하세요.')
    return a

# ---------------------------------------------------------------------------
# (A) 발생 잠재력(breeding) — 발생원 시설(risk_index)에 '실제 유충 검출률'을 결합.
#     민원은 넣지 않는다(검증 타겟이므로 순환 방지). 표본 많을수록 경험비중↑(최대 60%).
# ---------------------------------------------------------------------------
def _breeding(rec):
    facility = rec['risk_index'] / 100.0                    # 순수 발생원 시설(0~1, 민원 미포함)
    surveyed = rec.get('larva_surveyed', 0)
    positive = rec.get('larva_positive', 0)
    larva_rate = (positive / surveyed) if surveyed > 0 else None
    if surveyed >= 10:
        w = min(1.0, surveyed / 100.0) * 0.6               # 표본 100건이면 경험 비중 60%
        b = (1 - w) * facility + w * larva_rate
        basis = 'facility+larva'
    else:
        b, w, basis = facility, 0.0, 'facility_only'        # 조사 미실시(서부 결측 등)
    return _clamp(b), w, basis, larva_rate

# ---------------------------------------------------------------------------
# (인구 결합) 최종 지역위험 = sqrt(발생잠재력 × 인구노출).
#   "많이 생기고(breeding) + 많이 물리는(exposure)" 곳이 진짜 위험.
#   ⇒ 발생원만 많고 인구 적은 농촌(한림 등) 과대평가를 자동 교정.
#   검증: 민원 완전 제외한 이 지수 ↔ 실제 민원 스피어만 +0.81 (발생원 단독 +0.58).
# ---------------------------------------------------------------------------
def _geo_effective(rec):
    """반환: (geo, larva_w, basis, larva_rate, breeding, exposure)"""
    breeding, w, basis, larva_rate = _breeding(rec)
    exposure = rec.get('exposure', 0.15)
    geo = math.sqrt(breeding * exposure)
    return _clamp(geo), w, basis, larva_rate, round(breeding, 3), round(exposure, 3)

# ---------------------------------------------------------------------------
# (D) 불확실성 — 날씨가 실측인지/유충표본이 충분한지에 따라 신뢰구간 폭 결정.
# ---------------------------------------------------------------------------
def _confidence(weather_observed, surveyed, pop_estimated=False):
    wu = 0.06 if weather_observed else 0.22                 # 날씨 불확실성(실측 vs 평년값)
    if   surveyed >= 100: su = 0.06
    elif surveyed >= 30:  su = 0.12
    elif surveyed >= 1:   su = 0.18
    else:                 su = 0.25                         # 유충 조사 없음(서부 결측 등) → 추정 의존
    pu = 0.10 if pop_estimated else 0.0                    # 인구 추정값(화목동 등) 불확실성
    u = (wu ** 2 + su ** 2 + pu ** 2) ** 0.5               # 결합 상대 불확실성
    label = '높음' if u < 0.13 else ('보통' if u < 0.21 else '낮음')
    return u, label, wu, su

def mosquito_index(district, month=None, temp_c=None, humidity=None, rain_3d_mm=None,
                   live_weather=False, hour=None, wind_ms=None, precip_now=None, gdd_14d=None):
    if district not in DISTRICTS:
        raise KeyError("unknown district: " + str(district))
    if month is None: month = 6

    # 날씨가 실측/직접입력인지(불확실성 낮음) vs 월평년값 대체인지(불확실성 높음) 판단
    caller_provided = temp_c is not None
    weather_observed = False
    weather_src = 'manual' if caller_provided else 'climatology'

    # (C) 실시간 날씨: 명시 입력이 없고 live_weather=True면 Open-Meteo 조회
    if live_weather and temp_c is None and humidity is None and rain_3d_mm is None:
        live = fetch_weather(district)
        if live is not None:
            temp_c, humidity, rain_3d_mm = live['temp_c'], live['humidity'], live['rain_3d_mm']
            weather_observed = True
            weather_src = live['source']

    # 신뢰도 계산용: 실측 또는 직접입력이면 날씨 불확실성 낮음
    weather_known = weather_observed or caller_provided

    st, sh, sr = SEASON.get(month, (22,65,20))
    temp_c     = st if temp_c     is None else temp_c
    humidity   = sh if humidity   is None else humidity
    rain_3d_mm = sr if rain_3d_mm is None else rain_3d_mm

    tv, ts = _temp_suit(temp_c); hv, hs = _hum_suit(humidity); rv, rs = _rain_suit(rain_3d_mm)
    wv, ws = _wind_suit(wind_ms); nv, ns = _rain_now_suit(precip_now)
    time_v, time_s = (_time_suit(hour) if hour is not None else (None, '시간대 정보 없음'))
    act = weather_activity(temp_c, humidity, rain_3d_mm, hour, wind_ms, precip_now)
    dev = _dev_factor(gdd_14d)                              # 발육 보정(GDD). 미제공 시 1.0
    bfac = _behavior_factor(hour, wind_ms, precip_now)      # 시간대·풍속·현재강수 보정
    rec = DISTRICTS[district]
    geo, larva_w, geo_basis, larva_rate, breeding, exposure = _geo_effective(rec)  # 발생원×인구
    index = round(100 * act * dev * (0.35 + 0.65 * geo), 1)
    lv, nm, col = grade(index)
    data_gap = rec.get('data_gap', False)
    pop_estimated = district in POP_ESTIMATED

    # (D) 신뢰구간: 날씨 실측/입력 여부 + 유충 표본 수 + 인구 추정 여부
    u, conf_label, wu, su = _confidence(weather_known, rec.get('larva_surveyed', 0), pop_estimated)
    band_low  = round(max(0.0,   index * (1 - u)), 1)
    band_high = round(min(100.0, index * (1 + u)), 1)

    breakdown = _source_breakdown(rec)
    top_name = breakdown[0]['source'] if breakdown else None
    area_type = '농촌형(축산·정화조 밀집)' if district.endswith(('읍','면')) else '도심형(생활하수·타이어·수경시설)'

    all_idx = sorted(((d, round(100*act*dev*(0.35+0.65*_geo_effective(DISTRICTS[d])[0]),1))
                      for d in DISTRICTS), key=lambda x:-x[1])
    rank = [d for d,_ in all_idx].index(district) + 1
    total = len(all_idx)
    city_avg = round(sum(v for _,v in all_idx)/total, 1)
    top_district, top_val = all_idx[0]

    active_hours = '일몰 직후(19~22시)와 새벽(04~06시)에 가장 활발' if lv >= 2 else '활동 미약'
    repellent = {1:'불필요', 2:'가벼운 기피제(시트로넬라 등)',
                 3:'DEET 10~20% 또는 이카리딘 + 긴팔 권장',
                 4:'DEET 20%+ 또는 이카리딘 고농도, 노출 최소화'}[lv]

    act_txt = '고온다습한 날씨로 모기 활동이 왕성' if act>=0.6 else ('선선한 날씨로 활동이 제한적' if act<0.3 else '보통 수준의 활동')
    return {
        'district': district,
        'mosquito_index': index,
        'index_range': {'low': band_low, 'high': band_high},
        'confidence': {
            'level': conf_label,
            'uncertainty_pct': round(100*u, 1),
            'reasons': {
                'weather': ('실측(Open-Meteo)' if weather_observed
                            else ('직접입력' if caller_provided else '월평년값(추정)')),
                'larva_sample': rec.get('larva_surveyed', 0),
                'population': '추정값' if pop_estimated else '주민등록',
                'data_gap': data_gap,
            },
            'note': ('⚠ 보건소 현장조사·민원 미제공 구역 — 위험은 인구·발생원으로 추정(민원 0을 안전으로 보지 마세요).'
                     if data_gap else None),
        },
        'level': lv, 'grade': nm, 'color': col,
        'summary': district + '의 모기지수는 ' + str(index) + '점(' + str(lv) + '단계 ' + nm
                   + ', 신뢰도 ' + conf_label + ', ' + str(band_low) + '~' + str(band_high) + '점)입니다. '
                   + act_txt + '하며, 발생 잠재력 ' + str(round(breeding*100)) + '점 × 인구노출('
                   + format(rec['population'], ',') + '명)을 결합해 시내 ' + str(rank) + '/' + str(total) + '위입니다.'
                   + (' ※ 서부 등 현장조사 미제공 구역으로 추정치입니다.' if data_gap else ''),
        'weather': {
            'input': {'temp_c': temp_c, 'humidity': humidity, 'rain_3d_mm': rain_3d_mm, 'month': month,
                      'wind_ms': wind_ms, 'precip_now': precip_now, 'hour': hour},
            'source': weather_src,
            'observed': weather_observed,
            'activity_index': round(act,3),
            'behavior_factor': round(bfac,3),                  # 시간대·풍속·현재강수 보정(1.0=보정없음)
            'development_factor': round(dev,3),                # 발육 보정(GDD, 1.0=보정없음)
            'gdd_14d': gdd_14d,
            'components': {
                'temperature':  {'score': tv, 'status': ts},
                'humidity':     {'score': hv, 'status': hs},
                'rainfall':     {'score': rv, 'status': rs},
                'wind':         {'score': wv, 'status': ws},
                'time_of_day':  {'score': time_v, 'status': time_s},
                'current_rain': {'score': nv, 'status': ns},
            },
            'comment': '기온 ' + str(temp_c) + '℃, 습도 ' + str(humidity) + '%, 최근3일 강수 '
                       + str(rain_3d_mm) + 'mm'
                       + ((', 풍속 ' + str(wind_ms) + 'm/s') if wind_ms is not None else '')
                       + ((', ' + str(hour) + '시') if hour is not None else '')
                       + ' 기준 활동지수 ' + str(round(act,2))
                       + ((' (시간대·바람·현재 강수로 ' + str(round((1-bfac)*100)) + '% 하향)') if bfac < 0.999 else ''),
        },
        'exposure': {
            'population': rec['population'],
            'exposure_index': round(exposure, 3),
            'estimated': pop_estimated,
            'comment': '인구 ' + format(rec['population'], ',') + '명 → 노출도 ' + str(round(exposure,2))
                       + (' (인구표 미수록, 추정)' if pop_estimated else '')
                       + '. 발생 잠재력과 결합해 실제 피해규모를 보정.',
        },
        'source_risk': {
            'score': rec['control_priority'],
            'raw_risk_index': rec['risk_index'],
            'breeding_potential': round(breeding, 3),
            'exposure_index': round(exposure, 3),
            'effective_geo': round(geo, 3),
            'larva': {
                'surveyed': rec.get('larva_surveyed', 0),
                'positive': rec.get('larva_positive', 0),
                'detection_rate': round(larva_rate, 3) if larva_rate is not None else None,
                'weight_in_geo': round(larva_w, 2),
                'basis': geo_basis,
            },
            'area_type': area_type,
            'top_sources': breakdown[:5],
            'comment': ('주요 발생원은 ' + top_name + '이며, 이 구역은 ' + area_type + '입니다.'
                        + (' 유충 검출률 ' + str(round(100*larva_rate)) + '%로 실측 반영됨.' if larva_rate is not None else ' (유충 조사 미실시 — 발생원 추정.)'))
                       if top_name else '등록 발생원 없음',
        },
        'ranking': {
            'rank': rank, 'total_districts': total,
            'percentile': round(100*(total-rank+1)/total, 1),
            'city_avg_index': city_avg,
            'vs_city_avg': round(index - city_avg, 1),
            'highest_district': {'name': top_district, 'index': top_val},
        },
        'complaints_2025': rec['complaints'],
        'advice': {
            'citizen': _citizen_advice(lv, top_name),
            'authority': _authority_advice(lv, rank, total, rec['complaints'], data_gap),
        },
        'active_hours': active_hours,
        'recommended_repellent': repellent,
    }

def all_indices(month=None, live_weather=False, **wx):
    # live_weather일 때 구역별 좌표로 '한 번의 호출'에 17개 날씨를 받아 각각 적용
    if live_weather and not wx:
        bulk = fetch_weather_bulk(list(DISTRICTS))
        if bulk is not None:
            res = []
            for d in DISTRICTS:
                w = bulk.get(d)
                if w:
                    res.append(mosquito_index(d, month=month, temp_c=w['temp_c'],
                                              humidity=w['humidity'], rain_3d_mm=w['rain_3d_mm']))
                else:
                    res.append(mosquito_index(d, month=month))
            return sorted(res, key=lambda x:-x['mosquito_index'])
    res = [mosquito_index(d, month=month, **wx) for d in DISTRICTS]
    return sorted(res, key=lambda x:-x['mosquito_index'])

def list_districts():
    return list(DISTRICTS.keys())

if __name__ == '__main__':
    # 1) 수동 입력 (유충 데이터 있는 구역 → 신뢰도 높음)
    print(json.dumps(mosquito_index('활천동', temp_c=29, humidity=80, rain_3d_mm=50),
                     ensure_ascii=False, indent=2))
    # 2) 유충 조사 미실시 구역 → 신뢰도 낮음 + 발생원 추정 표시
    r = mosquito_index('한림면', temp_c=29, humidity=80, rain_3d_mm=50)
    print('\n[한림면]', r['mosquito_index'], r['index_range'], '신뢰도', r['confidence']['level'])
    # 3) 실시간 날씨 (인터넷 필요; 실패 시 자동으로 평년값 사용)
    # print(json.dumps(mosquito_index('활천동', live_weather=True), ensure_ascii=False, indent=2))
