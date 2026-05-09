-- Closed-trade journal. When the user closes a position (vs. canceling
-- before entry, or deleting because a parse was wrong), we snapshot the
-- entire trade — legs, premiums, exit price, realized P/L — into one jsonb
-- row so the live `trades` table stays focused on open positions and the
-- journal is a separate, query-friendly history.
--
-- Single-user app, RLS not required. Add it later if multi-tenant.

create table if not exists closed_trades (
  id uuid primary key default gen_random_uuid(),
  -- Original trade id (nullable) so future cross-references stay possible
  -- without preventing deletion of the live row when closed.
  source_trade_id uuid,
  symbol text not null,
  -- "closed" = position exited (counted in stats). "canceled" = never opened
  -- or parse-error, kept out of stats but still recoverable.
  outcome text not null check (outcome in ('closed','canceled')),
  -- Snapshot of the original Trade payload for full reconstruction.
  trade_snapshot jsonb not null,
  -- Realized economics. Null for canceled rows.
  entry_credit numeric,         -- net premium at entry (positive = credit)
  exit_credit numeric,          -- net premium at exit (positive = credit to close)
  realized_pnl numeric,         -- entry_credit + exit_credit, broker-style
  realized_pnl_pct numeric,     -- realized_pnl / capital_at_risk * 100
  capital_at_risk numeric,      -- denominator for the % calc
  notes text,                   -- free-form journal entry
  closed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists closed_trades_closed_at_idx on closed_trades(closed_at desc);
create index if not exists closed_trades_symbol_idx on closed_trades(symbol);
create index if not exists closed_trades_outcome_idx on closed_trades(outcome);
