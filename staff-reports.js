/* =============================================================
   직원용 화면의 '시민 제보' 칸 (expert.html)
   -------------------------------------------------------------
   · 직원 계정으로 로그인했을 때만 보인다. 실제 권한 확인은 서버(api/reports-admin.js)가 한다.
   · 최근 기간을 고르면 동별 물렸어요 · 모기 봤어요 · 고인 물 개수 표를 보여 주고, CSV 로 내려받을 수 있다.
   ============================================================= */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const KIND_KO = { bite: '물렸어요', mosquito: '모기 봤어요', breeding: '고인 물' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  async function load() {
    const A = window.MZAuth;
    const msg = $('staffReportsMsg'), table = $('staffReportsTable');
    const token = A && A.accessToken ? A.accessToken() : '';
    if (!token) { msg.textContent = '직원 계정으로 로그인해 주세요.'; return; }
    const days = $('staffReportsDays').value;
    msg.textContent = '불러오는 중이에요…';
    try {
      const r = await fetch(`/api/reports-admin?days=${days}`, { headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json();
      if (!j.ok) { msg.textContent = j.message || '불러오지 못했어요.'; table.innerHTML = ''; return; }
      msg.textContent = `최근 ${j.days}일 제보 ${j.total.toLocaleString('ko-KR')}건${j.truncated ? ' (너무 많아 최근 것만 보여요. 기간을 줄여 주세요)' : ''} (동 단위, 보낸 사람 정보 없음)`;
      const rows = Object.entries(j.byDistrict).sort((a, b) => (b[1].bite || 0) - (a[1].bite || 0));
      table.innerHTML = rows.length
        ? `<thead><tr><th>동</th><th>${KIND_KO.bite}</th><th>${KIND_KO.mosquito}</th><th>${KIND_KO.breeding}</th></tr></thead><tbody>${
          rows.map(([d, c]) => `<tr><td>${esc(d)}</td><td>${c.bite || 0}</td><td>${c.mosquito || 0}</td><td>${c.breeding || 0}</td></tr>`).join('')}</tbody>`
        : '<tbody><tr><td>아직 제보가 없어요.</td></tr></tbody>';
    } catch (_) { msg.textContent = '불러오지 못했어요. 잠시 후 다시 시도해 주세요.'; }
  }

  // CSV 는 토큰이 필요해서 링크 대신 받아서 저장한다
  async function downloadCsv() {
    const A = window.MZAuth;
    const token = A && A.accessToken ? A.accessToken() : '';
    if (!token) return;
    const days = $('staffReportsDays').value;
    const r = await fetch(`/api/reports-admin?days=${days}&format=csv`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) { $('staffReportsMsg').textContent = '내려받지 못했어요.'; return; }
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a');
    a.href = url; a.download = `모기제로-시민제보-${days}일.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function refresh() {
    const box = $('staffReports');
    if (!box) return;
    const A = window.MZAuth;
    box.hidden = !(A && A.isStaff && A.isStaff());
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!$('staffReports')) return;
    $('staffReportsLoad').addEventListener('click', load);
    $('staffReportsCsv').addEventListener('click', downloadCsv);
    refresh();
  });
  document.addEventListener('auth:changed', refresh);
}());
