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
