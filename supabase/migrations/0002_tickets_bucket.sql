-- Ensure the tickets storage bucket (private) exists.
-- Safe to run multiple times; on conflict is a no-op.
insert into storage.buckets (id, name, public)
values ('tickets', 'tickets', false)
on conflict (id) do nothing;
