-- =============================================================
-- 모기제로 사진 기증 (AI 학습용) — 저장소 · 기록 표 · 직원 확인
-- -------------------------------------------------------------
-- 사용법: account-schema.sql 다음에 SQL Editor 에 붙여 넣고 실행한다. 여러 번 실행해도 된다.
--
-- 원칙
--   · 로그인 + '사진 기증' 동의한 사람만, 하루 20장까지. 폰에서 먼저 거른다(모기 아님·애매함·흐림·어두움·같은 사진).
--   · 사진은 비공개 저장소(photo-donations)에 '내 아이디/파일' 로 올린다. 사진 속 위치 정보는 폰에서 지운 뒤 올린다.
--   · 직원이 정답(종)을 확인한 사진만 학습에 쓴다(review = 'confirmed'). 이상한 사진은 직원이 지운다.
--   · 계정을 지우면 기록이 지워진다. 사진 파일은 계정 삭제 전에 화면(auth.js deleteAccount)이 저장소에서 지운다
--     (Supabase 는 SQL 로 저장소 파일을 직접 지우는 것을 막는다).
-- =============================================================

-- 1) 동의 종류에 '사진 기증' 추가
alter table public.consents drop constraint if exists consents_kind_check;
alter table public.consents add constraint consents_kind_check
  check (kind in ('age14', 'terms', 'privacy', 'location', 'motion', 'photo_points', 'photo_donate'));

-- 2) 비공개 저장소
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photo-donations', 'photo-donations', false, 1048576, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg'];

-- 저장소 권한: 내 폴더에만 올리기, 내 사진·(직원은) 모든 사진 보기, 직원만 지우기
drop policy if exists "기증 사진 올리기" on storage.objects;
create policy "기증 사진 올리기" on storage.objects for insert to authenticated
  with check (bucket_id = 'photo-donations' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "기증 사진 보기" on storage.objects;
create policy "기증 사진 보기" on storage.objects for select to authenticated
  using (bucket_id = 'photo-donations' and ((storage.foldername(name))[1] = auth.uid()::text
         or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'staff')));
drop policy if exists "기증 사진 지우기" on storage.objects;
create policy "기증 사진 지우기" on storage.objects for delete to authenticated
  using (bucket_id = 'photo-donations' and ((storage.foldername(name))[1] = auth.uid()::text
         or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'staff')));

-- 3) 기증 기록
create table if not exists public.photo_donations (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  path         text not null unique,                 -- 저장소 안 파일 위치 (내아이디/파일.jpg)
  ai_label     text not null,                        -- 폰 AI 판별 (흰줄숲모기·얼룩날개모기·집모기류)
  ai_conf      numeric(4, 3) not null,               -- 그때 확률 (0~1)
  phash        text not null,                        -- 사진 지문 (같은 사진 반복 막기)
  width        int, height int,
  district     text,                                 -- 동네 이름(선택, 좌표 아님)
  created_at   timestamptz not null default now(),
  review       text not null default 'pending' check (review in ('pending', 'confirmed', 'rejected')),
  label        text check (label in ('흰줄숲모기', '얼룩날개모기', '빨간집모기', '작은빨간집모기', '집모기류', '모기아님', '판별불가')),
  reviewed_by  uuid references public.profiles (id) on delete set null,
  reviewed_at  timestamptz
);
create index if not exists photo_donations_review_idx on public.photo_donations (review, created_at);
create index if not exists photo_donations_user_idx on public.photo_donations (user_id, created_at desc);
alter table public.photo_donations enable row level security;
drop policy if exists "내 기증·직원은 전부 읽기" on public.photo_donations;
create policy "내 기증·직원은 전부 읽기" on public.photo_donations for select to authenticated
  using (auth.uid() = user_id or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'staff'));

-- 4) 기증 기록 남기기 (파일을 올린 뒤 부른다). 동의·하루 20장·같은 사진·폴더를 검사한다
create or replace function public.donate_photo(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); path text := p ->> 'path'; h text := p ->> 'phash'; today_n int;
begin
  if uid is null then raise exception 'login required'; end if;
  if not exists (select 1 from public.profiles where id = uid and onboarded_at is not null) then raise exception 'onboarding required'; end if;
  if not exists (select 1 from public.consents c where c.user_id = uid and c.kind = 'photo_donate'
                 and c.created_at = (select max(created_at) from public.consents where user_id = uid and kind = 'photo_donate') and c.agreed) then
    return jsonb_build_object('ok', false, 'reason', 'consent');
  end if;
  if path is null or split_part(path, '/', 1) <> uid::text then return jsonb_build_object('ok', false, 'reason', 'path'); end if;
  if (p ->> 'ai_label') not in ('흰줄숲모기', '얼룩날개모기', '집모기류') or coalesce((p ->> 'ai_conf')::numeric, 0) < 0.6 then
    return jsonb_build_object('ok', false, 'reason', 'label');
  end if;
  select count(*) into today_n from public.photo_donations
   where user_id = uid and (created_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date;
  if today_n >= 20 then return jsonb_build_object('ok', false, 'reason', 'daily'); end if;
  if h is null or length(h) <> 16 or exists (select 1 from public.photo_donations where phash = h) then
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end if;
  insert into public.photo_donations (user_id, path, ai_label, ai_conf, phash, width, height, district)
  values (uid, path, p ->> 'ai_label', (p ->> 'ai_conf')::numeric, h, (p ->> 'width')::int, (p ->> 'height')::int, nullif(left(p ->> 'district', 20), ''));
  return jsonb_build_object('ok', true, 'today', today_n + 1);
end $$;
revoke all on function public.donate_photo(jsonb) from public, anon;
grant execute on function public.donate_photo(jsonb) to authenticated;

-- 5) 직원 확인: 정답 달기 · 거절
create or replace function public.review_photo(p_id bigint, p_label text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'staff') then raise exception 'staff only'; end if;
  update public.photo_donations
     set review = case when p_label in ('모기아님', '판별불가') then 'rejected' else 'confirmed' end,
         label = p_label, reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;
end $$;
revoke all on function public.review_photo(bigint, text) from public, anon;
grant execute on function public.review_photo(bigint, text) to authenticated;

-- 직원이 사진을 지울 때 기록도 지운다 (파일은 화면에서 저장소 삭제를 함께 부른다)
create or replace function public.delete_photo_donation(p_id bigint)
returns text language plpgsql security definer set search_path = public as $$
declare pth text;
begin
  select path into pth from public.photo_donations where id = p_id
    and (user_id = auth.uid() or exists (select 1 from public.profiles where id = auth.uid() and role = 'staff'));
  if pth is null then raise exception 'not allowed'; end if;
  delete from public.photo_donations where id = p_id;
  return pth;
end $$;
revoke all on function public.delete_photo_donation(bigint) from public, anon;
grant execute on function public.delete_photo_donation(bigint) to authenticated;
