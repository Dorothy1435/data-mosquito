-- 모기제로 DB 한 번에 만들기 (game-schema → account-schema → schema → limits 순서로 합친 것). 여러 번 실행해도 된다.

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

-- 5분마다 랭킹 다시 만들기 (대시보드 → Database → Extensions 에서 pg_cron 을 켠 뒤 실행)
-- select cron.schedule('mz-ranking', '*/5 * * * *', $$select public.rebuild_ranking()$$);

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
