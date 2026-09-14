-- Jalankan seluruh file ini di Supabase SQL Editor sebelum mengaktifkan sinkronisasi.
create table if not exists public.finspace_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.finspace_snapshots enable row level security;

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

-- Buat bucket private bernama "receipts" di Storage Dashboard, lalu jalankan policies ini.
create policy "Users manage their own receipt images" on storage.objects
  for all to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
