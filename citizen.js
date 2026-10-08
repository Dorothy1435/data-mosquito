/* =============================================================
   시민 기능: 사진으로 모기 알아보기 · 여기 모기 있어요(제보 시험판)
   -------------------------------------------------------------
   1) 사진으로 모기 알아보기
      · 휴대폰에서는 '카메라로 찍기'를 누르면 바로 뒷면 카메라가 열린다.
      · 사진은 브라우저에서 긴 변 1024px 로 줄여 다시 저장한다.
        이때 사진에 숨어 있던 촬영 위치(GPS) 같은 정보가 모두 지워진다.
      · 줄인 사진만 /api/identify 로 보내 AI 가 판별한다. 저장하지 않는다.
   2) 모기 제보 — 빨간 '물렸어요' 버튼 · '여기 모기 있어요' (대화형 창)
      · 위치는 '지금 여기예요'를 누를 때 GPS 를 한 번만 쓴다. 싫으면 동네를 고른다.
      · 저장 스위치(서버 REPORT_STORE_ENABLED)가 꺼져 있으면 저장하지 않고 이 화면을 연 동안만 지도에 점을 찍는다.
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

  /* ---------------- 2) 모기 제보 (물렸어요 · 모기 봤어요 · 고인 물) ----------------
     2026-10-08 피드백: '여기서 모기 물렸어' 버튼을 눈에 띄게(빨간 경광등), 누르면 챗봇처럼 묻는다.
     흐름: 무엇을 → 어디서 → (물렸으면) 언제 · 몇 군데 → 지도에 표시
       · 빨간 버튼(data-report="bite")은 '물렸어요'로 바로 시작하고, 우리 동네의 '여기 모기 있어요'는 종류부터 묻는다.
       · 위치는 '지금 여기예요'를 눌렀을 때만 GPS 를 한 번 쓴다. 이 버튼이 곧 동의다(바로 위에 안내 문장).
         거부하거나 위치를 못 찾으면 동네를 직접 고른다.
       · 서버(/api/report)는 저장 스위치가 켜져 있을 때만 저장한다. 꺼져 있으면 이 화면을 연 동안만 지도에 점을 찍는다.
         (저장하는 정식 기능은 위치기반서비스사업 신고, 개인위치정보 이용약관·동의, 보관 기간을 정한 뒤에 연다)
       · '언제 · 몇 군데'는 지금은 화면에만 보여 주고 서버로 보내지 않는다 (저장 칸이 아직 없다). */
  const reportMarkers = [];
  const GIMHAE = { minLat: 35.13, maxLat: 35.40, minLng: 128.68, maxLng: 129.05 };
  const KIND_NAME = { mosquito: '모기 봤어요', bite: '물렸어요', breeding: '고인 물 발견' };
  const KIND_COLOR = { mosquito: '#3182F6', bite: '#E5484D', breeding: '#0E9F6E' };
  const WHERE_Q = { mosquito: '어디서 봤어요?', bite: '어디서 물렸어요?', breeding: '어디에 고인 물이 있어요?' };
  let report = null;   // 지금 진행 중인 제보 { kind, lat, lng, place, source, when, count }

  function setupReport() {
    const dlg = $('reportDialog');
    if (!dlg) return;   // 홈이 아닌 화면: 빨간 버튼은 링크(index.html#bite)라서 할 일이 없다

    // 예전 주소(index.html#photo)로 들어오면 사진 판별이 있는 도감 화면으로 보낸다
    if (location.hash === '#photo') { location.replace('mosquito-info.html#photo'); return; }

    document.querySelectorAll('[data-report]').forEach((b) => b.addEventListener('click', () => openReport(b.dataset.report || null)));
    const old = $('reportBtn');
    if (old) old.addEventListener('click', () => openReport(null));
    $('reportClose').addEventListener('click', () => dlg.close());
    // 바깥(어두운 부분)을 누르면 닫는다
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    // 닫으면 진행 중이던 제보를 버린다. 늦게 온 위치·서버 응답은 아래 '같은 제보인지' 검사에서 걸러진다
    dlg.addEventListener('close', () => { report = null; });

    // 다른 화면의 빨간 버튼으로 들어오면 (index.html#bite) 바로 연다
    if (location.hash === '#bite') {
      try { history.replaceState(null, '', location.pathname + location.search); } catch (_) { /* 무시 */ }
      setTimeout(() => openReport('bite'), 300);
    }
  }

  /* ---------- 대화 그리기 ---------- */
  function say(text, who) {
    const log = $('reportLog');
    const p = document.createElement('p');
    p.className = who === 'me' ? 'bc-me' : 'bc-bot';
    p.innerHTML = text;   // 이 파일에서 만든 문장만 넣는다 (사용자가 친 글자는 없다)
    log.appendChild(p);
    log.scrollTop = log.scrollHeight;
    return p;
  }

  // 고를 수 있는 단추들을 보여 준다. items: [{ label, sub?, tone?, silent?, onPick }]
  function choices(items, opts) {
    const box = $('reportChoices');
    box.className = 'bc-choices' + (opts && opts.grid ? ' is-grid' : '');
    box.innerHTML = '';
    items.forEach((it) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bc-opt' + (it.tone ? ' is-' + it.tone : '');
      b.innerHTML = it.sub ? `<b>${it.label}</b><small>${it.sub}</small>` : it.label;
      b.addEventListener('click', () => {
        box.innerHTML = '';
        if (!it.silent) say(it.label, 'me');   // 고른 답을 내 말풍선으로 남긴다
        it.onPick();
      });
      box.appendChild(b);
    });
    // 단추가 생기면 대화 칸이 줄어드니, 마지막 말이 보이게 다시 맨 아래로 내린다
    const log = $('reportLog');
    log.scrollTop = log.scrollHeight;
    const first = box.querySelector('button');
    if (first) first.focus({ preventScroll: true });
  }

  /* ---------- 대화 순서 ---------- */
  function openReport(kind) {
    const dlg = $('reportDialog');
    $('reportLog').innerHTML = '';
    $('reportChoices').innerHTML = '';
    if (dlg.showModal) { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', '');
    const mine = report = { kind: null };
    checkStore().then(() => {
      if (report !== mine) return;   // 그사이 닫았거나 새로 열었으면 이 대화는 끝
      if (kind && KIND_NAME[kind]) {
        report.kind = kind;
        say(kind === 'bite' ? '모기에 물렸군요. 알려 주시면 동네 지도에 표시할게요.' : '알려 주셔서 고마워요.');
        askWhere();
      } else {
        askKind();
      }
    });
  }

  function askKind() {
    say('무엇을 알려 주실 건가요?');
    choices([
      { label: '물렸어요', sub: '여기서 모기에 물렸어요', tone: 'red', onPick: () => { report.kind = 'bite'; askWhere(); } },
      { label: '모기 봤어요', sub: '모기가 날아다녀요', onPick: () => { report.kind = 'mosquito'; askWhere(); } },
      { label: '고인 물 발견', sub: '모기가 자랄 수 있는 물웅덩이·용기', onPick: () => { report.kind = 'breeding'; askWhere(); } },
    ]);
  }

  function askWhere() {
    const keep = storeOn ? '약 100m 단위로 줄여 저장하고 1년 뒤 지워요.' : '아직은 저장하지 않고 내 화면에만 표시해요.';
    say(`${WHERE_Q[report.kind]}<small>'지금 여기예요'를 누르면 휴대폰 위치(GPS)를 <b>한 번만</b> 써요. ${keep}</small>`);
    choices([
      { label: '📍 지금 여기예요', sub: '위치 1회 사용에 동의', tone: 'red', onPick: useGps },
      { label: '동네 고르기', sub: '위치를 쓰지 않아요', onPick: pickDistrict },
    ]);
  }

  function useGps() {
    if (!navigator.geolocation) { say('이 기기에서는 위치를 쓸 수 없어요.'); pickDistrict(); return; }
    const wait = say('위치를 확인하는 중이에요…');
    const mine = report;
    navigator.geolocation.getCurrentPosition((pos) => {
      if (report !== mine) return;   // 위치를 찾는 동안 창을 닫았으면 아무것도 보내지 않는다
      wait.remove();
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      if (lat < GIMHAE.minLat || lat > GIMHAE.maxLat || lng < GIMHAE.minLng || lng > GIMHAE.maxLng) {
        say('지금 위치가 김해 밖이에요. 지금은 김해 안에서만 표시할 수 있어요.');
        choices([
          { label: '김해 동네 고르기', onPick: pickDistrict },
          { label: '닫기', silent: true, onPick: () => $('reportDialog').close() },
        ]);
        return;
      }
      const model = window.GimhaeMosquitoModel;
      const dong = model && model.nearestDistrict ? model.nearestDistrict(lat, lng) : '';
      Object.assign(report, { lat, lng, source: 'gps', place: `${dong ? dong + ' 근처' : '내 위치'} · 오차 약 ${Math.round(accuracy)}m` });
      say(`위치를 확인했어요. ${dong ? `<b>${dong}</b> 근처예요` : '김해 안이에요'} (오차 약 ${Math.round(accuracy)}m)`);
      afterWhere();
    }, (err) => {
      if (report !== mine) return;
      wait.remove();
      say(err.code === 1 ? '위치 권한이 꺼져 있어요.' : '위치를 찾지 못했어요.');
      pickDistrict();
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  }

  function pickDistrict() {
    const model = window.GimhaeMosquitoModel;
    const names = model && model.COORDS ? Object.keys(model.COORDS) : [];
    if (!names.length) { say('동네 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'); return; }
    say('어느 동네예요?');
    choices(names.map((n) => ({ label: n, onPick: () => {
      const c = model.COORDS[n];
      Object.assign(report, { lat: c[0], lng: c[1], source: 'pick', place: `${n} (동네 선택)` });
      afterWhere();
    } })), { grid: true });
  }

  function afterWhere() {
    if (report.kind !== 'bite') { finish(); return; }
    say('언제 물렸어요?');
    choices(['방금', '1시간 안', '오늘', '어제'].map((t) => ({ label: t, onPick: () => { report.when = t; askCount(); } })), { grid: true });
  }

  function askCount() {
    say('몇 군데 물렸어요?');
    choices(['1군데', '2~3군데', '4군데 이상'].map((t) => ({ label: t, onPick: () => { report.count = t; finish(); } })), { grid: true });
  }

  async function finish() {
    const mine = report;
    const saved = await sendReport(mine);
    const stored = Boolean(saved && saved.stored);
    addMarker(stored, mine);
    if (report !== mine) return;   // 보내는 동안 창을 닫았으면 안내는 생략
    say(stored ? '접수했어요. 보건소가 확인할게요. 고마워요!' : '내 화면의 지도에 표시했어요. 아직 보건소로 보내는 기능은 준비 중이라, 새로고침하면 사라져요.');
    if (report.kind === 'bite') {
      say('물린 곳은 긁지 말고 차갑게 식혀 주세요. 며칠 안에 열이 나면 병원에서 <b>모기에 물렸다</b>고 꼭 알려 주세요.');
    } else if (report.kind === 'breeding') {
      say('고인 물은 일주일에 한 번만 비워도 모기가 자라지 못해요. 직접 비우기 어려운 곳이면 보건소에 알려 주세요.');
    }
    choices([
      { label: '지도에서 보기', tone: 'red', silent: true, onPick: showOnMap },
      { label: '닫기', silent: true, onPick: () => $('reportDialog').close() },
    ]);
  }

  // 서버에 보낸다. 저장 스위치가 꺼져 있으면 서버가 저장하지 않고 stored:false 를 돌려준다.
  async function sendReport(r) {
    try {
      const res = await fetch('/api/report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: r.kind, lat: r.lat, lng: r.lng, source: r.source }),
      });
      return await res.json();
    } catch (_) { return null; }
  }

  // script.js 의 전역 지도(map)와 Leaflet(L)을 쓴다. 없으면 조용히 건너뛴다.
  function addMarker(stored, r) {
    if (typeof L === 'undefined' || typeof map === 'undefined' || !map) return;
    const extra = r.kind === 'bite' ? `<br>${r.when || ''} · ${r.count || ''}` : '';
    const mk = L.circleMarker([r.lat, r.lng], { radius: 11, color: '#fff', weight: 3, fillColor: KIND_COLOR[r.kind], fillOpacity: 1 })
      .addTo(map)
      .bindPopup(`<b>${KIND_NAME[r.kind]}</b><br>${r.place}${extra}<br>방금 · ${stored ? '저장됨, 보건소 확인 전' : '내 화면에만 표시 (보건소 전송 준비 중)'}`);
    reportMarkers.push(mk);
    r.marker = mk;
  }

  // 제보 창을 닫고 우리 동네 지도로 간다 (폰에서는 '우리 동네' 탭이 열린다)
  function showOnMap() {
    const mk = report && report.marker;   // 닫으면 report 가 비워지므로 먼저 꺼내 둔다
    $('reportDialog').close();
    location.hash = 'town';
    setTimeout(() => {
      const el = $('map');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (mk && typeof map !== 'undefined' && map) {
        map.invalidateSize();
        map.setView(mk.getLatLng(), Math.max(map.getZoom(), 14), { animate: true });
        setTimeout(() => mk.openPopup(), 500);
      }
    }, 150);
  }

  // 저장 스위치가 켜져 있는지 서버에 물어, 위치 안내 문구를 사실대로 바꾼다
  let storeOn = false;
  async function checkStore() {
    try {
      const r = await (await fetch('/api/report')).json();
      storeOn = Boolean(r && r.stored);
    } catch (_) { storeOn = false; }
  }
}());
