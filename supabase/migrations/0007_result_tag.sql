-- Result tag on the journal row. Auto-derived from realized P/L sign at
-- close-time, but persisted so the user can override (e.g., mark a tiny
-- profit as a "scratch" because the thesis didn't really play out).
--
-- Null = legacy rows pre-dating this column; render auto-derived in the UI.

alter table closed_trades
  add column if not exists result_tag text
    check (result_tag in ('win','loss','scratch'));

create index if not exists closed_trades_result_tag_idx on closed_trades(result_tag);
