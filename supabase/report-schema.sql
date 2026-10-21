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
