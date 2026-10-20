/* =============================================================
   직원용 '기증 사진 확인' (photo-review.js, expert.html)
   -------------------------------------------------------------
   · 직원 계정일 때만 보인다. 실제 권한은 서버(review_photo 함수, 저장소 권한)가 확인한다.
   · 확인을 기다리는 사진을 30장씩 보여 주고, 종을 고르면 '확인됨'(학습에 씀), '모기 아님·판별 불가'는 '제외'.
   · 이상한 사진(사람·불쾌한 사진 등)은 '지우기'로 파일까지 지운다.
   · 사진 주소는 10분짜리 비밀 주소라 밖으로 새도 곧 열리지 않는다.
   ============================================================= */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const LABELS = ['흰줄숲모기', '얼룩날개모기', '빨간집모기', '작은빨간집모기', '집모기류', '모기아님', '판별불가'];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  async function load() {
    const A = window.MZAuth, box = $('photoReview');
    if (!box) return;
    box.hidden = !(A && A.isStaff && A.isStaff());
    if (box.hidden) return;
    const msg = $('photoReviewMsg'), list = $('photoReviewList');
    msg.textContent = '불러오는 중이에요…';
    try {
      const [rows, cnt] = await Promise.all([A.pendingPhotos(30), A.photoCounts()]);
      msg.textContent = cnt ? `확인 기다림 ${cnt.pending}장 · 학습에 쓸 사진 ${cnt.confirmed}장 · 제외 ${cnt.rejected}장` : '';
      if (!rows.length) { list.innerHTML = '<li class="pv-empty">확인할 사진이 없어요.</li>'; return; }
      list.innerHTML = rows.map((r) => `<li data-id="${r.id}">
        <img src="${esc(r.url)}" alt="기증된 모기 사진 (AI 판별: ${esc(r.ai_label)})" loading="lazy">
        <div class="pv-body">
          <p class="pv-ai">AI 판별 <b>${esc(r.ai_label === '집모기류' ? '빨간집모기 무리' : r.ai_label)}</b> ${Math.round(r.ai_conf * 100)}% · ${new Date(r.created_at).toLocaleDateString('ko-KR')}${r.district ? ` · ${esc(r.district)}` : ''}</p>
          <div class="pv-btns">${LABELS.map((l) => `<button type="button" class="${l === '모기아님' || l === '판별불가' ? 'btn-sub' : 'btn-main'}" data-label="${l}">${l === '집모기류' ? '집모기류(종 모름)' : l}</button>`).join('')}<button type="button" class="btn-sub pv-del" data-del="1">지우기</button></div>
          <p class="pv-msg" role="status"></p>
        </div></li>`).join('');
      list.querySelectorAll('li[data-id]').forEach((li) => {
        const id = Number(li.dataset.id), m = li.querySelector('.pv-msg');
        li.querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
          li.querySelectorAll('button').forEach((x) => { x.disabled = true; });
          try {
            if (b.dataset.del) { await A.deletePhoto(id); m.textContent = '지웠어요.'; }
            else { await A.reviewPhoto(id, b.dataset.label); m.textContent = `‘${b.dataset.label}’로 확인했어요.`; }
            li.classList.add('done');
          } catch (e) { m.textContent = e.message || '저장하지 못했어요.'; li.querySelectorAll('button').forEach((x) => { x.disabled = false; }); }
        }));
      });
    } catch (e) { msg.textContent = '사진을 불러오지 못했어요.'; }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const more = $('photoReviewMore');
    if (more) more.addEventListener('click', load);
    document.addEventListener('auth:changed', load);
    if (window.MZAuth) window.MZAuth.ready.then(load);
  });
}());
