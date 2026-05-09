-- Tracks where a trade came from. The portfolio→trades auto-sync writes
-- source='portfolio' rows on every upload (and reconciles them away if the
-- position is no longer in the broker snapshot). Manual entries keep
-- source='manual' (default) and the sidebar tags them as WIP — the user's
-- aspirational/research trades that haven't been opened yet.

alter table trades add column if not exists source text not null default 'manual';

-- Cheap to filter on for sync reconciliation queries.
create index if not exists trades_source_idx on trades(source);
