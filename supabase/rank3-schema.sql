-- =============================================================
-- 모기제로 랭킹 3가지 (2026-10-21): 모기 잡기 · 뛰어런(주·달·시즌) · 희귀 모기 사진
-- -------------------------------------------------------------
-- 사용법: run-schema.sql · photo-schema.sql 다음에 실행한다. 여러 번 실행해도 된다. pg_cron 필요.
--
-- 희귀 모기 사진 랭킹
--   · 시민이 '기증'한 사진 중 직원이 확인(review = 'confirmed')한 것만 센다 — AI 판별만으로는 세지 않는다
--   · 희귀 모기 = 감염병을 옮기는 종 (얼룩날개모기: 말라리아 · 작은빨간집모기·빨간집모기: 일본뇌염)
--     종 목록은 rare_species 에서 바꾼다 (보건소 결정 전 기본값)
--   · 올해(시즌) 누적, 10초마다 다시 만든다
-- =============================================================

-- 1) 뛰어런: '이번 달' 추가
alter table public.run_ranking_cache drop constraint if exists run_ranking_cache_period_check;
alter table public.run_ranking_cache add constraint run_ranking_cache_period_check check (period in ('week', 'month', 'season'));

create or replace function public.rebuild_run_ranking()
returns void language plpgsql security definer set search_path = public as $$
declare p text; since timestamptz;
begin
  delete from public.run_ranking_cache;
  foreach p in array array['week', 'month', 'season'] loop
    since := date_trunc(case p when 'week' then 'week' when 'month' then 'month' else 'year' end, now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
    insert into public.run_ranking_cache (period, rank, nickname, distance_m, sweat_steps, runs)
    select p, row_number() over (order by sum(r.distance_m) desc, sum(r.sweat_steps) desc)::int, pr.nickname,
           sum(r.distance_m)::int, sum(r.sweat_steps)::int, count(*)::int
      from public.run_sessions r join public.profiles pr on pr.id = r.user_id
     where r.started_at >= since and r.sweat_steps > 0
     group by pr.nickname
     order by 2 limit 100;
  end loop;
end $$;

-- 2) 희귀 모기 사진 랭킹
create table if not exists public.rare_species (name text primary key);
insert into public.rare_species (name) values ('얼룩날개모기'), ('작은빨간집모기'), ('빨간집모기') on conflict do nothing;
alter table public.rare_species enable row level security;
drop policy if exists "희귀 모기 목록은 누구나" on public.rare_species;
create policy "희귀 모기 목록은 누구나" on public.rare_species for select to anon, authenticated using (true);

create table if not exists public.photo_ranking_cache (
  rank      int primary key,
  nickname  text not null,
  photos    int not null,          -- 확인된 희귀 모기 사진 수
  kinds     text not null,         -- 종류별 수 (예: 얼룩날개모기 3 · 빨간집모기 1)
  built_at  timestamptz not null default now()
);
alter table public.photo_ranking_cache enable row level security;
drop policy if exists "사진 랭킹은 누구나" on public.photo_ranking_cache;
create policy "사진 랭킹은 누구나" on public.photo_ranking_cache for select to anon, authenticated using (true);

create or replace function public.rebuild_photo_ranking()
returns void language plpgsql security definer set search_path = public as $$
declare since timestamptz := date_trunc('year', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
begin
  delete from public.photo_ranking_cache;
  insert into public.photo_ranking_cache (rank, nickname, photos, kinds)
  select row_number() over (order by count(*) desc, max(d.reviewed_at) asc)::int, p.nickname, count(*)::int,
         (select string_agg(x.label || ' ' || x.n, ' · ' order by x.n desc)
            from (select d2.label, count(*) as n from public.photo_donations d2
                   where d2.user_id = d.user_id and d2.review = 'confirmed' and d2.created_at >= since
                     and d2.label in (select name from public.rare_species) group by d2.label) x)
    from public.photo_donations d join public.profiles p on p.id = d.user_id
   where d.review = 'confirmed' and d.created_at >= since and d.label in (select name from public.rare_species)
   group by d.user_id, p.nickname
   order by 1 limit 100;
end $$;

create or replace view public.photo_ranking_public as
  select rank, nickname, photos, kinds, built_at from public.photo_ranking_cache;
grant select on public.photo_ranking_public to anon, authenticated;

select cron.schedule('mz-run-ranking', '10 seconds', $$select public.rebuild_run_ranking()$$);
select cron.schedule('mz-photo-ranking', '10 seconds', $$select public.rebuild_photo_ranking()$$);

-- 3) 데이터 뽑기: 희귀 모기 사진 상위 10명 + 연락처 (상품 지급용), 뛰어런 이번 달
create schema if not exists report;
create or replace view report."상품_희귀모기사진" as
select pr.rank as 순위, pr.nickname as 닉네임, c.real_name as 이름, c.phone as 휴대폰, pr.photos as 사진수, pr.kinds as 종류
  from public.photo_ranking_cache pr
  join public.profiles p on p.nickname = pr.nickname
  left join public.member_contacts c on c.user_id = p.id
 order by pr.rank limit 10;
create or replace view report."상품_뛰어런_이번달" as
select r.rank as 순위, r.nickname as 닉네임, c.real_name as 이름, c.phone as 휴대폰, round(r.distance_m / 1000.0, 1) as 거리_km, r.runs as 횟수
  from public.run_ranking_cache r
  join public.profiles p on p.nickname = r.nickname
  left join public.member_contacts c on c.user_id = p.id
 where r.period = 'month'
 order by r.rank limit 10;
revoke all on all tables in schema report from public, anon, authenticated;
notify pgrst, 'reload schema';
