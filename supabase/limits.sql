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
