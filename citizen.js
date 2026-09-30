/* =============================================================
   시민 기능: 사진으로 모기 알아보기 · 여기 모기 있어요(제보 시험판)
   -------------------------------------------------------------
   1) 사진으로 모기 알아보기
      · 휴대폰에서는 '카메라로 찍기'를 누르면 바로 뒷면 카메라가 열린다.
      · 사진은 브라우저에서 긴 변 1024px 로 줄여 다시 저장한다.
        이때 사진에 숨어 있던 촬영 위치(GPS) 같은 정보가 모두 지워진다.
      · 줄인 사진만 /api/identify 로 보내 AI 가 판별한다. 저장하지 않는다.
   2) 여기 모기 있어요 (시험판)
      · 동(洞) 단위로만 고른다. 정확한 위치는 받지 않는다.
      · 서버에 보내거나 저장하지 않는다. 이 화면을 연 동안만 지도에 점을 찍는다.
        (저장하는 정식 기능은 위치정보법·개인정보 검토 뒤에 연다)
   ============================================================= */

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  document.addEventListener('DOMContentLoaded', () => {
    setupPhoto();
    setupReport();
  });

  /* ---------------- 1) 사진으로 모기 알아보기 ---------------- */
  // 판별 결과별 안내 (모기 도감 내용과 같은 사실만 쓴다)
  const INFO = {
    '흰줄숲모기': { tone: 'warn', what: '낮에도 무는 모기예요. 풀숲과 공원에 많아요.', disease: '뎅기열 · 지카바이러스를 옮길 수 있어요', todo: '화분 받침 · 폐타이어에 고인 물을 비워 주세요.' },
    '얼룩날개모기': { tone: 'warn', what: '앉을 때 몸을 비스듬히 세우는 모기예요.', disease: '말라리아를 옮길 수 있어요', todo: '물린 뒤 열이 나면 병원에 가서 모기에 물렸다고 알려 주세요.' },
    '집모기류': { tone: 'info', what: '밤에 집 안으로 들어오는 가장 흔한 갈색 모기예요. 빨간집모기인지 작은빨간집모기인지는 사진으로 구분하기 어려워요.', disease: '작은빨간집모기는 일본뇌염을 옮길 수 있어요', todo: '방충망을 점검하고, 어린이는 일본뇌염 예방접종을 확인하세요.' },
    '모기 아님': { tone: 'ok', what: '모기가 아닌 곤충으로 보여요. 다리가 아주 긴 큰 곤충(각다귀)은 사람을 물지 않아요.', disease: '', todo: '' },
    '알 수 없음': { tone: 'none', what: '사진으로는 알아보기 어려워요.', disease: '', todo: '' },
  };

  function setupPhoto() {
    const cam = $('photoCamera'), pick = $('photoPick');
    if (!cam || !pick) return;
    [cam, pick].forEach((input) => input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      input.value = '';           // 같은 사진을 다시 골라도 동작하게
      if (file) handleFile(file);
    }));
    // 버튼을 누르면 숨겨 둔 파일 입력을 연다 (키보드로도 쓸 수 있게 버튼을 둔다)
    document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => $(b.dataset.open).click()));
    const again = $('photoAgain');
    if (again) again.addEventListener('click', resetPhoto);
  }

  function resetPhoto() {
    $('photoBox').dataset.state = 'idle';
    $('photoPreview').removeAttribute('src');
    $('photoResult').innerHTML = '';
  }

  async function handleFile(file) {
    const box = $('photoBox');
    if (!/^image\//.test(file.type)) { showError('사진 파일만 올릴 수 있어요.'); return; }
    box.dataset.state = 'loading';
    let dataUrl;
    try { dataUrl = await shrink(file, 1024); }
    catch (e) { showError('사진을 읽지 못했어요. 다시 찍어 주세요.'); return; }
    $('photoPreview').src = dataUrl;

    try {
      const res = await fetch('/api/identify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: dataUrl }) });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) { showError(data.message || '지금은 사진을 판별하지 못했어요. 잠시 후 다시 시도해 주세요.'); return; }
      showResult(data);
    } catch (e) {
      showError('인터넷 연결을 확인하고 다시 시도해 주세요.');
    }
  }

  // 사진을 줄여 JPEG 로 다시 만든다. 다시 그리면 사진 속 촬영 위치 정보(EXIF)가 사라진다.
  function shrink(file, maxSide) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * scale);
        c.height = Math.round(img.naturalHeight * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('읽기 실패')); };
      img.src = url;
    });
  }

  function showError(message) {
    $('photoBox').dataset.state = 'done';
    $('photoResult').innerHTML = `<p class="pr-err">${escapeHtml(message)}</p>`;
  }

  function showResult(r) {
    const info = INFO[r.label] || INFO['알 수 없음'];
    const conf = { 높음: '거의 확실해요', 보통: '그럴 가능성이 높아요', 낮음: '확실하지 않아요' }[r.confidence] || '';
    const reasons = (r.reasons || []).map((t) => `<li>${escapeHtml(t)}</li>`).join('');
    $('photoBox').dataset.state = 'done';
    $('photoResult').innerHTML = `
      <p class="pr-k">AI가 본 결과 · 참고용</p>
      <h3 class="pr-name tone-${info.tone}">${escapeHtml(r.label)}</h3>
      <p class="pr-conf">${conf}</p>
      <p class="pr-what">${info.what}</p>
      ${info.disease ? `<p class="pr-dz">${info.disease}</p>` : ''}
      ${info.todo ? `<p class="pr-todo">${info.todo}</p>` : ''}
      ${reasons ? `<details class="more pr-why"><summary>AI가 본 특징</summary><ul>${reasons}</ul></details>` : ''}
      ${r.photoTip ? `<p class="pr-tip">다시 찍을 때: ${escapeHtml(r.photoTip)}</p>` : ''}`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------------- 2) 여기 모기 있어요 (시험판) ---------------- */
  const reportMarkers = [];

  function setupReport() {
    const btn = $('reportBtn'), dlg = $('reportDialog');
    if (!btn || !dlg) return;
    const sel = $('reportDistrict');
    const model = window.GimhaeMosquitoModel;
    const names = model && model.COORDS ? Object.keys(model.COORDS) : [];
    sel.innerHTML = '<option value="">동네를 골라 주세요</option>' + names.map((n) => `<option>${n}</option>`).join('');

    btn.addEventListener('click', () => { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); });
    $('reportCancel').addEventListener('click', () => dlg.close());
    $('reportForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = sel.value;
      const agree = $('reportAgree').checked;
      const msg = $('reportMsg');
      if (!name) { msg.textContent = '동네를 골라 주세요.'; sel.focus(); return; }
      if (!agree) { msg.textContent = '안내를 읽고 동의에 체크해 주세요.'; return; }
      msg.textContent = '';
      markOnMap(name);
      dlg.close();
      toast(`${name}에 표시했어요. 시험판이라 저장되지 않고, 이 화면을 닫으면 사라져요.`);
      const map = document.getElementById('map');
      if (map) map.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  function markOnMap(name) {
    const model = window.GimhaeMosquitoModel;
    const c = model && model.COORDS && model.COORDS[name];
    // script.js 의 전역 지도(map)와 Leaflet(L)을 쓴다. 없으면 조용히 건너뛴다.
    if (!c || typeof L === 'undefined' || typeof map === 'undefined' || !map) return;
    const mk = L.circleMarker([c[0], c[1]], { radius: 11, color: '#fff', weight: 3, fillColor: '#3182F6', fillOpacity: 1 })
      .addTo(map)
      .bindPopup(`<b>여기 모기 있어요</b><br>${name} · 방금 · 시험판(저장 안 됨)`);
    reportMarkers.push(mk);
    map.setView([c[0], c[1]], Math.max(map.getZoom(), 12), { animate: true });
    mk.openPopup();
  }

  function toast(message) {
    const el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), 4200);
  }
}());
