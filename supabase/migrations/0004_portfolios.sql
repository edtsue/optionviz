-- Portfolio snapshot persistence. Each row is a parsed broker screenshot
-- plus an optional Claude-generated analysis. The latest row by created_at
-- is treated as "current"; older rows accumulate for history.

create table if not exists portfolios (
  id uuid primary key default gen_random_uuid(),
  snapshot jsonb not null,
  analysis jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_portfolios_created on portfolios(created_at desc);

create or replace function portfolios_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists portfolios_touch on portfolios;
create trigger portfolios_touch
  before update on portfolios
  for each row execute function portfolios_touch();

alter table public.portfolios enable row level security;
