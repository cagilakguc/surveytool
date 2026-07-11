create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.projects (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.project_files (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade, name text not null, storage_path text not null unique,
  size_bytes bigint not null check (size_bytes >= 0), mime_type text, created_at timestamptz not null default now()
);
create table public.analysis_results (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade, tool text not null, result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade, stripe_customer_id text not null,
  stripe_subscription_id text not null unique, status text not null, current_period_end timestamptz, updated_at timestamptz not null default now()
);

create index projects_owner_idx on public.projects(owner_id);
create index project_files_project_idx on public.project_files(project_id);
create index analysis_results_project_idx on public.analysis_results(project_id);

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_files enable row level security;
alter table public.analysis_results enable row level security;
alter table public.subscriptions enable row level security;

create policy "profiles own row" on public.profiles for select using (auth.uid() = id);
create policy "projects own rows" on public.projects for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "files own rows" on public.project_files for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "results own rows" on public.analysis_results for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "subscriptions own row" on public.subscriptions for select using (auth.uid() = user_id);

insert into storage.buckets (id, name, public) values ('project-files', 'project-files', false) on conflict (id) do nothing;
create policy "users upload own project files" on storage.objects for insert to authenticated with check (bucket_id = 'project-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users read own project files" on storage.objects for select to authenticated using (bucket_id = 'project-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users delete own project files" on storage.objects for delete to authenticated using (bucket_id = 'project-files' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin insert into public.profiles (id, email) values (new.id, new.email); return new; end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
