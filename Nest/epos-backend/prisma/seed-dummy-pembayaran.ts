// Data dummy untuk menguji alur PEMBAYARAN LAPANGAN teknisi (Tanda Terima, Setoran Teknisi, Cocokkan Mutasi, laporan).
//   npx tsx prisma/seed-dummy-pembayaran.ts                  -> isi (idempoten: data dummy lama dihapus dulu)
//   npx tsx prisma/seed-dummy-pembayaran.ts --phone=08123... -> nomor HP pelanggan dummy diganti nomor Anda
//   npx tsx prisma/seed-dummy-pembayaran.ts --clear          -> hapus semua data dummy ini
//
// PERHATIAN: "Kirim Tanda Terima (WA)" benar-benar mengirim WhatsApp lewat Fonnte bila FONNTE_API_KEY terisi. Bawaan nomor
// pelanggan dummy palsu (0812000000xx); pakai --phone=<nomor Anda> bila ingin mencoba kirim sungguhan.
//
// Penanda: member.notes = 'DUMMY-PEMBAYARAN'. Memakai akun teknisi yang SUDAH ADA (tidak membuat akun/password baru):
//   teknisi@eposac.local (Teknisi Andi), teknisi@toko.local (Teknisi Toko), denis@teknisi.ayub (denis).
// TIDAK menyentuh stok, kas, atau data nyata.
import 'dotenv/config';
import { copyFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { PrismaClient, type MemberAcUnit, type TechnicianJob } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const MARK = 'DUMMY-PEMBAYARAN';
const DAY = 86400000;
const phoneArg = process.argv.find((a) => a.startsWith('--phone='))?.slice('--phone='.length);
const TECH_EMAILS = ['teknisi@eposac.local', 'teknisi@toko.local', 'denis@teknisi.ayub'];

async function clear() {
  const members = await prisma.member.findMany({ where: { notes: MARK }, select: { id: true } });
  const mIds = members.map((m) => m.id);
  const jobs = await prisma.technicianJob.findMany({ where: { memberId: { in: mIds } }, select: { id: true, orderId: true } });
  const jIds = jobs.map((j) => j.id);
  const oIds = [...new Set(jobs.map((j) => j.orderId))];
  const orders = await prisma.serviceOrder.findMany({ where: { id: { in: oIds } }, select: { invoiceId: true } });
  const invIds = orders.map((o) => o.invoiceId).filter((x): x is string => !!x);

  const fps = await prisma.fieldPayment.findMany({ where: { orderId: { in: oIds } }, select: { settlementId: true } });
  const settlementIds = [...new Set(fps.map((f) => f.settlementId).filter((x): x is string => !!x))];
  await prisma.fieldPayment.deleteMany({ where: { orderId: { in: oIds } } });
  await prisma.technicianCashEntry.deleteMany({
    where: { OR: [{ note: { startsWith: MARK } }, { settlementId: { in: settlementIds } }] },
  });
  await prisma.cashSettlement.deleteMany({ where: { id: { in: settlementIds } } });
  await prisma.manualPayment.deleteMany({ where: { invoiceId: { in: invIds } } });
  await prisma.whatsappLog.deleteMany({ where: { invoiceId: { in: invIds } } });

  await prisma.materialRequestItem.deleteMany({ where: { request: { jobId: { in: jIds } } } });
  await prisma.materialRequest.deleteMany({ where: { jobId: { in: jIds } } });
  await prisma.jobServiceLine.deleteMany({ where: { jobId: { in: jIds } } });
  await prisma.jobFindingPhoto.deleteMany({ where: { finding: { jobId: { in: jIds } } } });
  await prisma.jobFinding.deleteMany({ where: { jobId: { in: jIds } } });
  await prisma.technicianJob.deleteMany({ where: { id: { in: jIds } } }); // assignees ikut terhapus (cascade)
  await prisma.serviceOrderUnit.deleteMany({ where: { orderId: { in: oIds } } });
  await prisma.serviceOrder.deleteMany({ where: { id: { in: oIds } } });
  await prisma.invoiceItem.deleteMany({ where: { invoiceId: { in: invIds } } });
  await prisma.invoiceAdjustment.deleteMany({ where: { invoiceId: { in: invIds } } });
  await prisma.invoice.deleteMany({ where: { id: { in: invIds } } });
  await prisma.memberAcUnit.deleteMany({ where: { memberId: { in: mIds } } });
  await prisma.member.deleteMany({ where: { id: { in: mIds } } });
  console.log(`dihapus: ${mIds.length} pelanggan, ${jIds.length} job, ${invIds.length} invoice, ${fps.length} pembayaran lapangan`);
}

function placeholderPhotos() {
  // Foto bukti/temuan palsu: salin satu gambar yang sudah ada di uploads/job-photos supaya tautan "Lihat bukti" tidak rusak.
  const src = join('uploads', 'job-photos');
  const dest = join('uploads', 'payment-proofs');
  const first = existsSync(src) ? readdirSync(src).find((f) => f.endsWith('.png') || f.endsWith('.jpg')) : undefined;
  if (!first) return { finding: '/uploads/job-photos/tidak-ada.png', proof: '/uploads/payment-proofs/tidak-ada.png' };
  const ext = first.slice(first.lastIndexOf('.'));
  copyFileSync(join(src, first), join(dest, `dummy-bukti${ext}`));
  return { finding: `/uploads/job-photos/${first}`, proof: `/uploads/payment-proofs/dummy-bukti${ext}` };
}

async function main() {
  await clear();
  if (process.argv.includes('--clear')) return;

  const admin = await prisma.user.findFirst({ where: { role: 'admin', active: true }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('Tidak ada user admin.');
  const adminId = admin.id; // salinan non-null: dipakai di fungsi bersarang (penyempitan tipe tidak ikut masuk ke sana)
  const techs = await prisma.user.findMany({ where: { email: { in: TECH_EMAILS }, active: true } });
  const byEmail = (e: string) => {
    const u = techs.find((t) => t.email === e);
    if (!u) throw new Error(`Akun teknisi ${e} tidak ditemukan/aktif. Ubah TECH_EMAILS di skrip ini.`);
    return u;
  };
  const andi = byEmail('teknisi@eposac.local');
  const toko = byEmail('teknisi@toko.local');
  const denis = byEmail('denis@teknisi.ayub');
  const allTechs = [andi, toko, denis];

  const cuciKecil = await prisma.service.findFirst({ where: { name: { startsWith: 'Cuci AC 1/2' }, active: true } });
  const cuciBesar = await prisma.service.findFirst({ where: { name: { startsWith: 'Cuci AC 1.5' }, active: true } });
  const freonJasa = await prisma.service.findFirst({ where: { name: { startsWith: 'Isi Freon' }, active: true } });
  const bongkar = await prisma.service.findFirst({ where: { name: { startsWith: 'Bongkar Pasang' }, active: true } });
  const freon = await prisma.sparepart.findFirst({ where: { name: { startsWith: 'Freon R32' } } });
  if (!cuciKecil || !cuciBesar || !freonJasa || !bongkar || !freon) {
    throw new Error('Katalog jasa/sparepart bawaan (Cuci AC, Isi Freon, Bongkar Pasang, Freon R32) tidak lengkap.');
  }
  const freonSp = freon; // salinan non-null untuk fungsi bersarang
  const svc = (s: { id: string; name: string; basePrice: unknown }, qty: number, price?: number) => ({
    serviceId: s.id,
    name: s.name,
    qty,
    unitPrice: price ?? Number(s.basePrice),
  });

  const category = await prisma.problemCategory.upsert({
    where: { name: 'AC kurang dingin (dummy)' },
    update: {},
    create: { name: 'AC kurang dingin (dummy)', source: 'seed' },
  });
  const photos = placeholderPhotos();

  const today = new Date();
  today.setHours(8, 0, 0, 0);
  let unitSeq = 0;
  let invSeq = 0;
  let receiptSeq = 0;
  const phone = (i: number) => phoneArg ?? `08120000000${i}`;

  interface Scenario {
    name: string;
    phoneIdx: number;
    type: 'cuci' | 'perbaikan';
    jobStatus: 'sedang_dikerjakan' | 'menunggu_review' | 'selesai';
    paymentMode: 'bayar_di_lokasi' | 'ditagih_admin';
    units: number;
    lines: ReturnType<typeof svc>[];
    sparepartApproved?: { qty: number; used?: boolean };
    techEdited?: { before: number; reason: string; customLine?: ReturnType<typeof svc> };
    withFindings: boolean;
  }

  async function make(sc: Scenario) {
    const member = await prisma.member.create({
      data: {
        name: sc.name,
        phone: phone(sc.phoneIdx),
        address: 'Jl. Dummy No. 1, Blitar',
        notes: MARK,
        customerType: 'rumah',
        memberSince: new Date(Date.now() - 60 * DAY),
      },
    });
    const units: MemberAcUnit[] = [];
    for (let k = 0; k < sc.units; k++) {
      units.push(
        await prisma.memberAcUnit.create({
          data: {
            memberId: member.id,
            brand: ['Daikin', 'Panasonic', 'LG'][unitSeq % 3],
            model: 'DUMMY',
            pk: 1,
            roomLocation: ['Ruang Tamu', 'Kamar Utama', 'Kantor'][k % 3],
            barcodeValue: `DUMMY-PAY-${String(++unitSeq).padStart(4, '0')}`,
            status: 'aktif',
          },
        }),
      );
    }
    const order = await prisma.serviceOrder.create({
      data: {
        memberId: member.id,
        type: sc.type,
        status: 'terjadwal',
        createdById: adminId,
        scheduledDate: today,
        paymentMode: sc.paymentMode,
        note: `Dummy pembayaran: ${sc.name}`,
        serviceOrderUnits: { create: units.map((u) => ({ unitId: u.id, status: 'terjadwal' })) },
      },
    });
    const jobs: TechnicianJob[] = [];
    for (const [i, u] of units.entries()) {
      jobs.push(
        await prisma.technicianJob.create({
          data: {
            orderId: order.id,
            memberId: member.id,
            unitId: u.id,
            technicianId: allTechs[0].id,
            type: sc.type,
            status: sc.jobStatus,
            scheduledDate: today,
            startedAt: new Date(today.getTime() + 3600000),
            ...(sc.jobStatus === 'selesai' ? { completedAt: new Date(today.getTime() + 2 * 3600000) } : {}),
            createdById: adminId,
            billingDerived: true,
            ...(i === 0 && sc.techEdited
              ? { techPriceEditedAt: new Date(), techPriceEditReason: sc.techEdited.reason, priceBeforeTechEdit: sc.techEdited.before }
              : {}),
            assignees: { create: allTechs.map((t) => ({ technicianId: t.id })) },
          },
        }),
      );
    }
    const owner = jobs[0];

    // Baris jasa (job pemegang harga) + penyesuaian teknisi bila ada.
    const lines = [...sc.lines];
    await prisma.jobServiceLine.createMany({
      data: lines.map((l, i) => ({
        jobId: owner.id,
        serviceId: l.serviceId,
        name: l.name,
        qty: l.qty,
        unitPrice: l.unitPrice,
        position: i,
        source: sc.techEdited && i === 0 ? 'teknisi' : 'admin',
        changeReason: sc.techEdited && i === 0 ? sc.techEdited.reason : null,
      })),
    });
    if (sc.techEdited?.customLine) {
      const c = sc.techEdited.customLine;
      await prisma.jobServiceLine.create({
        data: {
          jobId: owner.id,
          serviceId: null,
          name: c.name,
          qty: c.qty,
          unitPrice: c.unitPrice,
          position: lines.length,
          source: 'teknisi',
          isCustom: true,
          changeReason: sc.techEdited.reason,
        },
      });
      lines.push(c);
    }

    // Invoice (tagihan dari baris jasa + sparepart yang disetujui), terbentuk di depan seperti Terima Servis versi baru.
    const sparepartTotal = sc.sparepartApproved ? sc.sparepartApproved.qty * Number(freonSp.sellPrice) : 0;
    const jasaTotal = lines.reduce((s, l) => s + Math.round(l.qty * l.unitPrice), 0);
    const grand = jasaTotal + sparepartTotal;
    const invoice = await prisma.invoice.create({
      data: {
        number: `INV-DUM-${String(++invSeq).padStart(3, '0')}`,
        memberId: member.id,
        customerName: member.name,
        customerPhone: member.phone,
        subtotal: grand,
        grandTotal: grand,
        totalPaid: 0,
        status: 'belum_dibayar',
        notes: MARK,
        createdById: adminId,
      },
    });
    await prisma.invoiceItem.createMany({
      data: [
        ...lines.map((l) => ({
          invoiceId: invoice.id,
          jobId: owner.id,
          kind: 'service',
          refId: l.serviceId,
          name: l.name,
          unit: 'jasa',
          qty: l.qty,
          unitPrice: l.unitPrice,
          lineTotal: Math.round(l.qty * l.unitPrice),
        })),
        ...(sc.sparepartApproved
          ? [
              {
                invoiceId: invoice.id,
                jobId: owner.id,
                kind: 'sparepart',
                refId: freonSp.id,
                name: freonSp.name,
                unit: 'pcs',
                qty: sc.sparepartApproved.qty,
                unitPrice: Number(freonSp.sellPrice),
                lineTotal: sparepartTotal,
              },
            ]
          : []),
      ],
    });
    await prisma.serviceOrder.update({ where: { id: order.id }, data: { invoiceId: invoice.id } });

    if (sc.sparepartApproved) {
      const used = sc.sparepartApproved.used;
      const mr = await prisma.materialRequest.create({
        data: {
          jobId: owner.id,
          invoiceId: invoice.id,
          status: 'approved',
          total: sparepartTotal,
          note: 'Freon habis, tambah (dummy)',
          createdById: andi.id,
          decidedById: adminId,
          decidedAt: new Date(),
          usedAt: used ? new Date() : null,
          usedById: used ? andi.id : null,
        },
      });
      await prisma.materialRequestItem.create({
        data: {
          requestId: mr.id,
          kind: 'sparepart',
          refId: freonSp.id,
          name: freonSp.name,
          unit: 'pcs',
          qty: sc.sparepartApproved.qty,
          qtyUsed: used ? sc.sparepartApproved.qty : null,
          unitPrice: Number(freonSp.sellPrice),
          lineTotal: sparepartTotal,
        },
      });
    }

    if (sc.withFindings) {
      for (const j of jobs) {
        const f = await prisma.jobFinding.create({
          data: { jobId: j.id, categoryId: category.id, title: category.name, note: 'Dummy', origin: 'komplain_awal', createdById: andi.id },
        });
        await prisma.jobFindingPhoto.createMany({
          data: ['sebelum', 'sesudah'].map((kind) => ({ findingId: f.id, kind, path: photos.finding, uploadedById: andi.id })),
        });
      }
    }
    return { member, order, owner, invoice, grand };
  }

  async function field(
    ctx: { order: { id: string }; invoice: { id: string } },
    recorder: { id: string },
    over: { method: string; amount: number; status: string; daysAgo?: number; channel?: 'wa' | 'kertas'; sent?: boolean; source?: string },
  ) {
    const at = new Date(Date.now() - (over.daysAgo ?? 0) * DAY);
    return prisma.fieldPayment.create({
      data: {
        invoiceId: ctx.invoice.id,
        orderId: ctx.order.id,
        recordedById: recorder.id,
        method: over.method,
        amount: over.amount,
        proofUrl: photos.proof,
        status: over.status,
        receiptNumber: `TT-DUM-${String(++receiptSeq).padStart(4, '0')}`,
        receiptChannel: over.channel ?? null,
        receiptSentAt: over.sent ? at : null,
        source: over.source ?? 'app',
        createdAt: at,
      },
    });
  }

  // S1 — siap ditagih: 2 unit cuci, bayar di lokasi, temuan + foto lengkap (siap Catat Pembayaran dan Ajukan Selesai).
  await make({
    name: 'Bu Sari (S1 siap ditagih)', phoneIdx: 1, type: 'cuci', jobStatus: 'sedang_dikerjakan', paymentMode: 'bayar_di_lokasi',
    units: 2, lines: [svc(cuciKecil, 2)], withFindings: true,
  });

  // S2 — total belum final: sparepart disetujui tetapi belum dilaporkan terpakai (Catat Pembayaran harus tertutup).
  await make({
    name: 'Pak Hendra (S2 sparepart belum final)', phoneIdx: 2, type: 'perbaikan', jobStatus: 'sedang_dikerjakan', paymentMode: 'bayar_di_lokasi',
    units: 1, lines: [svc(freonJasa, 1)], sparepartApproved: { qty: 2, used: false }, withFindings: true,
  });

  // S3 — kontrol: ditagih admin (tidak boleh ada kartu pembayaran / kartu harga untuk teknisi).
  await make({
    name: 'CV Sinar (S3 ditagih admin)', phoneIdx: 3, type: 'cuci', jobStatus: 'sedang_dikerjakan', paymentMode: 'ditagih_admin',
    units: 1, lines: [svc(cuciBesar, 1)], withFindings: true,
  });

  // S4 + S5 — tunai dipegang Teknisi Andi (satu sudah 2 hari: lencana umur; satu sudah dikirimi Tanda Terima WA).
  const s4 = await make({
    name: 'Bu Dewi (S4 tunai 2 hari)', phoneIdx: 4, type: 'cuci', jobStatus: 'menunggu_review', paymentMode: 'bayar_di_lokasi',
    units: 1, lines: [svc(cuciBesar, 1)], withFindings: true,
  });
  await field(s4, andi, { method: 'tunai', amount: s4.grand, status: 'dipegang_teknisi', daysAgo: 2, channel: 'kertas' });
  const s5 = await make({
    name: 'Toko Maju (S5 tunai hari ini)', phoneIdx: 5, type: 'perbaikan', jobStatus: 'menunggu_review', paymentMode: 'bayar_di_lokasi',
    units: 1, lines: [svc(bongkar, 1)], withFindings: true,
  });
  await field(s5, andi, { method: 'tunai', amount: s5.grand, status: 'dipegang_teknisi', channel: 'wa', sent: true });

  // S6 — QRIS menunggu dicocokkan dengan mutasi (Teknisi Toko).
  const s6 = await make({
    name: 'Pak Agus (S6 QRIS menunggu cocok)', phoneIdx: 6, type: 'cuci', jobStatus: 'menunggu_review', paymentMode: 'bayar_di_lokasi',
    units: 1, lines: [svc(cuciBesar, 1)], withFindings: true,
  });
  await field(s6, toko, { method: 'qris', amount: s6.grand, status: 'menunggu_cocok', channel: 'wa', sent: true });

  // S7 — jasa disesuaikan teknisi di lokasi (banner "Jasa disesuaikan teknisi" untuk admin).
  await make({
    name: 'Bu Rina (S7 jasa disesuaikan)', phoneIdx: 7, type: 'cuci', jobStatus: 'sedang_dikerjakan', paymentMode: 'bayar_di_lokasi',
    units: 2, lines: [svc(cuciKecil, 2)], withFindings: true,
    techEdited: {
      before: Number(cuciKecil.basePrice),
      reason: 'Satu unit lagi ikut dicuci, plus ganti kapasitor (dummy)',
      customLine: { serviceId: null as unknown as string, name: 'Ganti kapasitor', qty: 1, unitPrice: 120000 },
    },
  });

  // S8 — tunai dipegang denis (kemarin) + saldo kurang setor lama untuk demo "Terima Pelunasan Selisih".
  const s8 = await make({
    name: 'Bu Lestari (S8 tunai denis)', phoneIdx: 8, type: 'cuci', jobStatus: 'menunggu_review', paymentMode: 'bayar_di_lokasi',
    units: 1, lines: [svc(cuciKecil, 1)], withFindings: true,
  });
  await field(s8, denis, { method: 'tunai', amount: s8.grand, status: 'dipegang_teknisi', daysAgo: 1, channel: 'wa', sent: true });

  // S9-S12 — job SELESAI yang uangnya belum diverifikasi (tab Setoran Teknisi di Antrian Servis).
  // S9: 2 unit, tunai dipegang Andi (bersama S4/S5 = setoran tunai sekaligus satu teknisi).
  const s9 = await make({
    name: 'Bu Wati (S9 selesai, tunai Andi)', phoneIdx: 9, type: 'cuci', jobStatus: 'selesai', paymentMode: 'bayar_di_lokasi',
    units: 2, lines: [svc(cuciKecil, 2)], withFindings: true,
  });
  await field(s9, andi, { method: 'tunai', amount: s9.grand, status: 'dipegang_teknisi', channel: 'wa', sent: true });
  // S10: transfer menunggu dicocokkan (Teknisi Toko).
  const s10 = await make({
    name: 'Pak Bayu (S10 selesai, transfer)', phoneIdx: 10, type: 'perbaikan', jobStatus: 'selesai', paymentMode: 'bayar_di_lokasi',
    units: 1, lines: [svc(freonJasa, 1)], sparepartApproved: { qty: 1, used: true }, withFindings: true,
  });
  await field(s10, toko, { method: 'transfer', amount: s10.grand, status: 'menunggu_cocok', channel: 'wa', sent: true });
  // S11: satu order dibayar dua kali (tunai sebagian + sisanya QRIS), mengetes panel job dengan dua jenis sekaligus.
  const s11 = await make({
    name: 'Bu Citra (S11 selesai, tunai + QRIS)', phoneIdx: 11, type: 'cuci', jobStatus: 'selesai', paymentMode: 'bayar_di_lokasi',
    units: 2, lines: [svc(cuciBesar, 2)], withFindings: true,
  });
  const half = Math.floor(s11.grand / 2 / 1000) * 1000;
  await field(s11, denis, { method: 'tunai', amount: half, status: 'dipegang_teknisi', channel: 'wa', sent: true });
  await field(s11, denis, { method: 'qris', amount: s11.grand - half, status: 'menunggu_cocok', channel: 'wa', sent: true });
  // S12: tunai sudah 3 hari di tangan denis (lencana umur di tab Setoran).
  const s12 = await make({
    name: 'Toko Sentosa (S12 selesai, tunai 3 hari)', phoneIdx: 12, type: 'perbaikan', jobStatus: 'selesai', paymentMode: 'bayar_di_lokasi',
    units: 1, lines: [svc(bongkar, 1)], withFindings: true,
  });
  await field(s12, denis, { method: 'tunai', amount: s12.grand, status: 'dipegang_teknisi', daysAgo: 3, channel: 'kertas' });

  // Buku besar contoh untuk laporan Uang di Teknisi.
  await prisma.technicianCashEntry.createMany({
    data: [
      { technicianId: denis.id, kind: 'kurang_setor', amount: 20000, note: `${MARK} kurang setor sebelumnya`, createdById: adminId },
      { technicianId: andi.id, kind: 'ditutup_alasan', amount: 15000, note: `${MARK} dipakai beli freon, nota terlampir`, createdById: adminId },
      { technicianId: toko.id, kind: 'kelebihan_pelanggan', amount: 10000, note: `${MARK} kelebihan setelah harga turun`, createdById: adminId },
    ],
  });

  console.log('Selesai. Skenario (cari nama pelanggan "(S1…S8)" di Antrian Servis):');
  console.log('  S1 siap ditagih tunai/transfer + Ajukan Selesai   S2 sparepart belum final (Catat Pembayaran tertutup)');
  console.log('  S3 ditagih admin (kontrol)                        S4/S5 tunai dipegang Andi -> Setoran Tunai');
  console.log('  S6 QRIS menunggu cocok -> Cocokkan Mutasi         S7 jasa disesuaikan teknisi -> banner admin');
  console.log('  S8 tunai dipegang denis + saldo kurang setor Rp 20.000 -> Terima Pelunasan Selisih');
  console.log('  S9-S12 job SELESAI, uang belum diverifikasi -> tab Setoran Teknisi di Antrian Servis');
  console.log('        (S9 tunai Andi 2 unit, S10 transfer, S11 tunai + QRIS satu order, S12 tunai denis 3 hari)');
  console.log(`  Nomor HP pelanggan: ${phoneArg ?? '0812000000xx (palsu)'}; teknisi: Andi, Teknisi Toko, denis (semua job dipegang ketiganya)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
