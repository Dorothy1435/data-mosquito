/* =============================================================
   오늘 가기 좋은 공원 고르기
   -------------------------------------------------------------
   김해 도시공원 245곳 중에서, 오늘 날씨와 모기 사정을 함께 보고
   '지금 나가기 좋은 곳'을 순서대로 골라 준다.

   공원 점수 = 오늘의 나들이 지수 - 그 공원의 모기 위험만큼 감점 + 작은 가산점

     · 나들이 지수 : 기온·비·자외선·바람·모기 (도시 전체 기준)
     · 모기 위험   : 그 공원이 속한 구역의 밀도위험 + 공원 유형 보정
                     (수변공원은 물가라 높고, 어린이공원은 작고 관리돼 낮다)
     · 가산점      : 걸어갈 만한 거리, 넓이, 있는 시설

   주의
     · 공원별 모기 실측값은 없다. 구역 값과 공원 유형으로 미룬 추정치다.
     · 사진 데이터가 없어 지도 그림으로 대신한다.
       parks JSON 에 photo 항목이 생기면 그걸 우선 쓴다.

   window.ParkPicks 로 사용한다.
   ============================================================= */

(function (global) {
  'use strict';

  // 공원 유형별 모기 서식 보정 (gimhae.js 와 같은 기준을 쓴다)
  const TYPE_ADJ = {
    '수변공원': 0.14,   // 물가 — 정체수·습지
    '근린공원': 0.05,   // 넓고 식생 많음
    '체육공원': 0.03,
    '역사공원': 0.02,
    '소공원': -0.02,    // 작고 관리됨
    '어린이공원': -0.03, // 작고 포장·관리됨
  };

  // 유형별 그림 문자 — 글자만 있는 카드보다 알아보기 쉽다
  const TYPE_ICON = {
    '수변공원': '🌊', '근린공원': '🌳', '체육공원': '🏃',
    '역사공원': '🏛️', '소공원': '🌱', '어린이공원': '🛝',
  };

  // '산책 나가기 좋은 곳인가' 보정.
  // 모기 위험과는 다른 이야기다. 어린이공원은 모기는 적지만
  // 놀이터 한 칸이라 어른·어르신 나들이 장소로는 맞지 않는다.
  const TYPE_FIT = {
    '근린공원': 9,    // 산책로·벤치·그늘 — 나들이의 기본
    '역사공원': 7,    // 볼거리가 있다
    '체육공원': 6,    // 걷기·운동
    '수변공원': 5,    // 경치는 좋지만 모기 감점이 따로 붙는다
    '소공원': 0,
    '어린이공원': -8, // 아이 놀이터 위주
  };

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /* ---------- 두 지점 사이 거리(km) ---------- */
  function distanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  /* ---------- 공원 한 곳의 모기 위험 (0~1) ---------- */
  function parkMosquitoRisk(park) {
    const model = global.GimhaeMosquitoModel;
    const rec = model && model.DISTRICTS ? model.DISTRICTS[park.district] : null;
    const base = rec ? rec.density_risk : 0.4;
    return clamp(base + (TYPE_ADJ[park.type] || 0), 0, 1);
  }

  /* ---------- 공원 한 곳의 오늘 점수 ---------- */
  function scorePark(park, outingScore, from) {
    const risk = parkMosquitoRisk(park);

    // 모기 위험이 높을수록 깎는다. 최대 30점까지.
    let score = outingScore - risk * 30;

    // 산책 나가기 좋은 유형인지
    score += TYPE_FIT[park.type] || 0;

    // 거리 — 나들이는 '가까워야' 나간다. 비중을 크게 둔다.
    let distance = null;
    if (from && from.lat != null && from.lng != null) {
      distance = distanceKm(from.lat, from.lng, park.lat, park.lon);
      if (distance <= 1) score += 10;        // 걸어서
      else if (distance <= 2.5) score += 5;  // 가벼운 산책 거리
      else if (distance <= 5) score -= 2;
      else if (distance <= 8) score -= 9;
      else if (distance <= 12) score -= 18;
      else score -= 30;                      // 사실상 제외
    }

    // 넓은 공원은 걷기 좋다
    const area = Number(park.area_m2) || 0;
    if (area >= 50000) score += 6;
    else if (area >= 20000) score += 4;
    else if (area >= 10000) score += 2;
    else if (area < 3000) score -= 3;        // 너무 작아 산책이 안 된다

    // 시설이 있으면 조금 더
    const facilities = park.facilities || [];
    if (facilities.length >= 2) score += 2;
    else if (facilities.length === 1) score += 1;

    return {
      park,
      distance,
      risk,
      score: Math.round(clamp(score, 0, 100)),
      icon: TYPE_ICON[park.type] || '🌳',
    };
  }

  /* ---------- 좋은 이유를 한 줄로 ---------- */
  function reasonOf(pick) {
    const bits = [];
    const p = pick.park;

    if (pick.risk < 0.35) bits.push('모기가 적은 편');
    else if (pick.risk < 0.55) bits.push('모기 보통');
    else bits.push('모기 조금 있음');

    if (pick.distance != null) {
      bits.push(pick.distance < 1
        ? '걸어서 갈 만함'
        : `${pick.distance.toFixed(1)}km`);
    }

    const area = Number(p.area_m2) || 0;
    if (area >= 50000) bits.push('넓은 공원');

    const facilities = p.facilities || [];
    if (facilities.length) bits.push(facilities.slice(0, 2).join('·'));

    return bits.join(' · ');
  }

  /* ---------- 지도 그림 주소 ----------
     실제 사진이 없어서 그 자리의 지도 그림을 대신 쓴다.
     parks JSON 에 photo 가 들어오면 그걸 먼저 쓴다. */
  function pictureOf(park, zoom) {
    if (park.photo) return { src: park.photo, isMap: false, fx: 50, fy: 50 };

    const z = zoom || 15;
    const n = 2 ** z;
    const latRad = (park.lat * Math.PI) / 180;
    const xf = ((park.lon + 180) / 360) * n;
    const yf = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
    const x = Math.floor(xf);
    const y = Math.floor(yf);

    return {
      src: `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
      isMap: true,
      // 공원이 타일 안 어디쯤인지(%) — 그 지점이 가운데로 오게 맞춘다
      fx: Math.round((xf - x) * 100),
      fy: Math.round((yf - y) * 100),
    };
  }

  /* ---------- 오늘 가기 좋은 공원 고르기 ---------- */
  // parks        : data/gimhae-parks.json 의 배열
  // outingScore  : 오늘의 나들이 지수 (0~100)
  // options.from : { lat, lng } 사용자 위치
  // options.limit: 몇 곳을 고를지 (기본 3)
  function pick(parks, outingScore, options) {
    const opts = options || {};
    const limit = opts.limit || 3;
    if (!Array.isArray(parks) || !parks.length || outingScore == null) return [];

    const scored = parks
      .filter((p) => p && p.lat != null && p.lon != null)
      .map((p) => scorePark(p, outingScore, opts.from));

    // 너무 먼 곳은 뺀다 (위치를 알 때만)
    const near = opts.from
      ? scored.filter((s) => s.distance == null || s.distance <= 15)
      : scored;
    const pool = near.length >= limit ? near : scored;

    // 점수 높은 순. 같으면 가까운 순.
    pool.sort((a, b) => (b.score - a.score)
      || ((a.distance ?? 99) - (b.distance ?? 99)));

    // 같은 동네만 셋이 나오지 않게, 한 동네에서 최대 2곳까지만.
    const out = [];
    const perDistrict = {};
    for (const s of pool) {
      const d = s.park.district || '기타';
      if ((perDistrict[d] || 0) >= 2) continue;
      perDistrict[d] = (perDistrict[d] || 0) + 1;
      out.push({ ...s, reason: reasonOf(s), picture: pictureOf(s.park) });
      if (out.length >= limit) break;
    }
    return out;
  }

  global.ParkPicks = { pick, scorePark, parkMosquitoRisk, distanceKm, pictureOf, TYPE_ICON };
}(typeof window !== 'undefined' ? window : globalThis));
