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
