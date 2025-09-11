-- Link preview persistent cache table
create table if not exists public.link_previews (
  url text primary key,
  data jsonb not null,
  last_fetched timestamptz not null default now(),
  ttl_seconds integer not null default 21600, -- 6 hours
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Update trigger for updated_at
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_link_previews_updated_at on public.link_previews;
create trigger trg_link_previews_updated_at
before update on public.link_previews
for each row execute procedure public.set_updated_at();

-- Enable RLS; service role bypasses RLS
alter table public.link_previews enable row level security;

-- Optional read policy for anonymous (disabled by default)
-- create policy "link_previews_read_public"
--   on public.link_previews for select
--   to anon using (true);

