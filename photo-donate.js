/* =============================================================
   사진 기증 (photo-donate.js) — window.MZDonate
   -------------------------------------------------------------
   사진 판별 결과 아래에 'AI 학습에 기증하기'를 붙인다. 기증한 사진은 보건소 직원이 종을 확인한 뒤
   모기제로 AI 를 다시 학습시키는 데 쓴다(ml/05_fetch_donations.py).

   저장하기 전에 폰에서 먼저 거른다 (이상한 사진이 쌓이지 않게)
     ① 모기 판별: 흰줄숲모기·얼룩날개모기·집모기류이고 확신 60% 이상인 사진만 (모기 아님·알 수 없음은 버튼 자체가 안 나옴)
     ② 품질: 너무 작음(짧은 변 400px 미만), 너무 어둡거나 밝음, 흐림(선명도 값이 낮음)
     ③ 같은 사진: 사진 지문(dHash, 비슷한 사진이면 같은 값)으로 서버가 반복을 막음
   서버(donate_photo)가 다시 검사한다: 로그인·동의·하루 20장·같은 사진·내 폴더.
   올리는 사진은 긴 변 800px JPEG 로 다시 그려서 촬영 위치 같은 사진 속 정보가 남지 않는다.
   ============================================================= */
(function () {
  'use strict';
  const OK_LABELS = ['흰줄숲모기', '얼룩날개모기', '집모기류'];

  function loadImage(src) {
    return new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('사진 읽기 실패')); i.src = src; });
  }
  // 회색조 픽셀 (w×h)
  function gray(img, w, h, sx, sy, sw, sh) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data, out = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) out[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    return out;
  }
  // 품질 검사: 밝기 평균, 선명도(라플라시안 분산 — 흐린 사진은 값이 작다). 가운데 정사각형으로 본다
  function quality(img) {
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2, sy = (img.naturalHeight - side) / 2, N = 256;
    const px = gray(img, N, N, sx, sy, side, side);
    let sum = 0; for (let i = 0; i < px.length; i++) sum += px[i];
    const mean = sum / px.length;
    let s1 = 0, s2 = 0, n = 0;
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
      const i = y * N + x, v = px[i - N] + px[i + N] + px[i - 1] + px[i + 1] - 4 * px[i];
      s1 += v; s2 += v * v; n++;
    }
    const lapVar = s2 / n - (s1 / n) ** 2;
    return { mean, lapVar, side };
  }
  // 사진 지문 dHash(64비트 → 16자리): 9×8 로 줄여 옆 칸보다 밝은지
  function dhash(img) {
    const px = gray(img, 9, 8, 0, 0, img.naturalWidth, img.naturalHeight);
    let bits = '';
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += px[y * 9 + x] > px[y * 9 + x + 1] ? '1' : '0';
    let hex = ''; for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    return hex;
  }
  // 긴 변 800px JPEG 로 다시 그린다 (사진 속 정보는 다시 그리면서 사라진다)
  function toBlob(img) {
    const scale = Math.min(1, 800 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return new Promise((resolve) => c.toBlob((b) => resolve({ blob: b, width: c.width, height: c.height }), 'image/jpeg', 0.85));
  }
  // 폰 AI 결과의 가장 높은 확률 (reasons 의 '가장 가까운 것: … 87%' 에서 읽는다)
  function topProb(r) {
    const m = (r.reasons || []).join(' ').match(/가장 가까운 것:[^0-9]*(\d+)%/);
    return m ? Number(m[1]) / 100 : (r.confidence === '높음' ? 0.9 : r.confidence === '보통' ? 0.7 : 0.4);
  }

  // 판별 결과 아래에 기증 칸을 붙인다
  function offer(dataUrl, r, container) {
    if (!container || !dataUrl || !r) return;
    const prob = topProb(r);
    if (!OK_LABELS.includes(r.label) || prob < 0.6) return;   // ① 모기로 확실한 사진만
    const A = window.MZAuth;
    if (!A || A.status === 'off' || A.status === 'error') return;
    const box = document.createElement('div');
    box.className = 'dn';
    container.appendChild(box);
    if (!A.user()) {
      box.innerHTML = '<p class="dn-t">이 사진을 모기 AI 학습에 기증할 수 있어요</p><p class="dn-s">로그인하면 기증할 수 있어요. 보건소가 확인한 사진만 AI 학습에 써요.</p><a class="dn-btn sub" href="account.html?next=mosquito-info.html">로그인하고 기증하기</a>';
      return;
    }
    box.innerHTML = '<p class="dn-t">이 사진을 모기 AI 학습에 기증할까요?</p><p class="dn-s">보건소 직원이 모기 종류를 확인한 뒤 AI를 더 똑똑하게 만드는 데만 써요. 사진은 공개하지 않고, 촬영 위치 정보는 지워요.</p><button type="button" class="dn-btn">AI 학습에 기증하기</button><p class="dn-msg" role="status"></p>';
    const btn = box.querySelector('.dn-btn'), msg = box.querySelector('.dn-msg');
    btn.addEventListener('click', async () => {
      msg.className = 'dn-msg'; msg.textContent = '';
      if (window.MZConsent && !(await window.MZConsent.ensure('photo_donate', { purpose: '모기 사진 판별 AI 를 다시 학습시키기' }))) { msg.textContent = '동의하지 않으면 기증할 수 없어요.'; return; }
      btn.disabled = true; btn.textContent = '사진을 살펴보는 중…';
      try {
        await A.setConsent('photo_donate', true);   // 서버에도 동의 기록 (기증 전에 반드시)
        const img = await loadImage(dataUrl);
        const q = quality(img);
        if (q.side < 400) throw new Error('사진이 너무 작아요. 모기를 더 가까이에서 찍어 주세요.');                  // ②
        if (q.mean < 35) throw new Error('사진이 너무 어두워요. 밝은 곳에서 다시 찍어 주세요.');
        if (q.mean > 235) throw new Error('사진이 너무 밝아요. 빛을 등지고 다시 찍어 주세요.');
        if (q.lapVar < 40) throw new Error('사진이 흐려요. 흔들리지 않게 다시 찍어 주세요.');
        const { blob, width, height } = await toBlob(img);
        if (!blob) throw new Error('사진을 준비하지 못했어요.');
        btn.textContent = '보내는 중…';
        const res = await A.donatePhoto(blob, { ai_label: r.label, ai_conf: Math.round(prob * 1000) / 1000, phash: dhash(img), width, height });   // ③ 같은 사진은 서버가 막음
        btn.textContent = '기증했어요';
        msg.className = 'dn-msg ok';
        msg.textContent = `고마워요. 보건소가 확인하면 학습에 쓰여요. (오늘 ${res.today}/20장)`;
      } catch (e) {
        btn.disabled = false; btn.textContent = 'AI 학습에 기증하기';
        msg.textContent = e.message || '기증하지 못했어요.';
      }
    });
  }

  window.MZDonate = { offer, _quality: quality, _dhash: dhash };
}());
