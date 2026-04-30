-- Initial schema for OptionViz.
-- Single-user app: no auth/RLS by default. Add RLS if you ever multi-tenant.

create extension if not exists "pgcrypto";

create table if not exists trades (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  underlying_price numeric not null,
  risk_free_rate numeric not null default 0.045,
  underlying_shares integer,
  underlying_cost_basis numeric,
  notes text,
  ticket_image_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists legs (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references trades(id) on delete cascade,
  type text not null check (type in ('call','put')),
  side text not null check (side in ('long','short')),
  strike numeric not null,
  expiration date not null,
  quantity integer not null,
  premium numeric not null,
  iv numeric,
  position integer not null default 0
);

create index if not exists legs_trade_idx on legs(trade_id);
create index if not exists trades_created_idx on trades(created_at desc);

-- Storage bucket for uploaded ticket screenshots.
-- Run once in Supabase SQL editor or dashboard:
-- insert into storage.buckets (id, name, public) values ('tickets','tickets', false) on conflict do nothing;
