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
