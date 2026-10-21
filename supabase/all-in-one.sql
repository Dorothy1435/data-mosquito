-- 모기제로 DB 한 번에 만들기 (game → account → contact → schema → limits → run → photo → admin → free-play → user-data → report → rank3 순서). 여러 번 실행해도 된다. pg_cron 이 켜져 있어야 한다.

-- ======================= game-schema.sql =======================
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
--   · 랭킹은 요청마다 계산하지 않고 ranking_cache 표를 10초마다 다시 만든다 (pg_cron). 브라우저는 그 표(보기)만 읽는다.
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
-- 브라우저(anon·authenticated)가 규칙 값을 바꾸지 못하게 행 단위 보안을 켠다. 정책이 없으므로 읽기·쓰기 모두 막히고,
-- 검증 함수(submit_game_runs, security definer)만 이 표를 읽는다.
alter table public.game_config enable row level security;

-- 1) 프로필: 닉네임과 역할. auth.users 가 생기면 트리거가 한 줄 만든다
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  nickname    text not null unique check (char_length(nickname) between 2 and 12),
  role        text not null default 'citizen' check (role in ('citizen', 'staff')),   -- staff 는 대시보드에서 직접 바꾼다
  created_at  timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "내 프로필만 읽기" on public.profiles;
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
drop policy if exists "내 기록만 읽기" on public.game_runs;
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
drop policy if exists "내 누적만 읽기" on public.game_scores;
create policy "내 누적만 읽기" on public.game_scores for select to authenticated using (auth.uid() = user_id);

-- 4) 배지 (받은 것만 한 줄씩)
create table if not exists public.user_badges (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  badge_id   text not null,
  earned_at  timestamptz not null default now(),
  primary key (user_id, badge_id)
);
alter table public.user_badges enable row level security;
drop policy if exists "내 배지만 읽기" on public.user_badges;
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

-- 6) 랭킹: 10초마다 만들어 두는 표 + 누구나 읽는 보기
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
drop policy if exists "랭킹은 누구나" on public.ranking_cache;
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

-- 10초마다 랭킹 다시 만들기 (대시보드 → Database → Extensions 에서 pg_cron 을 켠 뒤 실행). 보는 사람 수와 상관없이 부담이 일정하다
-- select cron.schedule('mz-ranking', '10 seconds', $$select public.rebuild_ranking()$$);

-- 직원 지정 (대시보드 SQL 에서): update public.profiles set role = 'staff' where nickname = '닉네임';

-- ======================= account-schema.sql =======================
-- =============================================================
-- 모기제로 계정 기능: 동의 기록 · 가입 마무리 · 닉네임 변경 · 계정 삭제 (Supabase / PostgreSQL)
-- -------------------------------------------------------------
-- 사용법: game-schema.sql 을 먼저 실행한 뒤, SQL Editor 에 이 파일을 붙여 넣고 실행한다. 여러 번 실행해도 된다.
--
-- 원칙
--   · 동의는 '언제, 무엇에, 어느 판(버전)에' 동의했는지 줄로 쌓는다. 철회도 지우지 않고 '동의 안 함' 줄을 더한다(증빙용).
--   · 동의 기록에는 IP·기기 정보를 넣지 않는다.
--   · 브라우저는 표에 직접 쓰지 못하고, 아래 함수(security definer)로만 쓴다. 함수는 자기 계정(auth.uid())에만 쓴다.
--   · 계정 삭제는 auth.users 에서 지우면 profiles → 게임 기록 → 배지 → 동의 기록까지 연쇄로 지워진다(on delete cascade).
--   · 구글·카카오 가입자는 실명이 닉네임으로 공개되지 않게, 가입 때 임시 닉네임을 주고 '가입 마무리'에서 직접 정하게 한다.
-- =============================================================

-- 1) 프로필에 칸 추가
alter table public.profiles add column if not exists onboarded_at timestamptz;          -- 필수 동의·닉네임을 마친 시각 (없으면 '가입 마무리' 화면)
alter table public.profiles add column if not exists nickname_changed_at timestamptz;   -- 닉네임은 30일에 한 번만 바꿀 수 있다 (랭킹 혼동 방지)

-- 2) 동의 기록
create table if not exists public.consents (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('age14', 'terms', 'privacy', 'location', 'motion', 'photo_points')),
  version     text not null,              -- 약관·방침 판 (예: '2026-10-20')
  agreed      boolean not null,
  created_at  timestamptz not null default now()
);
create index if not exists consents_user_idx on public.consents (user_id, kind, created_at desc);
alter table public.consents enable row level security;
drop policy if exists "내 동의 기록만 읽기" on public.consents;
create policy "내 동의 기록만 읽기" on public.consents for select to authenticated using (auth.uid() = user_id);

-- 지금 유효한 동의 (종류마다 가장 최근 줄)
create or replace view public.my_consents with (security_invoker = true) as
  select distinct on (kind) kind, version, agreed, created_at
  from public.consents where user_id = auth.uid()
  order by kind, created_at desc;
grant select on public.my_consents to authenticated;

-- 동의 남기기: p_items = [{"kind":"terms","version":"2026-10-20","agreed":true}, ...]
create or replace function public.record_consents(p_items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare it jsonb;
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 10 then raise exception 'bad items'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    insert into public.consents (user_id, kind, version, agreed)
    values (auth.uid(), it ->> 'kind', left(coalesce(it ->> 'version', ''), 20), coalesce((it ->> 'agreed')::boolean, false));
  end loop;
end $$;
revoke all on function public.record_consents(jsonb) from public, anon;
grant execute on function public.record_consents(jsonb) to authenticated;

-- 3) 닉네임 규칙 검사 (2~12자, 한글·영문·숫자·_ 만, 운영자 사칭 금지)
create or replace function public.valid_nickname(p text)
returns boolean language sql immutable as $$
  select char_length(p) between 2 and 12
     and p ~ '^[가-힣A-Za-z0-9_]+$'
     and p !~* '(관리자|운영자|보건소|admin|staff|모기제로)';
$$;

-- 4) 가입 마무리: 닉네임 + 필수 동의(만 14세 이상 · 이용약관 · 개인정보) 를 한 번에
create or replace function public.finish_onboarding(p_nickname text, p_items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare nick text := trim(coalesce(p_nickname, ''));
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  if not public.valid_nickname(nick) then raise exception 'nickname invalid'; end if;
  if exists (select 1 from public.profiles where nickname = nick and id <> auth.uid()) then raise exception 'nickname duplicate'; end if;
  if not (select bool_and(coalesce((e ->> 'agreed')::boolean, false))
          from jsonb_array_elements(p_items) e where e ->> 'kind' in ('age14', 'terms', 'privacy'))
     or (select count(distinct e ->> 'kind') from jsonb_array_elements(p_items) e where e ->> 'kind' in ('age14', 'terms', 'privacy')) < 3
  then raise exception 'required consent missing'; end if;
  perform public.record_consents(p_items);
  update public.profiles set nickname = nick, onboarded_at = now() where id = auth.uid();
end $$;
revoke all on function public.finish_onboarding(text, jsonb) from public, anon;
grant execute on function public.finish_onboarding(text, jsonb) to authenticated;

-- 5) 닉네임 바꾸기 (30일에 한 번)
create or replace function public.change_nickname(p_nickname text)
returns void language plpgsql security definer set search_path = public as $$
declare nick text := trim(coalesce(p_nickname, '')); last timestamptz;
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  if not public.valid_nickname(nick) then raise exception 'nickname invalid'; end if;
  select nickname_changed_at into last from public.profiles where id = auth.uid();
  if last is not null and last > now() - interval '30 days' then raise exception 'nickname cooldown'; end if;
  if exists (select 1 from public.profiles where nickname = nick and id <> auth.uid()) then raise exception 'nickname duplicate'; end if;
  update public.profiles set nickname = nick, nickname_changed_at = now() where id = auth.uid();
end $$;
revoke all on function public.change_nickname(text) from public, anon;
grant execute on function public.change_nickname(text) to authenticated;

-- 6) 계정 삭제: 로그인 계정과 모든 기록을 바로 지운다 (되돌릴 수 없음)
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  delete from auth.users where id = auth.uid();   -- profiles 이하 연쇄 삭제
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- 7) 새 회원 트리거 바꾸기: 이메일 가입은 적은 닉네임을, 구글·카카오 가입은 임시 닉네임을 쓴다
--    (구글·카카오가 주는 이름은 실명일 수 있어 랭킹에 공개하지 않는다)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare nick text;
begin
  nick := case when coalesce(new.raw_app_meta_data ->> 'provider', 'email') = 'email'
               then trim(coalesce(new.raw_user_meta_data ->> 'nickname', '')) else '' end;
  if not public.valid_nickname(nick) then nick := '시민' || substr(replace(new.id::text, '-', ''), 1, 6); end if;
  while exists (select 1 from public.profiles where nickname = nick) loop
    nick := substr(nick, 1, 9) || lpad((floor(random() * 999))::int::text, 3, '0');
  end loop;
  insert into public.profiles (id, nickname) values (new.id, nick);
  return new;
end $$;

-- 8) 게임 기록은 가입 마무리(필수 동의)를 마친 계정만 받는다
--    submit_game_runs 앞에 문지기 함수를 둔다. 브라우저는 이 함수를 부른다(auth.js).
create or replace function public.submit_game_runs_checked(p_runs jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and onboarded_at is not null) then
    raise exception 'onboarding required';
  end if;
  return public.submit_game_runs(p_runs);
end $$;
revoke all on function public.submit_game_runs_checked(jsonb) from public, anon;
grant execute on function public.submit_game_runs_checked(jsonb) to authenticated;
revoke execute on function public.submit_game_runs(jsonb) from authenticated;   -- 이제 문지기 함수로만

-- ======================= contact-schema.sql =======================
-- =============================================================
-- 모기제로 회원 이름 · 휴대폰 번호 (상품 지급·본인 확인 연락용)
-- -------------------------------------------------------------
-- 사용법: account-schema.sql 다음에 SQL Editor 에 붙여 넣고 실행한다. 여러 번 실행해도 된다.
--
-- 원칙
--   · 회원 표(profiles)와 분리된 표에 둔다. 본인만 읽을 수 있고, 다른 회원·직원 화면에는 나오지 않는다.
--     (상품 지급 때 운영 기관이 대시보드에서만 확인한다)
--   · 휴대폰 번호는 한 번호에 한 계정만 (여러 계정으로 랭킹을 올리는 것 막기).
--   · verified: 휴대폰 본인인증(PASS 등)을 붙이면 true 로 바뀐다. 지금은 본인이 적은 값이라 false.
--   · 계정을 지우면 함께 지워진다(on delete cascade).
-- =============================================================

create table if not exists public.member_contacts (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  real_name   text not null check (char_length(real_name) between 2 and 20),
  phone       text not null unique check (phone ~ '^01[016789][0-9]{7,8}$'),   -- 숫자만 (010xxxxxxxx)
  verified    boolean not null default false,
  updated_at  timestamptz not null default now()
);
alter table public.member_contacts enable row level security;
drop policy if exists "내 연락처만 읽기" on public.member_contacts;
create policy "내 연락처만 읽기" on public.member_contacts for select to authenticated using (auth.uid() = user_id);

-- 이름·휴대폰 저장 (가입·가입 마무리·계정 관리에서). 같은 번호가 다른 계정에 있으면 거절
create or replace function public.set_contact(p_name text, p_phone text)
returns void language plpgsql security definer set search_path = public as $$
declare nm text := trim(coalesce(p_name, '')); ph text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  if char_length(nm) < 2 or char_length(nm) > 20 or nm !~ '^[가-힣A-Za-z ]+$' then raise exception 'name invalid'; end if;
  if ph !~ '^01[016789][0-9]{7,8}$' then raise exception 'phone invalid'; end if;
  if exists (select 1 from public.member_contacts where phone = ph and user_id <> auth.uid()) then raise exception 'phone duplicate'; end if;
  insert into public.member_contacts (user_id, real_name, phone, verified, updated_at)
  values (auth.uid(), nm, ph, false, now())
  on conflict (user_id) do update set real_name = excluded.real_name, phone = excluded.phone, verified = false, updated_at = now();
end $$;
revoke all on function public.set_contact(text, text) from public, anon;
grant execute on function public.set_contact(text, text) to authenticated;

-- 가입 마무리에 이름·휴대폰도 필수로 (account-schema.sql 의 finish_onboarding 을 덮어쓴다)
create or replace function public.finish_onboarding(p_nickname text, p_items jsonb, p_name text default null, p_phone text default null)
returns void language plpgsql security definer set search_path = public as $$
declare nick text := trim(coalesce(p_nickname, ''));
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  if not public.valid_nickname(nick) then raise exception 'nickname invalid'; end if;
  if exists (select 1 from public.profiles where nickname = nick and id <> auth.uid()) then raise exception 'nickname duplicate'; end if;
  if not (select bool_and(coalesce((e ->> 'agreed')::boolean, false))
          from jsonb_array_elements(p_items) e where e ->> 'kind' in ('age14', 'terms', 'privacy'))
     or (select count(distinct e ->> 'kind') from jsonb_array_elements(p_items) e where e ->> 'kind' in ('age14', 'terms', 'privacy')) < 3
  then raise exception 'required consent missing'; end if;
  perform public.set_contact(p_name, p_phone);
  perform public.record_consents(p_items);
  update public.profiles set nickname = nick, onboarded_at = now() where id = auth.uid();
end $$;
drop function if exists public.finish_onboarding(text, jsonb);
revoke all on function public.finish_onboarding(text, jsonb, text, text) from public, anon;
grant execute on function public.finish_onboarding(text, jsonb, text, text) to authenticated;

-- 아이디(이메일) 찾기: 이름 + 휴대폰 번호가 맞으면 가린 이메일(ab***@gmail.com)과 가입 방법만 돌려준다 (2026-10-21)
--   · 로그인 전에 쓰므로 anon 도 부를 수 있다. 같은 번호로는 1시간에 5번까지만 (남의 번호로 계속 찔러 보는 것 막기)
create table if not exists public.find_login_attempts (
  phone text not null,
  at    timestamptz not null default now()
);
create index if not exists find_login_attempts_phone_at on public.find_login_attempts (phone, at);
alter table public.find_login_attempts enable row level security;   -- 정책 없음 = 화면에서 직접 못 읽고 못 씀

create or replace function public.find_my_login(p_name text, p_phone text)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  nm text := trim(coalesce(p_name, ''));
  ph text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  em text; prov jsonb; id_part text;
begin
  if ph !~ '^01[016789][0-9]{7,8}$' then raise exception 'phone invalid'; end if;
  if (select count(*) from public.find_login_attempts where phone = ph and at > now() - interval '1 hour') >= 5 then
    raise exception 'too many attempts';
  end if;
  insert into public.find_login_attempts (phone) values (ph);
  delete from public.find_login_attempts where at < now() - interval '1 day';
  select u.email, coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb) into em, prov
    from public.member_contacts c join auth.users u on u.id = c.user_id
   where c.phone = ph and c.real_name = nm;
  if not found then return null; end if;
  id_part := split_part(coalesce(em, ''), '@', 1);
  return jsonb_build_object(
    'email', case when em is null or em = '' then null
                  else left(id_part, 2) || repeat('*', greatest(char_length(id_part) - 2, 2)) || '@' || split_part(em, '@', 2) end,
    'providers', prov);
end $$;
revoke all on function public.find_my_login(text, text) from public;
grant execute on function public.find_my_login(text, text) to anon, authenticated;

-- ======================= schema.sql =======================
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
  lat           numeric(7, 3) check (lat between 35.13 and 35.40),                -- 약 100m 로 반올림한 값. 동 단위 저장이면 비어 있다
  lng           numeric(7, 3) check (lng between 128.68 and 129.05),
  district      text not null,                                                    -- 김해 17개 읍·면·동 중 가장 가까운 곳
  source        text not null check (source in ('gps', 'pick')),                  -- GPS 동의 / 동네 직접 선택
  photo_label   text check (photo_label in ('흰줄숲모기', '얼룩날개모기', '집모기류', '모기 아님', '알 수 없음')),
  precision     text not null default 'district' check (precision in ('district', '100m')),   -- 저장한 위치의 자세함
  bite_when     text check (bite_when in ('방금', '1시간 안', '오늘', '어제')),                -- 물렸어요: 언제
  bite_count    text check (bite_count in ('1군데', '2~3군데', '4군데 이상')),                 -- 물렸어요: 몇 군데
  -- 보건소 확인 (Mosquito Alert 의 confirmed / probable / not sure 와 같은 3단계 + 반려)
  review        text not null default 'new' check (review in ('new', 'confirmed', 'probable', 'unsure', 'rejected')),
  reviewed_at   timestamptz,
  review_note   text check (char_length(review_note) <= 300)
);

-- 이미 예전 표를 만든 경우: 아래 줄로 칸을 더한다 (처음 만드는 경우엔 위에서 이미 만들어져 그냥 지나간다)
alter table public.reports alter column lat drop not null;
alter table public.reports alter column lng drop not null;
alter table public.reports add column if not exists precision text not null default 'district' check (precision in ('district', '100m'));
alter table public.reports add column if not exists bite_when text check (bite_when in ('방금', '1시간 안', '오늘', '어제'));
alter table public.reports add column if not exists bite_count text check (bite_count in ('1군데', '2~3군데', '4군데 이상'));
-- 예전 표에 좌표(100m)로 저장된 줄은 저장 방식을 바로잡는다
update public.reports set precision = '100m' where lat is not null and precision = 'district';

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

-- ======================= limits.sql =======================
-- =============================================================
-- 모기제로 호출 한도 (api/_limit.js 가 쓴다)
-- -------------------------------------------------------------
-- 사용법: Supabase 대시보드 → SQL Editor 에 붙여 넣고 실행.
--   이 표가 없어도 사이트는 동작한다(서버 메모리로 센다). 표가 있으면 서버가 여러 대여도 함께 센다.
-- 원칙: IP 주소는 저장하지 않는다. 서버가 하루마다 바뀌는 해시로 바꿔 보낸 키만 센다.
--       브라우저(anon 키)는 이 표와 함수에 접근할 수 없다. 서버 함수만 service role 키로 쓴다.
-- =============================================================

create table if not exists public.api_limits (
  key       text primary key,          -- 예: 'ask:m:3f9a…' (기능:기간:해시)
  n         int not null,              -- 이번 기간에 부른 횟수
  reset_at  timestamptz not null       -- 이 시각이 지나면 0부터 다시 센다
);
alter table public.api_limits enable row level security;   -- 정책 없음 → anon·authenticated 접근 불가

-- 한 번 부를 때마다 1 올리고, 한도(p_max) 안이면 true
create or replace function public.api_limit_hit(p_key text, p_window int, p_max int)
returns boolean language plpgsql security definer set search_path = public as $$
declare cur int;
begin
  insert into public.api_limits as l (key, n, reset_at)
  values (p_key, 1, now() + make_interval(secs => p_window))
  on conflict (key) do update set
    n        = case when l.reset_at < now() then 1 else l.n + 1 end,
    reset_at = case when l.reset_at < now() then now() + make_interval(secs => p_window) else l.reset_at end
  returning n into cur;
  return cur <= p_max;
end $$;
revoke all on function public.api_limit_hit(text, int, int) from public, anon, authenticated;

-- 지난 줄 정리 (pg_cron 이 켜져 있으면 매일 새벽 4시)
-- select cron.schedule('purge-api-limits', '0 4 * * *', $$delete from public.api_limits where reset_at < now() - interval '1 day'$$);

-- ======================= run-schema.sql =======================
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

-- ======================= photo-schema.sql =======================
-- =============================================================
-- 모기제로 사진 기증 (AI 학습용) — 저장소 · 기록 표 · 직원 확인
-- -------------------------------------------------------------
-- 사용법: account-schema.sql 다음에 SQL Editor 에 붙여 넣고 실행한다. 여러 번 실행해도 된다.
--
-- 원칙
--   · 로그인 + '사진 기증' 동의한 사람만, 하루 20장까지. 폰에서 먼저 거른다(모기 아님·애매함·흐림·어두움·같은 사진).
--   · 사진은 비공개 저장소(photo-donations)에 '내 아이디/파일' 로 올린다. 사진 속 위치 정보는 폰에서 지운 뒤 올린다.
--   · 직원이 정답(종)을 확인한 사진만 학습에 쓴다(review = 'confirmed'). 이상한 사진은 직원이 지운다.
--   · 계정을 지우면 기록이 지워진다. 사진 파일은 계정 삭제 전에 화면(auth.js deleteAccount)이 저장소에서 지운다
--     (Supabase 는 SQL 로 저장소 파일을 직접 지우는 것을 막는다).
-- =============================================================

-- 1) 동의 종류에 '사진 기증' 추가
alter table public.consents drop constraint if exists consents_kind_check;
alter table public.consents add constraint consents_kind_check
  check (kind in ('age14', 'terms', 'privacy', 'location', 'motion', 'photo_points', 'photo_donate'));

-- 2) 비공개 저장소
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photo-donations', 'photo-donations', false, 1048576, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg'];

-- 저장소 권한: 내 폴더에만 올리기, 내 사진·(직원은) 모든 사진 보기, 직원만 지우기
drop policy if exists "기증 사진 올리기" on storage.objects;
create policy "기증 사진 올리기" on storage.objects for insert to authenticated
  with check (bucket_id = 'photo-donations' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "기증 사진 보기" on storage.objects;
create policy "기증 사진 보기" on storage.objects for select to authenticated
  using (bucket_id = 'photo-donations' and ((storage.foldername(name))[1] = auth.uid()::text
         or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'staff')));
drop policy if exists "기증 사진 지우기" on storage.objects;
create policy "기증 사진 지우기" on storage.objects for delete to authenticated
  using (bucket_id = 'photo-donations' and ((storage.foldername(name))[1] = auth.uid()::text
         or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'staff')));

-- 3) 기증 기록
create table if not exists public.photo_donations (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  path         text not null unique,                 -- 저장소 안 파일 위치 (내아이디/파일.jpg)
  ai_label     text not null,                        -- 폰 AI 판별 (흰줄숲모기·얼룩날개모기·집모기류)
  ai_conf      numeric(4, 3) not null,               -- 그때 확률 (0~1)
  phash        text not null,                        -- 사진 지문 (같은 사진 반복 막기)
  width        int, height int,
  district     text,                                 -- 동네 이름(선택, 좌표 아님)
  created_at   timestamptz not null default now(),
  review       text not null default 'pending' check (review in ('pending', 'confirmed', 'rejected')),
  label        text check (label in ('흰줄숲모기', '얼룩날개모기', '빨간집모기', '작은빨간집모기', '집모기류', '모기아님', '판별불가')),
  reviewed_by  uuid references public.profiles (id) on delete set null,
  reviewed_at  timestamptz
);
create index if not exists photo_donations_review_idx on public.photo_donations (review, created_at);
create index if not exists photo_donations_user_idx on public.photo_donations (user_id, created_at desc);
alter table public.photo_donations enable row level security;
drop policy if exists "내 기증·직원은 전부 읽기" on public.photo_donations;
create policy "내 기증·직원은 전부 읽기" on public.photo_donations for select to authenticated
  using (auth.uid() = user_id or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'staff'));

-- 4) 기증 기록 남기기 (파일을 올린 뒤 부른다). 동의·하루 20장·같은 사진·폴더를 검사한다
create or replace function public.donate_photo(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); path text := p ->> 'path'; h text := p ->> 'phash'; today_n int;
begin
  if uid is null then raise exception 'login required'; end if;
  if not exists (select 1 from public.profiles where id = uid and onboarded_at is not null) then raise exception 'onboarding required'; end if;
  if not exists (select 1 from public.consents c where c.user_id = uid and c.kind = 'photo_donate'
                 and c.created_at = (select max(created_at) from public.consents where user_id = uid and kind = 'photo_donate') and c.agreed) then
    return jsonb_build_object('ok', false, 'reason', 'consent');
  end if;
  if path is null or split_part(path, '/', 1) <> uid::text then return jsonb_build_object('ok', false, 'reason', 'path'); end if;
  if (p ->> 'ai_label') not in ('흰줄숲모기', '얼룩날개모기', '집모기류') or coalesce((p ->> 'ai_conf')::numeric, 0) < 0.6 then
    return jsonb_build_object('ok', false, 'reason', 'label');
  end if;
  select count(*) into today_n from public.photo_donations
   where user_id = uid and (created_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date;
  if today_n >= 20 then return jsonb_build_object('ok', false, 'reason', 'daily'); end if;
  if h is null or length(h) <> 16 or exists (select 1 from public.photo_donations where phash = h) then
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end if;
  insert into public.photo_donations (user_id, path, ai_label, ai_conf, phash, width, height, district)
  values (uid, path, p ->> 'ai_label', (p ->> 'ai_conf')::numeric, h, (p ->> 'width')::int, (p ->> 'height')::int, nullif(left(p ->> 'district', 20), ''));
  return jsonb_build_object('ok', true, 'today', today_n + 1);
end $$;
revoke all on function public.donate_photo(jsonb) from public, anon;
grant execute on function public.donate_photo(jsonb) to authenticated;

-- 5) 직원 확인: 정답 달기 · 거절
create or replace function public.review_photo(p_id bigint, p_label text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'staff') then raise exception 'staff only'; end if;
  update public.photo_donations
     set review = case when p_label in ('모기아님', '판별불가') then 'rejected' else 'confirmed' end,
         label = p_label, reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;
end $$;
revoke all on function public.review_photo(bigint, text) from public, anon;
grant execute on function public.review_photo(bigint, text) to authenticated;

-- 직원이 사진을 지울 때 기록도 지운다 (파일은 화면에서 저장소 삭제를 함께 부른다)
create or replace function public.delete_photo_donation(p_id bigint)
returns text language plpgsql security definer set search_path = public as $$
declare pth text;
begin
  select path into pth from public.photo_donations where id = p_id
    and (user_id = auth.uid() or exists (select 1 from public.profiles where id = auth.uid() and role = 'staff'));
  if pth is null then raise exception 'not allowed'; end if;
  delete from public.photo_donations where id = p_id;
  return pth;
end $$;
revoke all on function public.delete_photo_donation(bigint) from public, anon;
grant execute on function public.delete_photo_donation(bigint) to authenticated;

-- ======================= admin-schema.sql =======================
-- =============================================================
-- 모기제로 최고 관리자(슈퍼 계정) · 직원 권한 관리 (2026-10-21)
-- -------------------------------------------------------------
-- 사용법: 다른 SQL 다음에 SQL Editor 에 붙여 넣고 실행한다. 여러 번 실행해도 된다.
--
-- 원칙
--   · 최고 관리자(is_admin)는 대시보드 SQL 로만 지정한다. 사이트·앱 어디에서도 바꿀 수 없다.
--   · 최고 관리자만 사이트의 '직원 권한 관리'에서 다른 회원을 직원(staff) ↔ 일반(citizen)으로 바꿀 수 있다.
--   · 최고 관리자는 직원 기능도 모두 쓴다(role = 'staff' 로 둔다). 다른 사람이 최고 관리자의 권한을 바꿀 수 없다.
--   · 회원은 profiles 를 직접 고칠 수 없다(update 정책 없음). 권한은 아래 함수로만 바뀐다.
-- =============================================================

alter table public.profiles add column if not exists is_admin boolean not null default false;

-- 회원 찾기: 닉네임 일부로 최대 30명 (최고 관리자만)
create or replace function public.admin_list_members(p_query text)
returns table (nickname text, role text, is_admin boolean, joined_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then raise exception 'admin only'; end if;
  return query
    select p.nickname, p.role, p.is_admin, p.created_at
      from public.profiles p
     where p.nickname is not null
       and (coalesce(trim(p_query), '') = '' or p.nickname ilike '%' || trim(p_query) || '%')
     order by p.is_admin desc, (p.role = 'staff') desc, p.created_at desc
     limit 30;
end $$;
revoke all on function public.admin_list_members(text) from public, anon;
grant execute on function public.admin_list_members(text) to authenticated;

-- 권한 바꾸기: citizen ↔ staff (최고 관리자만, 최고 관리자 계정은 못 바꿈)
create or replace function public.admin_set_role(p_nickname text, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare target public.profiles%rowtype;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then raise exception 'admin only'; end if;
  if p_role not in ('citizen', 'staff') then raise exception 'bad role'; end if;
  select * into target from public.profiles where nickname = trim(p_nickname);
  if not found then raise exception 'no member'; end if;
  if target.is_admin then raise exception 'cannot change admin'; end if;
  update public.profiles set role = p_role where id = target.id;
end $$;
revoke all on function public.admin_set_role(text, text) from public, anon;
grant execute on function public.admin_set_role(text, text) to authenticated;

-- 최고 관리자 지정 (대시보드에서 한 번만, 닉네임을 본인 것으로 바꿔 실행):
--   update public.profiles set is_admin = true, role = 'staff' where nickname = '내닉네임';

-- ======================= free-play.sql =======================
-- =============================================================
-- 모기제로 '그냥 잡기'(도전 밖에서 잡은 모기)도 랭킹에 넣기 (2026-10-21)
-- -------------------------------------------------------------
-- 사용법: game-schema.sql · account-schema.sql 다음에 실행한다. 여러 번 실행해도 된다.
--
-- 브라우저(game.js)는 그냥 잡은 수를 20초 또는 40마리마다 한 묶음으로 보낸다: { stage: 0, kills, duration_ms }
-- 서버는 묶음을 거절하지 않고 '사람이 잡을 수 있는 만큼'으로 잘라서 받는다.
--   · 한 묶음 최대 60마리
--   · 걸린 시간 기준: 한 마리당 최소 ms(min_ms_per_kill), 분당 상한(max_kills_per_min)
--   · 하루(서울 시간) 그냥 잡기 상한 free_daily_cap (기본 1500마리)
--   · 그냥 잡기는 하루 도전 횟수(daily_play_limit)를 쓰지 않는다
-- =============================================================

alter table public.game_config add column if not exists free_daily_cap int not null default 1500;
alter table public.game_runs drop constraint if exists game_runs_stage_check;
alter table public.game_runs add constraint game_runs_stage_check check (stage between 0 and 10);

create or replace function public.submit_game_runs(p_runs jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cfg      public.game_config%rowtype;
  uid      uuid := auth.uid();
  r        jsonb;
  st       int; k int; ms int; ok boolean; at timestamptz;
  today_n  int;      -- 오늘 도전 횟수
  free_n   int;      -- 오늘 그냥 잡기 마리 수
  day0     timestamptz := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  acc      int := 0; rej int := 0;
  sc       public.game_scores%rowtype;
  i        int;
  new_badges text[] := '{}';
begin
  if uid is null then raise exception 'login required'; end if;
  select * into cfg from public.game_config where id = 1;
  if jsonb_typeof(p_runs) <> 'array' or jsonb_array_length(p_runs) > 20 then raise exception 'bad payload'; end if;

  select count(*) filter (where stage >= 1), coalesce(sum(kills) filter (where stage = 0), 0)
    into today_n, free_n
    from public.game_runs where user_id = uid and received_at >= day0;

  for r in select * from jsonb_array_elements(p_runs) loop
    st := coalesce((r ->> 'stage')::int, 0);
    k  := coalesce((r ->> 'kills')::int, 0);
    ms := least(greatest(coalesce((r ->> 'duration_ms')::int, 0), 0), 3600000);
    ok := coalesce((r ->> 'success')::boolean, false);
    at := coalesce((r ->> 'played_at')::timestamptz, now());
    if at < now() - make_interval(hours => cfg.max_run_hours) or at > now() + interval '10 minutes' or k <= 0 and st = 0 then
      rej := rej + 1; continue;
    end if;

    if st = 0 then
      -- 그냥 잡기: 사람이 잡을 수 있는 만큼만 받는다
      k := least(k, 60,
                 ms / greatest(cfg.min_ms_per_kill, 1),
                 floor(ms::numeric * cfg.max_kills_per_min / 60000)::int,
                 cfg.free_daily_cap - free_n);
      if k <= 0 then rej := rej + 1; continue; end if;
      insert into public.game_runs (user_id, season, stage, kills, duration_ms, success, played_at)
      values (uid, cfg.season, 0, k, ms, false, at);
      acc := acc + 1; free_n := free_n + k;
      insert into public.game_scores (user_id, season, total_kills, best_stage, runs)
      values (uid, cfg.season, k, 0, 0)
      on conflict (user_id, season) do update
        set total_kills = public.game_scores.total_kills + excluded.total_kills, updated_at = now();
      continue;
    end if;

    -- 도전: 하루 횟수 · 단계 범위 · 목표 초과 · 분당 상한 · 마리당 최소 시간
    if today_n >= cfg.daily_play_limit
       or st < 1 or st > array_length(cfg.stage_targets, 1)
       or k < 0 or k > cfg.stage_targets[st]
       or ms < k * cfg.min_ms_per_kill
       or (ms > 0 and k::numeric / greatest(ms, 1) * 60000 > cfg.max_kills_per_min)
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
notify pgrst, 'reload schema';

-- ======================= user-data-schema.sql =======================
-- =============================================================
-- 모기제로 내 기록 서버 보관 (2026-10-21)
-- -------------------------------------------------------------
-- 사용법: 다른 SQL 다음에 SQL Editor 에 붙여 넣고 실행한다. 여러 번 실행해도 된다.
--
-- 로그인하면 이 기기에만 있던 기록을 계정에 보관한다. 다른 폰에서 로그인해도 이어진다.
--   game  : 잡은 수, 골드, 가진 무기·든 무기, 황금·엘리트·보스 잡은 수, 최고 단계, 배지, 최근 도전 50판
--   runs  : 뛰어런 기록(거리·시간·걸음·구간). 달린 길(좌표)은 보내지 않는다 — 처리방침대로 폰에만 남긴다
--   photo : 사진 판별 횟수, 종류별 횟수, 기증 횟수
-- 랭킹은 여기 값을 쓰지 않는다(랭킹은 서버가 검사한 game_runs · run_sessions 로만 매긴다).
-- 회원 탈퇴 시 함께 지워진다(on delete cascade).
-- =============================================================

create table if not exists public.user_data (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('game', 'runs', 'photo')),
  data        jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, kind)
);
alter table public.user_data enable row level security;
drop policy if exists "내 기록만 읽기" on public.user_data;
create policy "내 기록만 읽기" on public.user_data for select to authenticated using (auth.uid() = user_id);

-- 저장: 한 종류당 256KB 까지. 돌려주는 값 = 저장된 시각
create or replace function public.save_user_data(p_kind text, p_data jsonb)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare t timestamptz := now();
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  if p_kind not in ('game', 'runs', 'photo') then raise exception 'bad kind'; end if;
  if jsonb_typeof(p_data) <> 'object' or pg_column_size(p_data) > 262144 then raise exception 'bad data'; end if;
  insert into public.user_data (user_id, kind, data, updated_at) values (auth.uid(), p_kind, p_data, t)
  on conflict (user_id, kind) do update set data = excluded.data, updated_at = t;
  return t;
end $$;
revoke all on function public.save_user_data(text, jsonb) from public, anon;
grant execute on function public.save_user_data(text, jsonb) to authenticated;
notify pgrst, 'reload schema';

-- ======================= report-schema.sql =======================
-- =============================================================
-- 모기제로 관리자 함수 고침 · 이름·휴대폰 잠금 · 데이터 뽑기용 보기 (2026-10-21)
-- -------------------------------------------------------------
-- 사용법: 다른 SQL 다음에 SQL Editor 에 붙여 넣고 실행한다. 여러 번 실행해도 된다.
-- =============================================================

-- 1) 직원 권한 관리 함수 고침: 결과 칸 이름(is_admin)과 표 칸 이름이 겹쳐 오류가 났다
create or replace function public.admin_list_members(p_query text)
returns table (nickname text, role text, is_admin boolean, joined_at timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not exists (select 1 from public.profiles me where me.id = auth.uid() and me.is_admin) then raise exception 'admin only'; end if;
  return query
    select p.nickname, p.role, p.is_admin, p.created_at
      from public.profiles p
     where p.nickname is not null
       and (coalesce(trim(p_query), '') = '' or p.nickname ilike '%' || trim(p_query) || '%')
     order by p.is_admin desc, (p.role = 'staff') desc, p.created_at desc
     limit 30;
end $$;
revoke all on function public.admin_list_members(text) from public, anon;
grant execute on function public.admin_list_members(text) to authenticated;

-- 2) 이름·휴대폰은 처음 한 번만 저장. 그 뒤로는 본인이 바꿀 수 없다(상품 지급 대상 확인용)
--    바꿔야 하면 운영자가 대시보드에서 직접 고친다:
--      update public.member_contacts set real_name = '새이름', phone = '01012345678'
--       where user_id = (select id from public.profiles where nickname = '닉네임');
create or replace function public.set_contact(p_name text, p_phone text)
returns void language plpgsql security definer set search_path = public as $$
declare nm text := trim(coalesce(p_name, '')); ph text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  if exists (select 1 from public.member_contacts where user_id = auth.uid()) then raise exception 'contact locked'; end if;
  if char_length(nm) < 2 or char_length(nm) > 20 or nm !~ '^[가-힣A-Za-z ]+$' then raise exception 'name invalid'; end if;
  if ph !~ '^01[016789][0-9]{7,8}$' then raise exception 'phone invalid'; end if;
  if exists (select 1 from public.member_contacts where phone = ph) then raise exception 'phone duplicate'; end if;
  insert into public.member_contacts (user_id, real_name, phone, verified, updated_at)
  values (auth.uid(), nm, ph, false, now());
end $$;
revoke all on function public.set_contact(text, text) from public, anon;
grant execute on function public.set_contact(text, text) to authenticated;

-- 3) 데이터 뽑기용 보기 (report 묶음)
--    · 사이트·앱(공개 키)에서는 못 읽는다. 대시보드 SQL Editor 에서만 읽는다
--    · 뽑는 법: SQL Editor 에서 select * from report.회원; 실행 → 결과 오른쪽 위 'Export' → CSV
create schema if not exists report;
revoke all on schema report from public, anon, authenticated;

-- 회원 한 줄 요약: 연락처 · 잡은 수 · 뛰어런 · 사진
create or replace view report."회원" as
select p.nickname                                         as 닉네임,
       c.real_name                                        as 이름,
       c.phone                                            as 휴대폰,
       u.email                                            as 이메일,
       coalesce(u.raw_app_meta_data ->> 'provider', '')   as 가입방법,
       p.role                                             as 권한,
       p.is_admin                                         as 최고관리자,
       (p.created_at at time zone 'Asia/Seoul')::date     as 가입일,
       coalesce(gs.total_kills, 0)                        as 잡은모기,
       coalesce(gs.best_stage, 0)                         as 최고단계,
       coalesce(rs.km, 0)                                 as 뛰어런_km,
       coalesce(rs.n, 0)                                  as 뛰어런_횟수,
       coalesce(pd.n, 0)                                  as 사진기증,
       coalesce((ud.data ->> 'judged')::int, 0)           as 사진판별,
       coalesce((ug.data ->> 'gold')::int, 0)             as 골드
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.member_contacts c on c.user_id = p.id
  left join public.game_scores gs on gs.user_id = p.id and gs.season = extract(year from now())::int
  left join (select user_id, round(sum(distance_m) / 1000.0, 1) as km, count(*) as n from public.run_sessions group by user_id) rs on rs.user_id = p.id
  left join (select user_id, count(*) as n from public.photo_donations group by user_id) pd on pd.user_id = p.id
  left join public.user_data ud on ud.user_id = p.id and ud.kind = 'photo'
  left join public.user_data ug on ug.user_id = p.id and ug.kind = 'game';

-- 랭킹별 상위 10명 + 연락처 (상품 지급용)
create or replace view report."상품_모기잡기" as
select rank() over (order by gs.total_kills desc) as 순위, p.nickname as 닉네임, c.real_name as 이름, c.phone as 휴대폰, gs.total_kills as 잡은모기
  from public.game_scores gs join public.profiles p on p.id = gs.user_id left join public.member_contacts c on c.user_id = p.id
 where gs.season = extract(year from now())::int
 order by gs.total_kills desc limit 10;

create or replace view report."상품_뛰어런" as
select rank() over (order by sum(r.distance_m) desc) as 순위, p.nickname as 닉네임, c.real_name as 이름, c.phone as 휴대폰,
       round(sum(r.distance_m) / 1000.0, 1) as 거리_km, count(*) as 횟수
  from public.run_sessions r join public.profiles p on p.id = r.user_id left join public.member_contacts c on c.user_id = p.id
 where r.season = extract(year from now())::int
 group by p.nickname, c.real_name, c.phone
 order by sum(r.distance_m) desc limit 10;

-- 날짜별 활동 (가입 · 모기 잡기 · 뛰어런 · 사진 기증)
create or replace view report."일별활동" as
with d as (
  select (created_at at time zone 'Asia/Seoul')::date as 날짜, 'signup' as k, 1 as v from public.profiles
  union all select (received_at at time zone 'Asia/Seoul')::date, 'kills', kills from public.game_runs
  union all select (received_at at time zone 'Asia/Seoul')::date, 'run_km', distance_m / 1000 from public.run_sessions
  union all select (created_at at time zone 'Asia/Seoul')::date, 'photo', 1 from public.photo_donations
)
select 날짜,
       sum(v) filter (where k = 'signup') as 가입,
       sum(v) filter (where k = 'kills')  as 잡은모기,
       sum(v) filter (where k = 'run_km') as 뛰어런_km,
       sum(v) filter (where k = 'photo')  as 사진기증
  from d group by 날짜 order by 날짜 desc;

-- 사진 기증 목록 (학습·검토용)
create or replace view report."사진기증" as
select d.id as 번호, (d.created_at at time zone 'Asia/Seoul') as 기증시각, p.nickname as 닉네임, d.ai_label as AI판별, d.ai_conf as AI확률,
       d.review as 검토, d.label as 확인종, d.district as 동네, d.path as 파일
  from public.photo_donations d left join public.profiles p on p.id = d.user_id
 order by d.created_at desc;

-- 동의 기록 (최신 것만)
create or replace view report."동의" as
select distinct on (c.user_id, c.kind) p.nickname as 닉네임, c.kind as 항목, c.agreed as 동의, c.version as 판, (c.created_at at time zone 'Asia/Seoul') as 시각
  from public.consents c join public.profiles p on p.id = c.user_id
 order by c.user_id, c.kind, c.created_at desc;

revoke all on all tables in schema report from public, anon, authenticated;
notify pgrst, 'reload schema';

-- ======================= rank3-schema.sql =======================
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
