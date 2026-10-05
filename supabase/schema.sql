-- =============================================================
-- 모기제로 시민 제보 저장소 (Supabase / PostgreSQL)
-- -------------------------------------------------------------
-- 사용법: Supabase 대시보드 → SQL Editor 에 이 파일 내용을 붙여 넣고 실행한다.
--
-- 원칙 (Mosquito Alert 운영 방식 참고)
--   · 누가 보냈는지 저장하지 않는다. 이름·전화번호·IP·기기 정보 없음.
--   · 위치는 받자마자 서버에서 소수 셋째 자리(약 100m)로 반올림해 저장한다. 정확한 GPS 는 저장하지 않는다.
--   · 공개 지도에는 동(洞) 단위로 묶은 개수만 내보낸다 (reports_public 보기).
--   · 사진은 저장하지 않는다. AI 판별 결과(이름표)만 선택적으로 남긴다.
--   · 보관 기간이 지나면 지운다 (아래 purge_old_reports, 기본 1년 — 보건소가 확정).
--   · 브라우저(anon 키)는 이 표에 직접 접근할 수 없다. 서버 함수(api/report.js)만 service role 키로 쓴다.
--
-- 이 저장 기능은 위치정보법 절차(위치기반서비스사업 신고, 개인위치정보 이용약관·동의)를
-- 마친 뒤 Vercel 환경변수 REPORT_STORE_ENABLED=1 로 켠다. 켜기 전에는 서버가 아무것도 저장하지 않는다.
-- =============================================================

create table if not exists public.reports (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  kind          text not null check (kind in ('mosquito', 'bite', 'breeding')),   -- 모기 봤어요 · 물렸어요 · 고인 물 발견
  lat           numeric(7, 3) not null check (lat between 35.13 and 35.40),       -- 약 100m 로 반올림한 값
  lng           numeric(7, 3) not null check (lng between 128.68 and 129.05),
  district      text not null,                                                    -- 김해 17개 읍·면·동 중 가장 가까운 곳
  source        text not null check (source in ('gps', 'pick')),                  -- GPS 동의 / 동네 직접 선택
  photo_label   text check (photo_label in ('흰줄숲모기', '얼룩날개모기', '집모기류', '모기 아님', '알 수 없음')),
  -- 보건소 확인 (Mosquito Alert 의 confirmed / probable / not sure 와 같은 3단계 + 반려)
  review        text not null default 'new' check (review in ('new', 'confirmed', 'probable', 'unsure', 'rejected')),
  reviewed_at   timestamptz,
  review_note   text check (char_length(review_note) <= 300)
);

create index if not exists reports_created_idx on public.reports (created_at desc);
create index if not exists reports_district_idx on public.reports (district, created_at desc);

-- 행 단위 보안: 정책을 하나도 만들지 않으므로 anon·authenticated 키로는 읽기·쓰기 모두 막힌다.
-- service role 키(서버 함수 전용)는 RLS 를 우회하므로 서버만 쓸 수 있다.
alter table public.reports enable row level security;

-- 공개 지도용: 최근 14일, 동 단위 개수만 (반려된 제보 제외)
create or replace view public.reports_public as
  select district, kind, count(*)::int as n, max(created_at) as last_at
  from public.reports
  where created_at > now() - interval '14 days' and review <> 'rejected'
  group by district, kind;

-- 보관 기간이 지난 제보 지우기 (Supabase → Database → Cron 에서 매일 실행하도록 등록)
create or replace function public.purge_old_reports(keep interval default interval '1 year')
returns int language sql security definer as $$
  with d as (delete from public.reports where created_at < now() - keep returning 1)
  select count(*)::int from d;
$$;
