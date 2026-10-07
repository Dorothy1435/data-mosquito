/* =============================================================
   내 배지 화면 (me.js)
   -------------------------------------------------------------
   · 계정 칸: 서버(MZAuth)가 준비됐으면 가입·로그인·로그아웃, 아니면 "준비 중".
   · 기록·배지: 이 브라우저의 게임 기록(MZGame.state)을 보여 주고, 로그인했으면 서버 기록과 합친다.
   · 보상 표: game-config.js 의 REWARD_TIERS (운영 기관이 확정하면 그 파일만 고친다).
   ============================================================= */
(function () {
  'use strict';
  const CFG = window.MZ_GAME_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const n = (v) => Number(v || 0).toLocaleString('ko-KR');
  let mode = 'login';   // 폼 종류: login · signup

  function renderStats() {
    const s = window.MZGame ? window.MZGame.state() : { kills: 0, bestStage: 0, badges: [], today: { runs: 0 } };
    $('stKills').innerHTML = `${n(s.kills)}<small>마리</small>`;
    $('stStage').textContent = s.bestStage ? `${s.bestStage}단계` : '-';
    $('stToday').innerHTML = `${n(s.today ? s.today.runs : 0)}<small>/${n(CFG.DAILY_PLAY_LIMIT || 30)}회</small>`;
    const grid = $('bdgGrid');
    const badges = (window.MZGame && window.MZGame.badges) || [];
    grid.innerHTML = badges.map((b, i) => {
      const got = s.badges.includes(b.id);
      const pct = Math.min(100, Math.round((s.kills / b.need) * 100));
      return `<div class="bdg${got ? '' : ' is-locked'}">${window.MZGame.badgeIcon(b.id, 72)}<b>${b.name}</b><span>${got ? b.title : `${n(b.need)}마리`}</span>${got ? '' : `<div class="pr" aria-label="${pct}%"><i style="width:${pct}%"></i></div>`}</div>`;
    }).join('');
  }

  function renderRewards() {
    $('rewardNote').textContent = CFG.REWARD_NOTE || '';
    $('rewardBody').innerHTML = (CFG.REWARD_TIERS || []).map((t) => `<tr><td>${t.from === t.to ? `${t.from}위` : `${t.from}~${t.to}위`}</td><td>${t.prize}</td></tr>`).join('') || '<tr><td colspan="2">보상은 아직 정해지지 않았어요.</td></tr>';
  }

  function form() {
    const signup = mode === 'signup';
    return `<form class="frm" id="acctForm" novalidate>
      ${signup ? '<label>닉네임 (랭킹에 보여요)<input name="nickname" type="text" maxlength="12" autocomplete="nickname" required placeholder="2~12자"></label>' : ''}
      <label>이메일<input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label>
      <label>비밀번호<input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="6" required placeholder="6자 이상"></label>
      <p class="frm-err" id="frmErr" aria-live="polite"></p>
      <div class="frm-btns"><button type="submit" class="btn-main">${signup ? '가입하기' : '로그인'}</button></div>
      <p class="frm-swap">${signup ? '이미 계정이 있나요? <button type="button" data-mode="login">로그인</button>' : '처음이세요? <button type="button" data-mode="signup">회원가입</button>'}</p>
      <p class="acct-note">이메일은 로그인에만 쓰고, 랭킹에는 닉네임만 보여요. 이름·전화번호는 받지 않아요.</p>
    </form>`;
  }

  async function renderAccount() {
    const A = window.MZAuth;
    const name = $('acctName'), sub = $('acctSub'), btns = $('acctBtns'), body = $('acctBody');
    if (!A || A.status === 'loading') { sub.textContent = '서버 확인 중'; return; }
    if (A.status === 'off' || A.status === 'error') {
      name.textContent = '손님'; sub.textContent = '이 기기에만 기록이 남아요'; btns.innerHTML = '';
      body.innerHTML = `<p class="acct-note warn">회원가입·로그인·랭킹은 준비 중이에요. 서버(Supabase)가 연결되면 열려요. 그때까지도 잡은 수와 배지는 이 기기에 그대로 남아요.${A.status === 'error' ? ' (연결 오류: ' + A.lastError + ')' : ''}</p>`;
      return;
    }
    const u = A.user(), p = A.profile();
    if (u) {
      name.textContent = p ? p.nickname : '회원'; sub.textContent = `${u.email}${A.isStaff() ? ' · 직원' : ''}`;
      btns.innerHTML = '<button type="button" class="btn-sub" id="logoutBtn">로그아웃</button>';
      body.innerHTML = A.isStaff() ? '<p class="acct-note">직원 계정이에요. <a href="expert.html">전문가용 화면</a>을 볼 수 있어요.</p>' : '';
      $('logoutBtn').addEventListener('click', async () => { await A.signOut(); });
      // 서버 기록과 합치기
      try {
        const [score, badges] = await Promise.all([A.myScore(), A.myBadges()]);
        if (score || badges.length) { window.MZGame.mergeServer({ total_kills: score ? score.total_kills : 0, best_stage: score ? score.best_stage : 0, badges: badges.map((b) => b.badge_id) }); renderStats(); }
      } catch (e) { /* 서버 기록 없으면 이 기기 기록만 */ }
    } else {
      name.textContent = '손님'; sub.textContent = '로그인하면 랭킹에 참여하고 기록이 다른 기기에서도 이어져요'; btns.innerHTML = '';
      body.innerHTML = form();
      body.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; renderAccount(); }));
      $('acctForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target, err = $('frmErr'), btn = f.querySelector('.btn-main');
        err.textContent = ''; btn.disabled = true;
        try {
          if (mode === 'signup') {
            const r = await A.signUp(f.email.value.trim(), f.password.value, f.nickname.value);
            if (r.needsConfirm) { err.style.color = 'var(--g700)'; err.textContent = '가입 확인 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인해 주세요.'; mode = 'login'; }
          } else {
            await A.signIn(f.email.value.trim(), f.password.value);
          }
        } catch (ex) { err.style.color = ''; err.textContent = ex.message || '실패했어요. 다시 해 주세요.'; }
        btn.disabled = false;
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderStats(); renderRewards(); renderAccount();
    document.addEventListener('auth:changed', renderAccount);
    document.addEventListener('game:changed', renderStats);
    if (window.MZAuth) window.MZAuth.ready.then(renderAccount);
  });
}());
