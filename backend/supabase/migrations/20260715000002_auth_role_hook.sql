-- =============================================================================
-- Auth: salin role dari public.users ke klaim JWT `user_role`.
-- Pengganti Firebase custom claims. Diaktifkan lewat config.toml:
--   [auth.hook.custom_access_token]
--   uri = "pg-functions://postgres/public/custom_access_token_hook"
-- Klaim hanya diberikan bila user AKTIF — user nonaktif kehilangan role saat
-- token berikutnya diterbitkan, dan client menolak sesi tanpa role.
-- =============================================================================

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_role text;
  claims jsonb;
begin
  select role::text into v_role
  from public.users
  where id = (event ->> 'user_id')::uuid and active;

  claims := coalesce(event -> 'claims', '{}'::jsonb);
  if v_role is not null then
    claims := jsonb_set(claims, '{user_role}', to_jsonb(v_role));
  end if;
  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- Hanya service auth (supabase_auth_admin) yang boleh memanggil hook ini.
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb)
  from authenticated, anon, public;

-- Hook berjalan sebagai supabase_auth_admin: butuh baca public.users,
-- termasuk policy RLS eksplisit (RLS tabel users deny-all bagi role lain).
grant usage on schema public to supabase_auth_admin;
grant select on table public.users to supabase_auth_admin;

create policy "auth admin baca role users"
  on public.users
  for select
  to supabase_auth_admin
  using (true);

-- Helper RLS: role pemanggil dari klaim JWT `user_role` ('' bila tak ada).
create or replace function public.jwt_role()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'user_role', '');
$$;
