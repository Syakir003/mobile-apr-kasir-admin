// Data dummy penjualan buat ngetes grafik/laporan. Jalankan:
//   npx ts-node prisma/seed-dummy-sales.ts          -> isi (idempoten)
//   npx ts-node prisma/seed-dummy-sales.ts --clear  -> hapus
// Cuma bikin invoice + item (nomor DUMMY-...), TIDAK menyentuh stok/kas.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const WEEKS = 10;
const DAY = 86400000;
// Pola ramai-sepinya per minggu (index 0 = minggu terlama).
const WEEK_LOAD = [3, 5, 4, 7, 6, 9, 5, 8, 11, 7];

const rand = (n: number) => Math.floor(Math.random() * n);

async function main() {
  const old = await prisma.invoice.findMany({
    where: { number: { startsWith: 'DUMMY-' } },
    select: { id: true },
  });
  if (old.length) {
    await prisma.invoiceItem.deleteMany({ where: { invoiceId: { in: old.map((o) => o.id) } } });
    await prisma.invoice.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  }
  console.log(`dihapus: ${old.length} invoice dummy lama`);
  if (process.argv.includes('--clear')) return;

  const user = await prisma.user.findFirst({ where: { role: 'admin' } });
  if (!user) throw new Error('Tidak ada user admin. Jalankan seed utama dulu.');
  const products = await prisma.product.findMany({ where: { active: true }, take: 40 });
  if (!products.length) throw new Error('Tidak ada produk. Jalankan seed produk dulu.');
  const names = ['Budi Santoso', 'Siti Rahayu', 'Hendra Wijaya', 'Dewi Lestari', 'Agus Prasetyo', 'Rina Marlina'];

  const mondayNow = Date.now() - ((new Date().getUTCDay() + 6) % 7) * DAY;
  let n = 0;
  for (let w = 0; w < WEEKS; w++) {
    const weekStart = mondayNow - (WEEKS - 1 - w) * 7 * DAY;
    for (let i = 0; i < WEEK_LOAD[w]; i++) {
      const at = new Date(weekStart + rand(7) * DAY + (8 + rand(10)) * 3600000);
      if (at.getTime() > Date.now()) continue;
      const items = Array.from({ length: 1 + rand(2) }, () => {
        const p = products[rand(products.length)];
        const qty = 1;
        const unitPrice = Number(p.sellPrice);
        return { kind: 'product', refId: p.id, name: p.name, unit: 'unit', qty, unitPrice, lineTotal: unitPrice * qty };
      });
      items.push({ kind: 'service', refId: null as any, name: 'Jasa pasang', unit: 'paket', qty: 1, unitPrice: 250000, lineTotal: 250000 });
      const subtotal = items.reduce((a, b) => a + b.lineTotal, 0);
      const paid = Math.random() < 0.8 ? subtotal : Math.round(subtotal * 0.5);
      await prisma.invoice.create({
        data: {
          number: `DUMMY-${String(++n).padStart(4, '0')}`,
          customerName: names[rand(names.length)],
          subtotal,
          grandTotal: subtotal,
          totalPaid: paid,
          status: paid >= subtotal ? 'lunas' : 'kurang_bayar',
          createdById: user.id,
          createdAt: at,
          items: { create: items },
        },
      });
    }
  }
  console.log(`dibuat: ${n} invoice dummy dalam ${WEEKS} minggu`);
}

main().finally(() => prisma.$disconnect());
