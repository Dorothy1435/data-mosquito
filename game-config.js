/* =============================================================
   모기제로 모기 잡기 설정 (game-config.js)
   -------------------------------------------------------------
   게임·배지·보상·어뷰징 방지에 쓰는 숫자를 한 곳에 모았다.
   팀장 피드백(2026-10-07)에서 아직 정해지지 않은 값(보상 금액·범위, 하루 제한 등)은 여기만 고치면 된다.
   ※ 서버 쪽 검증값(하루 횟수, 분당 잡기 상한, 배지 기준)은 supabase/game-schema.sql 의 game_config 표와 같아야 한다.
   ============================================================= */
window.MZ_GAME_CONFIG = {
  // 시즌(연말 정산 단위). 랭킹·배지는 이 해 기준으로 모은다
  SEASON: 2026,

  // 스테이지: 목표 마리 수와 제한 시간(초). 순서대로 1단계, 2단계 …
  STAGES: [
    { target: 3, seconds: 20 },
    { target: 10, seconds: 40 },
    { target: 30, seconds: 75 },
    { target: 100, seconds: 150 },
    { target: 300, seconds: 300 },
    { target: 1000, seconds: 600 },
  ],

  // 오늘 모기지수 단계(0 매우 낮음 … 4 매우 높음)에 따라 열리는 스테이지 수.
  // 모기가 많은 날일수록 더 높은 단계까지 열리고, '매우 높음'인 날에만 1,000마리 단계가 열린다
  OPEN_STAGES_BY_LEVEL: [3, 3, 4, 5, 6],

  // 스테이지별 난이도. 뒤로 갈수록 마리 수가 많고, 더 멀리서 더 빠르게 도망가며, 명중 범위가 좁아진다
  //   count 동시에 떠 있는 마리 수 · flee 도망 시작 거리(px) · push 도망 세기 · jink 옆으로 꺾는 세기
  //   vmax 최고 속도 · hit 명중 반경 배율(1 = 기본)
  DIFFICULTY: [
    { count: 2, flee: 190, push: 2.6, jink: 0.7, vmax: 7.5, hit: 1 },
    { count: 3, flee: 220, push: 3.0, jink: 0.85, vmax: 9, hit: 1 },
    { count: 4, flee: 250, push: 3.4, jink: 1.0, vmax: 10.5, hit: 0.95 },
    { count: 6, flee: 270, push: 3.8, jink: 1.1, vmax: 12, hit: 0.9 },
    { count: 8, flee: 290, push: 4.2, jink: 1.2, vmax: 13.5, hit: 0.85 },
    { count: 10, flee: 310, push: 4.6, jink: 1.3, vmax: 15, hit: 0.8 },
  ],
  // 자유 모드(도전 아닌 평소): 오늘 단계별 마리 수. 휴대폰은 작은 화면이라 조금 적게
  FREE_COUNT_BY_LEVEL: [1, 2, 3, 5, 8],
  FREE_COUNT_BY_LEVEL_MOBILE: [1, 1, 2, 3, 5],
  MOBILE_COUNT_SCALE: 0.7,   // 도전 모드에서 휴대폰 동시 마리 수 배율

  // 명중 반경(px). 이 거리 안에 뿌리면 잡힌다. 휴대폰은 손가락이라 조금 넓게 (2026-10-08: 70/56 → 60/46, 너무 쉽다는 의견)
  HIT_RADIUS: { mobile: 60, desktop: 46 },

  // 모기약 통 (%). 꾹 누르고 문지르면 다 잡히던 문제를 막는다 (2026-10-08)
  //   한 번 뿌릴 때 cost 만큼 줄고, 1초에 refill 만큼 다시 찬다. 바닥나면 lockMs 동안 못 뿌린다
  SPRAY: { cost: 12, refill: 32, lockMs: 1000 },

  // 특수 이벤트 (2026-10-08 "특수한 이벤트도 없다" 피드백)
  EVENTS: {
    // 황금 모기: 가끔 나오는 빠른 금빛 모기. 도전 중에 잡으면 제한 시간 +bonusSec
    golden: { chanceRun: 0.08, chanceFree: 0.04, bonusSec: 5, speed: 1.3 },
    // 연속 잡기: within ms 안에 이어서 잡으면 콤보. every 콤보마다 도전 시간 +bonusSec
    combo: { withinMs: 1300, every: 5, bonusSec: 2 },
    // 모기떼 습격: fromStage 단계부터, 목표의 20%를 넘기면 가끔 ms 동안 extra 마리가 더 몰려온다 (1초마다 chance 확률)
    swarm: { fromStage: 3, chance: 0.05, extra: 3, ms: 6000, speed: 1.15 },
    // 여왕 모기: fromStage 단계부터 마지막 한 마리는 크고 질긴 여왕 모기. hits 번 맞혀야 잡힌다
    queen: { fromStage: 2, hits: 3 },
    // 해질녘: 실제 시각이 이 시간대면 자유 모드 모기가 extra 마리 더 (모기는 해 질 무렵 가장 활발 — 앱 안내와 같은 이야기)
    dusk: { from: 18, to: 20, extra: 1 },
    // 갑자기 꺾기: 손가락이 가까이 없어도 가끔 휙 방향을 튼다 (휴대폰은 손가락이 닿기 전엔 모기가 피할 수 없어 쉬웠다)
    dart: { minMs: 900, maxMs: 2200, power: 5 },
  },

  // 수집형 배지: 누적으로 잡은 수가 need 에 닿으면 받는다. 알 → 장구벌레 → … → 세계적 모기 순으로 자란다
  BADGES: [
    { id: 'egg', name: '알', need: 10, title: '알 수집가', text: '모기는 고인 물 위에 알을 낳아요. 알 10개 분량, 첫 배지예요.' },
    { id: 'larva', name: '장구벌레', need: 30, title: '장구벌레 사냥꾼', text: '물속에서 꼬물거리는 모기 유충이에요. 고인 물을 비우면 여기서 끝낼 수 있어요.' },
    { id: 'pupa', name: '번데기', need: 60, title: '번데기 감시자', text: '쉼표처럼 생긴 번데기. 이틀이면 날개 달린 모기가 돼요.' },
    { id: 'adult', name: '모기', need: 100, title: '모기 박멸 요원', text: '100마리! 김해 모기 박멸 요원으로 임명합니다.' },
    { id: 'culex', name: '빨간집모기', need: 200, title: '집모기 반장', text: '집 안에서 밤에 윙윙거리는 바로 그 모기. 가장 흔한 종류예요.' },
    { id: 'tritaen', name: '작은빨간집모기', need: 350, title: '뇌염 파수꾼', text: '일본뇌염을 옮길 수 있는 모기. 논·축사 근처에 많아요.' },
    { id: 'albo', name: '흰줄숲모기', need: 500, title: '숲모기 추격자', text: '검은 몸에 흰 줄. 낮에도 물고 뎅기열을 옮길 수 있어요.' },
    { id: 'anoph', name: '얼룩날개모기', need: 750, title: '말라리아 방어선', text: '날개에 얼룩, 엉덩이를 치켜들고 앉아요. 말라리아 매개 모기.' },
    { id: 'aegypti', name: '이집트숲모기', need: 1000, title: '모기 박멸 전설', text: '세계에서 가장 유명한 모기. 1,000마리, 전설입니다.' },
  ],

  // 연말 정산 보상 (팀장 피드백: 1~10위 2만 원 등 — 금액·범위는 운영 기관 확정 전). 확정되면 여기만 고친다
  REWARD_TIERS: [
    { from: 1, to: 10, prize: '상품권 2만 원 (예시, 미확정)' },
    { from: 11, to: 50, prize: '상품권 1만 원 (예시, 미확정)' },
    { from: 51, to: 100, prize: '기념품 (예시, 미확정)' },
  ],
  REWARD_NOTE: '12월에 시즌 누적 잡은 수와 배지로 순위를 정산해요. 보상 금액과 범위는 운영 기관이 확정하면 여기에 올려요.',

  // 어뷰징 방지 (서버의 game_config 와 같은 값이어야 한다)
  DAILY_PLAY_LIMIT: 30,      // 하루 도전 횟수
  MAX_KILLS_PER_MIN: 150,    // 한 도전에서 분당 잡기 상한. 넘으면 기록으로 안 쳐준다
  MIN_MS_PER_KILL: 200,      // 한 마리 잡는 데 걸리는 최소 시간(ms)

  // 이름 (팀장 피드백: 시민용 화면 이름은 미정 → 설정값)
  CITIZEN_PAGE_NAME: '자세히 보기',

  // 서버: 공개 설정(Supabase 주소·공개 키)을 주는 주소. 로컬에서는 config.js 의 window.MOSQUITO_CONFIG.supabase 로 대신할 수 있다
  PUBLIC_CONFIG_URL: '/api/public-config',
};
