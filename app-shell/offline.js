/* 안드로이드 앱 인터넷 끊김 화면: '다시 시도'를 누르면 실제 사이트를 다시 연다 */
document.getElementById('retryButton').addEventListener('click', function () {
  location.href = 'https://mosquito-zero.vercel.app/?source=android';
});
