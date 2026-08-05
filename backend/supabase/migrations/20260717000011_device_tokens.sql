-- =============================================================================
-- Fase 7 — FCM push: registrasi device token per user.
--
-- Melengkapi notifikasi in-app (0010) dengan PUSH ke HP saat app tertutup.
-- Backend tetap Supabase: tabel `device_tokens` mengikat FCM token ke user_id;
-- Edge Function `send-push` (di supabase/functions) yang memanggil FCM HTTP v1.
-- Firebase HANYA jadi transport (klien pakai firebase_messaging utk terima).
--
-- Token unik global: satu device (token) hanya milik satu user pada satu waktu —
-- bila HP dipakai login user lain, token dipindah (upsert) ke user itu. Saat
-- logout, klien memanggil unregister agar user lama tak menerima push berikutnya.
-- =============================================================================

create table if not exists device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  token text not null unique,
  platform text not null default 'unknown',  -- 'android'|'ios'|'web'
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists device_tokens_user_idx on device_tokens (user_id);

alter table device_tokens enable row level security;

-- Baca hanya token sendiri (jarang dipakai klien; tulis via RPC).
grant select on device_tokens to authenticated;
create policy "device tokens: baca sendiri"
  on device_tokens for select to authenticated
  using (user_id = auth.uid());

-- =============================================================================
-- register_device_token(payload) — daftarkan/segarkan token milik pemanggil.
-- Payload: { token, platform? }. Upsert by token (pindah kepemilikan bila perlu).
-- =============================================================================
create or replace function register_device_token(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_token text;
  v_platform text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Tidak terautentikasi';
  end if;

  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Input kosong';
  end if;
  v_token := btrim(coalesce(payload ->> 'token', ''));
  if v_token = '' then
    raise exception 'token wajib diisi';
  end if;
  v_platform := coalesce(nullif(btrim(coalesce(payload ->> 'platform', '')), ''),
                         'unknown');

  insert into device_tokens (user_id, token, platform)
  values (v_uid, v_token, v_platform)
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

-- =============================================================================
-- unregister_device_token(payload) — hapus token milik pemanggil (saat logout).
-- Payload: { token }
-- =============================================================================
create or replace function unregister_device_token(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_token text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Tidak terautentikasi';
  end if;
  v_token := btrim(coalesce(payload ->> 'token', ''));
  if v_token <> '' then
    delete from device_tokens where token = v_token and user_id = v_uid;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
