-- =============================================================
-- 모기제로 뛰어런 기록 · 랭킹 (Supabase / PostgreSQL)
-- -------------------------------------------------------------
-- 사용법: game-schema.sql · account-schema.sql 다음에 SQL Editor 에 붙여 넣고 실행한다. 여러 번 실행해도 된다.
--         pg_cron 이 켜져 있어야 한다(랭킹 10초마다 다시 만들기 예약이 이 파일 맨 아래에 들어 있다).
--
-- 원칙
--   · 서버에는 달리기 '요약'만 받는다: 시작 시각·시간·거리·걸음·판정 칸 수. 달린 길(GPS 좌표)은 받지 않는다(폰에만 남음).
--   · GPS 를 켜고 뛴 기록만 받는다(거리·보폭으로 흔들기를 거를 수 있어서). GPS 없는 기록은 폰의 개인 기록으로만 남는다.
--   · 서버가 다시 검사한다: 평균 속도, 분당 걸음, 보폭(거리 ÷ 땀 걸음), 판정 칸과 시간의 관계, 하루 상한, 너무 오래된 기록.
--     어긋나면 그 기록을 받지 않고 이유를 돌려준다.
--   · 랭킹은 '이번 주 거리'와 '시즌 누적 거리' 두 가지. 10초마다 표를 다시 만들어 두고 누구나 그 표만 읽는다.
-- =============================================================

create table if not exists public.run_sessions (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  started_at       timestamptz not null,
  duration_s       int not null check (duration_s between 60 and 6 * 3600),
  distance_m       int not null check (distance_m between 0 and 60000),
  sweat_steps      int not null check (sweat_steps >= 0),
  total_steps      int not null check (total_steps >= 0),
  run_windows      int not null default 0,
  shake_windows    int not null default 0,
  vehicle_windows  int not null default 0,
  season           int not null,
  received_at      timestamptz not null default now(),
  unique (user_id, started_at)
);
create index if not exists run_sessions_user_idx on public.run_sessions (user_id, started_at desc);
create index if not exists run_sessions_week_idx on public.run_sessions (started_at);
alter table public.run_sessions enable row level security;
drop policy if exists "내 달리기만 읽기" on public.run_sessions;
create policy "내 달리기만 읽기" on public.run_sessions for select to authenticated using (auth.uid() = user_id);

-- 달리기 보내기: p = { started_at, duration_s, distance_m, sweat_steps, total_steps, run_windows, shake_windows, vehicle_windows }
create or replace function public.submit_run(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid   uuid := auth.uid();
  st    timestamptz;
  dur   int; dist int; sweat int; total int; rw int; sw int; vw int;
  kmh   numeric; spm numeric; stride numeric; today_sweat int;
  kst_day date;
begin
  if uid is null then raise exception 'login required'; end if;
  if not exists (select 1 from public.profiles where id = uid and onboarded_at is not null) then raise exception 'onboarding required'; end if;
  st    := (p ->> 'started_at')::timestamptz;
  dur   := coalesce((p ->> 'duration_s')::int, 0);
  dist  := coalesce((p ->> 'distance_m')::int, 0);
  sweat := coalesce((p ->> 'sweat_steps')::int, 0);
  total := coalesce((p ->> 'total_steps')::int, 0);
  rw    := coalesce((p ->> 'run_windows')::int, 0);
  sw    := coalesce((p ->> 'shake_windows')::int, 0);
  vw    := coalesce((p ->> 'vehicle_windows')::int, 0);

  -- 검사 (사람이 낼 수 없는 기록은 받지 않는다)
  if st is null or st > now() + interval '5 minutes' or st < now() - interval '48 hours' then return jsonb_build_object('ok', false, 'reason', 'time'); end if;
  if dur < 60 or dur > 6 * 3600 or dist < 0 or dist > 60000 then return jsonb_build_object('ok', false, 'reason', 'range'); end if;
  kmh := dist::numeric / dur * 3.6;
  if kmh > 20 then return jsonb_build_object('ok', false, 'reason', 'speed'); end if;                 -- 평균 시속 20km 초과
  if sweat > total or total > dur * 4 then return jsonb_build_object('ok', false, 'reason', 'steps'); end if;   -- 분당 240걸음 초과
  if rw * 10 > dur + 20 then return jsonb_build_object('ok', false, 'reason', 'windows'); end if;    -- 판정 칸이 시간보다 많음
  if sweat > 0 then
    spm := sweat::numeric / greatest(rw * 10, 60) * 60;
    if spm > 230 then return jsonb_build_object('ok', false, 'reason', 'cadence'); end if;
    stride := dist::numeric / sweat;
    if stride < 0.35 or stride > 2.2 then return jsonb_build_object('ok', false, 'reason', 'stride'); end if;  -- 흔들기·잘못된 측정
  end if;
  -- 하루 상한 (한국 시간 기준 30,000 땀 걸음)
  kst_day := (st at time zone 'Asia/Seoul')::date;
  select coalesce(sum(sweat_steps), 0) into today_sweat from public.run_sessions
   where user_id = uid and (started_at at time zone 'Asia/Seoul')::date = kst_day;
  sweat := least(sweat, greatest(0, 30000 - today_sweat));

  insert into public.run_sessions (user_id, started_at, duration_s, distance_m, sweat_steps, total_steps, run_windows, shake_windows, vehicle_windows, season)
  values (uid, st, dur, dist, sweat, total, rw, sw, vw, extract(year from (st at time zone 'Asia/Seoul'))::int)
  on conflict (user_id, started_at) do nothing;
  return jsonb_build_object('ok', true, 'sweat_steps', sweat);
end $$;
revoke all on function public.submit_run(jsonb) from public, anon;
grant execute on function public.submit_run(jsonb) to authenticated;

-- 랭킹 표: period = 'week'(이번 주, 월요일 시작·한국 시간) · 'season'(올해 누적)
create table if not exists public.run_ranking_cache (
  period       text not null check (period in ('week', 'season')),
  rank         int not null,
  nickname     text not null,
  distance_m   int not null,
  sweat_steps  int not null,
  runs         int not null,
  built_at     timestamptz not null default now(),
  primary key (period, rank)
);
alter table public.run_ranking_cache enable row level security;
drop policy if exists "뛰어런 랭킹은 누구나" on public.run_ranking_cache;
create policy "뛰어런 랭킹은 누구나" on public.run_ranking_cache for select to anon, authenticated using (true);

create or replace function public.rebuild_run_ranking()
returns void language plpgsql security definer set search_path = public as $$
declare week_start timestamptz := date_trunc('week', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
        season_start timestamptz := date_trunc('year', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
begin
  delete from public.run_ranking_cache;
  insert into public.run_ranking_cache (period, rank, nickname, distance_m, sweat_steps, runs)
  select 'week', row_number() over (order by sum(r.distance_m) desc, sum(r.sweat_steps) desc)::int, p.nickname,
         sum(r.distance_m)::int, sum(r.sweat_steps)::int, count(*)::int
  from public.run_sessions r join public.profiles p on p.id = r.user_id
  where r.started_at >= week_start and r.sweat_steps > 0
  group by p.nickname
  order by 2 limit 100;
  insert into public.run_ranking_cache (period, rank, nickname, distance_m, sweat_steps, runs)
  select 'season', row_number() over (order by sum(r.distance_m) desc, sum(r.sweat_steps) desc)::int, p.nickname,
         sum(r.distance_m)::int, sum(r.sweat_steps)::int, count(*)::int
  from public.run_sessions r join public.profiles p on p.id = r.user_id
  where r.started_at >= season_start and r.sweat_steps > 0
  group by p.nickname
  order by 2 limit 100;
end $$;

create or replace view public.run_ranking_public as
  select period, rank, nickname, round(distance_m / 1000.0, 2) as distance_km, sweat_steps, runs, built_at
  from public.run_ranking_cache;
grant select on public.run_ranking_public to anon, authenticated;

-- 10초마다 다시 만들기 (pg_cron. 같은 이름이면 덮어쓴다)
select cron.schedule('mz-run-ranking', '10 seconds', $$select public.rebuild_run_ranking()$$);
