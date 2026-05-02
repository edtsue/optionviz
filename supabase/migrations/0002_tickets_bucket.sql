-- Create the tickets storage bucket (private) for uploaded ticket screenshots.
-- The bucket is private: all access goes through signed URLs generated server-side.
insert into storage.buckets (id, name, public)
values ('tickets', 'tickets', false)
on conflict (id) do nothing;
