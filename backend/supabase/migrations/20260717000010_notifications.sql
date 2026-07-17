-- =============================================================================
-- Fase 5 — Notifikasi realtime in-app (Supabase Realtime, tanpa FCM).
--
-- Notifikasi dibuat oleh TRIGGER DB (bukan redefinisi RPC) agar robust apa pun
-- jalur penulisannya:
--   * job ditugaskan/di-assign ke teknisi         -> notif ke teknisi
--   * pengajuan tambahan dibuat                    -> notif ke semua admin/kasir
--   * pengajuan diputuskan (approve/reject)        -> notif ke teknisi pembuat
--
-- Client subscribe lewat `.stream()` (Realtime menghormati RLS: user hanya
-- menerima baris miliknya). Tandai terbaca lewat RPC `mark_notifications_read`.
-- =============================================================================

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  title text not null,
  body text not null default '',
  type text not null default 'info',   -- 'job_assigned'|'request_submitted'|'request_decided'
  target text,                         -- id entitas terkait (jobId/requestId) utk deep-link
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx
  on notifications (user_id, created_at desc);

alter table notifications enable row level security;

-- Baca hanya notif sendiri. Update (tandai terbaca) lewat RPC — tak di-grant.
grant select on notifications to authenticated;
create policy "notifications: baca sendiri"
  on notifications for select to authenticated
  using (user_id = auth.uid());

-- Realtime: subscriber hanya menerima baris yang lolos RLS (miliknya sendiri).
alter publication supabase_realtime add table notifications;

-- ------------------------------------------------------------- trigger helpers
-- Notif saat job diassign (INSERT dgn teknisi, atau teknisi berubah) & 'assigned'.
create or replace function notify_job_assigned()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.technician_id is not null
     and new.status = 'assigned'
     and (tg_op = 'INSERT'
          or new.technician_id is distinct from old.technician_id) then
    insert into notifications (user_id, title, body, type, target)
    values (new.technician_id, 'Job baru ditugaskan',
            'Anda mendapat tugas ' || coalesce(new.type, 'pekerjaan') || '.',
            'job_assigned', new.id::text);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_job_assigned on technician_jobs;
create trigger trg_notify_job_assigned
  after insert or update of technician_id, status on technician_jobs
  for each row execute function notify_job_assigned();

-- Notif ke semua admin/kasir saat pengajuan tambahan dibuat.
create or replace function notify_request_submitted()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_u record;
begin
  for v_u in
    select id from users where role in ('admin', 'kasir') and active
  loop
    insert into notifications (user_id, title, body, type, target)
    values (v_u.id, 'Pengajuan tambahan baru',
            'Ada pengajuan sparepart/material menunggu persetujuan.',
            'request_submitted', new.id::text);
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_notify_request_submitted on material_requests;
create trigger trg_notify_request_submitted
  after insert on material_requests
  for each row execute function notify_request_submitted();

-- Notif ke teknisi pembuat saat pengajuan diputuskan.
create or replace function notify_request_decided()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status in ('approved', 'rejected')
     and new.status is distinct from old.status
     and new.created_by is not null then
    insert into notifications (user_id, title, body, type, target)
    values (new.created_by,
            case when new.status = 'approved'
                 then 'Pengajuan disetujui' else 'Pengajuan ditolak' end,
            coalesce(new.decision_note, ''),
            'request_decided', new.id::text);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_request_decided on material_requests;
create trigger trg_notify_request_decided
  after update of status on material_requests
  for each row execute function notify_request_decided();

-- =============================================================================
-- mark_notifications_read(payload) — tandai terbaca (satu id, atau semua milik
-- pemanggil bila tanpa notificationId). Return: { ok, updated }
-- =============================================================================
create or replace function mark_notifications_read(payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_id uuid;
  v_count integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Tidak terautentikasi';
  end if;

  if payload ? 'notificationId'
     and btrim(coalesce(payload ->> 'notificationId', '')) <> '' then
    v_id := (payload ->> 'notificationId')::uuid;
    update notifications set read = true
     where id = v_id and user_id = v_uid and not read;
  else
    update notifications set read = true
     where user_id = v_uid and not read;
  end if;
  get diagnostics v_count = row_count;

  return jsonb_build_object('ok', true, 'updated', v_count);
end;
$$;
