-- =============================================================================
-- Fase 7 — Pemicu FCM push: panggil Edge Function `send-push` saat notifikasi
-- dibuat, lewat pg_net (async, non-blocking).
--
-- Konfigurasi disimpan di `app_config` (BUKAN di migrasi) supaya URL & secret
-- tak ter-commit. Bila belum dikonfigurasi, trigger no-op → notifikasi in-app
-- tetap berjalan normal dan INSERT tak pernah gagal gara-gara push.
--
-- SETUP (setelah deploy fungsi + set secret; ganti <…>):
--   insert into app_config(key,value) values
--     ('push_function_url','https://<ref>.supabase.co/functions/v1/send-push'),
--     ('push_secret','<sama dgn PUSH_WEBHOOK_SECRET>')
--   on conflict (key) do update set value = excluded.value;
-- =============================================================================

create extension if not exists pg_net;

create table if not exists app_config (
  key text primary key,
  value text not null
);
-- Internal saja; tak di-grant ke authenticated & tanpa policy (tertutup RLS).
alter table app_config enable row level security;

create or replace function enqueue_push()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_url text;
  v_secret text;
begin
  select value into v_url from app_config where key = 'push_function_url';
  if v_url is null or v_url = '' then
    return new;  -- belum dikonfigurasi → lewati
  end if;
  select value into v_secret from app_config where key = 'push_secret';

  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('record', to_jsonb(new)),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', coalesce(v_secret, '')
    )
  );
  return new;
exception when others then
  -- Push gagal TIDAK boleh menggagalkan insert notifikasi.
  raise warning 'enqueue_push gagal: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_enqueue_push on notifications;
create trigger trg_enqueue_push
  after insert on notifications
  for each row execute function enqueue_push();
