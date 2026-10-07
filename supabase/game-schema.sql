-- =============================================================
-- 모기제로 회원 · 모기 잡기 기록 · 랭킹 · 배지 (Supabase / PostgreSQL)
-- -------------------------------------------------------------
-- 사용법: Supabase 대시보드 → SQL Editor 에 이 파일을 붙여 넣고 실행한다.
--        (제보 저장용 schema.sql 과는 별개. 둘 다 실행해도 된다.)
--
-- 설계 원칙 (팀장 피드백 2026-10-07: 서버가 터지지 않게, 어뷰징 못 하게)
--   · 브라우저는 공개 키(anon)로 붙고, 쓸 수 있는 건 '내 기록 보내기' 함수 하나뿐이다.
--     표에 직접 insert/update 는 못 한다 (행 단위 보안 RLS + 함수만 security definer).
--   · 기록은 한 마리마다가 아니라 도전이 끝날 때 한 번(여러 건 묶어서) 받는다.
--   · 서버가 검사한다: 하루 도전 횟수, 분당 잡기 상한, 한 마리당 최소 시간, 스테이지 목표 초과, 너무 오래된 기록.
--     어긋나면 그 기록만 버리고(거절 수만 돌려줌) 나머지는 받는다.
--   · 랭킹은 요청마다 계산하지 않고 ranking_cache 표를 5분마다 다시 만든다 (pg_cron). 브라우저는 그 표(보기)만 읽는다.
--   · 개인정보 최소화: 이메일은 auth 가 갖고, 공개되는 건 닉네임뿐. IP·기기 저장 안 함.
--   · 숫자 설정은 game_config 표 한 줄에 둔다. 사이트의 game-config.js 와 값을 맞춘다.
-- =============================================================

-- 0) 설정 (한 줄). 바꾸면 바로 적용된다
create table if not exists public.game_config (
  id                 int primary key default 1 check (id = 1),
  season             int not null default 2026,
  daily_play_limit   int not null default 30,     -- 하루 도전 횟수
  max_kills_per_min  int not null default 150,    -- 한 도전 분당 잡기 상한
  min_ms_per_kill    int not null default 200,    -- 한 마리당 최소 ms
  max_run_hours      int not null default 48,     -- 이보다 오래된 기록은 안 받는다 (오프라인 뒤 보내기 허용 범위)
  stage_targets      int[] not null default '{3,10,30,100,300,1000}',
  badge_needs        int[] not null default '{10,30,60,100,200,350,500,750,1000}',
  badge_ids          text[] not null default '{egg,larva,pupa,adult,culex,tritaen,albo,anoph,aegypti}'
);
insert into public.game_config (id) values (1) on conflict (id) do nothing;

-- 1) 프로필: 닉네임과 역할. auth.users 가 생기면 트리거가 한 줄 만든다
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  nickname    text not null unique check (char_length(nickname) between 2 and 12),
  role        text not null default 'citizen' check (role in ('citizen', 'staff')),   -- staff 는 대시보드에서 직접 바꾼다
  created_at  timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "내 프로필만 읽기" on public.profiles for select to authenticated using (auth.uid() = id);
-- 닉네임 바꾸기는 지금은 막아 둔다(랭킹 혼동 방지). 필요하면 update 정책을 추가한다.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare nick text;
begin
  nick := trim(coalesce(new.raw_user_meta_data ->> 'nickname', ''));
  if char_length(nick) < 2 then nick := '시민' || substr(replace(new.id::text, '-', ''), 1, 6); end if;
  -- 같은 닉네임이 있으면 뒤에 숫자를 붙인다
  while exists (select 1 from public.profiles where nickname = nick) loop
    nick := substr(nick, 1, 9) || lpad((floor(random() * 999))::int::text, 3, '0');
  end loop;
  insert into public.profiles (id, nickname) values (new.id, nick);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- 2) 도전 기록 (한 도전 = 한 줄). 브라우저는 직접 못 쓰고 submit_game_runs 함수만 쓴다
create table if not exists public.game_runs (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  season       int not null,
  stage        int not null check (stage between 1 and 10),
  kills        int not null check (kills between 0 and 5000),
  duration_ms  int not null check (duration_ms between 0 and 3600000),
  success      boolean not null,
  played_at    timestamptz not null,
  received_at  timestamptz not null default now()
);
create index if not exists game_runs_user_day_idx on public.game_runs (user_id, received_at desc);
alter table public.game_runs enable row level security;
create policy "내 기록만 읽기" on public.game_runs for select to authenticated using (auth.uid() = user_id);

-- 3) 시즌 누적 (사용자당 시즌당 한 줄). 함수가 더해 나간다
create table if not exists public.game_scores (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  season       int not null,
  total_kills  int not null default 0,
  best_stage   int not null default 0,
  runs         int not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (user_id, season)
);
alter table public.game_scores enable row level security;
create policy "내 누적만 읽기" on public.game_scores for select to authenticated using (auth.uid() = user_id);

-- 4) 배지 (받은 것만 한 줄씩)
create table if not exists public.user_badges (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  badge_id   text not null,
  earned_at  timestamptz not null default now(),
  primary key (user_id, badge_id)
);
alter table public.user_badges enable row level security;
create policy "내 배지만 읽기" on public.user_badges for select to authenticated using (auth.uid() = user_id);

-- 5) 기록 보내기 함수. 브라우저(auth.js submitRuns)가 호출한다. 돌려주는 값:
--    { accepted, rejected, total_kills, best_stage, badges[] }
create or replace function public.submit_game_runs(p_runs jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cfg      public.game_config%rowtype;
  uid      uuid := auth.uid();
  r        jsonb;
  st       int; k int; ms int; ok boolean; at timestamptz;
  today_n  int;
  acc      int := 0; rej int := 0;
  sc       public.game_scores%rowtype;
  i        int;
  new_badges text[] := '{}';
begin
  if uid is null then raise exception 'login required'; end if;
  select * into cfg from public.game_config where id = 1;
  if jsonb_typeof(p_runs) <> 'array' or jsonb_array_length(p_runs) > 20 then raise exception 'bad payload'; end if;

  -- 오늘 받은 도전 수 (서울 시간 기준 하루)
  select count(*) into today_n from public.game_runs
   where user_id = uid and received_at >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';

  for r in select * from jsonb_array_elements(p_runs) loop
    st := coalesce((r ->> 'stage')::int, 0);
    k  := coalesce((r ->> 'kills')::int, 0);
    ms := coalesce((r ->> 'duration_ms')::int, 0);
    ok := coalesce((r ->> 'success')::boolean, false);
    at := coalesce((r ->> 'played_at')::timestamptz, now());
    -- 검사: 하루 횟수 · 단계 범위 · 목표 초과 · 분당 상한 · 마리당 최소 시간 · 너무 오래된 기록
    if today_n >= cfg.daily_play_limit
       or st < 1 or st > array_length(cfg.stage_targets, 1)
       or k < 0 or k > cfg.stage_targets[st]
       or ms < k * cfg.min_ms_per_kill
       or (ms > 0 and k::numeric / greatest(ms, 1) * 60000 > cfg.max_kills_per_min)
       or at < now() - make_interval(hours => cfg.max_run_hours) or at > now() + interval '10 minutes'
    then rej := rej + 1; continue; end if;
    insert into public.game_runs (user_id, season, stage, kills, duration_ms, success, played_at)
    values (uid, cfg.season, st, k, ms, ok, at);
    acc := acc + 1; today_n := today_n + 1;
    insert into public.game_scores (user_id, season, total_kills, best_stage, runs)
    values (uid, cfg.season, k, case when ok then st else 0 end, 1)
    on conflict (user_id, season) do update
      set total_kills = public.game_scores.total_kills + excluded.total_kills,
          best_stage  = greatest(public.game_scores.best_stage, excluded.best_stage),
          runs        = public.game_scores.runs + 1,
          updated_at  = now();
  end loop;

  select * into sc from public.game_scores where user_id = uid and season = cfg.season;
  -- 배지: 누적이 기준에 닿은 것 중 아직 없는 것
  if sc.user_id is not null then
    for i in 1 .. array_length(cfg.badge_needs, 1) loop
      if sc.total_kills >= cfg.badge_needs[i] then
        insert into public.user_badges (user_id, badge_id) values (uid, cfg.badge_ids[i]) on conflict do nothing;
      end if;
    end loop;
    select coalesce(array_agg(badge_id), '{}') into new_badges from public.user_badges where user_id = uid;
  end if;

  return jsonb_build_object('accepted', acc, 'rejected', rej,
    'total_kills', coalesce(sc.total_kills, 0), 'best_stage', coalesce(sc.best_stage, 0), 'badges', to_jsonb(new_badges));
end $$;
revoke all on function public.submit_game_runs(jsonb) from public;
grant execute on function public.submit_game_runs(jsonb) to authenticated;

-- 6) 랭킹: 5분마다 만들어 두는 표 + 누구나 읽는 보기
create table if not exists public.ranking_cache (
  season       int not null,
  rank         int not null,
  nickname     text not null,
  total_kills  int not null,
  best_stage   int not null,
  badge_count  int not null,
  built_at     timestamptz not null default now(),
  primary key (season, rank)
);
alter table public.ranking_cache enable row level security;
create policy "랭킹은 누구나" on public.ranking_cache for select to anon, authenticated using (true);

create or replace function public.rebuild_ranking()
returns void language sql security definer set search_path = public as $$
  delete from public.ranking_cache;
  insert into public.ranking_cache (season, rank, nickname, total_kills, best_stage, badge_count)
  select s.season,
         row_number() over (partition by s.season order by s.total_kills desc, s.best_stage desc, s.updated_at asc)::int,
         p.nickname, s.total_kills, s.best_stage,
         (select count(*)::int from public.user_badges b where b.user_id = s.user_id)
  from public.game_scores s join public.profiles p on p.id = s.user_id
  where s.total_kills > 0;
$$;
create or replace view public.ranking_public as
  select season, rank, nickname, total_kills, best_stage, badge_count, built_at from public.ranking_cache;
grant select on public.ranking_public to anon, authenticated;

-- 5분마다 랭킹 다시 만들기 (대시보드 → Database → Extensions 에서 pg_cron 을 켠 뒤 실행)
-- select cron.schedule('mz-ranking', '*/5 * * * *', $$select public.rebuild_ranking()$$);

-- 직원 지정 (대시보드 SQL 에서): update public.profiles set role = 'staff' where nickname = '닉네임';
