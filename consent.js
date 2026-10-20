/* =============================================================
   기능을 쓸 때 받는 동의 (consent.js) — window.MZConsent
   -------------------------------------------------------------
   위치(GPS)·움직임 센서처럼 민감한 정보는 그 기능을 처음 쓸 때 목적·항목·보관을 보여 주고 동의를 받는다.
     · 로그인하지 않아도 쓸 수 있다: 동의 여부는 이 기기(localStorage 'mz-consent')에 기억한다.
     · 로그인한 상태면 서버에도 동의 기록을 남긴다(MZAuth.setConsent, 언제·어느 판에 동의했는지).
     · 거부해도 기능을 대신 쓰는 길을 남긴다(예: 위치 대신 동네 고르기, GPS 없이 걸음만 세기).
     · 판(POLICY_VERSION)이 바뀌면 다시 묻는다.
   사용: const ok = await MZConsent.ensure('location', { purpose: '모기 제보 위치' });
   ============================================================= */
(function () {
  'use strict';
  const KEY = 'mz-consent';
  const VERSION = (window.MZAuth && window.MZAuth.POLICY_VERSION) || '2026-10-20';
  const TEXT = {
    location: {
      title: '위치정보 이용 동의',
      items: '휴대폰의 현재 위치(GPS 좌표)',
      keep: '좌표는 이 폰 안에서만 쓰고 서버에 보내지 않아요. 제보는 동네 이름만, 뛰어런은 거리 숫자만 남아요.',
      deny: '동의하지 않아도 동네를 직접 고르거나, 거리 없이 걸음만 셀 수 있어요.',
    },
    photo_donate: {
      title: '사진 기증 동의 (모기 AI 학습)',
      items: '지금 찍은 모기 사진(줄인 사진, 촬영 위치 정보는 지움), AI 판별 결과, 동네 이름',
      keep: '보건소 직원이 모기 종류를 확인한 뒤 모기제로 AI 학습에만 써요. 사진은 공개하지 않고, 계정을 지우면 함께 지워요.',
      deny: '동의하지 않아도 사진 판별은 그대로 쓸 수 있어요.',
    },
    motion: {
      title: '움직임 센서 이용 동의',
      items: '휴대폰 가속도 센서 값(흔들림)',
      keep: '걸음 수를 세는 데만 쓰고, 센서 값은 저장하지 않아요. 걸음·시간 같은 결과 숫자만 남아요.',
      deny: '동의하지 않으면 뛰어런을 쓸 수 없어요. 다른 기능은 그대로 쓸 수 있어요.',
    },
  };

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
  function save(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* 저장 못 해도 이번엔 쓴다 */ } }

  // 지금 동의 상태: true(동의) · false(거부) · null(아직 안 물음 또는 판이 바뀜)
  function get(kind) {
    const r = load()[kind];
    if (!r || r.v !== VERSION) return null;
    return !!r.agreed;
  }
  function set(kind, agreed, opts) {
    const all = load(); all[kind] = { agreed: !!agreed, v: VERSION, at: new Date().toISOString() }; save(all);
    const A = window.MZAuth;
    if (!(opts && opts.skipServer) && A && A.enabled && A.user() && !A.needsOnboarding()) {
      A.setConsent(kind, agreed).catch(() => { /* 서버 기록 실패해도 기능은 동작 */ });
    }
  }

  // 동의 창 (dialog). 같은 창을 다시 쓴다
  function dialog() {
    let d = document.getElementById('mzConsentDlg');
    if (d) return d;
    d = document.createElement('dialog');
    d.id = 'mzConsentDlg'; d.className = 'consent-dlg'; d.setAttribute('aria-labelledby', 'mzConsentT');
    d.innerHTML = `<form method="dialog" class="consent-card">
      <h2 id="mzConsentT"></h2>
      <dl>
        <dt>쓰는 곳</dt><dd data-f="purpose"></dd>
        <dt>쓰는 정보</dt><dd data-f="items"></dd>
        <dt>보관</dt><dd data-f="keep"></dd>
      </dl>
      <p class="consent-deny" data-f="deny"></p>
      <p class="consent-more"><a href="privacy.html#location" target="_blank" rel="noopener">개인정보 처리방침 자세히</a> · 동의는 언제든 '내 기록 → 계정 관리'(로그인 시) 또는 브라우저 설정에서 철회할 수 있어요.</p>
      <div class="consent-btns">
        <button type="submit" value="no" class="btn-sub">동의 안 함</button>
        <button type="submit" value="yes" class="btn-main">동의해요</button>
      </div>
    </form>`;
    document.body.appendChild(d);
    return d;
  }

  // 동의가 있으면 바로 true, 없으면 창을 띄워 묻는다. opts.purpose: 지금 쓰려는 기능 설명
  function ensure(kind, opts) {
    const now = get(kind);
    if (now === true) return Promise.resolve(true);
    const t = TEXT[kind]; if (!t) return Promise.resolve(false);
    const d = dialog();
    d.querySelector('#mzConsentT').textContent = t.title;
    d.querySelector('[data-f="purpose"]').textContent = (opts && opts.purpose) || '';
    d.querySelector('[data-f="items"]').textContent = t.items;
    d.querySelector('[data-f="keep"]').textContent = t.keep;
    d.querySelector('[data-f="deny"]').textContent = t.deny;
    return new Promise((resolve) => {
      const done = () => {
        d.removeEventListener('close', done);
        const ok = d.returnValue === 'yes';
        set(kind, ok);
        resolve(ok);
      };
      d.returnValue = '';
      d.addEventListener('close', done);
      if (typeof d.showModal === 'function') d.showModal();
      else resolve(window.confirm(`${t.title}\n\n${(opts && opts.purpose) || ''}\n${t.keep}`));   // 아주 오래된 브라우저
    });
  }

  window.MZConsent = { get, set, ensure, VERSION };
}());
