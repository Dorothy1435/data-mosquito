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
