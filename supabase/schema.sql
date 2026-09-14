-- Jalankan seluruh file ini di Supabase SQL Editor sebelum mengaktifkan sinkronisasi.
create table if not exists public.finspace_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.finspace_snapshots enable row level security;

drop policy if exists "Users read their own FinSpace data" on public.finspace_snapshots;
drop policy if exists "Users create their own FinSpace data" on public.finspace_snapshots;
drop policy if exists "Users update their own FinSpace data" on public.finspace_snapshots;
create policy "Users read their own FinSpace data" on public.finspace_snapshots
  for select to authenticated using (auth.uid() = user_id);
create policy "Users create their own FinSpace data" on public.finspace_snapshots
  for insert to authenticated with check (auth.uid() = user_id);
create policy "Users update their own FinSpace data" on public.finspace_snapshots
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.touch_finspace_snapshot()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists finspace_snapshot_updated_at on public.finspace_snapshots;
create trigger finspace_snapshot_updated_at before update on public.finspace_snapshots
for each row execute function public.touch_finspace_snapshot();

-- Aktifkan Realtime agar perubahan dari laptop langsung diterima HP (dan sebaliknya).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'finspace_snapshots'
     ) then
    alter publication supabase_realtime add table public.finspace_snapshots;
  end if;
end;
$$;

-- Buat bucket private bernama "receipts" di Storage Dashboard, lalu jalankan policies ini.
drop policy if exists "Users manage their own receipt images" on storage.objects;
create policy "Users manage their own receipt images" on storage.objects
  for all to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
