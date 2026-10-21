/* =============================================================
   랭킹 화면 (ranking.js)
   -------------------------------------------------------------
   세 가지 랭킹을 탭으로 바꿔 본다. 모두 서버가 10초마다 만들어 둔 공개 표(닉네임·숫자)만 읽는다.
     · 모기 잡기: 시즌 누적 잡은 수 (MZAuth.ranking)
     · 뛰어런 이번 주 / 시즌: 땀 걸음이 있는 달리기의 거리 합 (MZAuth.runRanking)
   · 회원가입한 사람만 올라가고, 10등까지만 보여 준다(상품도 10등까지). 1~3등은 금·은·동 왕관
   · 기록이 모자라면 남은 칸은 '비어 있음'으로 채워 순위표 모양은 늘 보인다
   서버가 없으면 "준비 중"과 이 기기의 내 기록만 보여 준다.
   ============================================================= */
(function () {
  'use strict';
  const CFG = window.MZ_GAME_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const n = (v) => Number(v || 0).toLocaleString('ko-KR');
  let kind = 'game';   // game · week · season
  const TEXT = {
    game: { title: '모기를 가장 많이 잡은 사람', lead: '닉네임만 보여요. 시즌 누적 잡은 수로 순위를 매겨요.' },
    week: { title: '이번 주 가장 많이 뛴 사람', lead: '월요일부터 지금까지, 땀 걸음이 있는 달리기의 거리 합이에요. GPS 를 켜고 뛴 기록만 올라가요.' },
    season: { title: '올해 가장 많이 뛴 사람', lead: '올해 누적 거리예요. 땀 걸음이 있는 달리기만 세요.' },
  };

  const SHOW = CFG.RANK_SHOW || 10;
  // 왕관 (1 금 · 2 은 · 3 동)
  const CROWN = ['#E8B000', '#9AA4AF', '#C07A3A'];
  const crown = (i) => `<svg class="rk-crown" width="30" height="30" viewBox="0 0 24 24" aria-hidden="true"><path fill="${CROWN[i]}" d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5 19.2 18H4.8Z"/><rect x="4.8" y="19" width="14.4" height="2" rx="1" fill="${CROWN[i]}"/></svg>`;
  function rankCell(rank) {
    return rank <= 3 ? `<span class="n top" aria-label="${rank}등">${crown(rank - 1)}<b>${rank}</b></span>` : `<span class="n" aria-label="${rank}등">${rank}</span>`;
  }
  // 10칸 중 기록이 없는 칸
  function emptyRows(from) {
    let h = '';
    for (let r = from; r <= SHOW; r++) h += `<li class="empty">${rankCell(r)}<span class="who">비어 있음</span><span class="sc">-</span></li>`;
    return h;
  }

  function renderRewards() {
    $('rewardBody').innerHTML = (CFG.REWARD_TIERS || []).map((t) => `<tr><td>${t.from === t.to ? `${t.from}위` : `${t.from}~${t.to}위`}</td><td>${t.prize}</td></tr>`).join('');
  }

  async function render() {
    const A = window.MZAuth, note = $('rkNote'), list = $('rkList');
    $('rkSeason').textContent = `${CFG.SEASON || new Date().getFullYear()} 시즌 랭킹`;
    $('rkTitle').textContent = TEXT[kind].title;
    $('rkLead').textContent = TEXT[kind].lead;
    if (!A || A.status === 'loading') return;
    if (A.status !== 'ready') {
      const mine = window.MZGame ? window.MZGame.state() : { kills: 0 };
      note.className = 'acct-note warn';
      note.innerHTML = `랭킹은 준비 중이에요. 서버가 연결되면 열려요.<br>이 기기에서 지금까지 잡은 수: <b>${n(mine.kills)}마리</b>`;
      list.innerHTML = emptyRows(1);
      return;
    }
    try {
      const me = A.profile();
      const rows = kind === 'game' ? await A.ranking(SHOW) : await A.runRanking(kind, SHOW);
      note.className = 'acct-note';
      const who = A.user() ? (me ? `<b>${esc(me.nickname)}</b>님으로 로그인 중.` : '로그인 중.') : '회원가입한 사람만 랭킹에 올라가요. <a href="account.html?next=ranking.html">로그인</a>';
      note.innerHTML = rows.length ? `${who}<br>10등까지 상품을 드려요. 10초마다 갱신돼요.` : `${who}<br>아직 기록이 없어요. 첫 번째로 이름을 올려 보세요.`;
      list.innerHTML = rows.slice(0, SHOW).map((r) => {
        const mine = me && r.nickname === me.nickname ? ' class="me"' : '';
        if (kind === 'game') return `<li${mine}>${rankCell(r.rank)}<span><span class="who">${esc(r.nickname)}</span><br><span class="rk-sub">최고 ${r.best_stage || 0}단계 · 배지 ${r.badge_count || 0}개</span></span><span class="sc">${n(r.total_kills)}<small>마리</small></span></li>`;
        return `<li${mine}>${rankCell(r.rank)}<span><span class="who">${esc(r.nickname)}</span><br><span class="rk-sub">${r.runs}회 · 땀 걸음 ${n(r.sweat_steps)}</span></span><span class="sc">${Number(r.distance_km || 0).toFixed(1)}<small>km</small></span></li>`;
      }).join('') + emptyRows(rows.length + 1);
    } catch (e) {
      note.className = 'acct-note warn'; note.textContent = '랭킹을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.';
    }
  }
  function esc(s) { return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function select(k) {
    kind = k;
    document.querySelectorAll('.rk-tabs [data-rk]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.rk === k)));
    try { history.replaceState(null, '', k === 'game' ? location.pathname : `#${k}`); } catch (e) { /* 무시 */ }
    render();
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderRewards();
    document.querySelectorAll('.rk-tabs [data-rk]').forEach((b) => b.addEventListener('click', () => select(b.dataset.rk)));
    const h = location.hash.replace('#', '');
    if (h === 'week' || h === 'season') kind = h;
    select(kind);
    document.addEventListener('auth:changed', render);
    if (window.MZAuth) window.MZAuth.ready.then(render);
    // 화면을 보고 있는 동안 10초마다 다시 읽는다 (서버가 만들어 둔 표만 읽어서 사람이 많아도 부담이 늘지 않는다)
    setInterval(() => { if (document.visibilityState === 'visible') render(); }, 10000);
  });
}());
