-- Separate explicit Save draft checkpoints from autosave / Undo revisions.
-- Existing append-only drafts and access policies remain unchanged.
alter table public.studio_canvas_drafts
  add column if not exists is_checkpoint boolean not null default false;
create index if not exists studio_canvas_checkpoint_lookup
  on public.studio_canvas_drafts(client_id,snapshot_id,revision desc)
  where is_checkpoint = true;
comment on column public.studio_canvas_drafts.is_checkpoint is
  'Explicit saved draft checkpoint. The editor displays the latest six; autosaves are not checkpoints.';
