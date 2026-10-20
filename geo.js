/* =============================================================
   정확한 현재 위치 받기 (geo.js) — window.MZGeo
   -------------------------------------------------------------
   휴대폰 GPS 는 처음 몇 초 동안 와이파이·기지국으로 어림한 값(오차 수백 m)을 먼저 주고, 점점 정확해진다.
   그래서 첫 값을 바로 쓰지 않고, 정해진 시간 동안 위치를 계속 받아 '오차가 가장 작은 값'을 쓴다.
     · 오차가 good(기본 30m) 이하로 들어오면 바로 끝낸다.
     · maxWait(기본 8초)가 지나면 그때까지 받은 것 중 가장 정확한 값을 쓴다.
     · 예전에 저장된 위치는 쓰지 않는다(maximumAge 0).
   PC 는 GPS 가 없어 인터넷·와이파이로 어림하므로 오차가 크다(화면에 오차를 함께 보여 준다).
   사용: MZGeo.best({ good: 25, maxWait: 10000, onProgress: (pos) => {} }).then((pos) => ..., (err) => ...)
   ============================================================= */
(function () {
  'use strict';

  function best(opts) {
    const o = Object.assign({ good: 30, maxWait: 8000, onProgress: null }, opts || {});
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject({ code: 2, message: '위치 기능 없음' }); return; }
      let top = null, id = null, done = false;
      const finish = (fn, v) => {
        if (done) return;
        done = true;
        if (id != null) navigator.geolocation.clearWatch(id);
        clearTimeout(timer);
        fn(v);
      };
      const timer = setTimeout(() => (top ? finish(resolve, top) : finish(reject, { code: 3, message: '시간 초과' })), o.maxWait);
      id = navigator.geolocation.watchPosition((pos) => {
        if (!top || pos.coords.accuracy < top.coords.accuracy) {
          top = pos;
          if (typeof o.onProgress === 'function') { try { o.onProgress(pos); } catch (e) { /* 무시 */ } }
        }
        if (pos.coords.accuracy <= o.good) finish(resolve, pos);
      }, (err) => {
        // 권한 거부는 바로 알리고, 그 밖의 오류는 받은 값이 있으면 그것을 쓴다
        if (err.code === 1 || !top) finish(reject, err);
        else finish(resolve, top);
      }, { enableHighAccuracy: true, maximumAge: 0, timeout: o.maxWait });
    });
  }

  window.MZGeo = { best };
}());
