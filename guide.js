/* =============================================================
   모기 도감 화면
   -------------------------------------------------------------
   사진 판별 기능은 아직 만들지 않았다.
   버튼을 눌러도 아무 일이 없으면 고장난 것처럼 보이므로,
   '준비 중'이라고 분명히 안내한다.

   실제로 판별하지 않으면서 결과를 보여주는 일은 하지 않는다.
   잘못된 종 이름은 감염병 오해로 이어질 수 있기 때문이다.
   ============================================================= */

document.addEventListener('DOMContentLoaded', () => {
  const notice = document.getElementById('soonNotice');

  document.querySelectorAll('[data-soon]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!notice) return;
      notice.textContent = '사진 판별 기능은 아직 준비 중입니다. 아래 모기 4종과 직접 견주어 보세요.';
      notice.classList.add('is-visible');
    });
  });
});
