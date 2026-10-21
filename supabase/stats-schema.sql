-- =============================================================
-- 모기제로 전체 숫자 (2026-10-21): 회원 수 · 잡은 모기 · 뛰어런 · 사진 — 합계만
-- -------------------------------------------------------------
-- 개인정보 없이 합계 숫자만 돌려준다. 공개 키로도 부를 수 있어 운영 현황을 바로 확인할 수 있다.
-- =============================================================
create or replace function public.site_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'members',        (select count(*) from public.profiles),
    'members_done',   (select count(*) from public.profiles where onboarded_at is not null),
    'joined_today',   (select count(*) from public.profiles where created_at >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'),
    'staff',          (select count(*) from public.profiles where role = 'staff'),
    'kills',          (select coalesce(sum(total_kills), 0) from public.game_scores),
    'run_km',         (select round(coalesce(sum(distance_m), 0) / 1000.0, 1) from public.run_sessions),
    'runs',           (select count(*) from public.run_sessions),
    'photos',         (select count(*) from public.photo_donations),
    'photos_confirmed', (select count(*) from public.photo_donations where review = 'confirmed'),
    'at',             now());
$$;
revoke all on function public.site_stats() from public;
grant execute on function public.site_stats() to anon, authenticated;
notify pgrst, 'reload schema';
