/* =============================================================
   내 기록 화면 (me.js)
   -------------------------------------------------------------
   · 기록·배지: 이 브라우저의 게임 기록(MZGame.state)을 보여 주고, 로그인했으면 서버 기록과 합친다.
     로그인하지 않아도 모든 기능을 쓸 수 있고, 기록은 이 기기에 쌓인다. 로그인은 랭킹(기록 경쟁)용이다.
   · 계정 칸(서버 MZAuth 가 준비됐을 때): 화면이 상태에 따라 바뀐다
       login(로그인) · signup(회원가입) · forgot(비밀번호 찾기) · recover(메일 링크로 새 비밀번호)
       onboard(가입 마무리: 구글·카카오로 처음 들어왔을 때 닉네임·필수 동의) · account(계정 관리)
   · 봇·AI 자동 가입 막기: 캡차 키가 있으면 가입·로그인·비밀번호 찾기·비밀번호 바꾸기에 Cloudflare Turnstile 을 붙인다.
   · 보상 표: game-config.js 의 REWARD_TIERS (운영 기관이 확정하면 그 파일만 고친다).
   ============================================================= */
(function () {
  'use strict';
  const CFG = window.MZ_GAME_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const n = (v) => Number(v || 0).toLocaleString('ko-KR');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let mode = 'login';   // login · signup · forgot

  function renderStats() {
    const s = window.MZGame ? window.MZGame.state() : { kills: 0, bestStage: 0, badges: [], today: { runs: 0 } };
    $('stKills').innerHTML = `${n(s.kills)}<small>마리</small>`;
    $('stStage').textContent = s.bestStage ? `${s.bestStage}단계` : '-';
    $('stToday').innerHTML = `${n(s.today ? s.today.runs : 0)}<small>/${n(CFG.DAILY_PLAY_LIMIT || 30)}회</small>`;
    const grid = $('bdgGrid');
    const badges = (window.MZGame && window.MZGame.badges) || [];
    grid.innerHTML = badges.map((b) => {
      const got = s.badges.includes(b.id);
      const pct = Math.min(100, Math.round((s.kills / b.need) * 100));
      return `<div class="bdg${got ? '' : ' is-locked'}">${window.MZGame.badgeIcon(b.id, 72)}<b>${b.name}</b><span>${got ? b.title : `${n(b.need)}마리`}</span>${got ? '' : `<div class="pr" aria-label="${pct}%"><i style="width:${pct}%"></i></div>`}</div>`;
    }).join('');
  }

  function renderRewards() {
    $('rewardNote').textContent = CFG.REWARD_NOTE || '';
    $('rewardBody').innerHTML = (CFG.REWARD_TIERS || []).map((t) => `<tr><td>${t.from === t.to ? `${t.from}위` : `${t.from}~${t.to}위`}</td><td>${t.prize}</td></tr>`).join('') || '<tr><td colspan="2">보상은 아직 정해지지 않았어요.</td></tr>';
  }

  /* ---------- 캡차 (Cloudflare Turnstile) ---------- */
  let tsLoading = null;
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve();
    if (!tsLoading) {
      tsLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        s.async = true; s.onload = () => resolve(); s.onerror = () => { tsLoading = null; reject(new Error('captcha')); };
        document.head.appendChild(s);
      });
    }
    return tsLoading;
  }
  // 상자(box)에 캡차를 넣고, 토큰을 꺼내는 함수와 다시 받는 함수를 돌려준다. 캡차 키가 없으면 아무것도 안 한다
  function captcha(box) {
    const key = window.MZAuth.turnstileSiteKey;
    let token = null, id = null;
    if (!key || !box) return { token: () => undefined, reset() {}, needed: false };
    loadTurnstile().then(() => {
      id = window.turnstile.render(box, {
        sitekey: key, language: 'ko', theme: 'light',
        callback: (t) => { token = t; }, 'expired-callback': () => { token = null; }, 'error-callback': () => { token = null; },
      });
    }).catch(() => { box.textContent = '사람인지 확인하는 상자를 불러오지 못했어요. 새로고침해 주세요.'; });
    return { token: () => token || undefined, reset() { token = null; if (id != null && window.turnstile) window.turnstile.reset(id); }, needed: true };
  }

  /* ---------- 동의 목록 (가입·가입 마무리 공통) ---------- */
  function consentBlock() {
    return `<fieldset class="agree" id="agreeBox">
      <legend class="sr-only">약관 동의</legend>
      <label class="agree-all"><input type="checkbox" id="agAll"> <span><b>전체 동의</b> <small>(선택 항목 포함)</small></span></label>
      <label><input type="checkbox" name="age14" data-req> <span><em>[필수]</em> 만 14세 이상이에요</span></label>
      <label><input type="checkbox" name="terms" data-req> <span><em>[필수]</em> <a href="terms.html" target="_blank" rel="noopener">이용약관</a>에 동의해요</span></label>
      <label><input type="checkbox" name="privacy" data-req> <span><em>[필수]</em> <a href="privacy.html#signup" target="_blank" rel="noopener">개인정보 수집·이용</a>에 동의해요</span></label>
      <div class="agree-sum">
        <p><b>모으는 것</b> 이메일(로그인), 닉네임(랭킹에 공개), 모기 잡기 기록</p>
        <p><b>쓰는 곳</b> 로그인, 랭킹, 기록을 다른 기기에서 이어 보기</p>
        <p><b>보관</b> 계정을 지울 때까지 (지우면 바로 모두 삭제)</p>
        <p>동의하지 않아도 모기제로의 모든 기능은 로그인 없이 쓸 수 있어요. 랭킹 참여만 안 돼요.</p>
      </div>
      <label><input type="checkbox" name="location"> <span><em class="opt">[선택]</em> 위치정보 이용 — 제보 위치·뛰어런 거리 (<a href="privacy.html#location" target="_blank" rel="noopener">자세히</a>)</span></label>
      <label><input type="checkbox" name="motion"> <span><em class="opt">[선택]</em> 움직임 센서 이용 — 뛰어런 걸음 세기</span></label>
      <p class="agree-note">선택 항목은 그 기능을 처음 쓸 때 다시 물어보고, 계정 관리에서 언제든 끌 수 있어요.</p>
    </fieldset>`;
  }
  function wireConsent(root) {
    const all = root.querySelector('#agAll');
    const boxes = Array.from(root.querySelectorAll('#agreeBox input[name]'));
    all.addEventListener('change', () => boxes.forEach((b) => { b.checked = all.checked; }));
    boxes.forEach((b) => b.addEventListener('change', () => { all.checked = boxes.every((x) => x.checked); }));
    return () => Object.fromEntries(boxes.map((b) => [b.name, b.checked]));
  }

  /* ---------- 화면 조각 ---------- */
  function socialButtons() {
    const P = window.MZAuth.providers;
    if (!P.length) return '';
    return `<div class="sns">
      ${P.includes('kakao') ? '<button type="button" class="sns-btn kakao" data-oauth="kakao"><span aria-hidden="true">💬</span> 카카오로 시작하기</button>' : ''}
      ${P.includes('google') ? '<button type="button" class="sns-btn google" data-oauth="google"><span aria-hidden="true" class="g">G</span> 구글로 시작하기</button>' : ''}
      <p class="sns-or"><span>또는 이메일로</span></p>
    </div>`;
  }
  function loginForm() {
    return `${socialButtons()}
    <form class="frm" id="acctForm" novalidate>
      <label>이메일<input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label>
      <label>비밀번호<input name="password" type="password" autocomplete="current-password" required></label>
      <div class="cap" id="capBox"></div>
      <p class="frm-err" id="frmErr" role="alert"></p>
      <div class="frm-btns"><button type="submit" class="btn-main">로그인</button></div>
      <p class="frm-swap"><button type="button" data-mode="forgot">비밀번호를 잊었어요</button> · 처음이세요? <button type="button" data-mode="signup">회원가입</button></p>
    </form>`;
  }
  function signupForm() {
    return `${socialButtons()}
    <form class="frm" id="acctForm" novalidate>
      <label>닉네임 (랭킹에 보여요)<input name="nickname" type="text" maxlength="12" autocomplete="nickname" required placeholder="2~12자 한글·영문·숫자"></label>
      <label>이메일<input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label>
      <label>비밀번호<input name="password" type="password" autocomplete="new-password" minlength="8" required placeholder="8자 이상, 영문과 숫자"></label>
      <label>비밀번호 확인<input name="password2" type="password" autocomplete="new-password" minlength="8" required></label>
      ${consentBlock()}
      <div class="cap" id="capBox"></div>
      <p class="frm-err" id="frmErr" role="alert"></p>
      <div class="frm-btns"><button type="submit" class="btn-main">가입하기</button></div>
      <p class="frm-swap">이미 계정이 있나요? <button type="button" data-mode="login">로그인</button></p>
      <p class="acct-note">이름·전화번호·주소는 받지 않아요. 랭킹에는 닉네임만 보여요.</p>
    </form>`;
  }
  function forgotForm() {
    return `<form class="frm" id="acctForm" novalidate>
      <p class="acct-note">가입한 이메일을 적으면 비밀번호를 새로 정하는 링크를 보내 드려요. 구글·카카오로 가입했다면 그 계정으로 로그인해 주세요.</p>
      <label>이메일<input name="email" type="email" autocomplete="email" required></label>
      <div class="cap" id="capBox"></div>
      <p class="frm-err" id="frmErr" role="alert"></p>
      <div class="frm-btns"><button type="submit" class="btn-main">재설정 메일 받기</button></div>
      <p class="frm-swap"><button type="button" data-mode="login">로그인으로 돌아가기</button></p>
    </form>`;
  }

  function bindSwap(body) {
    body.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; renderAccount(); }));
    body.querySelectorAll('[data-oauth]').forEach((b) => b.addEventListener('click', async () => {
      const err = $('frmErr');
      b.disabled = true;
      try { await window.MZAuth.signInWith(b.dataset.oauth); } catch (ex) { if (err) err.textContent = ex.message; b.disabled = false; }
    }));
  }
  // 폼 제출 공통: 버튼 잠그기, 오류 표시, 캡차 다시 받기
  function onSubmit(form, cap, work) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = form.querySelector('.frm-err'), btn = form.querySelector('.btn-main');
      err.textContent = ''; err.classList.remove('ok');
      if (cap && cap.needed && !cap.token()) { err.textContent = '사람인지 확인하는 상자를 먼저 눌러 주세요.'; return; }
      btn.disabled = true;
      try {
        const msg = await work(form, cap ? cap.token() : undefined);
        if (msg) { err.classList.add('ok'); err.textContent = msg; }
      } catch (ex) { err.textContent = ex.message || '실패했어요. 다시 해 주세요.'; }
      if (cap) cap.reset();
      btn.disabled = false;
    });
  }

  /* ---------- 계정 관리 (로그인 뒤) ---------- */
  function accountPanel(A) {
    const p = A.profile() || {};
    const methods = A.loginMethods().map((m) => ({ email: '이메일', google: '구글', kakao: '카카오' }[m] || m)).join(' · ');
    const next = p.nickname_changed_at ? new Date(new Date(p.nickname_changed_at).getTime() + 30 * 864e5) : null;
    return `<div class="acct-grid">
      <details class="acct-sec"><summary>닉네임 바꾸기</summary>
        <form class="frm" id="nickForm" novalidate>
          <label>새 닉네임<input name="nickname" type="text" maxlength="12" required value="${esc(p.nickname || '')}"></label>
          <p class="acct-note">30일에 한 번 바꿀 수 있어요.${next && next > new Date() ? ` 다음 변경 가능: ${next.toLocaleDateString('ko-KR')}` : ''}</p>
          <p class="frm-err" role="alert"></p>
          <div class="frm-btns"><button type="submit" class="btn-main">바꾸기</button></div>
        </form></details>
      ${A.hasPassword() ? `<details class="acct-sec"><summary>비밀번호 바꾸기</summary>
        <form class="frm" id="pwForm" novalidate>
          <label>지금 비밀번호<input name="current" type="password" autocomplete="current-password" required></label>
          <label>새 비밀번호<input name="password" type="password" autocomplete="new-password" minlength="8" required placeholder="8자 이상, 영문과 숫자"></label>
          <label>새 비밀번호 확인<input name="password2" type="password" autocomplete="new-password" minlength="8" required></label>
          <div class="cap" id="capPw"></div>
          <p class="frm-err" role="alert"></p>
          <div class="frm-btns"><button type="submit" class="btn-main">바꾸기</button></div>
        </form></details>` : ''}
      <details class="acct-sec" id="consentSec"><summary>선택 동의 관리</summary>
        <div class="frm">
          <label class="sw"><input type="checkbox" data-consent="location"> 위치정보 이용 (제보 위치·뛰어런 거리)</label>
          <label class="sw"><input type="checkbox" data-consent="motion"> 움직임 센서 이용 (뛰어런 걸음 세기)</label>
          <p class="acct-note">끄면 그 기능을 쓸 때 다시 물어봐요. 필수 동의는 계정을 지우면 함께 사라져요. <a href="privacy.html">개인정보 처리방침</a> · <a href="terms.html">이용약관</a></p>
          <p class="frm-err" id="consentErr" role="alert"></p>
        </div></details>
      <details class="acct-sec"><summary>내 정보 · 로그아웃 · 계정 삭제</summary>
        <div class="frm">
          <p class="acct-note">로그인 방법: ${esc(methods || '이메일')}</p>
          <div class="frm-btns">
            <button type="button" class="btn-sub" id="exportBtn">내 정보 내려받기</button>
            <button type="button" class="btn-sub" id="logoutAllBtn">모든 기기에서 로그아웃</button>
          </div>
          <form class="frm danger" id="delForm" novalidate>
            <p><b>계정 삭제</b> — 계정과 서버에 있는 모든 기록(잡은 수·배지·랭킹·동의 기록)을 바로 지워요. 되돌릴 수 없어요.</p>
            <label>확인을 위해 <b>삭제</b>라고 적어 주세요<input name="confirm" type="text" autocomplete="off" required></label>
            <label class="sw"><input type="checkbox" name="local"> 이 기기에 남은 기록(잡은 수·배지·골드·뛰어런)도 지우기</label>
            <p class="frm-err" role="alert"></p>
            <div class="frm-btns"><button type="submit" class="btn-main btn-danger">계정 삭제</button></div>
          </form>
        </div></details>
    </div>`;
  }
  function wireAccount(A) {
    onSubmit($('nickForm'), null, async (f) => { await A.changeNickname(f.nickname.value); return '닉네임을 바꿨어요. 랭킹에는 5분 안에 반영돼요.'; });
    if ($('pwForm')) {
      const cap = captcha($('capPw'));
      onSubmit($('pwForm'), cap, async (f, token) => {
        if (f.password.value !== f.password2.value) throw new Error('새 비밀번호 두 칸이 서로 달라요.');
        await A.changePassword(f.current.value, f.password.value, token);
        f.reset(); return '비밀번호를 바꿨어요.';
      });
    }
    // 선택 동의: 서버 기록을 읽어 스위치에 표시, 바꾸면 서버와 이 기기(MZConsent)에 함께 남긴다
    A.myConsents().then((c) => {
      document.querySelectorAll('[data-consent]').forEach((sw) => {
        const k = sw.dataset.consent;
        sw.checked = !!(c[k] && c[k].agreed);
        sw.addEventListener('change', async () => {
          try {
            await A.setConsent(k, sw.checked);
            if (window.MZConsent) window.MZConsent.set(k, sw.checked, { skipServer: true });
            $('consentErr').textContent = '';
          } catch (ex) { sw.checked = !sw.checked; $('consentErr').textContent = ex.message; }
        });
      });
    });
    $('exportBtn').addEventListener('click', async () => {
      try {
        const data = await A.exportMyData();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = `모기제로-내정보-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      } catch (ex) { alertBox(ex.message); }
    });
    $('logoutAllBtn').addEventListener('click', async () => { await A.signOut(true); });
    onSubmit($('delForm'), null, async (f) => {
      if (f.confirm.value.trim() !== '삭제') throw new Error("'삭제'라고 정확히 적어 주세요.");
      const wipe = f.local.checked;
      await A.deleteAccount();
      if (wipe) { ['mz-game', 'mz-run', 'mz-consent'].forEach((k) => { try { localStorage.removeItem(k); } catch (e) { /* 무시 */ } }); }
      setTimeout(() => location.reload(), 300);
      return '계정을 지웠어요.';
    });
  }
  function alertBox(msg) { const e = $('frmErr') || document.querySelector('#acctBody .frm-err'); if (e) e.textContent = msg; }

  /* ---------- 계정 칸 그리기 ---------- */
  async function renderAccount() {
    const A = window.MZAuth;
    const name = $('acctName'), sub = $('acctSub'), btns = $('acctBtns'), body = $('acctBody');
    if (!A || A.status === 'loading') { sub.textContent = '서버 확인 중'; return; }
    if (A.status === 'off' || A.status === 'error') {
      name.textContent = '손님'; sub.textContent = '이 기기에만 기록이 남아요'; btns.innerHTML = '';
      body.innerHTML = `<p class="acct-note warn">회원가입·로그인·랭킹은 준비 중이에요. 서버가 연결되면 열려요. 그때까지도 잡은 수와 배지는 이 기기에 그대로 남아요.${A.status === 'error' ? ' (지금은 서버에 연결할 수 없어요)' : ''}</p>`;
      return;
    }
    const u = A.user(), p = A.profile();

    // 비밀번호 재설정 메일의 링크로 들어온 경우: 새 비밀번호만 묻는다
    if (u && A.recovering) {
      name.textContent = '새 비밀번호 정하기'; sub.textContent = u.email || ''; btns.innerHTML = '';
      body.innerHTML = `<form class="frm" id="acctForm" novalidate>
        <label>새 비밀번호<input name="password" type="password" autocomplete="new-password" minlength="8" required placeholder="8자 이상, 영문과 숫자"></label>
        <label>새 비밀번호 확인<input name="password2" type="password" autocomplete="new-password" minlength="8" required></label>
        <p class="frm-err" id="frmErr" role="alert"></p>
        <div class="frm-btns"><button type="submit" class="btn-main">비밀번호 저장</button></div></form>`;
      onSubmit($('acctForm'), null, async (f) => {
        if (f.password.value !== f.password2.value) throw new Error('두 칸이 서로 달라요.');
        await A.changePassword('', f.password.value); return '저장했어요.';
      });
      return;
    }

    // 구글·카카오로 처음 들어왔거나 동의를 아직 안 한 계정: 가입 마무리
    if (u && A.needsOnboarding()) {
      name.textContent = '가입 마무리'; sub.textContent = '랭킹에 쓸 닉네임과 동의만 남았어요'; btns.innerHTML = '<button type="button" class="btn-sub" id="logoutBtn">나중에 하기(로그아웃)</button>';
      body.innerHTML = `<form class="frm" id="acctForm" novalidate>
        <label>닉네임 (랭킹에 보여요)<input name="nickname" type="text" maxlength="12" required placeholder="2~12자 한글·영문·숫자"></label>
        <p class="acct-note">구글·카카오의 이름은 랭킹에 쓰지 않아요. 보여 줄 닉네임을 직접 정해 주세요.</p>
        ${consentBlock()}
        <p class="frm-err" id="frmErr" role="alert"></p>
        <div class="frm-btns"><button type="submit" class="btn-main">시작하기</button></div></form>`;
      const getConsents = wireConsent(body);
      $('logoutBtn').addEventListener('click', () => A.signOut());
      onSubmit($('acctForm'), null, async (f) => {
        const c = getConsents();
        await A.finishOnboarding(f.nickname.value, c);
        if (window.MZConsent) { window.MZConsent.set('location', !!c.location, { skipServer: true }); window.MZConsent.set('motion', !!c.motion, { skipServer: true }); }
      });
      return;
    }

    if (u) {
      name.textContent = p ? p.nickname : '회원'; sub.textContent = `${u.email || ''}${A.isStaff() ? ' · 직원' : ''}`;
      btns.innerHTML = '<button type="button" class="btn-sub" id="logoutBtn">로그아웃</button>';
      body.innerHTML = (A.isStaff() ? '<p class="acct-note">직원 계정이에요. <a href="expert.html">전문가용 화면</a>을 볼 수 있어요.</p>' : '') + accountPanel(A);
      $('logoutBtn').addEventListener('click', () => A.signOut());
      wireAccount(A);
      // 서버 기록과 합치기
      try {
        const [score, badges] = await Promise.all([A.myScore(), A.myBadges()]);
        if (score || badges.length) { window.MZGame.mergeServer({ total_kills: score ? score.total_kills : 0, best_stage: score ? score.best_stage : 0, badges: badges.map((b) => b.badge_id) }); renderStats(); }
      } catch (e) { /* 서버 기록 없으면 이 기기 기록만 */ }
      return;
    }

    // 로그인 전
    name.textContent = '손님'; btns.innerHTML = '';
    sub.textContent = '로그인 없이도 다 쓸 수 있어요. 로그인하면 랭킹에 참여하고 기록이 다른 기기에서도 이어져요';
    body.innerHTML = mode === 'signup' ? signupForm() : mode === 'forgot' ? forgotForm() : loginForm();
    bindSwap(body);
    const cap = captcha($('capBox'));
    if (mode === 'signup') {
      const getConsents = wireConsent(body);
      onSubmit($('acctForm'), cap, async (f, token) => {
        if (f.password.value !== f.password2.value) throw new Error('비밀번호 두 칸이 서로 달라요.');
        const c = getConsents();
        if (!c.age14 || !c.terms || !c.privacy) throw new Error('필수 항목 3가지에 동의해 주세요.');
        const r = await A.signUp({ email: f.email.value.trim(), password: f.password.value, nickname: f.nickname.value, consents: c, captchaToken: token });
        if (window.MZConsent) { window.MZConsent.set('location', !!c.location, { skipServer: true }); window.MZConsent.set('motion', !!c.motion, { skipServer: true }); }
        if (r.needsConfirm) { mode = 'login'; return '가입 확인 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인해 주세요.'; }
        return '';
      });
    } else if (mode === 'forgot') {
      onSubmit($('acctForm'), cap, async (f, token) => {
        await A.sendPasswordReset(f.email.value, token);
        return '메일을 보냈어요. 받은 편지함(스팸함도)에서 링크를 눌러 주세요.';
      });
    } else {
      onSubmit($('acctForm'), cap, async (f, token) => { await A.signIn({ email: f.email.value.trim(), password: f.password.value, captchaToken: token }); });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderStats(); renderRewards(); renderAccount();
    document.addEventListener('auth:changed', renderAccount);
    document.addEventListener('game:changed', renderStats);
    if (window.MZAuth) window.MZAuth.ready.then(renderAccount);
  });
}());
