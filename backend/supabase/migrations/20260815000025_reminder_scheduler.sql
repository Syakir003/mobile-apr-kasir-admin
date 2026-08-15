-- =============================================================================
-- Fase 8 — Scheduler harian pengingat servis (H-3 dan H+7).
--
-- CATATAN DEPLOY: `pg_cron` harus diaktifkan lebih dulu di Dashboard Supabase
-- (Database -> Extensions) untuk proyek hosted. Bila belum aktif, `create
-- extension` di bawah gagal saat `db push` — aktifkan dulu, baru deploy.
--
-- Fungsi ini hanya MEMANEN jadwal jadi baris antrean; pengiriman aktual
-- dilakukan adapter (manual wa.me sekarang, Cloud API nanti). Aman dipanggil
-- berkali-kali dalam sehari — `dedupe_key` unik yang menjaga, bukan penjadwalan
-- yang harus tepat sekali jalan.
-- =============================================================================

create extension if not exists pg_cron;

create or replace function enqueue_service_reminders()
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
begin
  with due as (
    select u.id                        as unit_id,
           u.member_id                 as member_id,
           u.next_service_date::date   as due_date,
           case
             when u.next_service_date::date = current_date + 3 then 'reminder_h3'
             when u.next_service_date::date = current_date - 7 then 'reminder_h7'
           end                         as kind
      from member_ac_units u
      join members m on m.id = u.member_id
     where u.next_service_date is not null
       and u.status = 'aktif'
       and m.active
       and not m.wa_opt_out
       and wa_phone(m.phone) <> ''
       and u.next_service_date::date in (current_date + 3, current_date - 7)
       -- "jika belum pesan": begitu unit punya job yang masih berjalan,
       -- pengingat berhenti sendiri. Saat job itu selesai, next_service_date
       -- bergeser ke siklus baru sehingga baris ini tak pernah cocok lagi —
       -- tidak perlu state "sudah diingatkan" terpisah.
       and not exists (
         select 1 from technician_jobs j
          where j.unit_id = u.id
            and j.status not in ('selesai', 'dibatalkan')
       )
  ), grouped as (
    -- Satu pelanggan dengan 3 AC jatuh tempo di hari yang sama menerima SATU
    -- pesan berisi 3 unit, bukan 3 pesan. Selain lebih sopan, ini juga menekan
    -- biaya saat nanti pindah ke Cloud API (tarif per pesan).
    select member_id, kind, due_date, array_agg(unit_id order by unit_id) as unit_ids
      from due
     where kind is not null
     group by member_id, kind, due_date
  )
  insert into wa_outbox (member_id, member_name, phone, kind, unit_ids, due_date,
                         body, dedupe_key)
  select g.member_id,
         m.name,
         wa_phone(m.phone),
         g.kind,
         g.unit_ids,
         g.due_date,
         build_wa_body(g.member_id, g.kind, g.unit_ids, g.due_date),
         g.member_id::text || ':' || g.kind || ':' || g.due_date::text
    from grouped g
    join members m on m.id = g.member_id
  on conflict (dedupe_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Dipanggil pg_cron (peran postgres), tidak pernah dari client.
revoke execute on function enqueue_service_reminders() from anon, public;

-- 02:00 UTC = 09:00 WIB — antrean sudah siap saat admin mulai kerja pagi,
-- bukan menumpuk tengah malam.
select cron.unschedule('pengingat-servis-harian')
 where exists (select 1 from cron.job where jobname = 'pengingat-servis-harian');

select cron.schedule('pengingat-servis-harian', '0 2 * * *',
                     $$select enqueue_service_reminders()$$);
