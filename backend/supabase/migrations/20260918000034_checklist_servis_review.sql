-- =============================================================================
-- Checklist temuan servis + review Admin — port dari Nest
-- `20260822030000_job_findings_checklist` dan TechnicianJobsService
-- (addFinding, addFindingPhoto, submitForReview, approveComplete, sendBack).
--
-- * problem_categories : daftar jenis kerusakan untuk autocomplete. Tumbuh
--                        sendiri: judul baru dari teknisi jadi baris 'auto';
--                        yang dikurasi admin 'seed'. Unik tanpa beda huruf besar.
-- * job_findings       : temuan per job (boleh banyak).
-- * job_finding_photos : foto sebelum/sesudah PER TEMUAN (boleh banyak per jenis).
--                        File tetap di bucket Storage `job-photos` yang sudah
--                        ada (policy upload teknisi/admin dari 0008 berlaku).
-- * technician_jobs.review_note : catatan Admin saat mengembalikan job.
--
-- Alur review (tambahan, BUKAN pengganti):
--   sedang_dikerjakan --submit_review--> menunggu_review --approve--> selesai
--                                              \--send_back--> sedang_dikerjakan
-- Action lama `complete` SENGAJA DIPERTAHANKAN apa adanya: app mobile & web yang
-- sedang live masih memanggilnya. Menghapusnya = breaking change yang butuh
-- rilis app serentak. Hapus `complete` di migrasi terpisah setelah UI pindah.
--
-- RLS baca mengikuti pola hardening 0020 (job_photos): admin/kasir semua,
-- teknisi hanya job yang terlihat olehnya (my_visible_job_ids). Tulis lewat RPC.
-- =============================================================================

-- ------------------------------------------------------------ problem_categories
create table if not exists problem_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  source text not null default 'seed' check (source in ('seed', 'auto')),
  created_at timestamptz not null default now()
);
create unique index if not exists problem_categories_name_lower_key
  on problem_categories (lower(name));

-- ------------------------------------------------------------------ job_findings
create table if not exists job_findings (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references technician_jobs (id) on delete cascade,
  category_id uuid not null references problem_categories (id),
  -- Judul disimpan sendiri supaya histori utuh walau nama kategori diubah.
  title text not null,
  note text,
  origin text not null default 'ditambah_teknisi'
    check (origin in ('komplain_awal', 'ditambah_teknisi')),
  created_by uuid references users (id),
  created_at timestamptz not null default now()
);
create index if not exists job_findings_job_idx on job_findings (job_id);

-- ------------------------------------------------------------ job_finding_photos
create table if not exists job_finding_photos (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references job_findings (id) on delete cascade,
  kind text not null check (kind in ('sebelum', 'sesudah')),
  path text not null,               -- object path dalam bucket `job-photos`
  uploaded_by uuid references users (id),
  created_at timestamptz not null default now()
);
create index if not exists job_finding_photos_finding_kind_idx
  on job_finding_photos (finding_id, kind);

-- ------------------------------------------------------------- kolom review
alter table technician_jobs
  add column if not exists review_note text;

-- ----------------------------------------------------------------------- akses
alter table problem_categories enable row level security;
alter table job_findings enable row level security;
alter table job_finding_photos enable row level security;

-- Kategori = master data: baca semua user login, kurasi (tambah/ubah) admin.
grant select, insert, update on problem_categories to authenticated;

drop policy if exists "problem categories: baca user login" on problem_categories;
create policy "problem categories: baca user login"
  on problem_categories for select to authenticated using (true);

drop policy if exists "problem categories: tulis admin" on problem_categories;
create policy "problem categories: tulis admin"
  on problem_categories for insert to authenticated
  with check (jwt_role() = 'admin');

drop policy if exists "problem categories: ubah admin" on problem_categories;
create policy "problem categories: ubah admin"
  on problem_categories for update to authenticated
  using (jwt_role() = 'admin') with check (jwt_role() = 'admin');

-- Temuan & foto: baca saja; tulis lewat RPC.
grant select on job_findings, job_finding_photos to authenticated;

drop policy if exists "job findings: baca admin/kasir" on job_findings;
create policy "job findings: baca admin/kasir"
  on job_findings for select to authenticated
  using (jwt_role() in ('admin', 'kasir'));

drop policy if exists "job findings: baca teknisi (job terlihat)" on job_findings;
create policy "job findings: baca teknisi (job terlihat)"
  on job_findings for select to authenticated
  using (jwt_role() = 'teknisi' and job_id in (select my_visible_job_ids()));

-- Ikut induknya: subquery ke job_findings tetap kena RLS di atas.
drop policy if exists "job finding photos: baca sesuai induk" on job_finding_photos;
create policy "job finding photos: baca sesuai induk"
  on job_finding_photos for select to authenticated
  using (finding_id in (select f.id from job_findings f));

-- =============================================================================
-- add_job_finding(payload) — tambah temuan ke job aktif.
-- Payload: { jobId, categoryId? , categoryName?, note? }
--   categoryId   : pilih dari autocomplete, ATAU
--   categoryName : ketik bebas — dipakai ulang bila sudah ada (tanpa beda huruf
--                  besar), dibuat baru (source 'auto') bila belum.
-- Otorisasi: admin (semua job) atau teknisi pemilik job; job assigned/dikerjakan.
-- Return: { ok, id, categoryId, title }
-- =============================================================================
create or replace function add_job_finding(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_role text;
  v_job_id uuid;
  v_owner uuid;
  v_status text;
  v_cat_id uuid;
  v_cat_name text;
  v_note text;
  v_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Tidak terautentikasi';
  end if;
  v_role := jwt_role();

  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Input kosong';
  end if;
  if jsonb_typeof(payload -> 'jobId') is distinct from 'string'
     or btrim(payload ->> 'jobId') = '' then
    raise exception 'jobId wajib diisi';
  end if;

  v_job_id := (payload ->> 'jobId')::uuid;
  v_note := nullif(btrim(coalesce(payload ->> 'note', '')), '');

  select technician_id, status into v_owner, v_status
    from technician_jobs where id = v_job_id;
  if not found then
    raise exception 'Job tidak ditemukan';
  end if;

  -- Teknisi hanya untuk job miliknya; admin bebas. Kasir tak boleh.
  if v_role = 'teknisi' then
    if v_owner is distinct from v_uid then
      raise exception 'Job ini bukan milik Anda';
    end if;
  elsif v_role <> 'admin' then
    raise exception 'Tidak diizinkan menambah temuan';
  end if;

  if v_status not in ('assigned', 'sedang_dikerjakan') then
    raise exception 'Temuan hanya bisa ditambahkan saat job aktif';
  end if;

  if btrim(coalesce(payload ->> 'categoryId', '')) <> '' then
    select id, name into v_cat_id, v_cat_name
      from problem_categories where id = (payload ->> 'categoryId')::uuid;
    if not found then
      raise exception 'Kategori tidak ditemukan';
    end if;
  else
    v_cat_name := btrim(coalesce(payload ->> 'categoryName', ''));
    if v_cat_name = '' then
      raise exception 'categoryId atau categoryName wajib diisi';
    end if;
    -- `on conflict do nothing` menutup race dua teknisi mengetik nama yang sama.
    insert into problem_categories (name, source)
    values (v_cat_name, 'auto')
    on conflict ((lower(name))) do nothing;
    select id, name into v_cat_id, v_cat_name
      from problem_categories where lower(name) = lower(v_cat_name);
  end if;

  insert into job_findings (job_id, category_id, title, note, origin, created_by)
  values (v_job_id, v_cat_id, v_cat_name, v_note, 'ditambah_teknisi', v_uid)
  returning id into v_id;

  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'job.finding', v_job_id::text,
          jsonb_build_object('findingId', v_id, 'title', v_cat_name));

  return jsonb_build_object('ok', true, 'id', v_id,
    'categoryId', v_cat_id, 'title', v_cat_name);
end;
$$;

revoke execute on function add_job_finding(jsonb) from anon, public;
grant execute on function add_job_finding(jsonb) to authenticated;

-- =============================================================================
-- add_job_finding_photo(payload) — catat metadata foto temuan setelah client
-- upload ke bucket `job-photos`. Boleh berkali-kali per jenis.
-- Payload: { findingId, kind: 'sebelum'|'sesudah', path }
-- Otorisasi: sama add_job_photo (0008) — admin, atau teknisi pemilik job.
-- Return: { ok, id }
-- =============================================================================
create or replace function add_job_finding_photo(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_role text;
  v_finding_id uuid;
  v_kind text;
  v_path text;
  v_job_id uuid;
  v_owner uuid;
  v_status text;
  v_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Tidak terautentikasi';
  end if;
  v_role := jwt_role();

  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Input kosong';
  end if;
  if jsonb_typeof(payload -> 'findingId') is distinct from 'string'
     or btrim(payload ->> 'findingId') = '' then
    raise exception 'findingId wajib diisi';
  end if;

  v_finding_id := (payload ->> 'findingId')::uuid;
  v_kind := btrim(coalesce(payload ->> 'kind', ''));
  v_path := btrim(coalesce(payload ->> 'path', ''));

  if v_kind not in ('sebelum', 'sesudah') then
    raise exception 'Jenis foto harus sebelum/sesudah';
  end if;
  if v_path = '' then
    raise exception 'path foto wajib diisi';
  end if;

  select j.id, j.technician_id, j.status into v_job_id, v_owner, v_status
    from job_findings f
    join technician_jobs j on j.id = f.job_id
   where f.id = v_finding_id;
  if not found then
    raise exception 'Temuan tidak ditemukan';
  end if;

  if v_role = 'teknisi' then
    if v_owner is distinct from v_uid then
      raise exception 'Job ini bukan milik Anda';
    end if;
  elsif v_role <> 'admin' then
    raise exception 'Tidak diizinkan mengunggah foto';
  end if;

  if v_status not in ('assigned', 'sedang_dikerjakan') then
    raise exception 'Foto hanya bisa ditambahkan saat job aktif';
  end if;

  insert into job_finding_photos (finding_id, kind, path, uploaded_by)
  values (v_finding_id, v_kind, v_path, v_uid)
  returning id into v_id;

  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'job.finding_photo', v_job_id::text,
          jsonb_build_object('findingId', v_finding_id, 'kind', v_kind,
                             'path', v_path));

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke execute on function add_job_finding_photo(jsonb) from anon, public;
grant execute on function add_job_finding_photo(jsonb) to authenticated;

-- =============================================================================
-- update_technician_job_status — DEFINISI ULANG dari 0024 (definisi final).
-- Payload: { jobId, action, notes?, scannedBarcode? }
--
-- Perubahan terhadap 0024:
--   * start / complete / cancel : logika identik; hanya tambah updated_at.
--   * submit_review (teknisi pemilik/admin): sedang_dikerjakan -> menunggu_review.
--       Gate: >= 1 temuan; tiap temuan punya foto sebelum DAN sesudah; tidak ada
--       pengajuan pending; tidak ada pengajuan approved yang belum dipakai.
--       review_note lama dikosongkan.
--   * approve (admin): menunggu_review -> selesai. Efek samping SAMA dengan
--       complete (blok dipakai bersama): unit, next_service_date, wa_outbox
--       'selesai_servis', penutupan order.
--   * send_back (admin): menunggu_review -> sedang_dikerjakan; notes wajib,
--       disimpan ke review_note.
-- =============================================================================
create or replace function update_technician_job_status(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_role text;
  v_job_id uuid;
  v_action text;
  v_notes text;
  v_scanned text;
  v_job record;
  v_all_done boolean;
  v_any_done boolean;
  v_all_final boolean;
  -- Fase 8 — penjadwalan servis berikutnya.
  v_interval integer;
  v_member_id uuid;
  v_next timestamptz;
  -- Review temuan.
  v_locked_status text;
  v_finding_title text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Tidak terautentikasi';
  end if;
  v_role := jwt_role();

  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Input kosong';
  end if;
  if jsonb_typeof(payload -> 'jobId') is distinct from 'string'
     or btrim(payload ->> 'jobId') = '' then
    raise exception 'jobId wajib diisi';
  end if;
  v_job_id := (payload ->> 'jobId')::uuid;
  v_action := payload ->> 'action';
  v_notes := nullif(btrim(coalesce(payload ->> 'notes', '')), '');
  v_scanned := nullif(btrim(coalesce(payload ->> 'scannedBarcode', '')), '');

  select j.id, j.order_id, j.unit_id, j.technician_id, j.type, j.status,
         u.barcode_value as unit_barcode
    into v_job
    from technician_jobs j
    left join member_ac_units u on u.id = j.unit_id
   where j.id = v_job_id;
  if not found then
    raise exception 'Job tidak ditemukan';
  end if;

  if v_role = 'teknisi' then
    if v_job.technician_id is distinct from v_uid then
      raise exception 'Job ini bukan milik Anda';
    end if;
  elsif v_role <> 'admin' then
    raise exception 'Tidak diizinkan';
  end if;

  if v_action = 'start' then
    if v_job.status <> 'assigned' then
      raise exception 'Job harus berstatus Ditugaskan untuk dimulai';
    end if;
    -- Scan wajib hanya bila unit punya barcode (rule 8.2).
    if v_job.unit_id is not null and coalesce(v_job.unit_barcode, '') <> '' then
      if v_scanned is null then
        raise exception 'Scan barcode unit diperlukan sebelum memulai';
      end if;
      if v_scanned <> v_job.unit_barcode then
        raise exception 'Barcode tidak sesuai unit pada job ini';
      end if;
    end if;
    -- Foto SEBELUM wajib sebelum memulai (rule 8.3).
    if not exists (
      select 1 from job_photos where job_id = v_job_id and kind = 'sebelum'
    ) then
      raise exception 'Foto SEBELUM wajib diunggah sebelum memulai pekerjaan';
    end if;
    update technician_jobs
       set status = 'sedang_dikerjakan',
           started_at = now(),
           notes = coalesce(v_notes, notes),
           updated_at = now()
     where id = v_job_id;
    update service_order_units set status = 'dalam_pengerjaan'
     where order_id = v_job.order_id and unit_id is not distinct from v_job.unit_id;
    if v_job.unit_id is not null then
      -- Hanya unit yang sedang `aktif` yang ditandai maintenance; unit `rusak`
      -- atau `menunggu_pemasangan` tidak boleh kehilangan statusnya.
      update member_ac_units set status = 'dalam_maintenance'
       where id = v_job.unit_id and status = 'aktif';
    end if;

  elsif v_action = 'submit_review' then
    -- Kunci baris job lalu baca ulang statusnya: pengajuan material yang masuk
    -- bersamaan tidak boleh lolos di antara cek dan perubahan status.
    select status into v_locked_status
      from technician_jobs where id = v_job_id for update;
    if v_locked_status is distinct from 'sedang_dikerjakan' then
      raise exception 'Job harus Sedang Dikerjakan untuk diajukan selesai';
    end if;
    if not exists (select 1 from job_findings where job_id = v_job_id) then
      raise exception 'Minimal 1 temuan masalah harus diisi sebelum job bisa diajukan selesai';
    end if;
    select f.title into v_finding_title
      from job_findings f
     where f.job_id = v_job_id
       and (not exists (select 1 from job_finding_photos p
                         where p.finding_id = f.id and p.kind = 'sebelum')
            or not exists (select 1 from job_finding_photos p
                            where p.finding_id = f.id and p.kind = 'sesudah'))
     order by f.created_at
     limit 1;
    if found then
      raise exception 'Temuan "%" wajib punya foto SEBELUM dan SESUDAH sebelum job bisa diajukan selesai',
        v_finding_title;
    end if;
    if exists (
      select 1 from material_requests
       where job_id = v_job_id and status = 'pending'
    ) then
      raise exception 'Masih ada pengajuan tambahan yang belum diputuskan';
    end if;
    if exists (
      select 1 from material_requests
       where job_id = v_job_id and status = 'approved' and used_at is null
    ) then
      raise exception 'Tandai material yang disetujui sebagai dipakai sebelum mengajukan selesai';
    end if;
    update technician_jobs
       set status = 'menunggu_review',
           review_note = null,
           notes = coalesce(v_notes, notes),
           updated_at = now()
     where id = v_job_id;

  elsif v_action in ('complete', 'approve') then
    if v_action = 'complete' then
      if v_job.status <> 'sedang_dikerjakan' then
        raise exception 'Job harus Sedang Dikerjakan untuk diselesaikan';
      end if;
      if not exists (
        select 1 from job_photos where job_id = v_job_id and kind = 'sebelum'
      ) then
        raise exception 'Foto SEBELUM wajib diunggah sebelum menyelesaikan pekerjaan';
      end if;
      if not exists (
        select 1 from job_photos where job_id = v_job_id and kind = 'sesudah'
      ) then
        raise exception 'Foto SESUDAH wajib diunggah sebelum menyelesaikan pekerjaan';
      end if;
      if exists (
        select 1 from material_requests
         where job_id = v_job_id and status = 'pending'
      ) then
        raise exception 'Masih ada pengajuan tambahan yang belum diputuskan';
      end if;
      if exists (
        select 1 from material_requests
         where job_id = v_job_id and status = 'approved' and used_at is null
      ) then
        raise exception 'Tandai material yang disetujui sebagai dipakai sebelum menyelesaikan';
      end if;
    else
      -- approve: review visual Admin adalah gate-nya; gate teknis sudah dicek
      -- saat submit_review.
      if v_role <> 'admin' then
        raise exception 'Hanya Admin yang boleh menyetujui penyelesaian job';
      end if;
      if v_job.status <> 'menunggu_review' then
        raise exception 'Job harus berstatus Menunggu Review untuk disetujui';
      end if;
    end if;

    update technician_jobs
       set status = 'selesai',
           completed_at = now(),
           -- approve tidak menimpa catatan teknisi dengan catatan admin.
           notes = case when v_action = 'complete'
                        then coalesce(v_notes, notes) else notes end,
           updated_at = now()
     where id = v_job_id;
    update service_order_units set status = 'selesai'
     where order_id = v_job.order_id and unit_id is not distinct from v_job.unit_id;
    if v_job.unit_id is not null then
      -- FASE 8: siklus servis berikutnya. 0 = jenis job ini memang tak
      -- dijadwalkan (pemasangan/bongkar/service) -> next_service_date
      -- DIKOSONGKAN, supaya jadwal lama tidak tertinggal dan mengirim
      -- pengingat palsu setelah unit dibongkar atau diperbaiki.
      v_interval := resolve_service_interval_days(v_job.unit_id, v_job.type);

      -- BUG A: dulu hanya 'pemasangan' yang dikembalikan ke 'aktif'; kini semua
      -- jenis pekerjaan mengakhiri masa maintenance unit.
      update member_ac_units
         set status = case
               when v_job.type = 'pemasangan' then 'aktif'::ac_unit_status
               when status = 'dalam_maintenance' then 'aktif'::ac_unit_status
               else status end,
             installation_date = case when v_job.type = 'pemasangan'
                                      then coalesce(installation_date, now())
                                      else installation_date end,
             last_service_date = now(),
             next_service_date = case when v_interval > 0
                                      then now() + make_interval(days => v_interval)
                                      else null end
       where id = v_job.unit_id
      returning member_id, next_service_date into v_member_id, v_next;

      -- FASE 8: pesan konfirmasi "pekerjaan selesai". Hanya untuk unit yang
      -- memang punya siklus berikutnya, milik member aktif yang tidak opt-out.
      -- dedupe_key 'job:<id>' menjamin satu job hanya pernah menghasilkan satu
      -- pesan, berapa kali pun RPC ini terpanggil ulang.
      if v_interval > 0 and v_member_id is not null then
        insert into wa_outbox (member_id, member_name, phone, kind, unit_ids,
                               due_date, body, dedupe_key)
        select v_member_id, m.name, wa_phone(m.phone), 'selesai_servis',
               array[v_job.unit_id], v_next::date,
               build_wa_body(v_member_id, 'selesai_servis',
                             array[v_job.unit_id], v_next::date),
               'job:' || v_job_id::text
          from members m
         where m.id = v_member_id
           and m.active
           and not m.wa_opt_out
           and wa_phone(m.phone) <> ''
        on conflict (dedupe_key) do nothing;
      end if;
    end if;
    select bool_and(status = 'selesai') into v_all_done
      from service_order_units where order_id = v_job.order_id;
    if coalesce(v_all_done, true) then
      update service_orders set status = 'selesai' where id = v_job.order_id;
    end if;

  elsif v_action = 'send_back' then
    if v_role <> 'admin' then
      raise exception 'Hanya Admin yang boleh mengembalikan job ke teknisi';
    end if;
    if v_notes is null then
      raise exception 'Catatan wajib diisi saat mengembalikan job ke teknisi';
    end if;
    if v_job.status <> 'menunggu_review' then
      raise exception 'Job harus berstatus Menunggu Review untuk dikembalikan';
    end if;
    update technician_jobs
       set status = 'sedang_dikerjakan',
           review_note = v_notes,
           updated_at = now()
     where id = v_job_id;

  elsif v_action = 'cancel' then
    if v_role <> 'admin' then
      raise exception 'Hanya Admin yang boleh membatalkan job';
    end if;
    if v_job.status = 'selesai' then
      raise exception 'Job yang sudah selesai tidak bisa dibatalkan';
    end if;
    -- BUG: dulu job yang sudah dibatalkan masih bisa dibatalkan lagi dan
    -- menghasilkan baris audit ganda.
    if v_job.status = 'dibatalkan' then
      raise exception 'Job ini sudah dibatalkan';
    end if;
    update technician_jobs
       set status = 'dibatalkan', updated_at = now()
     where id = v_job_id;
    update service_order_units set status = 'dibatalkan'
     where order_id = v_job.order_id and unit_id is not distinct from v_job.unit_id;
    -- BUG B: unit tidak boleh ikut tersangkut gara-gara pekerjaan yang batal.
    if v_job.unit_id is not null then
      update member_ac_units set status = 'aktif'
       where id = v_job.unit_id and status = 'dalam_maintenance';
    end if;
    -- BUG B: status order ikut ditutup bila tak ada lagi unit yang menggantung.
    select bool_and(status in ('selesai', 'dibatalkan')),
           bool_or(status = 'selesai')
      into v_all_final, v_any_done
      from service_order_units where order_id = v_job.order_id;
    if coalesce(v_all_final, true) then
      update service_orders
         set status = case when coalesce(v_any_done, false) then 'selesai'
                           else 'dibatalkan' end
       where id = v_job.order_id;
    end if;

  else
    raise exception 'Aksi tidak dikenal: %', v_action;
  end if;

  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'job.' || v_action, v_job_id::text,
          jsonb_build_object('notes', v_notes));

  return jsonb_build_object(
    'ok', true,
    'status', (select status from technician_jobs where id = v_job_id));
end;
$$;

revoke execute on function update_technician_job_status(jsonb) from anon, public;
grant execute on function update_technician_job_status(jsonb) to authenticated;
