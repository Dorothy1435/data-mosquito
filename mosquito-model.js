/*
 * 김해시 모기지수 모델 v4 (브라우저용 JavaScript 포팅)
 * ============================================================
 * 원본: mosquito_model_portable.py (v4). 면적을 확보해 '개수' → '밀도'로 전환한 모델.
 *   모기지수 = 100 × 기상활동지수 × (0.30 + 0.70 × 밀도위험)
 *   밀도위험 = 0.5 × norm(log(발생원밀도)) + 0.5 × norm(log(인구밀도))
 * 검증: 2025 좌표기반 방역민원 밀도와 스피어만 +0.951 (v3는 -0.258로 방향이 반대였음).
 * 유충 검출률은 민원밀도와 음의 상관(-0.715)이라 위험지수에서 제외하고 '시설 관리상태'로만 출력.
 * 외부 의존성 없음. window.GimhaeMosquitoModel 로 사용.
 */
(function (global) {
  'use strict';

  const BRIERE = {"a": 0.000501846, "T0": 10.5, "Tm": 40.0, "m": 1.164};
  const BRIERE_NORM = 2.124484;
  const TA_TODAY_W = 0.287;
  const HUM_BASE = 0.648, HUM_SLOPE = 0.02;
  const RAIN_W = 0.038, WIND_W = 0.096;
  const BREED_LOG_RANGE = [3.2027, 6.2613];
  const POPD_LOG_RANGE = [3.7548, 9.4315];
  const W_BREED = 0.5, W_POPD = 0.5;
  const SEASON = {"1": [1.9, 2.1, 43.7, 0.5, 2.0], "2": [3.7, 3.0, 45.6, 5.9, 2.0], "3": [9.6, 9.2, 58.6, 8.2, 1.7], "4": [14.2, 13.7, 58.7, 27.8, 2.0], "5": [18.5, 18.0, 72.2, 25.1, 1.8], "6": [23.3, 22.9, 76.2, 32.5, 1.8], "7": [27.2, 27.0, 79.3, 51.5, 1.7], "8": [26.8, 26.9, 78.4, 45.2, 2.1], "9": [23.1, 23.7, 74.3, 40.9, 1.9], "10": [16.7, 17.6, 68.8, 19.4, 2.0], "11": [9.8, 10.1, 56.9, 8.1, 2.0], "12": [4.7, 5.3, 49.9, 11.5, 2.1]};
  const SRC_KOR = {"septic_clean": "정화조(청소대상)", "septic_private": "개인하수처리시설", "wwtp_private": "개인오수처리시설", "wwtp_public": "공공하수처리시설", "livestock": "축산농가", "reservoir": "저수지", "tire_shop": "타이어가게", "waste_tire": "폐타이어적치", "waste_stk": "폐기물처리업", "junk_shop": "고물상", "water_feature": "수경시설", "toilet": "공중화장실", "park": "도시공원", "bathhouse": "목욕장", "waterpump": "배수펌프장", "bee_farm": "양봉농가"};
  const RISK_W = {"septic_clean": 3.0, "septic_private": 3.0, "wwtp_private": 2.5, "wwtp_public": 1.0, "livestock": 2.0, "reservoir": 2.5, "tire_shop": 2.0, "waste_tire": 2.5, "waste_stk": 1.5, "junk_shop": 1.5, "water_feature": 1.5, "toilet": 0.5, "park": 1.0, "bathhouse": 0.5, "waterpump": 1.5, "bee_farm": 0.3};
  const COORDS = {"활천동": [35.243, 128.901], "북부동": [35.262, 128.869], "내외동": [35.228, 128.869], "부원동": [35.231, 128.884], "동상동": [35.234, 128.879], "회현동": [35.224, 128.883], "칠산서부동": [35.213, 128.86], "화목동": [35.222, 128.857], "불암동": [35.207, 128.927], "장유": [35.18, 128.804], "주촌면": [35.227, 128.829], "진례면": [35.27, 128.787], "진영읍": [35.31, 128.741], "한림면": [35.328, 128.804], "생림면": [35.337, 128.889], "상동면": [35.323, 128.946], "대동면": [35.234, 128.984]};
  const DATA_GAP = new Set(["장유", "진례면", "진영읍", "한림면"]);
  const POP_ESTIMATED = new Set(["화목동"]);
  const DISTRICTS = {"활천동": {"area_km2": 17.2, "population": 71086, "pop_density": 4133.0, "breed_density": 112.9, "density_risk": 0.6532, "control_priority": 86.4, "complaints_2025": 87, "water_pct": 0.251, "park_m2_per_km2": 11664, "larva_surveyed": 212, "larva_positive": 87, "sources": {"septic_clean": 232, "septic_private": 308, "wwtp_private": 58, "wwtp_public": 0, "livestock": 1, "reservoir": 0, "tire_shop": 14, "waste_tire": 0, "waste_stk": 6, "junk_shop": 21, "water_feature": 13, "toilet": 69, "park": 38, "bathhouse": 18, "waterpump": 4, "bee_farm": 0}, "data_gap": false, "pop_estimated": false, "breed_norm": 0.5011, "popd_norm": 0.8054}, "북부동": {"area_km2": 13.79, "population": 80819, "pop_density": 5859.7, "breed_density": 36.2, "density_risk": 0.501, "control_priority": 84.2, "complaints_2025": 42, "water_pct": 0.101, "park_m2_per_km2": 22038, "larva_surveyed": 46, "larva_positive": 23, "sources": {"septic_clean": 45, "septic_private": 61, "wwtp_private": 29, "wwtp_public": 0, "livestock": 0, "reservoir": 3, "tire_shop": 6, "waste_tire": 0, "waste_stk": 3, "junk_shop": 5, "water_feature": 10, "toilet": 53, "park": 30, "bathhouse": 12, "waterpump": 0, "bee_farm": 0}, "data_gap": false, "pop_estimated": false, "breed_norm": 0.1352, "popd_norm": 0.8669}, "내외동": {"area_km2": 5.41, "population": 67448, "pop_density": 12474.7, "breed_density": 85.6, "density_risk": 0.7057, "control_priority": 87.0, "complaints_2025": 35, "water_pct": 0.495, "park_m2_per_km2": 41414, "larva_surveyed": 74, "larva_positive": 20, "sources": {"septic_clean": 34, "septic_private": 88, "wwtp_private": 8, "wwtp_public": 0, "livestock": 0, "reservoir": 1, "tire_shop": 6, "waste_tire": 1, "waste_stk": 0, "junk_shop": 3, "water_feature": 3, "toilet": 38, "park": 26, "bathhouse": 11, "waterpump": 0, "bee_farm": 1}, "data_gap": false, "pop_estimated": false, "breed_norm": 0.4115, "popd_norm": 1.0}, "부원동": {"area_km2": 2.0, "population": 8811, "pop_density": 4408.9, "breed_density": 282.7, "density_risk": 0.8081, "control_priority": 40.7, "complaints_2025": 25, "water_pct": 0.027, "park_m2_per_km2": 4307, "larva_surveyed": 146, "larva_positive": 41, "sources": {"septic_clean": 47, "septic_private": 127, "wwtp_private": 7, "wwtp_public": 0, "livestock": 0, "reservoir": 0, "tire_shop": 1, "waste_tire": 0, "waste_stk": 0, "junk_shop": 2, "water_feature": 1, "toilet": 25, "park": 5, "bathhouse": 3, "waterpump": 0, "bee_farm": 0}, "data_gap": false, "pop_estimated": false, "breed_norm": 0.7995, "popd_norm": 0.8168}, "동상동": {"area_km2": 1.74, "population": 8403, "pop_density": 4826.7, "breed_density": 178.1, "density_risk": 0.7409, "control_priority": 38.5, "complaints_2025": 9, "water_pct": 0.03, "park_m2_per_km2": 4899, "larva_surveyed": 36, "larva_positive": 11, "sources": {"septic_clean": 27, "septic_private": 65, "wwtp_private": 1, "wwtp_public": 0, "livestock": 0, "reservoir": 0, "tire_shop": 6, "waste_tire": 0, "waste_stk": 0, "junk_shop": 4, "water_feature": 0, "toilet": 13, "park": 5, "bathhouse": 3, "waterpump": 0, "bee_farm": 2}, "data_gap": false, "pop_estimated": false, "breed_norm": 0.6491, "popd_norm": 0.8328}, "회현동": {"area_km2": 1.14, "population": 7981, "pop_density": 6979.1, "breed_density": 522.9, "density_risk": 0.9488, "control_priority": 41.7, "complaints_2025": 32, "water_pct": 0.377, "park_m2_per_km2": 102946, "larva_surveyed": 23, "larva_positive": 10, "sources": {"septic_clean": 58, "septic_private": 123, "wwtp_private": 12, "wwtp_public": 0, "livestock": 0, "reservoir": 0, "tire_shop": 1, "waste_tire": 0, "waste_stk": 0, "junk_shop": 1, "water_feature": 2, "toilet": 13, "park": 6, "bathhouse": 3, "waterpump": 3, "bee_farm": 0}, "data_gap": false, "pop_estimated": false, "breed_norm": 1.0, "popd_norm": 0.8977}, "칠산서부동": {"area_km2": 11.94, "population": 7362, "pop_density": 616.8, "breed_density": 76.8, "density_risk": 0.4235, "control_priority": 28.8, "complaints_2025": 27, "water_pct": 0.229, "park_m2_per_km2": 1603, "larva_surveyed": 4, "larva_positive": 1, "sources": {"septic_clean": 121, "septic_private": 82, "wwtp_private": 67, "wwtp_public": 0, "livestock": 13, "reservoir": 0, "tire_shop": 10, "waste_tire": 0, "waste_stk": 3, "junk_shop": 34, "water_feature": 1, "toilet": 30, "park": 12, "bathhouse": 1, "waterpump": 6, "bee_farm": 2}, "data_gap": false, "pop_estimated": false, "breed_norm": 0.3765, "popd_norm": 0.4706}, "화목동": {"area_km2": 7.82, "population": 1250, "pop_density": 159.9, "breed_density": 61.2, "density_risk": 0.2685, "control_priority": 12.0, "complaints_2025": 10, "water_pct": 0.011, "park_m2_per_km2": 1631, "larva_surveyed": 11, "larva_positive": 6, "sources": {"septic_clean": 81, "septic_private": 36, "wwtp_private": 15, "wwtp_public": 2, "livestock": 15, "reservoir": 0, "tire_shop": 2, "waste_tire": 0, "waste_stk": 2, "junk_shop": 28, "water_feature": 1, "toilet": 1, "park": 7, "bathhouse": 0, "waterpump": 0, "bee_farm": 0}, "data_gap": false, "pop_estimated": true, "breed_norm": 0.3033, "popd_norm": 0.2336}, "불암동": {"area_km2": 2.55, "population": 6458, "pop_density": 2528.9, "breed_density": 184.7, "density_risk": 0.6899, "control_priority": 33.9, "complaints_2025": 29, "water_pct": 0.0, "park_m2_per_km2": 1836, "larva_surveyed": 10, "larva_positive": 5, "sources": {"septic_clean": 49, "septic_private": 69, "wwtp_private": 30, "wwtp_public": 0, "livestock": 0, "reservoir": 0, "tire_shop": 4, "waste_tire": 0, "waste_stk": 1, "junk_shop": 12, "water_feature": 1, "toilet": 12, "park": 5, "bathhouse": 2, "waterpump": 1, "bee_farm": 0}, "data_gap": false, "pop_estimated": false, "breed_norm": 0.6609, "popd_norm": 0.7189}, "장유": {"area_km2": 55.52, "population": 177769, "pop_density": 3201.9, "breed_density": 23.6, "density_risk": 0.3802, "control_priority": 100.0, "complaints_2025": 0, "water_pct": 0.205, "park_m2_per_km2": 12022, "larva_surveyed": 0, "larva_positive": 0, "sources": {"septic_clean": 119, "septic_private": 116, "wwtp_private": 154, "wwtp_public": 0, "livestock": 8, "reservoir": 7, "tire_shop": 14, "waste_tire": 0, "waste_stk": 7, "junk_shop": 4, "water_feature": 21, "toilet": 84, "park": 62, "bathhouse": 0, "waterpump": 2, "bee_farm": 14}, "data_gap": true, "pop_estimated": false, "breed_norm": 0.0, "popd_norm": 0.7605}, "주촌면": {"area_km2": 31.29, "population": 19804, "pop_density": 632.8, "breed_density": 56.7, "density_risk": 0.3769, "control_priority": 42.9, "complaints_2025": 32, "water_pct": 0.655, "park_m2_per_km2": 3301, "larva_surveyed": 112, "larva_positive": 87, "sources": {"septic_clean": 162, "septic_private": 150, "wwtp_private": 236, "wwtp_public": 1, "livestock": 25, "reservoir": 18, "tire_shop": 5, "waste_tire": 1, "waste_stk": 42, "junk_shop": 22, "water_feature": 5, "toilet": 28, "park": 13, "bathhouse": 1, "waterpump": 5, "bee_farm": 4}, "data_gap": false, "pop_estimated": false, "breed_norm": 0.2787, "popd_norm": 0.4751}, "진례면": {"area_km2": 44.65, "population": 5474, "pop_density": 122.6, "breed_density": 53.1, "density_risk": 0.2224, "control_priority": 21.3, "complaints_2025": 0, "water_pct": 0.855, "park_m2_per_km2": 380, "larva_surveyed": 0, "larva_positive": 0, "sources": {"septic_clean": 189, "septic_private": 215, "wwtp_private": 364, "wwtp_public": 2, "livestock": 40, "reservoir": 26, "tire_shop": 4, "waste_tire": 0, "waste_stk": 37, "junk_shop": 9, "water_feature": 0, "toilet": 31, "park": 3, "bathhouse": 0, "waterpump": 0, "bee_farm": 14}, "data_gap": true, "pop_estimated": false, "breed_norm": 0.2577, "popd_norm": 0.1871}, "진영읍": {"area_km2": 39.8, "population": 52844, "pop_density": 1327.6, "breed_density": 100.0, "density_risk": 0.5336, "control_priority": 71.9, "complaints_2025": 0, "water_pct": 0.476, "park_m2_per_km2": 9332, "larva_surveyed": 0, "larva_positive": 0, "sources": {"septic_clean": 329, "septic_private": 539, "wwtp_private": 421, "wwtp_public": 1, "livestock": 46, "reservoir": 13, "tire_shop": 21, "waste_tire": 0, "waste_stk": 28, "junk_shop": 24, "water_feature": 9, "toilet": 66, "park": 25, "bathhouse": 0, "waterpump": 3, "bee_farm": 9}, "data_gap": true, "pop_estimated": false, "breed_norm": 0.4618, "popd_norm": 0.6055}, "한림면": {"area_km2": 59.71, "population": 6405, "pop_density": 107.3, "breed_density": 165.6, "density_risk": 0.3946, "control_priority": 26.2, "complaints_2025": 0, "water_pct": 0.298, "park_m2_per_km2": 14, "larva_surveyed": 0, "larva_positive": 0, "sources": {"septic_clean": 1005, "septic_private": 787, "wwtp_private": 1362, "wwtp_public": 8, "livestock": 380, "reservoir": 22, "tire_shop": 2, "waste_tire": 1, "waste_stk": 142, "junk_shop": 25, "water_feature": 0, "toilet": 34, "park": 1, "bathhouse": 0, "waterpump": 2, "bee_farm": 19}, "data_gap": true, "pop_estimated": false, "breed_norm": 0.6254, "popd_norm": 0.1638}, "생림면": {"area_km2": 50.74, "population": 3331, "pop_density": 65.6, "breed_density": 96.2, "density_risk": 0.2637, "control_priority": 18.0, "complaints_2025": 12, "water_pct": 0.152, "park_m2_per_km2": 2701, "larva_surveyed": 158, "larva_positive": 138, "sources": {"septic_clean": 565, "septic_private": 326, "wwtp_private": 673, "wwtp_public": 6, "livestock": 177, "reservoir": 9, "tire_shop": 1, "waste_tire": 5, "waste_stk": 58, "junk_shop": 12, "water_feature": 1, "toilet": 27, "park": 3, "bathhouse": 0, "waterpump": 0, "bee_farm": 13}, "data_gap": false, "pop_estimated": false, "breed_norm": 0.4492, "popd_norm": 0.0782}, "상동면": {"area_km2": 68.83, "population": 2872, "pop_density": 41.7, "breed_density": 73.5, "density_risk": 0.1812, "control_priority": 14.4, "complaints_2025": 26, "water_pct": 0.104, "park_m2_per_km2": 78, "larva_surveyed": 107, "larva_positive": 75, "sources": {"septic_clean": 569, "septic_private": 498, "wwtp_private": 662, "wwtp_public": 5, "livestock": 31, "reservoir": 12, "tire_shop": 2, "waste_tire": 3, "waste_stk": 38, "junk_shop": 10, "water_feature": 0, "toilet": 20, "park": 4, "bathhouse": 0, "waterpump": 3, "bee_farm": 14}, "data_gap": false, "pop_estimated": false, "breed_norm": 0.3623, "popd_norm": 0.0}, "대동면": {"area_km2": 48.77, "population": 4918, "pop_density": 100.8, "breed_density": 73.4, "density_risk": 0.2574, "control_priority": 20.8, "complaints_2025": 17, "water_pct": 0.291, "park_m2_per_km2": 0, "larva_surveyed": 83, "larva_positive": 68, "sources": {"septic_clean": 491, "septic_private": 458, "wwtp_private": 249, "wwtp_public": 3, "livestock": 27, "reservoir": 9, "tire_shop": 0, "waste_tire": 1, "waste_stk": 2, "junk_shop": 5, "water_feature": 0, "toilet": 19, "park": 0, "bathhouse": 1, "waterpump": 1, "bee_farm": 20}, "data_gap": false, "pop_estimated": false, "breed_norm": 0.3618, "popd_norm": 0.1529}};

  // 파생값(정규화)은 데이터에 포함돼 있고, 시설유형별 최대 밀도만 여기서 계산한다.
  const MAX_SRC_DEN = {};
  Object.keys(SRC_KOR).forEach((k) => {
    MAX_SRC_DEN[k] = Math.max(0, ...Object.values(DISTRICTS).map(
      (r) => (r.sources[k] || 0) / r.area_km2));
  });

  function round(v, n) { const f = Math.pow(10, n); return Math.round(v * f) / f; }
  function clamp(x, lo = 0, hi = 1) { return Math.max(lo, Math.min(hi, x)); }
  function normLog(v, rng) {
    const lo = rng[0], hi = rng[1];
    return clamp((Math.log1p(Math.max(v, 0)) - lo) / (hi - lo));
  }
  function pyNum(value, decimals) {
    let s = Number(value).toFixed(decimals);
    if (s.indexOf('.') !== -1) { s = s.replace(/0+$/, ''); if (s.endsWith('.')) s += '0'; }
    return s;
  }

  // ---- (1) 기상 → 활동지수 ----
  function briere(T) {
    if (T <= BRIERE.T0 || T >= BRIERE.Tm) return 0;
    const v = BRIERE.a * T * (T - BRIERE.T0) * Math.pow(BRIERE.Tm - T, 1 / BRIERE.m);
    return clamp(v / BRIERE_NORM);
  }
  function tempSuit(tempC, ta7) {
    const t7 = (ta7 == null) ? tempC : ta7;
    const te = TA_TODAY_W * tempC + (1 - TA_TODAY_W) * t7;
    const v = briere(te);
    let s;
    if (te < 11) s = '발육영점 이하 — 모기 활동 거의 정지';
    else if (te < 16) s = '저온 — 활동 저조, 월동개체 위주';
    else if (te < 22) s = '상승기 — 발생 시작';
    else if (te < 26) s = '양호 — 번식·흡혈 활발';
    else if (te <= 32) s = '최적 — 발생 정점 구간';
    else if (te <= 36) s = '고온 — 활동 다소 둔화';
    else s = '극한 폭염 — 활동 급감';
    return [round(v, 3), s, round(te, 1)];
  }
  function humSuit(H) {
    const v = clamp(HUM_BASE + HUM_SLOPE * (H - 40) / 50, 0.30, 1.05);
    let s;
    if (H < 50) s = '건조 — 성충 수명 단축';
    else if (H < 70) s = '보통';
    else s = '다습 — 성충 생존에 유리';
    return [round(v, 3), s];
  }
  function rainSuit(rain7, rainToday) {
    rainToday = rainToday || 0;
    let v = 1 + RAIN_W * Math.tanh(rain7 / 40) - 0.9 * RAIN_W * Math.tanh(rainToday / 25);
    v = clamp(v, 0.85, 1.15);
    let s;
    if (rainToday >= 30) s = '당일 폭우 — 유충 유실로 일시 감소';
    else if (rain7 >= 40) s = '최근 강수 많음 — 산란처 확대';
    else if (rain7 >= 10) s = '적당한 강수 — 고인물 유지';
    else s = '건조 지속 — 기존 정체수 위주';
    return [round(v, 3), s];
  }
  function windSuit(ws) {
    const v = clamp(1 - WIND_W * (ws - 1.5) / 3, 0.55, 1.15);
    let s;
    if (ws >= 4.0) s = '강풍 — 비행·흡혈 억제';
    else if (ws >= 2.5) s = '바람 다소 강함 — 활동 일부 억제';
    else s = '약풍 — 활동에 지장 없음';
    return [round(v, 3), s];
  }
  function weatherActivity(tempC, humidity, rain7, windMs, ta7, rainToday) {
    if (windMs == null) windMs = 1.8;
    const t = tempSuit(tempC, ta7)[0];
    const h = humSuit(humidity)[0];
    const r = rainSuit(rain7, rainToday)[0];
    const w = windSuit(windMs)[0];
    return clamp(t * h * r * w);
  }

  // ---- (2) 지역 위험(밀도) ----
  function grade(index) {
    if (index < 25) return [1, '쾌적', '#3b82f6'];
    if (index < 50) return [2, '관심', '#22c55e'];
    if (index < 75) return [3, '주의', '#f59e0b'];
    return [4, '불쾌', '#ef4444'];
  }
  function sourceBreakdown(rec) {
    const contrib = {};
    const area = rec.area_km2;
    Object.entries(rec.sources).forEach(([k, cnt]) => {
      const den = cnt / area;
      const mx = MAX_SRC_DEN[k] || 0;
      contrib[k] = (mx > 0 ? den / mx : 0) * (RISK_W[k] || 1);
    });
    const tot = Object.values(contrib).reduce((a, b) => a + b, 0) || 1;
    const rows = [];
    Object.keys(contrib).sort((a, b) => contrib[b] - contrib[a]).forEach((k) => {
      if ((rec.sources[k] || 0) > 0) {
        rows.push({ source: SRC_KOR[k], count: rec.sources[k],
          per_km2: round(rec.sources[k] / area, 1),
          risk_contribution_pct: round(100 * contrib[k] / tot, 1) });
      }
    });
    return rows;
  }
  function confidence(weatherObserved, rec) {
    const wu = weatherObserved ? 0.06 : 0.20;
    const gu = rec.data_gap ? 0.22 : 0.08;
    const pu = rec.pop_estimated ? 0.10 : 0.0;
    const u = Math.sqrt(wu * wu + gu * gu + pu * pu);
    const label = u < 0.13 ? '높음' : (u < 0.21 ? '보통' : '낮음');
    return [u, label];
  }
  function citizenAdvice(level, topSourceName) {
    const base = {
      1: ['특별한 조치가 필요 없습니다.'],
      2: ['야간 외출 시 가벼운 기피제를 사용하세요.', '집 주변 화분받침·빈 용기의 고인물을 비우세요.'],
      3: ['방충망·기피제를 사용하고 야간 활동을 줄이세요.', '집 주변 정화조·하수구 뚜껑 주변을 점검하세요.', '고인물 용기를 뒤집어 두세요.'],
      4: ['야외활동을 자제하고 긴팔·긴바지를 착용하세요.', '농도 높은 기피제(DEET·이카리딘)를 사용하세요.', '집 안팎 모든 고인물을 즉시 제거하세요.'],
    }[level];
    const tips = {
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
    }[topSourceName];
    return tips && level >= 2 ? base.concat([tips]) : base.slice();
  }
  function authorityAdvice(rec, level, rank, total, larvaRate) {
    const a = [];
    if (level >= 3) a.push('취약구역 방역 주기를 단축하고 유문등·포충기 가동을 강화하세요.');
    if (rank <= Math.max(3, Math.floor(total / 5))) {
      a.push('본 구역은 밀도위험 상위(' + rank + '/' + total + ')입니다. 정화조·하수구 유충구제(라바사이드)를 선제 시행하세요.');
    }
    if (rec.data_gap) {
      a.push('민원·현장조사 자료가 미제공된 결측 구역입니다 — 인구·발생원 밀도로만 추정했으므로 우선 현장 조사로 데이터를 확보하세요.');
    } else if (rec.complaints_2025 === 0 && level >= 3) {
      a.push('발생원 밀도는 높으나 민원 기록이 없는 사각지대입니다 — 선제 점검을 권장합니다.');
    }
    if (larvaRate != null && larvaRate >= 0.6) {
      a.push('유충 실태조사 검출률이 ' + Math.round(100 * larvaRate) + '%로 높습니다 — 발생원 시설 자체의 관리상태가 불량합니다(모기지수와 별개로 시설 개선 대상).');
    }
    if (!a.length) a.push('정기 방역 주기를 유지하세요.');
    return a;
  }

  // ---- (3) 메인 API ----
  function indexOf(district, act) {
    const rec = DISTRICTS[district];
    const geo = W_BREED * rec.breed_norm + W_POPD * rec.popd_norm;
    return [round(100 * act * (0.30 + 0.70 * geo), 1), geo];
  }

  function mosquitoIndex(district, options = {}) {
    if (!DISTRICTS[district]) throw new Error('unknown district: ' + district);
    const month = options.month == null ? 6 : options.month;
    let tempC = options.temp_c;
    let humidity = options.humidity;
    let rain7 = options.rain_7d_mm != null ? options.rain_7d_mm : options.rain_3d_mm; // v3 호환
    let ta7 = options.ta_7d_avg;
    let windMs = options.wind_ms;
    let rainToday = options.rain_today_mm;
    const callerProvided = tempC != null;
    const weatherObserved = options.weather_observed != null
      ? !!options.weather_observed : (tempC != null);
    const weatherSrc = callerProvided ? 'manual' : 'climatology';

    const S = SEASON[month] || [22.0, 22.0, 70.0, 30.0, 1.9];
    if (tempC == null) tempC = S[0];
    if (ta7 == null) ta7 = S[1];
    if (humidity == null) humidity = S[2];
    if (rain7 == null) rain7 = S[3];
    if (windMs == null) windMs = S[4];
    if (rainToday == null) rainToday = 0.0;

    const [tv, ts, te] = tempSuit(tempC, ta7);
    const [hv, hs] = humSuit(humidity);
    const [rv, rs] = rainSuit(rain7, rainToday);
    const [wv, ws] = windSuit(windMs);
    const act = clamp(tv * hv * rv * wv);

    const rec = DISTRICTS[district];
    const [index, geo] = indexOf(district, act);
    const [lv, nm, col] = grade(index);

    const [u, confLabel] = confidence(weatherObserved || callerProvided, rec);
    const bandLow = round(Math.max(0, index * (1 - u)), 1);
    const bandHigh = round(Math.min(100, index * (1 + u)), 1);

    const breakdown = sourceBreakdown(rec);
    const topName = breakdown.length ? breakdown[0].source : null;
    const surveyed = rec.larva_surveyed || 0;
    const larvaRate = surveyed >= 10 ? (rec.larva_positive || 0) / surveyed : null;

    const allIdx = Object.keys(DISTRICTS)
      .map((dd) => [dd, indexOf(dd, act)[0]]).sort((a, b) => b[1] - a[1]);
    const rank = allIdx.findIndex((x) => x[0] === district) + 1;
    const total = allIdx.length;
    const cityAvg = round(allIdx.reduce((sum, x) => sum + x[1], 0) / total, 1);
    const [topDistrict, topVal] = allIdx[0];
    const priRank = Object.keys(DISTRICTS)
      .sort((a, b) => DISTRICTS[b].control_priority - DISTRICTS[a].control_priority)
      .indexOf(district) + 1;

    const areaType = (district.endsWith('읍') || district.endsWith('면'))
      ? '농촌형(축산·정화조 산재)' : '도심형(생활하수·수경시설·공원)';
    const actTxt = act >= 0.6 ? '고온다습한 날씨로 모기 활동이 왕성'
      : (act < 0.3 ? '선선한 날씨로 활동이 제한적' : '보통 수준의 활동');
    const activeHours = lv >= 2 ? '일몰 직후(19~22시)와 새벽(04~06시)에 가장 활발' : '활동 미약';
    const repellent = { 1: '불필요', 2: '가벼운 기피제(시트로넬라 등)',
      3: 'DEET 10~20% 또는 이카리딘 + 긴팔 권장',
      4: 'DEET 20%+ 또는 이카리딘 고농도, 노출 최소화' }[lv];
    const totalFacilities = Object.values(rec.sources).reduce((a, b) => a + b, 0);

    return {
      district,
      mosquito_index: index,
      index_range: { low: bandLow, high: bandHigh },
      level: lv, grade: nm, color: col,
      confidence: {
        level: confLabel,
        uncertainty_pct: round(100 * u, 1),
        reasons: {
          weather: weatherObserved ? '실측(Open-Meteo)' : (callerProvided ? '직접입력' : '실측 월평년값'),
          population: rec.pop_estimated ? '100m 격자 추정' : '주민등록',
          complaint_data: rec.data_gap ? '미제공(결측)' : '보유',
        },
        note: rec.data_gap ? '⚠ 민원·현장조사 미제공 구역 — 인구·발생원 밀도로만 추정한 값입니다(민원 0건을 안전으로 해석하지 마세요).' : null,
      },
      summary: district + '의 모기지수는 ' + pyNum(index, 1) + '점(' + lv + '단계 ' + nm
        + ', 신뢰도 ' + confLabel + ', ' + pyNum(bandLow, 1) + '~' + pyNum(bandHigh, 1)
        + '점)입니다. ' + actTxt + '하며, 발생원 밀도 ' + Math.round(rec.breed_density)
        + '개/㎢ · 인구밀도 ' + Number(Math.round(rec.pop_density)).toLocaleString('en-US')
        + '명/㎢를 결합해 시내 ' + rank + '/' + total + '위입니다.'
        + (rec.data_gap ? ' ※ 민원 자료 미제공 구역으로 추정치입니다.' : ''),
      weather: {
        input: { temp_c: tempC, ta_7d_avg: ta7, humidity, rain_7d_mm: rain7,
          rain_today_mm: rainToday, wind_ms: windMs, month },
        source: weatherSrc,
        observed: weatherObserved,
        effective_temp_c: te,
        activity_index: round(act, 3),
        components: {
          temperature: { score: tv, status: ts, effective_temp_c: te },
          humidity: { score: hv, status: hs },
          rainfall: { score: rv, status: rs },
          wind: { score: wv, status: ws },
        },
        comment: '유효기온 ' + te + '℃(당일 ' + tempC + '℃, 7일평균 ' + ta7 + '℃), 습도 '
          + humidity + '%, 최근7일 강수 ' + rain7 + 'mm, 풍속 ' + windMs + 'm/s → 활동지수 ' + pyNum(act, 2),
      },
      area: {
        area_km2: rec.area_km2, population: rec.population, pop_density: rec.pop_density,
        pop_density_norm: rec.popd_norm, estimated: rec.pop_estimated,
        water_pct: rec.water_pct, park_m2_per_km2: rec.park_m2_per_km2,
      },
      // v3 호환 별칭 — 기존 화면 코드가 exposure.* 를 참조
      exposure: { population: rec.population, exposure_index: rec.popd_norm,
        pop_density: rec.pop_density, estimated: rec.pop_estimated },
      source_risk: {
        density_risk: round(geo, 3),
        // v3 호환 별칭(기존 화면 코드가 참조) — 의미는 v4 밀도 기준
        effective_geo: round(geo, 3),
        score: rec.control_priority,
        breeding_potential: rec.breed_norm,
        exposure_index: rec.popd_norm,
        larva: { surveyed, positive: rec.larva_positive || 0,
          detection_rate: larvaRate != null ? round(larvaRate, 3) : null,
          weight_in_geo: 0, basis: 'excluded' },
        breed_density_per_km2: rec.breed_density,
        breed_density_norm: rec.breed_norm,
        pop_density_norm: rec.popd_norm,
        control_priority: rec.control_priority,
        control_priority_rank: priRank,
        area_type: areaType,
        top_sources: breakdown.slice(0, 5),
        total_facilities: totalFacilities,
        comment: topName ? ('주요 발생원은 ' + topName + '이며, 이 구역은 ' + areaType
          + '입니다. 발생원 ' + totalFacilities.toLocaleString('ko-KR') + '개소 / ' + rec.area_km2 + '㎢.')
          : '등록 발생원 없음',
      },
      larva_survey: {
        surveyed, positive: rec.larva_positive || 0,
        detection_rate: larvaRate != null ? round(larvaRate, 3) : null,
        used_in_index: false,
        note: '발생원 시설의 관리상태 지표입니다. 민원밀도와 음의 상관(-0.715)이어서 모기지수 산출에는 쓰지 않고, 시설 개선 우선순위 참고용으로만 제공합니다.',
      },
      ranking: {
        rank, total_districts: total,
        percentile: round(100 * (total - rank + 1) / total, 1),
        city_avg_index: cityAvg, vs_city_avg: round(index - cityAvg, 1),
        highest_district: { name: topDistrict, index: topVal },
      },
      complaints_2025: rec.complaints_2025,
      advice: {
        citizen: citizenAdvice(lv, topName),
        authority: authorityAdvice(rec, lv, rank, total, larvaRate),
      },
      active_hours: activeHours,
      recommended_repellent: repellent,
    };
  }

  function allIndices(options = {}) {
    return Object.keys(DISTRICTS).map((d) => mosquitoIndex(d, options))
      .sort((a, b) => b.mosquito_index - a.mosquito_index);
  }
  function controlPriorityRanking() {
    const rows = Object.keys(DISTRICTS).map((d) => ({
      district: d, control_priority: DISTRICTS[d].control_priority,
      density_risk: round(W_BREED * DISTRICTS[d].breed_norm + W_POPD * DISTRICTS[d].popd_norm, 3),
      population: DISTRICTS[d].population, area_km2: DISTRICTS[d].area_km2,
      complaints_2025: DISTRICTS[d].complaints_2025, data_gap: DISTRICTS[d].data_gap,
    })).sort((a, b) => b.control_priority - a.control_priority);
    rows.forEach((r, i) => { r.rank = i + 1; });
    return rows;
  }
  function listDistricts() { return Object.keys(DISTRICTS); }
  function nearestDistrict(lat, lng) {
    let best = null, bestD = Infinity;
    Object.entries(COORDS).forEach(([name, c]) => {
      const dist = Math.hypot(c[0] - lat, c[1] - lng);
      if (dist < bestD) { bestD = dist; best = name; }
    });
    return best;
  }

  const api = { mosquitoIndex, allIndices, controlPriorityRanking, listDistricts,
    nearestDistrict, COORDS, DISTRICTS, SRC_KOR, RISK_W };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.GimhaeMosquitoModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
