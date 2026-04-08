-- TrackMaster production RLS/storage hardening.
-- Apply after reviewing in a Supabase SQL editor or migration.
-- This file intentionally contains no secrets.

begin;

alter table public.tracks enable row level security;
alter table public.presets enable row level security;

drop policy if exists "Public Access" on public.tracks;
drop policy if exists "Allow Public Delete" on public.tracks;
drop policy if exists "Users can only insert their own tracks" on public.tracks;
drop policy if exists "Users can only see their own tracks" on public.tracks;
drop policy if exists "Users can manage their own tracks" on public.tracks;

create policy "Authenticated users can select own tracks"
  on public.tracks
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Authenticated users can insert own tracks"
  on public.tracks
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Authenticated users can update own tracks"
  on public.tracks
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Authenticated users can delete own tracks"
  on public.tracks
  for delete
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Public Access Presets" on public.presets;
drop policy if exists "Users can manage their own presets" on public.presets;

create policy "Anyone can read factory presets"
  on public.presets
  for select
  to anon, authenticated
  using (is_custom = false and user_id is null);

create policy "Authenticated users can manage own presets"
  on public.presets
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and coalesce(is_custom, true) = true);

update storage.buckets
set public = false
where id = 'audio-files';

drop policy if exists "Allow Public Storage Delete" on storage.objects;
drop policy if exists "Allow anyone to upload files 1o4vxz4_1" on storage.objects;
drop policy if exists "Public Storage Access" on storage.objects;
drop policy if exists "Users can upload their own tracks" on storage.objects;

create policy "Authenticated users can select own audio files"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'audio-files' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Authenticated users can upload own audio files"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'audio-files' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Authenticated users can update own audio files"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'audio-files' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'audio-files' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Authenticated users can delete own audio files"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'audio-files' and (storage.foldername(name))[1] = auth.uid()::text);

commit;
