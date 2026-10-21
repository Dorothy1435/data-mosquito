/* =============================================================
   내 기록 화면 (me.js)
   -------------------------------------------------------------
   · 기록·배지: 이 브라우저의 게임 기록(MZGame.state)을 보여 주고, 로그인했으면 서버 기록과 합친다.
     로그인하지 않아도 모든 기능을 쓸 수 있고, 기록은 이 기기에 쌓인다. 로그인은 랭킹(기록 경쟁)용이다.
   · 로그인·회원가입·계정 관리는 따로 account.html (account.js) 에서 한다.
     로그인하지 않았으면 '로그인하지 않으면 랭킹 기록에 남지 않아요' 안내가 뜬다(mobile-tabs.js, data-login-note).
   · 보상 표: game-config.js 의 REWARD_TIERS (운영 기관이 확정하면 그 파일만 고친다).
   ============================================================= */
(function () {
  'use strict';
  const CFG = window.MZ_GAME_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const n = (v) => Number(v || 0).toLocaleString('ko-KR');

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

  // 한눈에: 뛰어런 거리와 사진 횟수는 그 화면(runner.js · citizen.js)이 이 기기에 남긴 값 + 계정에 보관된 값
  const readLocal = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };
  let srvRuns = null, srvPhoto = null;
  function renderSummary() {
    const g = window.MZGame ? window.MZGame.state() : { kills: 0 };
    const byId = new Map();
    (srvRuns && Array.isArray(srvRuns.runs) ? srvRuns.runs : []).forEach((r) => { if (r && r.id != null) byId.set(String(r.id), r); });
    (readLocal('mz-runs', []) || []).forEach((r) => { if (r && r.id != null) byId.set(String(r.id), r); });
    const del = new Set(readLocal('mz-runs-deleted', []).concat(srvRuns && srvRuns.deleted ? srvRuns.deleted : []).map(String));
    const m = Array.from(byId.values()).filter((r) => !del.has(String(r.id))).reduce((a, r) => a + (Number(r.m) || 0), 0);
    const p = readLocal('mz-photo-stats', {}) || {};
    const judged = Math.max(Number(p.judged) || 0, srvPhoto ? Number(srvPhoto.judged) || 0 : 0);
    const donated = Math.max(Number(p.donated) || 0, srvPhoto ? Number(srvPhoto.donated) || 0 : 0);
    $('sumKills').innerHTML = `${n(g.kills)}<small>마리</small>`;
    $('sumKm').innerHTML = `${(m / 1000).toFixed(1)}<small>km</small>`;
    $('sumPhoto').innerHTML = `${n(judged)}<small>장</small>`;
    $('sumDonate').innerHTML = `${n(donated)}<small>장</small>`;
  }
  async function loadSummary() {
    const A = window.MZAuth;
    if (A && A.loadUserData && A.user && A.user()) {
      try { [srvRuns, srvPhoto] = await Promise.all([A.loadUserData('runs'), A.loadUserData('photo')]); } catch (e) { /* 이 기기 값만 */ }
    } else { srvRuns = null; srvPhoto = null; }
    renderSummary();
  }

  function renderRewards() {
    $('rewardNote').textContent = CFG.REWARD_NOTE || '';
    $('rewardBody').innerHTML = (CFG.REWARD_TIERS || []).map((t) => `<tr><td>${t.from === t.to ? `${t.from}위` : `${t.from}~${t.to}위`}</td><td>${t.prize}</td></tr>`).join('') || '<tr><td colspan="2">보상은 아직 정해지지 않았어요.</td></tr>';
  }

  // 로그인해 있으면 서버의 누적·배지와 합친다 (다른 기기에서 쌓은 기록도 보이게)
  async function mergeServer() {
    const A = window.MZAuth;
    if (!A || !A.enabled || !A.user() || !window.MZGame) return;
    try {
      const [score, badges] = await Promise.all([A.myScore(), A.myBadges()]);
      if (score || badges.length) { window.MZGame.mergeServer({ total_kills: score ? score.total_kills : 0, best_stage: score ? score.best_stage : 0, badges: badges.map((b) => b.badge_id) }); renderStats(); }
    } catch (e) { /* 서버 기록이 없으면 이 기기 기록만 */ }
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderStats(); renderRewards(); renderSummary();
    document.addEventListener('game:changed', () => { renderStats(); renderSummary(); });
    document.addEventListener('auth:changed', () => { mergeServer(); loadSummary(); });
    if (window.MZAuth) window.MZAuth.ready.then(() => { mergeServer(); loadSummary(); });
  });
}());
