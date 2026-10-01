// NestJobRepository vs backend Nest native sungguhan. Lihat _support.dart.
import 'package:epos_ac/core/api/api_client.dart';
import 'package:epos_ac/data/repositories/job_repository.dart';
import 'package:epos_ac/features/jobs/job_providers.dart';
import 'package:flutter_test/flutter_test.dart';

import '_support.dart';

void main() {
  final repo = NestJobRepository(const ApiClient());

  group('admin', () {
    setUpAll(() => loginAs('admin'));

    test('fetchJobs() = semua job di DB', () async {
      final jobs = await repo.fetchJobs();
      expect(jobs.length, int.parse(await sql('select count(*) from technician_jobs')));
      expect(jobs.every((j) => j.type.isNotEmpty), isTrue);
    });

    test('fetchJobById: status & teknisi cocok dengan DB', () async {
      final row = (await sql("select id||'|'||status||'|'||coalesce(technician_id,'') "
              'from technician_jobs where technician_id is not null limit 1'))
          .split('|');
      final job = await repo.fetchJobById(row[0]);
      expect(job, isNotNull);
      expect(job!.status.value, row[1]);
      expect(job.technicianId, row[2]);
    });

    test('fetchUnitHistory = semua job di unit + ringkasan material cocok DB', () async {
      final row = (await sql("select j.unit_id||'|'||j.id from material_requests mr "
              "join technician_jobs j on j.id=mr.job_id where j.unit_id is not null and mr.status='approved' limit 1"))
          .split('|');
      final unit = row.length == 2 ? row[0] : await sql('select unit_id from technician_jobs where unit_id is not null limit 1');
      final h = await repo.fetchUnitHistory(unit);
      expect(h.jobs.length, int.parse(await sql("select count(*) from technician_jobs where unit_id='$unit'")));
      if (row.length == 2) {
        final approved = int.parse(await sql("select count(*) from material_requests where job_id='${row[1]}' and status='approved'"));
        final total = double.parse(await sql("select coalesce(sum(total),0) from material_requests where job_id='${row[1]}' and status='approved'"));
        expect(h.extras[row[1]]!.materialItems, approved);
        expect(h.extras[row[1]]!.materialTotal, total.round());
      }
    });

    test('fetchOrders = semua service order', () async {
      final orders = await repo.fetchOrders();
      expect(orders.length, int.parse(await sql('select count(*) from service_orders')));
    });

    test('fetchRequests: pengajuan material per job', () async {
      final job = await sql('select job_id from material_requests limit 1');
      final reqs = await repo.fetchRequests(job);
      expect(reqs.length, int.parse(await sql("select count(*) from material_requests where job_id='$job'")));
      expect(reqs.first.items, isNotEmpty);
    });
  });

  group('admin: tulis', () {
    setUpAll(() => loginAs('admin'));

    test('buat order servis multi-unit lewat createServiceOrderCallerProvider-payload', () async {
      final mem = await sql('select member_id from member_ac_units group by member_id having count(*)>=2 limit 1');
      final units = (await sql("select string_agg(id, ',') from (select id from member_ac_units where member_id='$mem' limit 2) x")).split(',');
      final before = int.parse(await sql('select count(*) from service_orders'));
      await const ApiClient().post('/service-orders', body: {'memberId': mem, 'type': 'cuci', 'unitIds': units});
      expect(int.parse(await sql('select count(*) from service_orders')), before + 1);
    });

    test('info bayar job = invoice di DB', () async {
      final row = (await sql("select j.id||'|'||i.number||'|'||i.grand_total::int||'|'||i.total_paid::int "
              'from technician_jobs j join service_orders o on o.id=j.order_id join invoices i on i.id=o.invoice_id limit 1'))
          .split('|');
      final info = jobPaymentInfoFromJobDetail(
          Map<String, dynamic>.from(await const ApiClient().get('/technician-jobs/${row[0]}') as Map));
      expect(info.hasInvoice, isTrue);
      expect(info.number, row[1]);
      expect(info.grandTotal, int.parse(row[2]));
      expect(info.totalPaid, int.parse(row[3]));
    });
  });

  group('teknisi', () {
    setUpAll(() => loginAs('teknisi'));

    test('fetchJobs(technicianId) = SEMUA job milik teknisi (status apa pun)', () async {
      final tech = await sql("select id from users where role='teknisi' limit 1");
      final jobs = await repo.fetchJobs(technicianId: tech);
      final mine = int.parse(await sql("select count(*) from technician_jobs where technician_id='$tech'"));
      expect(jobs.length, mine);
    });

    test('fetchUnitHistory boleh untuk teknisi', () async {
      final unit = await sql('select unit_id from technician_jobs where unit_id is not null limit 1');
      final h = await repo.fetchUnitHistory(unit);
      expect(h.jobs.length, int.parse(await sql("select count(*) from technician_jobs where unit_id='$unit'")));
    });

    test('fetchPhotos tidak error', () async {
      final tech = await sql("select id from users where role='teknisi' limit 1");
      final job = await sql("select id from technician_jobs where technician_id='$tech' limit 1");
      await repo.fetchPhotos(job);
    });
  });
}
