import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';

// Seed katalog produk AC dari prisma/seed-source/ac-products.csv.
//   npx tsx prisma/seed-ac-products.ts --dry   -> cek saja, TIDAK menyentuh database
//   npx tsx prisma/seed-ac-products.ts         -> tulis ke database
// Idempotent: produk yang (merek + model + peran/jenis)-nya sudah ada dilewati.
// Harga jual diisi 0 (kolom wajib, datanya tidak punya harga) — admin mengisi
// harga di Data Master > Produk. Stok awal 0, jadi belum bisa terjual sebelum
// ada Barang Masuk.

interface Row {
  brand: string;
  series: string;
  model: string;
  jenis: string;
  pk: number | null;
}

const num = (s: string) => (s.trim() ? Number(s.trim().replace(',', '.')) : null);
// Sama dengan composeName() di web (master/produk/page.tsx): Merek + Model + "<PK> PK".
const composeName = (r: Row) => [r.brand, r.model, r.pk !== null && `${r.pk} PK`].filter(Boolean).join(' ');

function load(): Row[] {
  const lines = readFileSync(join(__dirname, 'seed-source', 'ac-products.csv'), 'utf8').trim().split(/\r?\n/).slice(1);
  const seen = new Set<string>();
  const rows: Row[] = [];
  for (const line of lines) {
    const [brand, series, model, jenis, pk] = line.split(';').map((s) => s.trim());
    const key = `${brand}|${model}|${jenis}`;
    if (seen.has(key)) continue; // baris ganda di sumber (mis. Daikin FVC85AV14 Indoor)
    seen.add(key);
    rows.push({ brand, series, model, jenis, pk: num(pk ?? '') });
  }
  return rows;
}

// Pasangan Indoor -> Outdoor (Product.pairedProductId diisi di sisi Indoor).
// 1) model identik (Indoor & Outdoor satu kode);
// 2) kode beda tapi merek + seri + PK sama dan persis 1 Indoor + 1 Outdoor yang belum berpasangan.
// ponytail: tebakan ini hanya saran auto-suggest (bisa di-override saat transaksi); bila
// ada kode ganda di grup yang sama sengaja dilewati, pasangkan manual.
function planPairs(rows: Row[]): [Row, Row][] {
  const ins = rows.filter((r) => r.jenis === 'Indoor');
  const outs = rows.filter((r) => r.jenis === 'Outdoor');
  const pairs: [Row, Row][] = [];
  const usedIn = new Set<Row>();
  const usedOut = new Set<Row>();
  const take = (i: Row, o: Row) => (pairs.push([i, o]), usedIn.add(i), usedOut.add(o));

  for (const i of ins) {
    const o = outs.find((x) => x.brand === i.brand && x.model === i.model);
    if (o) take(i, o);
  }
  const grp = (r: Row) => `${r.brand}|${r.series}|${r.pk}`;
  const left = (list: Row[], used: Set<Row>) => list.filter((r) => !used.has(r) && r.pk !== null);
  const outBy = new Map<string, Row[]>();
  for (const o of left(outs, usedOut)) outBy.set(grp(o), [...(outBy.get(grp(o)) ?? []), o]);
  const inBy = new Map<string, Row[]>();
  for (const i of left(ins, usedIn)) inBy.set(grp(i), [...(inBy.get(grp(i)) ?? []), i]);
  for (const [g, is] of inBy) {
    const os = outBy.get(g);
    if (is.length === 1 && os?.length === 1) take(is[0], os[0]);
  }
  return pairs;
}

async function main() {
  const rows = load();
  const pairs = planPairs(rows);
  const count = (j: string) => rows.filter((r) => r.jenis === j).length;
  console.log(
    `Baris unik: ${rows.length} (Indoor ${count('Indoor')}, Outdoor ${count('Outdoor')}, lainnya ${rows.length - count('Indoor') - count('Outdoor')}); pasangan Indoor-Outdoor: ${pairs.length}`,
  );
  if (process.argv.includes('--dry')) return;

  const { PrismaClient } = await import('@prisma/client');
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

  const ids = new Map<Row, string>();
  let created = 0;
  let skipped = 0;
  for (const r of rows) {
    const isRole = r.jenis === 'Indoor' || r.jenis === 'Outdoor';
    const acRole = isRole ? r.jenis.toLowerCase() : null;
    const category = isRole ? null : r.jenis;
    const found = await prisma.product.findFirst({ where: { brand: r.brand, model: r.model, acRole, category } });
    if (found) {
      ids.set(r, found.id);
      skipped++;
      continue;
    }
    // Sama dengan ProductsService.create(): SKU dari counter global 'product_sku', satu transaksi.
    const p = await prisma.$transaction(async (tx) => {
      const [{ seq }] = await tx.$queryRaw<{ seq: number }[]>`
        INSERT INTO counters (key, seq) VALUES ('product_sku', 1)
        ON CONFLICT (key) DO UPDATE SET seq = counters.seq + 1 RETURNING seq`;
      return tx.product.create({
        data: {
          sku: `PRD-${String(seq).padStart(4, '0')}`,
          name: composeName(r),
          brand: r.brand,
          model: r.model,
          type: r.series === r.brand ? null : r.series,
          pk: r.pk,
          inverter: /inverter/i.test(r.series),
          sellPrice: 0,
          category,
          acRole,
          active: true,
        },
      });
    });
    ids.set(r, p.id);
    created++;
  }

  let paired = 0;
  for (const [i, o] of pairs) {
    const ind = await prisma.product.findUnique({ where: { id: ids.get(i)! } });
    if (ind?.pairedProductId) continue; // jangan timpa pasangan yang sudah diatur manual
    await prisma.product.update({ where: { id: ind!.id }, data: { pairedProductId: ids.get(o)! } });
    paired++;
  }
  console.log(`Dibuat: ${created}, dilewati (sudah ada): ${skipped}, dipasangkan: ${paired}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
