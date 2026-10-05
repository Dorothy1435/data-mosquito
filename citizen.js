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
    // '카메라로 찍기'는 페이지 안에서 카메라를 바로 연다. 안 되는 기기에서는 휴대폰 기본 카메라(파일 입력)로 넘어간다.
    document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.open === 'photoCamera') openCamera();
      else $(b.dataset.open).click();
    }));
    setupCamera();
    const again = $('photoAgain');
    if (again) again.addEventListener('click', resetPhoto);
  }

  function resetPhoto() {
    $('photoBox').dataset.state = 'idle';
    $('photoPreview').removeAttribute('src');
    $('photoResult').innerHTML = '';
  }

  async function handleFile(file) {
    if (!/^image\//.test(file.type)) { showError('사진 파일만 올릴 수 있어요.'); return; }
    $('photoBox').dataset.state = 'loading';
    let dataUrl;
    try { dataUrl = await shrink(file, 1024); }
    catch (e) { showError('사진을 읽지 못했어요. 다시 찍어 주세요.'); return; }
    identify(dataUrl);
  }

  async function identify(dataUrl) {
    const box = $('photoBox');
    box.dataset.state = 'loading';
    $('photoPreview').src = dataUrl;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });

    try {
      const res = await fetch('/api/identify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: dataUrl }) });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) { showError(data.message || '지금은 사진을 판별하지 못했어요. 잠시 후 다시 시도해 주세요.'); return; }
      showResult(data);
    } catch (e) {
      showError('인터넷 연결을 확인하고 다시 시도해 주세요.');
    }
  }

  /* ---------- 페이지 안 카메라 ----------
     getUserMedia 로 뒷면 카메라를 바로 켠다 (HTTPS 에서만 동작, Vercel 은 HTTPS).
     찍은 화면을 캔버스로 옮겨 긴 변 1024px JPEG 로 만든다 — 위치 정보 같은 메타데이터는 처음부터 없다.
     카메라 권한을 거부했거나 지원하지 않으면 휴대폰 기본 카메라(파일 입력)를 연다. */
  let camStream = null;

  function setupCamera() {
    const dlg = $('camDialog');
    if (!dlg) return;
    $('camShot').addEventListener('click', takeShot);
    $('camClose').addEventListener('click', closeCamera);
    dlg.addEventListener('close', stopStream);
  }

  async function openCamera() {
    const dlg = $('camDialog');
    if (!dlg || !dlg.showModal || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $('photoCamera').click(); return; }
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    } catch (e) {
      $('photoCamera').click();   // 권한 거부·카메라 없음 → 휴대폰 기본 카메라로
      return;
    }
    const v = $('camVideo');
    v.srcObject = camStream;
    dlg.showModal();
    try { await v.play(); } catch (_) { /* 버튼을 눌러 연 것이라 자동 재생 제한은 거의 없다 */ }
  }

  function takeShot() {
    const v = $('camVideo');
    if (!v.videoWidth) return;
    const scale = Math.min(1, 1024 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    const dataUrl = c.toDataURL('image/jpeg', 0.85);
    $('camDialog').classList.add('flash');
    setTimeout(() => { $('camDialog').classList.remove('flash'); closeCamera(); identify(dataUrl); }, 180);
  }

  function closeCamera() { stopStream(); const d = $('camDialog'); if (d && d.open) d.close(); }
  function stopStream() { if (camStream) { camStream.getTracks().forEach((t) => t.stop()); camStream = null; } }

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

  /* ---------------- 2) 여기 모기 있어요 (시험판) ----------------
     위치 동의 → GPS 1회 → 지도에 표시. 동의하지 않거나 GPS 가 안 되면 동네를 직접 고른다.
     시험판이라 위치를 서버로 보내거나 저장하지 않는다.
     (저장하는 정식 기능은 위치기반서비스사업 신고, 개인위치정보 이용약관·동의, 보관 기간을 정한 뒤에 연다) */
  const reportMarkers = [];
  const GIMHAE = { minLat: 35.13, maxLat: 35.40, minLng: 128.68, maxLng: 129.05 };

  function setupReport() {
    const btn = $('reportBtn'), dlg = $('reportDialog');
    if (!btn || !dlg) return;
    const sel = $('reportDistrict'), msg = $('reportMsg'), submit = $('reportSubmit');
    const model = window.GimhaeMosquitoModel;
    const names = model && model.COORDS ? Object.keys(model.COORDS) : [];
    sel.innerHTML = '<option value="">동네를 골라 주세요</option>' + names.map((n) => `<option>${n}</option>`).join('');
    let mode = 'gps';

    const setMode = (m) => {
      mode = m;
      $('reportConsent').hidden = m !== 'gps';
      $('reportPick').hidden = m !== 'pick';
      $('reportManual').hidden = m !== 'gps';
      submit.textContent = m === 'gps' ? '내 위치로 표시하기' : '이 동네에 표시하기';
      msg.textContent = '';
    };
    btn.addEventListener('click', () => {
      setMode('gps');
      $('reportAgree').checked = false;
      checkStore();
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    });
    $('reportCancel').addEventListener('click', () => dlg.close());
    $('reportManual').addEventListener('click', () => { setMode('pick'); sel.focus(); });

    $('reportForm').addEventListener('submit', (e) => {
      e.preventDefault();
      if (mode === 'pick') {
        if (!sel.value) { msg.textContent = '동네를 골라 주세요.'; sel.focus(); return; }
        const c = model.COORDS[sel.value];
        mark(c[0], c[1], `${sel.value} (동네 선택)`, 'pick');
        dlg.close();
        return;
      }
      if (!$('reportAgree').checked) { msg.textContent = '위치 정보 이용에 동의하거나, 동네를 직접 골라 주세요.'; return; }
      if (!navigator.geolocation) { msg.textContent = '이 기기에서는 위치를 쓸 수 없어요. 동네를 직접 골라 주세요.'; setMode('pick'); return; }
      submit.disabled = true;
      msg.textContent = '위치를 확인하는 중이에요…';
      navigator.geolocation.getCurrentPosition((pos) => {
        submit.disabled = false;
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        if (lat < GIMHAE.minLat || lat > GIMHAE.maxLat || lng < GIMHAE.minLng || lng > GIMHAE.maxLng) {
          msg.textContent = '지금 위치가 김해 밖이에요. 김해 안에서만 표시할 수 있어요.';
          return;
        }
        const dong = model && model.nearestDistrict ? model.nearestDistrict(lat, lng) : '';
        mark(lat, lng, `${dong ? dong + ' 근처' : '내 위치'} · 오차 약 ${Math.round(accuracy)}m`, 'gps');
        dlg.close();
      }, (err) => {
        submit.disabled = false;
        msg.textContent = err.code === 1
          ? '위치 권한이 꺼져 있어요. 동네를 직접 골라 주세요.'
          : '위치를 찾지 못했어요. 동네를 직접 골라 주세요.';
        setMode('pick');
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
    });
  }

  /* 저장 스위치가 켜져 있는지 서버에 물어, 동의 안내의 '보관' 문구를 사실대로 바꾼다 */
  let storeOn = false;
  async function checkStore() {
    try {
      const r = await (await fetch('/api/report')).json();
      storeOn = Boolean(r && r.stored);
    } catch (_) { storeOn = false; }
    const keep = $('reportKeep');
    if (keep) keep.textContent = storeOn
      ? '약 100m 단위로 줄여 저장하고 1년 뒤 지워요. 누가 보냈는지는 저장하지 않아요'
      : '시험판이라 저장하지 않아요. 이 화면을 닫으면 사라져요';
  }

  const KIND_NAME = { mosquito: '모기 봤어요', bite: '물렸어요', breeding: '고인 물 발견' };
  const KIND_COLOR = { mosquito: '#3182F6', bite: '#E5484D', breeding: '#0E9F6E' };

  async function mark(lat, lng, label, source) {
    const kindEl = document.querySelector('input[name="reportKind"]:checked');
    const kind = kindEl ? kindEl.value : 'mosquito';
    // 서버에 보낸다. 저장 스위치가 꺼져 있으면 서버가 저장하지 않고 stored:false 를 돌려준다.
    let saved = null;
    try {
      const r = await fetch('/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, lat, lng, source }) });
      saved = await r.json();
    } catch (_) { saved = null; }
    const stored = Boolean(saved && saved.stored);
    // script.js 의 전역 지도(map)와 Leaflet(L)을 쓴다. 없으면 조용히 건너뛴다.
    if (typeof L === 'undefined' || typeof map === 'undefined' || !map) { toast(saved && saved.message ? saved.message : '제보를 받았어요.'); return; }
    const mk = L.circleMarker([lat, lng], { radius: 11, color: '#fff', weight: 3, fillColor: KIND_COLOR[kind], fillOpacity: 1 })
      .addTo(map)
      .bindPopup(`<b>${KIND_NAME[kind]}</b><br>${label}<br>방금 · ${stored ? '저장됨, 보건소 확인 전' : '시험판(저장 안 됨)'}`);
    reportMarkers.push(mk);
    map.setView([lat, lng], Math.max(map.getZoom(), 14), { animate: true });
    const el = document.getElementById('map');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => mk.openPopup(), 500);
    toast(stored ? (saved.message || '제보했어요. 보건소가 확인할게요.') : '지도에 표시했어요. 시험판이라 저장되지 않아요.');
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
