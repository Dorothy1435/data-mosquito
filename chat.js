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
  function faqAnswer(text) {
    const q = String(text).replace(/[\s?!.]/g, '');
    const has = (...ks) => ks.some((k) => q.includes(k));
    const snap = buildDistrictSnapshot();
    const byIndex = snap.slice().sort((a, b) => b.index - a.index);
    const top = byIndex[0];
    const low = byIndex[byIndex.length - 1];
    const srcOf = (d) => (d && d.top_sources || []).slice(0, 2).join('·');

    // (1) 특정 구역 점수: "장유 오늘 몇 점?", "회현동 위험해?"
    const M = window.GimhaeMosquitoModel;
    if (M && snap.length) {
      const hit = snap.find((d) => q.includes(d.name) || q.includes(d.name.replace(/(동|면|읍)$/, '')));
      if (hit && has('점', '위험', '오늘', '어때', '어떄', '모기', '지수', '얼마')) {
        return { a: `${hit.name}의 오늘 모기지수는 ${hit.index}점(${hit.grade})이에요. 주요 발생원은 ${srcOf(hit)} 등입니다. 참고용 예상값이에요.`,
          f: ['가장 위험한 동네는?', '가장 안전한 동네는?', '모기 예방법 알려줘'] };
      }
    }
    // (2) 가장 위험/안전한 동네
    if (has('가장위험', '제일위험', '위험한동네', '위험한지역', '어디가위험')) {
      return top ? { a: `오늘 기준 가장 위험한 곳은 ${top.name}으로 ${top.index}점(${top.grade})이에요. 주요 발생원은 ${srcOf(top)} 등입니다.`,
        f: ['가장 안전한 동네는?', '모기 예방법 알려줘', '발생원이 뭐야?'] } : null;
    }
    if (has('가장안전', '제일안전', '안전한동네', '안전한지역', '어디가안전')) {
      return low ? { a: `오늘 기준 위험이 가장 낮은 곳은 ${low.name}으로 ${low.index}점(${low.grade})이에요. 그래도 고인 물 주변은 조심하세요.`,
        f: ['가장 위험한 동네는?', '모기 예방법 알려줘', '오늘 우리 동네는?'] } : null;
    }
    // (3) 우리 동네(선택 구역 기준)
    if (has('우리동네', '오늘우리', '내동네', '우리지역', '오늘우리동네')) {
      const sel = document.getElementById('districtSelect');
      const cur = sel && sel.value ? snap.find((d) => d.name === sel.value) : null;
      if (cur) {
        return { a: `${cur.name}의 오늘 모기지수는 ${cur.index}점(${cur.grade})이에요. 주요 발생원은 ${srcOf(cur)} 등입니다. 참고용 값이에요.`,
          f: ['가장 안전한 동네는?', '모기 예방법 알려줘', '발생원이 뭐야?'] };
      }
      return { a: '김해 모델 페이지에서 동네를 고르면 그 동네 오늘 점수를 알려드려요. "장유 오늘 몇 점?"처럼 동네 이름으로 물어봐도 됩니다.',
        f: ['가장 위험한 동네는?', '가장 안전한 동네는?', '모기지수가 뭐야?'] };
    }
    // (4) 정의·개념
    if (has('모기지수가뭐', '모기지수란', '지수가뭐', '지수란무엇', '지수뭐야')) {
      return { a: '모기지수는 오늘 모기 위험을 0~100점으로 나타낸 값이에요. 높을수록 위험하며 쾌적·관심·주의·불쾌 4단계로 안내합니다. 발생원 밀도와 실시간 날씨로 계산한 참고용 예상값이에요.',
        f: ['가장 위험한 동네는?', '모기 예방법 알려줘', '왜 김해만 정밀 모델이야?'] };
    }
    if (has('왜김해', '김해만')) {
      return { a: '김해시는 발생원 시설·인구·면적 같은 행정 데이터가 확보돼 있어 정밀 모델을 적용해요. 그 외 지역은 그 데이터가 없어 날씨 기반 추정값으로만 보여드립니다.',
        f: ['발생원이 뭐야?', '검증은 어떻게 했어?', '가장 위험한 동네는?'] };
    }
    if (has('예방', '안물리', '물리지않', '기피제', '어떻게막')) {
      return { a: '① 집·주변 고인 물(화분받침·폐타이어·빗물받이·양동이)을 비우고 방충망을 점검하세요. ② 해질녘·새벽엔 밝은 긴 옷과 기피제를 쓰고, 물가·수풀 가까운 곳을 피하세요.',
        f: ['가장 안전한 동네는?', '발생원이 뭐야?', '매개모기 종류는?'] };
    }
    if (has('발생원이뭐', '발생원이란', '발생원뭐', '발생원종류')) {
      return { a: '발생원은 모기가 알을 낳고 번식하는 시설·환경이에요. 김해는 정화조·개인하수/오수처리·축산·저수지·폐타이어·공중화장실·도시공원 등 16종 약 17,081곳을 반영합니다.',
        f: ['가장 위험한 동네는?', '모기 예방법 알려줘', '왜 김해만 정밀 모델이야?'] };
    }
    if (has('검증', '믿을', '믿어', '정확해', '정확한')) {
      return { a: '예측을 두 방향으로 검증했어요. 공간: 밀도위험 ↔ 실제 방역민원 +0.951. 시간: 예측 활동곡선 ↔ 실측 유충(2년·5.4만 건) +0.996. 실측과 강하게 일치합니다.',
        f: ['모기지수가 뭐야?', '발생원이 뭐야?', '가장 위험한 동네는?'] };
    }
    if (has('매개모기', '무슨모기', '모기종류', '일본뇌염', '뎅기', '지카', '말라리아', '웨스트나일')) {
      return { a: '국내 주요 매개모기는 작은빨간집모기(일본뇌염), 빨간집모기(웨스트나일), 흰줄숲모기(뎅기·지카), 얼룩날개모기(말라리아)예요. 종마다 번식하는 발생원이 다릅니다.',
        f: ['모기 예방법 알려줘', '발생원이 뭐야?', '가장 위험한 동네는?'] };
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
