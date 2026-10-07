/* =============================================================
   랭킹 화면 (ranking.js)
   -------------------------------------------------------------
   서버(MZAuth.ranking)가 5분마다 만들어 둔 공개 랭킹(닉네임·누적·최고 단계)을 읽어 보여 준다.
   서버가 없으면 "준비 중"과 이 기기의 내 기록만 보여 준다.
   ============================================================= */
(function () {
  'use strict';
  const CFG = window.MZ_GAME_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const n = (v) => Number(v || 0).toLocaleString('ko-KR');

  function renderRewards() {
    $('rewardBody').innerHTML = (CFG.REWARD_TIERS || []).map((t) => `<tr><td>${t.from === t.to ? `${t.from}위` : `${t.from}~${t.to}위`}</td><td>${t.prize}</td></tr>`).join('');
  }

  async function render() {
    const A = window.MZAuth, note = $('rkNote'), list = $('rkList');
    $('rkSeason').textContent = `모기 잡기 · ${CFG.SEASON || new Date().getFullYear()} 시즌 랭킹`;
    const mine = window.MZGame ? window.MZGame.state() : { kills: 0 };
    if (!A || A.status === 'loading') return;
    if (A.status !== 'ready') {
      note.className = 'acct-note warn';
      note.innerHTML = `랭킹은 준비 중이에요. 서버(Supabase)가 연결되면 열려요.<br>이 기기에서 지금까지 잡은 수: <b>${n(mine.kills)}마리</b>`;
      list.innerHTML = '';
      return;
    }
    try {
      const rows = await A.ranking(100);
      const me = A.profile();
      if (!rows.length) { note.className = 'acct-note'; note.textContent = '아직 기록이 없어요. 첫 번째로 이름을 올려 보세요.'; list.innerHTML = ''; return; }
      note.className = 'acct-note';
      note.innerHTML = A.user() ? (me ? `<b>${me.nickname}</b>님으로 로그인 중. 랭킹은 5분마다 갱신돼요.` : '로그인 중') : '로그인하면 내 순위가 표시돼요. 랭킹은 5분마다 갱신돼요. <a href="me.html">로그인</a>';
      list.innerHTML = rows.map((r) => `<li${me && r.nickname === me.nickname ? ' class="me"' : ''}><span class="n">${r.rank}</span><span><span class="who">${esc(r.nickname)}</span><br><span class="rk-sub">최고 ${r.best_stage || 0}단계 · 배지 ${r.badge_count || 0}개</span></span><span class="sc">${n(r.total_kills)}<small>마리</small></span></li>`).join('');
    } catch (e) {
      note.className = 'acct-note warn'; note.textContent = '랭킹을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.';
    }
  }
  function esc(s) { return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  document.addEventListener('DOMContentLoaded', () => {
    renderRewards(); render();
    document.addEventListener('auth:changed', render);
    if (window.MZAuth) window.MZAuth.ready.then(render);
  });
}());
