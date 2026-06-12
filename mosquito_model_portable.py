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

실서비스 전환: SEASON(월평년값)을 기상청/Open-Meteo API 값으로 바꿔 temp_c/humidity/rain_3d_mm에 넣으면 됩니다.
"""
import math

SRC_KOR = {'septic_sewage': '정화조/오수', 'livestock_farm': '축산농가', 'reservoir': '저수지', 'tire_shop': '타이어가게', 'waste_recycle': '폐기물재활용', 'waste_treat': '폐기물처리', 'water_feature': '수경시설', 'public_toilet': '공중화장실'}
RISK_W  = {'septic_sewage': 3.0, 'livestock_farm': 2.0, 'reservoir': 2.5, 'tire_shop': 2.0, 'waste_recycle': 1.5, 'waste_treat': 1.0, 'water_feature': 1.5, 'public_toilet': 0.5}

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

def weather_activity(temp_c, humidity, rain_3d_mm):
    t,_ = _temp_suit(temp_c); h,_ = _hum_suit(humidity); r,_ = _rain_suit(rain_3d_mm)
    env = 0.6 * h + 0.4 * r
    return _clamp(t * (0.5 + 0.5 * env))

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

def _authority_advice(level, rank, total, complaints):
    a = []
    if level >= 3: a.append('취약구역 방역 주기를 단축하고 유문등·포충기 가동을 강화하세요.')
    if rank <= max(3, total//5): a.append('본 구역은 방제 우선순위 상위(' + str(rank) + '/' + str(total) + ')입니다. 정화조·하수구 유충구제(라바사이드)를 선제 시행하세요.')
    if complaints == 0 and level >= 3: a.append('발생원은 많으나 민원 기록이 없는 사각지대입니다 — 민원 발생 전 선제 점검을 권장합니다.')
    if not a: a.append('정기 방역 주기를 유지하세요.')
    return a

def mosquito_index(district, month=None, temp_c=None, humidity=None, rain_3d_mm=None):
    if district not in DISTRICTS:
        raise KeyError("unknown district: " + str(district))
    if month is None: month = 6
    st, sh, sr = SEASON.get(month, (22,65,20))
    temp_c     = st if temp_c     is None else temp_c
    humidity   = sh if humidity   is None else humidity
    rain_3d_mm = sr if rain_3d_mm is None else rain_3d_mm

    tv, ts = _temp_suit(temp_c); hv, hs = _hum_suit(humidity); rv, rs = _rain_suit(rain_3d_mm)
    act = weather_activity(temp_c, humidity, rain_3d_mm)
    rec = DISTRICTS[district]
    geo = rec['control_priority'] / 100.0
    index = round(100 * act * (0.35 + 0.65 * geo), 1)
    lv, nm, col = grade(index)

    breakdown = _source_breakdown(rec)
    top_name = breakdown[0]['source'] if breakdown else None
    area_type = '농촌형(축산·정화조 밀집)' if district.endswith(('읍','면')) else '도심형(생활하수·타이어·수경시설)'

    all_idx = sorted(((d, round(100*act*(0.35+0.65*DISTRICTS[d]['control_priority']/100.0),1))
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
        'level': lv, 'grade': nm, 'color': col,
        'summary': district + '의 모기지수는 ' + str(index) + '점(' + str(lv) + '단계 ' + nm + ')입니다. '
                   + act_txt + '하며, 발생원 위험은 ' + str(rec['control_priority'])
                   + '점(시내 ' + str(rank) + '/' + str(total) + '위)입니다.',
        'weather': {
            'input': {'temp_c': temp_c, 'humidity': humidity, 'rain_3d_mm': rain_3d_mm, 'month': month},
            'activity_index': round(act,3),
            'components': {
                'temperature': {'score': tv, 'status': ts},
                'humidity':    {'score': hv, 'status': hs},
                'rainfall':    {'score': rv, 'status': rs},
            },
            'comment': '기온 ' + str(temp_c) + '℃, 습도 ' + str(humidity) + '%, 최근3일 강수 '
                       + str(rain_3d_mm) + 'mm 기준 활동지수 ' + str(round(act,2)),
        },
        'source_risk': {
            'score': rec['control_priority'],
            'raw_risk_index': rec['risk_index'],
            'area_type': area_type,
            'top_sources': breakdown[:5],
            'comment': ('주요 발생원은 ' + top_name + '이며, 이 구역은 ' + area_type + '입니다.') if top_name else '등록 발생원 없음',
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
            'authority': _authority_advice(lv, rank, total, rec['complaints']),
        },
        'active_hours': active_hours,
        'recommended_repellent': repellent,
    }

def all_indices(month=None, **wx):
    res = [mosquito_index(d, month=month, **wx) for d in DISTRICTS]
    return sorted(res, key=lambda x:-x['mosquito_index'])

def list_districts():
    return list(DISTRICTS.keys())

if __name__ == '__main__':
    import json
    print(json.dumps(mosquito_index('활천동', temp_c=29, humidity=80, rain_3d_mm=50),
                     ensure_ascii=False, indent=2))
