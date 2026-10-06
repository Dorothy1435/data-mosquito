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
    setupMosquito();
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

  /* ---------- 유리 렌즈 ----------
     큰 숫자 위를 유리 렌즈가 천천히 떠다니며 숫자를 확대한다. 마우스를 올리면 렌즈가 따라온다.
     (토스 채용 페이지의 유리 폴더가 글자를 비추는 장면에서 가져온 기법. 영상 대신 CSS 로 만든다.) */
  /* ---------- 날아다니는 모기 + 모기약 ----------
     첫 화면 위를 모기가 날아다닌다. 마릿수는 오늘 모기지수 단계를 따른다:
       매우 양호 1 · 양호 2 · 보통 3 · 위험 5 · 매우 위험 8 (휴대폰은 조금 적게)
       · 마리마다 2~3초마다 새 목적지를 골라 스프링처럼 끌려가고, 지그재그로 윙윙거린다
       · 마우스(모기약)가 가까이 오면 조금 도망간다
       · 화면을 누르면 그 자리에 약이 퍼지고(.puff), 가까이 있던 모기는 잡힌다 — 빙글 돌며 떨어진 뒤 새 모기가 들어온다
     '움직임 줄이기'면 모기를 숨기고 게임도 끈다. */
  function setupMosquito() {
    const proto = $('flyer');
    const card = proto && proto.closest('.hero-card');
    if (!proto || !card || reduceMotion) { if (proto) proto.hidden = true; return; }
    const hint = $('sprayHint');
    const small = window.matchMedia('(max-width: 620px)').matches;
    const HIT = small ? 70 : 56;          // 이 거리 안이면 잡힌 것 (손가락은 정확하지 않아 휴대폰은 조금 넓게)
    const FLEE = 230;                     // 모기약이 이 거리 안에 오면 도망간다
    const COUNT_BY_LEVEL = small ? [1, 1, 2, 3, 5] : [1, 2, 3, 5, 8];
    let cx = null, cy = null;             // 모기약(마우스) 위치
    // 잡은 수는 이 브라우저에 저장해 다음에 와도 이어진다 (없거나 막혀 있으면 0부터)
    const KILL_KEY = 'mz-kills';
    let kills = 0;
    try { kills = Math.max(0, parseInt(localStorage.getItem(KILL_KEY) || '0', 10) || 0); } catch (e) { kills = 0; }
    // 이스터 에그: 잡은 수가 여기에 닿으면 임명장이 뜬다
    const MILESTONES = { 100: ['모기 박멸 요원', '100마리를 잡았어요. 김해 모기 박멸 요원으로 임명합니다.'], 500: ['모기 박멸 반장', '500마리! 반장으로 승진했어요. 동네 모기가 당신을 피해 다닙니다.'], 1000: ['모기 박멸 전설', '1,000마리. 전설입니다. 김해 모기들 사이에 소문이 났어요.'] };
    const flies = [];                     // 모기 하나하나의 상태
    card.classList.add('spray');

    function pick(f, now) {
      const W = card.clientWidth, H = card.clientHeight;
      f.gx = W * (0.12 + Math.random() * 0.76); f.gy = H * (0.1 + Math.random() * 0.55);
      f.nextPick = now + 1800 + Math.random() * 1400;
    }
    // 새 모기: 가장자리 밖에서 날아 들어온다
    function spawn(f, now, fromEdge) {
      const W = card.clientWidth, H = card.clientHeight;
      if (fromEdge) { f.x = Math.random() < 0.5 ? -40 : W + 40; f.y = H * (0.15 + Math.random() * 0.4); f.entering = true; }
      else { f.x = W * (0.3 + Math.random() * 0.5); f.y = H * (0.15 + Math.random() * 0.4); f.entering = false; }
      f.vx = 0; f.vy = 0; f.alpha = 1; f.spin = 0; f.dead = 0; f.face = 1;
      f.el.style.opacity = '1';
      pick(f, now);
    }
    function addFly(fromEdge) {
      const el = flies.length ? proto.cloneNode(true) : proto;
      if (el !== proto) { el.removeAttribute('id'); card.appendChild(el); }
      const f = { el, phase: Math.random() * 10, x: 0, y: 0, vx: 0, vy: 0, gx: 0, gy: 0, nextPick: 0, dead: 0, spin: 0, alpha: 1, face: 1, entering: false };
      spawn(f, performance.now(), fromEdge);
      flies.push(f);
    }
    // 오늘 단계에 맞춰 마릿수를 맞춘다 (늘면 가장자리에서 들어오고, 줄면 뒤에서부터 사라진다)
    function setCount(n) {
      while (flies.length < n) addFly(true);
      while (flies.length > n) { const f = flies.pop(); if (f.el !== proto) f.el.remove(); else f.el.hidden = true; }
      if (hint) hint.textContent = (n > 1 ? `모기 ${n}마리 · 눌러서 잡아 보세요` : '모기를 눌러서 잡아 보세요') + (kills ? ` · 지금까지 ${kills}마리` : '');
    }
    document.addEventListener('mosquito:updated', (e) => {
      const idx = e.detail && e.detail.index;
      if (idx == null) return;
      const n = Math.round(idx);
      const level = n <= 20 ? 0 : n <= 40 ? 1 : n <= 60 ? 2 : n <= 80 ? 3 : 4;
      setCount(COUNT_BY_LEVEL[level]);
    });

    card.addEventListener('pointermove', (e) => { const r = card.getBoundingClientRect(); cx = e.clientX - r.left; cy = e.clientY - r.top; });
    // 한 번 뿌리기: 약이 퍼지고, 가까운 모기는 잡히고, 근처 모기는 흩어진다
    function spray(px, py) {
      puff(px, py);
      flies.forEach((f) => {
        if (f.dead) return;
        const d = Math.hypot(px - f.x, py - f.y);
        if (d <= HIT) { kill(f); return; }
        // 빗나간 약: 근처 모기는 놀라서 반대쪽으로 확 튄다
        if (d < 200) { const k = (1 - d / 200) * 14; f.vx += ((f.x - px) / d) * k; f.vy += ((f.y - py) / d) * k; f.jink = now0() + 500; }
      });
    }
    // 누르면 한 번, 꾹 누르고 있으면 0.12초마다 연사. 손가락·마우스를 움직이면 그 자리를 따라간다
    let sprayTimer = null;
    const stopSpray = () => { if (sprayTimer) { clearInterval(sprayTimer); sprayTimer = null; } };
    let downAt = 0;
    card.addEventListener('pointerdown', (e) => {
      const r = card.getBoundingClientRect();
      cx = e.clientX - r.left; cy = e.clientY - r.top;
      downAt = performance.now();
      // 누른 채 끌 때 포인터가 다른 요소 위로 가도 계속 받는다 (요약 카드 위를 지나도 연사가 안 끊긴다)
      try { card.setPointerCapture(e.pointerId); } catch (err) { /* 지원 안 하는 브라우저 */ }
      spray(cx, cy);
      stopSpray();
      sprayTimer = setInterval(() => { if (cx != null) spray(cx, cy); }, 120);
    });
    ['pointerup', 'pointercancel'].forEach((ev) => card.addEventListener(ev, stopSpray));
    card.addEventListener('pointerleave', () => { if (!sprayTimer) { cx = null; cy = null; } });
    // 휴대폰: 바로 쓸면 평소처럼 스크롤, 0.18초 이상 꾹 누른 뒤 끌면 스크롤 대신 연사
    card.addEventListener('touchmove', (e) => {
      if (!sprayTimer) return;
      if (performance.now() - downAt > 180) e.preventDefault();
      else stopSpray();
    }, { passive: false });
    window.addEventListener('blur', stopSpray);
    card.addEventListener('contextmenu', (e) => e.preventDefault());   // 꾹 누를 때 메뉴가 뜨지 않게

    // 약이 퍼지는 모양: 작은 방울 7개가 사방으로 번진다
    function puff(px, py) {
      const p = document.createElement('div');
      p.className = 'puff';
      p.style.left = px + 'px'; p.style.top = py + 'px';
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + Math.random() * 0.6, d = 26 + Math.random() * 30;
        const b = document.createElement('i');
        b.style.setProperty('--dx', (Math.cos(a) * d).toFixed(0) + 'px');
        b.style.setProperty('--dy', (Math.sin(a) * d).toFixed(0) + 'px');
        p.appendChild(b);
      }
      card.appendChild(p);
      setTimeout(() => p.remove(), 800);
    }
    const now0 = () => performance.now();
    // 임명장: 화면을 덮는 카드 + 모기 떼가 떨어진다. 누르면 닫힌다
    function easterEgg(n) {
      const [title, text] = MILESTONES[n];
      const egg = document.createElement('div');
      egg.className = 'egg';
      egg.setAttribute('role', 'dialog');
      egg.innerHTML = `<div class="egg-rain" aria-hidden="true"></div><div class="egg-card"><p class="egg-k">모기제로 임명장</p><p class="egg-n">${n.toLocaleString('ko-KR')}<small>마리</small></p><p class="egg-t">${title}</p><p class="egg-p">${text}</p><p class="egg-d">${new Date().toLocaleDateString('ko-KR')} · 모기제로</p><button type="button" class="btn-main">계속 잡기</button></div>`;
      const rain = egg.querySelector('.egg-rain');
      if (!reduceMotion) for (let i = 0; i < 24; i++) { const m = proto.cloneNode(true); m.removeAttribute('id'); m.className = 'flyer egg-fly'; m.style.left = (Math.random() * 100) + '%'; m.style.setProperty('--d', (Math.random() * 1.8).toFixed(2) + 's'); m.style.setProperty('--r', (Math.random() * 720 - 360).toFixed(0) + 'deg'); rain.appendChild(m); }
      egg.addEventListener('click', () => egg.remove());
      card.appendChild(egg);
      egg.querySelector('button').focus();
    }
    function kill(f) {
      f.dead = performance.now(); kills += 1;
      try { localStorage.setItem(KILL_KEY, String(kills)); } catch (e) { /* 저장 못 해도 게임은 된다 */ }
      if (MILESTONES[kills]) setTimeout(() => easterEgg(kills), 700);
      const pop = document.createElement('span');
      pop.className = 'kill-pop';
      pop.textContent = kills === 1 ? '잡았다!' : `잡았다! ${kills}마리째`;
      pop.style.left = f.x + 'px'; pop.style.top = (f.y - 30) + 'px';
      card.appendChild(pop);
      setTimeout(() => pop.remove(), 1200);
      if (hint) hint.hidden = true;
    }

    const t0 = performance.now();
    addFly(false);   // 지수를 알기 전엔 한 마리
    // 시연용: 주소에 ?egg=1 (또는 egg=500, egg=1000) 을 붙이면 임명장을 바로 보여 준다. 잡은 수는 바꾸지 않는다
    try {
      const want = Number(new URLSearchParams(location.search).get('egg'));
      const n = want === 1 ? 100 : want;
      if (MILESTONES[n]) setTimeout(() => easterEgg(n), 1500);
    } catch (err) { /* 무시 */ }
    function tick(now) {
      const t = (now - t0) / 1000, W = card.clientWidth, H = card.clientHeight;
      flies.forEach((f) => {
        const el = f.el;
        if (f.dead) {
          // 잡힌 모기: 빙글 돌며 떨어지고 흐려진다. 1초 뒤 가장자리에서 새 모기.
          const k = (now - f.dead) / 1000;
          f.vy += 0.9; f.x += f.vx * 0.3; f.y += f.vy; f.spin += 28; f.alpha = Math.max(0, 1 - k * 1.1);
          el.style.opacity = f.alpha.toFixed(2);
          el.style.transform = `translate(${f.x.toFixed(1)}px, ${f.y.toFixed(1)}px) translate(-50%, -50%) rotate(${f.spin}deg)`;
          if (k > 1.1) spawn(f, now, true);
          return;
        }
        if (now > f.nextPick) pick(f, now);
        // 모기약이 가까우면 반대쪽으로 도망간다 — 가까울수록 세게, 그리고 옆으로 꺾어 예측하기 어렵게
        let fleeing = false;
        if (cx != null) {
          const dx = f.x - cx, dy = f.y - cy, d = Math.hypot(dx, dy);
          if (d < FLEE && d > 1) {
            fleeing = true;
            const k = (1 - d / FLEE) * 3.2;
            f.vx += (dx / d) * k; f.vy += (dy / d) * k;
            // 0.4초마다 꺾는 방향을 바꾼다 (왼쪽/오른쪽으로 비껴 날기)
            if (!f.jinkAt || now > f.jinkAt) { f.jinkAt = now + 400; f.jinkDir = Math.random() < 0.5 ? -1 : 1; }
            f.vx += (-dy / d) * k * 0.9 * f.jinkDir; f.vy += (dx / d) * k * 0.9 * f.jinkDir;
            // 구석에 몰리면 벽을 따라 빠져나간다
            if (f.x < 60) f.vx += 1.2; if (f.x > W - 60) f.vx -= 1.2; if (f.y < 60) f.vy += 1.2; if (f.y > H - 60) f.vy -= 1.2;
          }
        }
        f.vx += (f.gx - f.x) * 0.01; f.vy += (f.gy - f.y) * 0.01;
        // 도망갈 땐 덜 미끄러져 더 빠르다. 너무 빨라지지는 않게 속도를 자른다
        const damp = fleeing ? 0.94 : 0.9, vmax = fleeing ? 11 : 6;
        f.vx *= damp; f.vy *= damp;
        const sp = Math.hypot(f.vx, f.vy);
        if (sp > vmax) { f.vx *= vmax / sp; f.vy *= vmax / sp; }
        const tp = t + f.phase;   // 마리마다 윙윙거리는 박자가 다르다
        f.x += f.vx + Math.sin(tp * 23) * 1.4 + Math.sin(tp * 7.3) * 0.9;
        f.y += f.vy + Math.cos(tp * 19) * 1.3 + Math.sin(tp * 5.1) * 1.1;
        if (f.entering && f.x > 20 && f.x < W - 20) f.entering = false;
        if (!f.entering) { f.x = Math.max(20, Math.min(W - 20, f.x)); f.y = Math.max(20, Math.min(H - 20, f.y)); }
        if (Math.abs(f.vx) > 0.4) f.face = f.vx > 0 ? -1 : 1;   // 그림이 왼쪽을 보고 있으므로 오른쪽으로 갈 땐 뒤집는다
        const tilt = Math.max(-25, Math.min(25, f.vy * 3));
        el.style.transform = `translate(${f.x.toFixed(1)}px, ${f.y.toFixed(1)}px) translate(-50%, -50%) scaleX(${f.face}) rotate(${(tilt * -f.face).toFixed(1)}deg)`;
      });
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

}());
