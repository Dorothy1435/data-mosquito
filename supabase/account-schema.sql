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
