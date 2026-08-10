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
          <div>
            <strong>모기제로 도우미</strong>
            <span class="mz-chat-sub">김해 모기 위험 안내 · AI 참고용</span>
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

    async function ask(question) {
      addMsg('user', question);
      const loading = addMsg('bot', '…');
      loading.classList.add('mz-loading');
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
        loading.classList.remove('mz-loading');
        loading.textContent = data.answer || '죄송해요, 답을 가져오지 못했어요.';
        // 답변마다 후속 질문 추천을 갱신
        if (Array.isArray(data.followups) && data.followups.length) {
          setSuggest(data.followups);
        }
      } catch (e) {
        loading.classList.remove('mz-loading');
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
