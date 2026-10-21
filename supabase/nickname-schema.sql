-- =============================================================
-- 모기제로 닉네임 중복 확인 (2026-10-21)
-- -------------------------------------------------------------
-- 가입·가입 마무리·닉네임 바꾸기 화면에서 입력하는 동안 바로 알려 준다.
-- 돌려주는 값: 'ok'(쓸 수 있음) · 'taken'(이미 있음) · 'invalid'(규칙에 안 맞음)
-- 닉네임은 랭킹에 공개되는 값이라 있는지 없는지 알려 줘도 새는 정보가 없다. 실제 저장 때도 서버가 다시 막는다.
-- =============================================================
create or replace function public.nickname_available(p_nickname text)
returns text language plpgsql stable security definer set search_path = public as $$
declare nick text := trim(coalesce(p_nickname, ''));
begin
  if not public.valid_nickname(nick) then return 'invalid'; end if;
  if exists (select 1 from public.profiles where nickname = nick and id is distinct from auth.uid()) then return 'taken'; end if;
  return 'ok';
end $$;
revoke all on function public.nickname_available(text) from public;
grant execute on function public.nickname_available(text) to anon, authenticated;
notify pgrst, 'reload schema';
