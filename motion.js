/* =============================================================
   움직임 (v19)
   -------------------------------------------------------------
   계산이나 데이터는 건드리지 않는다. 화면이 '어떻게 나타나고 움직이는지'만 맡는다.

     1) 스크롤 등장     .rv · .kit · .panel.grow 가 화면에 들어오면 .is-in
     2) 숫자 카운트업   모기지수·나들이 지수가 0에서 굴러 올라간다
     3) 첫 화면 빠지기  스크롤하면 첫 화면 글이 위로 밀리며 흐려진다 (--hp)
     4) 스크롤 이야기   토스처럼 화면이 고정된 채 문장이 한 줄씩 바뀐다 (data-step)
     5) 확대되며 등장   지도·사진이 화면에 들어오며 커진다 (애플) (--z)
     6) 상단 바         첫 화면을 지나면 흰 바탕으로 바뀐다 (.solid)
   (모기 잡기 게임은 game.js 에 따로 있다)

   '움직임 줄이기' 설정이면 1·2만 즉시 적용하고 나머지는 멈춘 상태로 둔다.
   스크롤 계산은 requestAnimationFrame 한 번에 모아서 한다.
   ============================================================= */

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  document.addEventListener('DOMContentLoaded', () => {
    splitHeadingLines();
    setupReveal();
    setupScrollEffects();
  });

  /* ---------- 1) 스크롤 등장 ---------- */
  function setupReveal() {
    const items = Array.from(document.querySelectorAll('.rv, .kit, .panel.grow'));
    // 형제끼리는 순서대로 조금씩 늦게 나타나게 --i 를 매긴다 (준비물 칸 포함)
    items.forEach((el) => {
      const sibs = Array.from(el.parentElement.children).filter((c) => c.classList.contains('rv'));
      if (sibs.length > 1) el.style.setProperty('--i', String(Math.min(sibs.indexOf(el), 6)));
    });
    document.querySelectorAll('.kit li').forEach((li, i) => li.style.setProperty('--i', String(i)));

    const show = (el) => el.classList.add('is-in');
    if (reduceMotion || !('IntersectionObserver' in window)) { items.forEach(show); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { show(e.target); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.08 });
    items.forEach((el) => io.observe(el));
    // 안전장치: 어떤 이유로 관찰이 안 되더라도 3초 뒤엔 글이 반드시 보이게 한다 (가독성 우선)
    setTimeout(() => items.forEach(show), 3000);
  }

  /* ---------- 3)~6) 스크롤에 묶인 움직임 ---------- */
  function setupScrollEffects() {
    const hero = document.querySelector('.hero');
    const heroIn = $('heroIn');
    const story = $('story');
    const nav = $('siteNav');
    const zooms = Array.from(document.querySelectorAll('.zoom-in, .sp-img, .report-art'));

    function update() {
      const vh = window.innerHeight;

      // 6) 상단 바: 첫 화면(보라)을 지나면 흰 바탕
      if (nav) nav.classList.toggle('solid', !hero || window.scrollY > hero.offsetHeight - 80);
      // 떠 있는 카메라 버튼: 첫 화면을 지나면 보인다
      const fab = document.querySelector('.fab-cam');
      if (fab) fab.classList.toggle('show', !hero || window.scrollY > hero.offsetHeight * 0.6);

      if (reduceMotion) return;

      // 3) 첫 화면이 위로 빠지는 정도 0~1
      if (hero && heroIn) {
        const hp = clamp(window.scrollY / (hero.offsetHeight * 0.8), 0, 1);
        heroIn.style.setProperty('--hp', hp.toFixed(3));
      }

      // 4) 스크롤 이야기: 구간 안에서 얼마나 내려왔는지로 0·1·2 단계를 정한다
      if (story) {
        const r = story.getBoundingClientRect();
        const travel = r.height - vh;
        const p = clamp(-r.top / (travel || 1), 0, 0.999);
        const step = String(Math.floor(p * 3));
        if (story.dataset.step !== step) story.dataset.step = step;
      }

      // 5) 화면에 들어오며 커지기: 요소 윗부분이 화면 아래에서 가운데로 올라오는 동안 0→1
      zooms.forEach((el) => {
        const r = el.getBoundingClientRect();
        const z = clamp((vh - r.top) / (vh * 0.7), 0, 1);
        el.style.setProperty('--z', z.toFixed(3));
      });
    }

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { update(); ticking = false; });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
  }

  /* ---------- 2) 숫자 카운트업 ----------
     script.js / app-ui.js 가 값을 다 써 넣은 뒤(같은 이벤트의 나중 순서)에 실행된다. */
  document.addEventListener('mosquito:updated', (event) => {
    const d = event.detail || {};
    if (d.index != null) countUp($('indexValue'), d.index);
    const outing = $('outingScore');
    if (outing) {
      const target = Number(outing.textContent);
      if (!Number.isNaN(target)) countUp(outing, target);
    }
  });

  function countUp(el, target) {
    if (!el) return;
    const from = Number(el.dataset.shown || 0);
    el.dataset.shown = String(target);
    if (reduceMotion || from === target) { el.textContent = String(target); return; }
    const duration = 1200;
    const start = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 4);   // 빠르게 시작해서 부드럽게 멈춘다
    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      el.textContent = String(Math.round(from + (target - from) * ease(t)));
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ---------- 제목 줄 나누기 ----------
     <br> 로 나뉜 제목을 줄마다 감싸, 줄이 차례로 아래에서 밀려 올라오게 한다 (토스 채용 페이지 기법). */
  function splitHeadingLines() {
    if (reduceMotion) return;
    document.querySelectorAll('.head h2, .copy > h2, .copy > h1').forEach((h) => {
      const lines = h.innerHTML.split(/<br\s*\/?>/i);
      h.innerHTML = lines.map((l, i) => `<span class="ln" style="--li:${i}"><span>${l.trim()}</span></span>`).join('');
      // 스크롤 등장(.rv) 안에 없는 제목은 바로 보여 준다 (안 그러면 줄이 숨은 채로 남는다)
      if (!h.closest('.rv')) requestAnimationFrame(() => requestAnimationFrame(() => h.classList.add('is-in')));
    });
  }

  /* 날아다니는 모기 + 모기약 게임은 game.js 로 옮겼다 (2026-10-07, 스테이지·배지 추가) */

}());
