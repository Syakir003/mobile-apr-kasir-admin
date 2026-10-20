// Data dummy teknisi buat ngetes laporan/monitoring. Jalankan:
//   npx ts-node prisma/seed-dummy-teknisi.ts          -> isi (idempoten)
//   npx ts-node prisma/seed-dummy-teknisi.ts --clear  -> hapus
// Bikin 3 teknisi (dummy-teknisi{1..3}@toko.local, password: dummy12345),
// pelanggan + unit AC (barcode DUMMY-AC-...), order & job berbagai status.
// Penanda dummy: notes member = 'DUMMY'. TIDAK menyentuh stok/kas.
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const DAY = 86400000;
const rand = (n: number) => Math.floor(Math.random() * n);
const pick = <T>(a: T[]) => a[rand(a.length)];

async function clear() {
  const members = await prisma.member.findMany({ where: { notes: 'DUMMY' }, select: { id: true } });
  const mIds = members.map((m) => m.id);
  const jobs = await prisma.technicianJob.findMany({ where: { memberId: { in: mIds } }, select: { id: true, orderId: true } });
  const jIds = jobs.map((j) => j.id);
  const oIds = [...new Set(jobs.map((j) => j.orderId))];
  await prisma.jobFindingPhoto.deleteMany({ where: { finding: { jobId: { in: jIds } } } });
  await prisma.jobFinding.deleteMany({ where: { jobId: { in: jIds } } });
  await prisma.jobPhoto.deleteMany({ where: { jobId: { in: jIds } } });
  await prisma.technicianJob.deleteMany({ where: { id: { in: jIds } } });
  await prisma.serviceOrderUnit.deleteMany({ where: { orderId: { in: oIds } } });
  await prisma.serviceOrder.deleteMany({ where: { id: { in: oIds } } });
  await prisma.memberAcUnit.deleteMany({ where: { memberId: { in: mIds } } });
  await prisma.member.deleteMany({ where: { id: { in: mIds } } });
  const u = await prisma.user.deleteMany({ where: { email: { startsWith: 'dummy-teknisi' } } });
  console.log(`dihapus: ${mIds.length} pelanggan, ${jIds.length} job, ${u.count} teknisi dummy`);
}

async function main() {
  await clear();
  if (process.argv.includes('--clear')) return;

  const admin = await prisma.user.findFirst({ where: { role: 'admin' } });
  if (!admin) throw new Error('Tidak ada user admin. Jalankan seed utama dulu.');

  const password = await bcrypt.hash('dummy12345', 10);
  const techs = await Promise.all(
    ['Andi Saputra', 'Bayu Firmansyah', 'Candra Wijaya'].map((displayName, i) =>
      prisma.user.create({
        data: { email: `dummy-teknisi${i + 1}@toko.local`, password, displayName, role: 'teknisi' },
      }),
    ),
  );

  const names = ['Budi Santoso', 'Siti Rahayu', 'Hendra Wijaya', 'Dewi Lestari', 'Agus Prasetyo', 'Rina Marlina', 'Toko Maju Jaya', 'CV Sinar Abadi'];
  const rooms = ['Ruang Tamu', 'Kamar Utama', 'Kamar Anak', 'Kantor', 'Ruang Rapat', 'Toko Depan'];
  const types = ['pemasangan', 'cuci', 'perbaikan'];
  // Distribusi status: banyak selesai (buat laporan), sisanya aktif.
  const statuses = ['selesai', 'selesai', 'selesai', 'selesai', 'menunggu_review', 'sedang_dikerjakan', 'assigned', 'menunggu_penugasan', 'dibatalkan'] as const;

  let n = 0;
  for (const name of names) {
    const member = await prisma.member.create({
      data: { name, phone: `0812${String(10000000 + rand(89999999))}`, address: 'Blitar', notes: 'DUMMY', customerType: name.startsWith('Toko') || name.startsWith('CV') ? 'perusahaan' : 'rumah', memberSince: new Date(Date.now() - 200 * DAY) },
    });
    for (let k = 0; k < 2 + rand(2); k++) {
      const done = Date.now() - rand(120) * DAY;
      const unit = await prisma.memberAcUnit.create({
        data: {
          memberId: member.id,
          brand: pick(['Daikin', 'Panasonic', 'LG', 'Sharp']),
          model: 'DUMMY',
          pk: pick([0.5, 1, 1.5, 2]),
          roomLocation: pick(rooms),
          barcodeValue: `DUMMY-AC-${String(++n).padStart(4, '0')}`,
          status: 'aktif',
          installationDate: new Date(done - 90 * DAY),
          lastServiceDate: new Date(done),
          serviceIntervalDays: 90,
          nextServiceDate: new Date(done + 90 * DAY),
        },
      });
      const status = pick([...statuses]);
      const created = new Date(Date.now() - rand(60) * DAY);
      const sched = new Date(created.getTime() + rand(5) * DAY);
      const type = pick(types);
      const order = await prisma.serviceOrder.create({
        data: { memberId: member.id, type, status: status === 'selesai' ? 'selesai' : status === 'dibatalkan' ? 'dibatalkan' : 'terjadwal', createdById: admin.id, createdAt: created, scheduledDate: sched, serviceOrderUnits: { create: [{ unitId: unit.id, status: 'aktif' }] } },
      });
      const started = status === 'sedang_dikerjakan' || status === 'menunggu_review' || status === 'selesai';
      const startedAt = started ? new Date(sched.getTime() + 9 * 3600000) : null;
      await prisma.technicianJob.create({
        data: {
          orderId: order.id,
          memberId: member.id,
          unitId: unit.id,
          technicianId: status === 'menunggu_penugasan' ? null : pick(techs).id,
          type,
          status,
          scheduledDate: sched,
          createdById: admin.id,
          createdAt: created,
          startedAt,
          completedAt: status === 'selesai' && startedAt ? new Date(startedAt.getTime() + (1 + rand(3)) * 3600000) : null,
          notes: 'DUMMY',
        },
      });
    }
  }
  const jobs = await prisma.technicianJob.count({ where: { notes: 'DUMMY' } });
  console.log(`dibuat: ${techs.length} teknisi, ${names.length} pelanggan, ${n} unit AC, ${jobs} job`);
}

main().finally(() => prisma.$disconnect());
