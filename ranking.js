/* =============================================================
   랭킹 화면 (ranking.js)
   -------------------------------------------------------------
   세 가지 랭킹을 한 화면에 함께 보여 준다 (PC 3칸, 폰은 위아래). 각각 10등까지.
     · 모기 잡기: 올해 누적 잡은 수 (MZAuth.ranking)
     · 뛰어런: 이번 주 · 이번 달 · 올해 거리 합 (MZAuth.runRanking) — 기간 버튼으로 바꾼다
     · 희귀 모기 사진: 보건소가 확인한 희귀 모기 기증 사진 수 (MZAuth.photoRanking)
   모두 서버가 10초마다 만들어 둔 공개 표(닉네임·숫자)만 읽는다. 회원가입한 사람만 올라간다.
   1~3등은 금·은·동 왕관, 기록이 모자란 칸은 '비어 있음'.
   ============================================================= */
(function () {
  'use strict';
  const CFG = window.MZ_GAME_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const n = (v) => Number(v || 0).toLocaleString('ko-KR');
  const SHOW = CFG.RANK_SHOW || 10;
  let period = 'week';   // 뛰어런 기간: week · month · season

  // 왕관 (1 금 · 2 은 · 3 동)
  const CROWN = ['#E8B000', '#9AA4AF', '#C07A3A'];
  const crown = (i) => `<svg class="rk-crown" width="30" height="30" viewBox="0 0 24 24" aria-hidden="true"><path fill="${CROWN[i]}" d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5 19.2 18H4.8Z"/><rect x="4.8" y="19" width="14.4" height="2" rx="1" fill="${CROWN[i]}"/></svg>`;
  function rankCell(rank) {
    return rank <= 3 ? `<span class="n top" aria-label="${rank}등">${crown(rank - 1)}<b>${rank}</b></span>` : `<span class="n" aria-label="${rank}등">${rank}</span>`;
  }
  function emptyRows(from) {
    let h = '';
    for (let r = from; r <= SHOW; r++) h += `<li class="empty">${rankCell(r)}<span class="who">비어 있음</span><span class="sc">-</span></li>`;
    return h;
  }
  function esc(s) { return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  // 한 줄: 순위 · 닉네임(+작은 설명) · 숫자
  function row(r, me, sub, score, unit) {
    const mine = me && r.nickname === me.nickname ? ' class="me"' : '';
    return `<li${mine}>${rankCell(r.rank)}<span><span class="who">${esc(r.nickname)}</span>${sub ? `<br><span class="rk-sub">${esc(sub)}</span>` : ''}</span><span class="sc">${score}<small>${unit}</small></span></li>`;
  }
  function fill(id, rows, make) {
    $(id).innerHTML = rows.slice(0, SHOW).map(make).join('') + emptyRows(Math.min(rows.length, SHOW) + 1);
  }

  function renderRewards() {
    const body = $('rewardBody'); if (!body) return;
    body.innerHTML = (CFG.REWARD_TIERS || []).map((t) => `<tr><td>${t.from === t.to ? `${t.from}위` : `${t.from}~${t.to}위`}</td><td>${t.prize}</td></tr>`).join('');
  }

  async function renderRun(A, me) {
    try {
      const rows = await A.runRanking(period, SHOW);
      fill('rkRun', rows, (r) => row(r, me, `${r.runs}회 · 땀 걸음 ${n(r.sweat_steps)}`, Number(r.distance_km || 0).toFixed(1), 'km'));
    } catch (e) { $('rkRun').innerHTML = emptyRows(1); }
  }

  async function render() {
    const A = window.MZAuth, note = $('rkNote');
    $('rkSeason').textContent = `${CFG.SEASON || new Date().getFullYear()} 시즌`;
    if (!A || A.status === 'loading') return;
    if (A.status !== 'ready') {
      note.className = 'acct-note warn';
      note.textContent = '랭킹은 준비 중이에요. 서버가 연결되면 열려요.';
      ['rkGame', 'rkRun', 'rkPhoto'].forEach((id) => { $(id).innerHTML = emptyRows(1); });
      return;
    }
    const me = A.profile();
    note.className = 'acct-note';
    note.innerHTML = A.user()
      ? `${me ? `<b>${esc(me.nickname)}</b>님으로 로그인 중이에요. ` : ''}랭킹마다 10등까지 상품을 드려요.`
      : '회원가입한 사람만 랭킹에 올라가요. 랭킹마다 10등까지 상품을 드려요. <a href="account.html?next=ranking.html">로그인</a>';
    try {
      const [game, photo] = await Promise.all([A.ranking(SHOW), A.photoRanking(SHOW)]);
      fill('rkGame', game, (r) => row(r, me, `최고 ${r.best_stage || 0}단계 · 배지 ${r.badge_count || 0}개`, n(r.total_kills), '마리'));
      fill('rkPhoto', photo, (r) => row(r, me, r.kinds || '', n(r.photos), '장'));
    } catch (e) {
      note.className = 'acct-note warn'; note.textContent = '랭킹을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.';
    }
    await renderRun(A, me);
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderRewards();
    ['rkGame', 'rkRun', 'rkPhoto'].forEach((id) => { $(id).innerHTML = emptyRows(1); });
    document.querySelectorAll('#rkPeriod [data-period]').forEach((b) => b.addEventListener('click', () => {
      period = b.dataset.period;
      document.querySelectorAll('#rkPeriod [data-period]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      if (window.MZAuth && window.MZAuth.status === 'ready') renderRun(window.MZAuth, window.MZAuth.profile());
    }));
    const h = location.hash.replace('#', '');
    if (h === 'week' || h === 'month' || h === 'season') {
      period = h;
      document.querySelectorAll('#rkPeriod [data-period]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.period === h)));
    }
    document.addEventListener('auth:changed', render);
    if (window.MZAuth) window.MZAuth.ready.then(render);
    // 화면을 보고 있는 동안 10초마다 다시 읽는다
    setInterval(() => { if (document.visibilityState === 'visible') render(); }, 10000);
  });
}());
