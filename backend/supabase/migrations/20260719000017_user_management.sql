-- =============================================================================
-- Fase 6 — Manajemen akun oleh Admin (dok. fitur bab 4.4).
--
-- Sebelumnya `public.users` hanya bisa disunting lewat SQL/dashboard: tidak ada
-- policy UPDATE dan tidak ada GRANT, jadi peran & status aktif user tak bisa
-- diubah dari aplikasi sama sekali. Migrasi ini menambah RPC
-- `update_user_account` (SECURITY DEFINER, admin) — tetap tanpa GRANT UPDATE ke
-- client, sesuai aturan "semua tulis lewat RPC".
--
-- Pembuatan akun BARU tidak ada di sini: menulis ke `auth.users` butuh
-- service_role yang tidak boleh ada di aplikasi. Itu ditangani Edge Function
-- `admin-users` (lihat backend/supabase/functions/admin-users/).
--
-- Penjaga supaya sistem tidak bisa terkunci dari luar:
--   1. Admin tidak boleh menurunkan peran / menonaktifkan dirinya sendiri.
--      Ini yang benar-benar menegakkan invarian "selalu ada >= 1 admin aktif":
--      untuk menyentuh akun admin mana pun, pemanggil HARUS admin aktif, dan ia
--      tidak boleh menyentuh dirinya sendiri — jadi jumlah admin aktif tak
--      pernah bisa turun ke nol.
--   2. Cek "admin aktif terakhir" di bawah adalah sabuk pengaman berlapis, dan
--      dengan aturan (1) di atas praktis TIDAK PERNAH TERPICU (pemanggil sendiri
--      selalu terhitung sebagai admin aktif lain). Sengaja dipertahankan supaya
--      invarian tetap terjaga bila kelak aturan (1) dilonggarkan.
-- =============================================================================

-- =============================================================================
-- update_user_account(payload) — ubah peran / status aktif / nama tampilan.
-- Payload: { userId, role?: 'admin'|'kasir'|'teknisi', active?: bool,
--            displayName?: text }
-- Field yang tidak dikirim = tidak diubah.
-- Return: { ok, userId, role, active, displayName }
-- =============================================================================
create or replace function update_user_account(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_target uuid;
  v_role text;
  v_active boolean;
  v_name text;
  v_cur_role text;
  v_cur_active boolean;
  v_cur_name text;
  v_new_role text;
  v_new_active boolean;
  v_new_name text;
  v_admin_count integer;
begin
  v_uid := assert_caller_role(array['admin'],
    'Hanya Admin yang boleh mengelola akun');

  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Input kosong';
  end if;

  if jsonb_typeof(payload -> 'userId') is distinct from 'string'
     or btrim(payload ->> 'userId') = '' then
    raise exception 'userId wajib diisi';
  end if;
  v_target := (payload ->> 'userId')::uuid;

  -- Hanya field yang benar-benar dikirim yang dianggap perubahan.
  v_role := nullif(btrim(coalesce(payload ->> 'role', '')), '');
  if v_role is not null and v_role not in ('admin', 'kasir', 'teknisi') then
    raise exception 'Peran harus admin/kasir/teknisi';
  end if;

  if payload ? 'active' then
    if jsonb_typeof(payload -> 'active') <> 'boolean' then
      raise exception 'Status aktif tidak valid';
    end if;
    v_active := (payload ->> 'active')::boolean;
  end if;

  v_name := nullif(btrim(coalesce(payload ->> 'displayName', '')), '');

  if v_role is null and v_active is null and v_name is null then
    raise exception 'Tidak ada perubahan';
  end if;

  select role::text, active, display_name
    into v_cur_role, v_cur_active, v_cur_name
    from users where id = v_target for update;
  if not found then
    raise exception 'Pengguna tidak ditemukan';
  end if;

  v_new_role := coalesce(v_role, v_cur_role);
  v_new_active := coalesce(v_active, v_cur_active);
  v_new_name := coalesce(v_name, v_cur_name);

  -- Penjaga 1: jangan sampai admin mengunci dirinya sendiri keluar.
  if v_target = v_uid then
    if v_new_role <> 'admin' then
      raise exception 'Tidak bisa menurunkan peran akun Anda sendiri';
    end if;
    if not v_new_active then
      raise exception 'Tidak bisa menonaktifkan akun Anda sendiri';
    end if;
  end if;

  -- Penjaga 2 (berlapis, praktis tak pernah terpicu — lihat catatan di atas):
  -- sistem harus selalu punya minimal satu admin aktif.
  if v_cur_role = 'admin' and v_cur_active
     and (v_new_role <> 'admin' or not v_new_active) then
    select count(*) into v_admin_count
      from users where role = 'admin' and active and id <> v_target;
    if v_admin_count = 0 then
      raise exception 'Minimal harus ada satu Admin aktif';
    end if;
  end if;

  update users
     set role = v_new_role::user_role,
         active = v_new_active,
         display_name = v_new_name
   where id = v_target;

  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'user.update', v_target::text,
          jsonb_build_object(
            'before', jsonb_build_object('role', v_cur_role,
                                         'active', v_cur_active,
                                         'displayName', v_cur_name),
            'after', jsonb_build_object('role', v_new_role,
                                        'active', v_new_active,
                                        'displayName', v_new_name)));

  return jsonb_build_object('ok', true, 'userId', v_target,
                            'role', v_new_role, 'active', v_new_active,
                            'displayName', v_new_name);
end;
$$;

revoke execute on function update_user_account(jsonb) from anon, public;
grant execute on function update_user_account(jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- Admin perlu melihat SEMUA akun (policy 0003 hanya mengizinkan baca diri
-- sendiri untuk teknisi; admin/kasir sudah tercakup). Tidak ada perubahan
-- policy yang dibutuhkan — dicatat di sini agar jelas saat audit.
-- -----------------------------------------------------------------------------
