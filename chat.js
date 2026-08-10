// 모기제로 AI 도우미 — 브라우저 위젯
// 화면 우측 아래 작은 버튼 → 채팅창. 질문을 /api/ask 로 보내 답을 받는다.
// 구역 점수 같은 숫자는 여기서 '모델로 계산'해 함께 보내, 서버 LLM이 지어내지 않게 한다.

(function () {
  // 현재 달(계절 반영). 실시간 날씨가 없어도 월평년값으로 대략 계산한다.
  function currentMonth() {
    return new Date().getMonth() + 1;
  }

  // 17개 구역의 오늘(월평년값) 점수 스냅샷을 만든다. 모델이 없으면 빈 배열.
  function buildDistrictSnapshot() {
    const M = window.GimhaeMosquitoModel;
    if (!M) return [];
    const month = currentMonth();
    const srcKor = M.SRC_KOR || {};
    try {
      return M.listDistricts().map((name) => {
        const r = M.mosquitoIndex(name, { month });
        const sources = (M.DISTRICTS[name] || {}).sources || {};
        const top = Object.entries(sources)
          .filter(([, c]) => c > 0)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([k]) => srcKor[k] || k);
        return {
          name,
          index: Math.round(r.mosquito_index * 10) / 10,
          grade: r.grade,
          density_risk: r.source_risk.density_risk,
          top_sources: top,
        };
      });
    } catch (e) {
      return [];
    }
  }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // ==== 로컬 FAQ 즉답 (API 없이 처리 — 한도 절약·즉시 응답) ====
  // 자주 묻는 질문과 구역 점수 질문은 여기서 바로 답한다. 매칭 실패 시 null → API로 넘어감.
  // 후속질문(f)도 전부 FAQ가 답할 수 있는 것으로만 구성해, 클릭해도 API를 안 쓴다.
  function faqAnswer(text) {
    const q = String(text).replace(/[\s?!.,~]/g, '').toLowerCase();
    const has = (...ks) => ks.some((k) => q.includes(k));
    const snap = buildDistrictSnapshot();
    const byIndex = snap.slice().sort((a, b) => b.index - a.index);
    const top = byIndex[0];
    const low = byIndex[byIndex.length - 1];
    const srcOf = (d) => (d && d.top_sources || []).slice(0, 2).join('·');
    const M = window.GimhaeMosquitoModel;
    const R = (a, f) => ({ a, f });
    // 자주 쓰는 후속질문 묶음
    const F_MAIN = ['가장 위험한 동네는?', '가장 안전한 동네는?', '모기 예방법 알려줘'];
    const F_LEARN = ['모기지수가 뭐야?', '발생원이 뭐야?', '매개모기 종류는?'];

    // (A) 인사·감사·도움말
    if (has('잘가', '바이', 'bye', 'ㅂㅂ', '끝', '나갈')) {
      return R('네, 오늘도 모기 조심하세요! 필요하면 언제든 다시 불러 주세요 🦟', F_MAIN);
    }
    if (has('안녕', '하이', 'hello', 'hi', '반가', '방가', 'ㅎㅇ', '안뇽', '헬로')) {
      return R('안녕하세요! 김해 모기 위험을 안내하는 도우미예요 🦟 궁금한 걸 물어보세요.', ['오늘 우리 동네 위험해?', '가장 위험한 동네는?', '모기 예방법 알려줘']);
    }
    if (has('고마', '감사', 'ㄱㅅ', 'thank', '수고', '굿', '최고')) {
      return R('도움이 됐다니 다행이에요 😊 더 궁금한 게 있으면 언제든 물어보세요!', F_MAIN);
    }
    if (has('뭐물어', '뭘물어', '뭐할수', '뭐물어봐', '도움말', '뭐가능', '무엇을물어', '기능이뭐', '뭐알려')) {
      return R('저는 이런 걸 바로 알려드려요 🦟 ▸ 우리 동네/특정 동네 오늘 점수 ▸ 가장 위험·안전한 동네 ▸ 모기지수·발생원 설명 ▸ 예방법·활동 시간 ▸ 매개모기와 감염병 ▸ 지도 사용법. 편하게 물어보세요!', ['오늘 우리 동네 위험해?', '가장 위험한 동네는?', '모기 예방법 알려줘']);
    }

    // (B) 개념·설명
    if (has('모기지수가뭐', '모기지수란', '지수가뭐', '지수란', '지수뭐', '모기지수설명')) {
      return R('모기지수는 오늘 모기 위험을 0~100점으로 나타낸 값이에요. 높을수록 위험하며 쾌적·관심·주의·불쾌 4단계로 안내합니다. 발생원 밀도와 실시간 날씨로 계산한 참고용 예상값이에요.', ['등급 기준이 어떻게 돼?', '가장 위험한 동네는?', '왜 김해만 정밀 모델이야?']);
    }
    if (has('등급', '단계가', '단계는', '단계뭐', '몇점부터', '몇점이면', '쾌적', '불쾌', '관심단계', '주의단계')) {
      return R('등급은 4단계예요. 0~25 쾌적, 25~50 관심, 50~75 주의, 75~100 불쾌. 숫자가 클수록 모기 활동·발생 위험이 높다는 뜻이에요.', ['가장 위험한 동네는?', '모기지수가 뭐야?', '모기 예방법 알려줘']);
    }
    if (has('어떻게계산', '계산방법', '계산법', '어떻게만들', '어떻게산출', '공식')) {
      return R('발생원 밀도(개/㎢)와 인구 밀도(명/㎢)를 합쳐 "밀도위험"을 만들고, 여기에 실시간 날씨 활동지수(유효기온·습도·강수·풍속)를 곱해 0~100점을 냅니다. 날씨는 30℃ 부근에서 모기 활동이 가장 활발해요.', ['검증은 어떻게 했어?', '발생원이 뭐야?', '왜 여름에 모기가 많아?']);
    }
    if (has('왜김해', '김해만', '다른지역', '우리지역은왜', '타지역')) {
      return R('김해시는 발생원 시설·인구·면적 같은 행정 데이터가 확보돼 있어 정밀 모델을 적용해요. 그 외 지역은 그 데이터가 없어 날씨 기반 추정값으로만 보여드립니다.', ['발생원이 뭐야?', '검증은 어떻게 했어?', '가장 위험한 동네는?']);
    }
    if (has('발생원이뭐', '발생원이란', '발생원뭐', '발생원종류', '발생원설명', '어디서번식', '어디서생겨', '모기어디서')) {
      return R('발생원은 모기가 알을 낳고 번식하는 시설·환경이에요. 김해는 정화조·개인하수/오수처리·축산·저수지·폐타이어·수경시설·공중화장실·도시공원 등 16종 약 17,081곳을 반영합니다. 공통점은 "고인 물"이에요.', ['발생원이 몇 개야?', '가장 위험한 동네는?', '모기 예방법 알려줘']);
    }
    if (has('발생원몇', '발생원이몇', '몇개소', '몇곳', '시설몇', '총몇', '몇종')) {
      return R('김해시 전체 발생원은 16종 약 17,081곳이에요. 정화조·개인하수/오수처리시설이 가장 많고, 축산농가 763곳, 공중화장실 563곳, 도시공원 245곳 등이 포함돼요.', ['발생원이 뭐야?', '가장 위험한 동네는?', '데이터는 어디서 구했어?']);
    }
    if (has('검증', '믿을', '믿어', '정확해', '정확한', '신뢰', '맞아')) {
      return R('예측을 두 방향으로 검증했어요. 공간: 밀도위험 ↔ 실제 방역민원 +0.951. 시간: 예측 활동곡선 ↔ 실측 유충(2년·5.4만 건) +0.996. 실측과 강하게 일치합니다.', ['데이터는 어디서 구했어?', '어떻게 계산해?', '가장 위험한 동네는?']);
    }
    if (has('데이터어디', '어디서구', '출처', '자료어디', 'sodamap', '소다맵', '무슨데이터')) {
      return R('김해시 방역현황보고 시스템(sodamap)에서 발생원·면적·인구·방역민원·유충 실측을 받았어요. 날씨는 Open-Meteo(무료 공개 API), 지도는 OpenStreetMap을 씁니다.', ['검증은 어떻게 했어?', '발생원이 뭐야?', '가장 위험한 동네는?']);
    }

    // (C) 행동·예방
    if (has('deet', '디트', '무슨기피제', '기피제추천', '기피제뭐', '어떤기피제')) {
      return R('DEET(10~30%) 또는 이카리딘 성분 기피제가 효과적이에요. 얼굴은 직접 뿌리지 말고 손에 덜어 바르고, 땀이 나면 다시 발라 주세요. 어린이는 저농도를 쓰세요.', ['모기 예방법 알려줘', '모기 활동 시간은?', '물렸을 때는?']);
    }
    if (has('물렸', '물린', '가려', '긁', '부었', '물린후', '물리면')) {
      return R('긁지 말고 찬물·얼음으로 진정시킨 뒤 항히스타민 연고를 바르세요. 붓기·발열·통증이 심하거나 오래가면 병원을 찾으세요. (의학적 진단은 아니에요)', ['모기 예방법 알려줘', '매개모기 종류는?', '모기 활동 시간은?']);
    }
    if (has('예방', '안물리', '물리지않', '기피제', '어떻게막', '조심', '대비')) {
      return R('① 집·주변 고인 물(화분받침·폐타이어·빗물받이·양동이)을 비우고 방충망을 점검하세요. ② 해질녘·새벽엔 밝은 긴 옷과 기피제를 쓰고, 물가·수풀 가까운 곳을 피하세요.', ['어떤 기피제를 써?', '모기 활동 시간은?', '산책은 어디가 좋아?']);
    }
    if (has('몇시', '언제모기', '활동시간', '활동시간대', '언제조심', '몇시에', '새벽', '해질', '밤에')) {
      return R('모기는 보통 해질녘(저녁 7~10시)과 새벽(4~6시)에 가장 활발해요. 이 시간대 야외활동은 기피제와 긴 옷으로 대비하는 게 좋아요.', ['모기 예방법 알려줘', '가장 안전한 동네는?', '왜 여름에 모기가 많아?']);
    }
    if (has('여름', '겨울', '계절', '몇월', '월별', '언제많', '왜많', '성수기')) {
      return R('모기는 기온이 오르는 7~8월에 가장 많아요. 실측 유충도 7~8월 정점, 겨울엔 거의 0으로, 모델의 온도 곡선과 그대로 일치합니다(상관 +0.996).', ['모기 활동 시간은?', '검증은 어떻게 했어?', '가장 위험한 동네는?']);
    }
    if (has('산책', '공원어디', '어느공원', '공원추천', '나가도', '야외', '운동')) {
      return R('산책은 물가의 수변공원·넓은 근린공원보다, 작고 관리되는 어린이·소공원이 상대적으로 안전해요. 위험이 낮은 동네의 공원을 고르면 더 좋아요. 김해 모델 페이지 지도에서 공원 위치도 볼 수 있어요.', ['가장 안전한 동네는?', '모기 활동 시간은?', '모기 예방법 알려줘']);
    }

    // (D) 매개모기·감염병
    if (has('매개모기', '무슨모기', '모기종류', '어떤모기')) {
      return R('국내 주요 매개모기는 작은빨간집모기(일본뇌염), 빨간집모기(웨스트나일), 흰줄숲모기(뎅기·지카), 얼룩날개모기(말라리아)예요. 종마다 번식하는 발생원이 다릅니다.', ['일본뇌염이 위험해?', '모기 예방법 알려줘', '발생원이 뭐야?']);
    }
    if (has('일본뇌염')) {
      return R('일본뇌염은 작은빨간집모기가 매개해요. 주로 논·축사·웅덩이에서 번식합니다. 예방접종과 모기 물림 예방이 중요해요(접종 일정은 보건소·질병청 안내를 따르세요).', ['매개모기 종류는?', '모기 예방법 알려줘', '모기 활동 시간은?']);
    }
    if (has('뎅기', '지카', '말라리아', '웨스트나일', '감염병', '전염병', '병옮')) {
      return R('모기 매개 감염병으로 일본뇌염·웨스트나일열·뎅기열·지카·말라리아 등이 있어요. 국내에선 물림 예방이 가장 중요하고, 해외여행 시엔 지역별 주의가 필요해요.', ['매개모기 종류는?', '모기 예방법 알려줘', '어떤 기피제를 써?']);
    }

    // (E) 지도·사용법
    if (has('지도', '마커', '토글', '세모', '네모', '공원표시', '유충표시', '유충지점', '기호', '범례')) {
      return R('김해 모델 페이지 지도에서 큰 원은 구역 위험, 네모는 도시공원, 세모는 유충 실측 지점이에요. 지도 위 버튼으로 공원·유충 표시를 켜고 끌 수 있어요.', ['가장 위험한 동네는?', '발생원이 뭐야?', '검증은 어떻게 했어?']);
    }
    if (has('사이트뭐', '모기제로가뭐', '뭐하는', '누가만들', '이사이트', '이거뭐', '어떤사이트')) {
      return R('모기제로는 김해시 발생원 데이터와 실시간 날씨로 오늘의 모기 위험을 예보하는 서비스예요. 지자체에는 방제 우선순위를, 시민에게는 오늘의 위험·예방 안내를 제공합니다.', ['모기지수가 뭐야?', '가장 위험한 동네는?', '검증은 어떻게 했어?']);
    }
    if (has('동네목록', '구역목록', '어떤동네', '무슨동네', '지역목록', '몇개구역', '어느동네', '동네몇')) {
      const names = M ? M.listDistricts() : [];
      return R(`김해 17개 구역을 다뤄요: ${names.join(', ')}. 특정 동네 이름을 말하면 오늘 점수를 바로 알려드릴게요.`, ['가장 위험한 동네는?', '오늘 우리 동네 위험해?', '가장 안전한 동네는?']);
    }
    if (has('방제', '라바사이드', 'igr', '유충구제', '당국', '어떻게방역', '방역어떻게')) {
      return R('방제는 위험·발생원이 높은 구역부터 유충 구제(라바사이드·IGR)를 선제적으로 하고, 정화조·오수 정체수, 공원 인공연못·배수로, 저수지 등 발생원 서식면을 관리하는 게 효과적이에요.', ['가장 위험한 동네는?', '발생원이 뭐야?', '검증은 어떻게 했어?']);
    }

    // (E2) 모기 생태 상식
    if (has('수명', '며칠살', '얼마나살', '얼마나사', '모기산다', '몇일살', '오래살')) {
      return R('모기 성충은 보통 2~4주 살아요(암컷 기준). 알→유충→번데기→성충까지 여름엔 1~2주면 자랍니다. 그래서 고인 물을 자주 비우면 번식을 끊을 수 있어요.', ['모기는 어디서 번식해?', '모기 예방법 알려줘', '왜 여름에 모기가 많아?']);
    }
    if (has('암컷', '수컷', '왜피', '왜물어', '왜무는', '피를빨', '흡혈')) {
      return R('흡혈은 암컷만 해요. 알을 만들 단백질(피)이 필요해서예요. 평소엔 암수 모두 꽃꿀 같은 당분을 먹어요.', ['왜 나만 물려?', '물렸을 때는?', '모기 예방법 알려줘']);
    }
    if (has('나만물', '왜나만', '잘물려', '잘물리', '많이물', '모기가좋아', '누가잘물')) {
      return R('모기는 체온·이산화탄소·땀 냄새·젖산 등에 끌려요. 그래서 활동량 많고 땀 많은 사람이 잘 물려요. 혈액형 영향은 과학적으로 뚜렷하지 않습니다.', ['모기 예방법 알려줘', '어떤 기피제를 써?', '모기 활동 시간은?']);
    }
    if (has('왜가려', '가려운이유', '왜부어', '왜간지', '물리면가려')) {
      return R('모기 침 속 성분(항응고제 등)에 우리 몸이 알레르기 반응을 일으켜서 가렵고 부어요. 긁으면 더 심해지니 항히스타민 연고가 좋아요.', ['물렸을 때는?', '모기 예방법 알려줘', '매개모기 종류는?']);
    }
    if (has('박멸', '없앨수', '완전없', '다없앨', '박살')) {
      return R('완전 박멸은 어렵지만, 발생원(고인 물) 관리와 유충 구제로 개체 수를 크게 줄일 수 있어요. 그래서 발생원 중심 방제가 중요합니다.', ['방제는 어떻게 해?', '발생원이 뭐야?', '모기 예방법 알려줘']);
    }

    // (E3) 날씨가 모기에 주는 영향
    if (has('비오면', '비가오', '강수', '장마', '비올때', '비온뒤', '폭우')) {
      return R('적당한 비는 고인 물을 만들어 발생원을 늘려요. 다만 폭우는 유충을 쓸어내기도 해서, 보통 비가 그친 며칠 뒤 개체가 늘어납니다.', ['왜 여름에 모기가 많아?', '모기는 어디서 번식해?', '가장 위험한 동네는?']);
    }
    if (has('더우면', '더울때', '기온', '온도높', '폭염', '더위')) {
      return R('기온이 오르면(약 30℃까지) 모기 발육·활동이 빨라져요. 다만 40℃ 이상으로 너무 더우면 오히려 줄어듭니다. 모델도 30℃ 부근을 정점으로 계산해요.', ['왜 여름에 모기가 많아?', '어떻게 계산해?', '모기 활동 시간은?']);
    }
    if (has('습하면', '습도', '건조하면', '바람불면', '바람많', '풍속')) {
      return R('습하면 모기가 오래 살아 활동이 늘고, 건조하거나 바람이 강하면 잘 날지 못해 활동이 줄어요. 모델은 습도·강수·풍속을 모두 반영합니다.', ['어떻게 계산해?', '왜 여름에 모기가 많아?', '가장 위험한 동네는?']);
    }
    if (has('왜높', '왜낮', '어제보다', '점수변', '자주바뀌', '실시간이야', '왜올라', '왜떨어')) {
      return R('점수는 실시간 날씨에 따라 매일 바뀌어요. 기온·습도가 오르면 오르고, 선선하거나 바람이 강하면 내려갑니다. 발생원 밀도는 동네마다 고정된 기본 위험이에요.', ['어떻게 계산해?', '가장 위험한 동네는?', '모기 활동 시간은?']);
    }

    // (E4) 방충 제품·용품
    if (has('모기향', '전자매트', '모기매트', '훈증')) {
      return R('모기향·전자매트는 어느 정도 효과가 있어요. 환기되는 곳에서 보조로 쓰고, 밀폐 공간에서 오래 흡입하는 건 피하세요.', ['어떤 기피제를 써?', '모기장 효과 있어?', '모기 예방법 알려줘']);
    }
    if (has('모기장', '방충망효과', '텐트')) {
      return R('모기장은 물리적으로 가장 확실한 예방법이에요. 특히 잘 때 효과적이고, 방충망 파손도 함께 점검하세요.', ['모기 예방법 알려줘', '어떤 기피제를 써?', '모기 활동 시간은?']);
    }
    if (has('유문등', '트랩', '포집기', '유인등', '잡는기계')) {
      return R('유문등은 빛으로 모기를 유인해 잡는 장치예요. 방제 현장에서는 개체 밀도를 모니터링하는 데도 씁니다.', ['방제는 어떻게 해?', '발생원이 뭐야?', '가장 위험한 동네는?']);
    }

    // (E5) 어린이·임산부·반려동물
    if (has('어린이', '아기', '아이', '유아', '임산부', '임신')) {
      return R('어린이·임산부도 기피제를 쓸 수 있지만 저농도를 쓰고 사용법을 지키세요. 손에 덜어 바르고 얼굴엔 직접 뿌리지 마세요. 자세한 건 의사·약사와 상담하세요.', ['어떤 기피제를 써?', '모기 예방법 알려줘', '물렸을 때는?']);
    }
    if (has('강아지', '반려', '고양이', '애완', '동물')) {
      return R('사람용 DEET를 반려동물에 함부로 바르면 안 돼요. 반려동물용으로 허가된 제품만 쓰고, 수의사와 상담하는 걸 권합니다.', ['모기 예방법 알려줘', '어떤 기피제를 써?', '매개모기 종류는?']);
    }

    // (E6) 신고·민원
    if (has('신고', '민원', '어디연락', '방역요청', '연락처', '전화', '많으면어디')) {
      return R('모기가 많거나 발생원이 의심되면 김해시(보건소) 방역 부서에 방역 민원을 넣을 수 있어요. 실제 방역민원 데이터는 이 모델의 검증에도 활용됐어요.', ['방제는 어떻게 해?', '발생원이 뭐야?', '가장 위험한 동네는?']);
    }

    // (E7) 기술·모델
    if (has('ai야', 'ai냐', '인공지능', 'gpt', '챗봇이', '너는뭐', '누구야')) {
      return R('저는 사이트 정보로만 답하는 안내 도우미예요. 위험 예측 자체는 발생원·인구 밀도와 실시간 날씨를 결합한 통계 모델(Brière 온도곡선 등)로 계산합니다.', ['어떻게 계산해?', '검증은 어떻게 했어?', '정확도는 얼마야?']);
    }
    if (has('briere', 'brière', 'briére', '브리에', '브리어', '온도곡선', '활동곡선')) {
      return R('Brière 곡선은 곤충의 발육·활동이 기온에 따라 어떻게 변하는지 나타내는 곡선이에요. 모기는 약 30℃ 부근에서 가장 활발합니다.', ['어떻게 계산해?', '왜 여름에 모기가 많아?', '검증은 어떻게 했어?']);
    }
    if (has('정확도', '몇퍼', '몇프로', '얼마나맞', '오차', '틀릴')) {
      return R('실측과의 상관이 공간 +0.951, 시간 +0.996으로 높아요. 다만 구역이 17개로 커서 정밀 예측보다 위험 스크리닝·방제 우선순위용으로 적합해요. 값은 참고용이에요.', ['검증은 어떻게 했어?', '어떻게 계산해?', '가장 위험한 동네는?']);
    }
    if (has('업데이트', '갱신', '얼마나자주', '언제바뀌', '주기')) {
      return R('날씨는 실시간(Open-Meteo)으로 갱신되어 점수가 매일 바뀌고, 발생원 데이터는 김해시 방역 시스템 기준으로 반영돼요.', ['어떻게 계산해?', '데이터는 어디서 구했어?', '가장 위험한 동네는?']);
    }

    // (E8) 발생원 종류별 설명
    const SRCINFO = {
      정화조: '정화조는 유기물이 많은 정체수라 빨간집모기류가 잘 번식해요. 오수받이·환기구 봉인과 유충 구제가 중요합니다.',
      오수: '개인오수·하수처리시설의 정체수에는 영양분이 많아 모기 유충이 자라기 쉬워요.',
      하수: '하수처리 정체·집수 구간의 고인 물이 발생원이 됩니다.',
      저수지: '저수지는 넓은 수면과 가장자리 수초 지대에서 모기가 번식해요.',
      폐타이어: '폐타이어는 빗물이 고여 흰줄숲모기 같은 "용기 번식종"의 대표 발생원이에요. 물이 안 고이게 치우세요.',
      타이어: '타이어에 고인 빗물은 모기 유충의 명당이에요. 물이 고이지 않게 관리하세요.',
      축산: '축사 주변 물웅덩이·습한 환경이 모기 번식지가 됩니다.',
      축사: '축사 주변 물웅덩이·습한 환경이 모기 번식지가 됩니다.',
      화장실: '공중화장실의 정화조·물탱크 정체수가 발생원이 될 수 있어요.',
      수경: '분수·연못 같은 수경시설의 정체 구간에서 모기가 번식할 수 있어요.',
      고물상: '고물상의 빗물 고인 잡동사니 용기들이 발생원이 됩니다.',
      폐기물: '폐기물 적치장의 빗물 고인 잡동사니가 모기 번식지가 돼요.',
    };
    for (const key in SRCINFO) {
      if (q.includes(key)) return R(SRCINFO[key], ['발생원이 뭐야?', '가장 위험한 동네는?', '모기 예방법 알려줘']);
    }

    // (F) 가장 위험/안전
    if (has('가장위험', '제일위험', '위험한동네', '위험한지역', '어디가위험', '위험한곳', '어디위험')) {
      return top ? R(`오늘 기준 가장 위험한 곳은 ${top.name}으로 ${top.index}점(${top.grade})이에요. 주요 발생원은 ${srcOf(top)} 등입니다.`, ['가장 안전한 동네는?', '모기 예방법 알려줘', '발생원이 뭐야?']) : null;
    }
    if (has('가장안전', '제일안전', '안전한동네', '안전한지역', '어디가안전', '안전한곳', '어디안전')) {
      return low ? R(`오늘 기준 위험이 가장 낮은 곳은 ${low.name}으로 ${low.index}점(${low.grade})이에요. 그래도 고인 물 주변은 조심하세요.`, ['가장 위험한 동네는?', '산책은 어디가 좋아?', '오늘 우리 동네 위험해?']) : null;
    }

    // (G) 우리 동네(선택 구역 기준)
    if (has('우리동네', '오늘우리', '내동네', '우리지역', '오늘우리동네', '여기위험', '여긴')) {
      const sel = document.getElementById('districtSelect');
      const cur = sel && sel.value ? snap.find((d) => d.name === sel.value) : null;
      if (cur) {
        return R(`${cur.name}의 오늘 모기지수는 ${cur.index}점(${cur.grade})이에요. 주요 발생원은 ${srcOf(cur)} 등입니다. 참고용 값이에요.`, ['가장 안전한 동네는?', '모기 예방법 알려줘', '발생원이 뭐야?']);
      }
      return R('김해 모델 페이지에서 동네를 고르면 그 동네 오늘 점수를 알려드려요. "장유 오늘 몇 점?"처럼 동네 이름으로 물어봐도 됩니다.', ['가장 위험한 동네는?', '가장 안전한 동네는?', '동네 목록 보여줘']);
    }

    // (H) 특정 구역 점수: "장유 오늘 몇 점?", "회현동 위험해?", 또는 동네 이름만
    if (M && snap.length) {
      const hit = snap.find((d) => q.includes(d.name) || q.includes(d.name.replace(/(동|면|읍)$/, '')));
      if (hit) {
        return R(`${hit.name}의 오늘 모기지수는 ${hit.index}점(${hit.grade})이에요. 주요 발생원은 ${srcOf(hit)} 등입니다. 참고용 예상값이에요.`, ['가장 위험한 동네는?', '가장 안전한 동네는?', '모기 예방법 알려줘']);
      }
    }

    return null;
  }

  // ==== 위젯 DOM 만들기 ====
  function build() {
    const root = document.createElement('div');
    root.className = 'mz-chat';
    root.innerHTML = `
      <button class="mz-chat-fab" type="button" aria-label="모기 도우미 열기" aria-expanded="false">
        <span aria-hidden="true">🦟</span><span class="mz-fab-text">모기 도우미</span>
      </button>
      <section class="mz-chat-panel" role="dialog" aria-label="모기제로 AI 도우미" hidden>
        <header class="mz-chat-head">
          <div class="mz-head-id">
            <span class="mz-avatar" aria-hidden="true">🦟</span>
            <div class="mz-head-text">
              <strong>모기제로 도우미</strong>
              <span class="mz-chat-sub"><i class="mz-online" aria-hidden="true"></i> 실시간 안내 · AI 참고용</span>
            </div>
          </div>
          <button class="mz-chat-close" type="button" aria-label="닫기">✕</button>
        </header>
        <div class="mz-chat-log" aria-live="polite"></div>
        <div class="mz-chat-suggest">
          <button type="button" class="mz-sug">오늘 우리 동네 위험해?</button>
          <button type="button" class="mz-sug">모기지수가 뭐야?</button>
          <button type="button" class="mz-sug">왜 김해만 정밀 모델이야?</button>
          <button type="button" class="mz-sug">모기 예방법 알려줘</button>
        </div>
        <form class="mz-chat-form">
          <input class="mz-chat-input" type="text" autocomplete="off"
            placeholder="질문을 입력하세요 (예: 장유 오늘 몇 점?)" maxlength="500" aria-label="질문 입력">
          <button class="mz-chat-send" type="submit" aria-label="보내기">➤</button>
        </form>
      </section>`;
    document.body.appendChild(root);

    const fab = root.querySelector('.mz-chat-fab');
    const panel = root.querySelector('.mz-chat-panel');
    const closeBtn = root.querySelector('.mz-chat-close');
    const log = root.querySelector('.mz-chat-log');
    const form = root.querySelector('.mz-chat-form');
    const input = root.querySelector('.mz-chat-input');
    let greeted = false;

    function openPanel() {
      panel.hidden = false;
      fab.setAttribute('aria-expanded', 'true');
      input.focus();
      if (!greeted) {
        addMsg('bot', '안녕하세요! 김해 모기 위험을 안내하는 도우미예요 🦟 궁금한 걸 물어보세요.');
        greeted = true;
      }
    }
    function closePanel() {
      panel.hidden = true;
      fab.setAttribute('aria-expanded', 'false');
    }
    fab.addEventListener('click', () => (panel.hidden ? openPanel() : closePanel()));
    closeBtn.addEventListener('click', closePanel);

    // 메시지 추가. 반환값은 요소(로딩 표시 교체용).
    function addMsg(who, text) {
      const el = document.createElement('div');
      el.className = `mz-msg mz-${who}`;
      el.textContent = text;
      log.appendChild(el);
      log.scrollTop = log.scrollHeight;
      return el;
    }

    // 추천 질문 칩을 다시 채운다(초기 기본값, 답변 후 후속질문 등).
    const suggest = root.querySelector('.mz-chat-suggest');
    function setSuggest(list) {
      suggest.innerHTML = '';
      (list || []).forEach((q) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'mz-sug';
        b.textContent = q;
        b.addEventListener('click', () => ask(b.textContent));
        suggest.appendChild(b);
      });
    }

    const apiCache = {}; // 같은 질문 반복 시 API 재호출 방지(세션 캐시)

    async function ask(question) {
      addMsg('user', question);

      // 1) 로컬 FAQ 즉답 (API 없이) — 자주 묻는 것·구역 점수
      const faq = faqAnswer(question);
      if (faq) {
        addMsg('bot', faq.a);
        if (faq.f && faq.f.length) setSuggest(faq.f);
        log.scrollTop = log.scrollHeight;
        return;
      }
      // 2) 세션 캐시 (같은 질문 반복)
      if (apiCache[question]) {
        addMsg('bot', apiCache[question].answer);
        if (apiCache[question].followups) setSuggest(apiCache[question].followups);
        log.scrollTop = log.scrollHeight;
        return;
      }

      const loading = addMsg('bot', '');
      loading.classList.add('mz-typing');
      loading.innerHTML = '<span></span><span></span><span></span>';
      log.scrollTop = log.scrollHeight;
      try {
        const res = await fetch('/api/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question,
            districts: buildDistrictSnapshot(),
            today: todayStr(),
          }),
        });
        const data = await res.json();
        loading.classList.remove('mz-typing'); loading.innerHTML = '';
        loading.textContent = data.answer || '죄송해요, 답을 가져오지 못했어요.';
        // 답변마다 후속 질문 추천을 갱신
        if (Array.isArray(data.followups) && data.followups.length) {
          setSuggest(data.followups);
        }
        // 성공 답변만 세션 캐시에 저장(오류 메시지는 저장 안 함)
        if (data.ok) apiCache[question] = { answer: data.answer, followups: data.followups };
      } catch (e) {
        loading.classList.remove('mz-typing'); loading.innerHTML = '';
        loading.textContent = '⚠️ 연결에 실패했어요. 잠시 후 다시 시도해 주세요.';
      }
      log.scrollTop = log.scrollHeight;
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      input.value = '';
      ask(q);
    });
    // 초기 추천 질문 버튼에 동작 연결
    root.querySelectorAll('.mz-sug').forEach((b) => {
      b.addEventListener('click', () => ask(b.textContent));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
