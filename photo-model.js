/* =============================================================
   모기제로 자체 사진 판별 모델 (photo-model.js) — window.MZPhotoModel
   -------------------------------------------------------------
   · ml/ 폴더에서 학습한 작은 모델(models/mosquito-v1.onnx)을 폰 브라우저 안에서 돌린다.
     사진이 어디로도 나가지 않고, AI 회사 요금도 들지 않는다.
   · 실행 엔진(onnxruntime-web)은 사진을 처음 판별할 때 한 번만 받는다(약 14MB). 그다음부터는 브라우저에 저장된 것을 쓴다.
   · 엔진 파일은 버전을 고정하고 무결성 값(SRI)을 붙였다. 버전을 올리면 SRI 도 다시 계산한다.
   · 판별: 가운데 정사각형을 잘라 224×224 로 줄이고 → 분류별 확률 → 가장 높은 것.
     가장 높은 확률이 기준(0.6)보다 낮으면 '알 수 없음'.
   · 결과 형식은 서버 판별(/api/identify)과 같다: { label, confidence, reasons, photoTip }
   ============================================================= */
(function () {
  'use strict';
  const ORT_VER = '1.30.0';
  const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/`;
  const ORT_SRI = 'sha384-Bw6URI+Gvoadw0do7/QrSHUC9D1vCYYK5OSqChFyhyV5mzPL4oe2rOAFljAnS8Sq';
  const MODEL = 'models/mosquito-v1.onnx';
  const META = 'models/mosquito-v1.json';

  let session = null;
  let meta = null;
  let loading = null;

  function loadScript() {
    return new Promise((resolve, reject) => {
      if (window.ort) { resolve(); return; }
      const s = document.createElement('script');
      s.src = ORT_BASE + 'ort.wasm.min.js';
      s.integrity = ORT_SRI; s.crossOrigin = 'anonymous'; s.async = true;
      s.onload = () => resolve(); s.onerror = () => reject(new Error('엔진을 받지 못함'));
      document.head.appendChild(s);
    });
  }

  function load() {
    if (session) return Promise.resolve();
    if (!loading) {
      loading = (async () => {
        const m = await fetch(META);
        if (!m.ok) throw new Error('모델 없음');
        meta = await m.json();
        await loadScript();
        window.ort.env.wasm.wasmPaths = ORT_BASE;
        window.ort.env.wasm.numThreads = 1;   // 여러 일꾼(스레드)은 특수 보안 설정이 필요해 하나만 쓴다
        session = await window.ort.InferenceSession.create(MODEL, { executionProviders: ['wasm'] });
      })().catch((e) => { loading = null; throw e; });
    }
    return loading;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('사진 읽기 실패'));
      img.src = src;
    });
  }

  // 사진 → 모델 입력(1×3×224×224, 정규화)
  function toTensor(img) {
    const S = meta.size;
    const side = Math.min(img.naturalWidth, img.naturalHeight) * (meta.crop || 0.87);
    const sx = (img.naturalWidth - side) / 2, sy = (img.naturalHeight - side) / 2;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const g = c.getContext('2d');
    g.drawImage(img, sx, sy, side, side, 0, 0, S, S);
    const px = g.getImageData(0, 0, S, S).data;
    const data = new Float32Array(3 * S * S);
    for (let i = 0; i < S * S; i++) {
      for (let ch = 0; ch < 3; ch++) data[ch * S * S + i] = (px[i * 4 + ch] / 255 - meta.mean[ch]) / meta.std[ch];
    }
    return new window.ort.Tensor('float32', data, [1, 3, S, S]);
  }

  async function classify(dataUrl) {
    await load();
    const img = await loadImage(dataUrl);
    const out = await session.run({ image: toTensor(img) });
    const prob = Array.from(out.prob.data);
    const order = prob.map((p, i) => [p, i]).sort((a, b) => b[0] - a[0]);
    const [top, ti] = order[0];
    const [second, si] = order[1];
    const pct = (p) => `${Math.round(p * 100)}%`;
    const unsure = top < (meta.unsure_below || 0.6);
    return {
      label: unsure ? '알 수 없음' : meta.labels[ti],
      confidence: top >= 0.85 ? '높음' : (top >= 0.6 ? '보통' : '낮음'),
      reasons: [`가장 가까운 것: ${meta.labels[ti]} ${pct(top)}`, `두 번째 후보: ${meta.labels[si]} ${pct(second)}`],
      photoTip: unsure ? '모기가 화면 가운데에 크게, 밝은 곳에서 흔들리지 않게 다시 찍어 주세요.' : '',
      source: 'device',
    };
  }

  window.MZPhotoModel = { classify, load };
}());
