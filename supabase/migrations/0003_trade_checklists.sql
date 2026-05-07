-- Per-trade checklist persistence for the covered-call / cash-secured-put workflow.
-- One row per trade. checked_items is a free-form jsonb map from item-key → boolean
-- so the UI can evolve item identifiers without schema churn.

create table if not exists trade_checklists (
  trade_id uuid primary key references trades(id) on delete cascade,
  strategy text not null check (strategy in ('covered_call', 'cash_secured_put')),
  market_view text not null check (market_view in ('bull', 'neutral', 'bear')) default 'neutral',
  stop_multiplier numeric not null default 2.0
    check (stop_multiplier >= 1.5 and stop_multiplier <= 3.5),
  checked_items jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_trade_checklists_trade on trade_checklists(trade_id);

-- Touch updated_at on any change.
create or replace function trade_checklists_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trade_checklists_touch on trade_checklists;
create trigger trade_checklists_touch
  before update on trade_checklists
  for each row execute function trade_checklists_touch();
