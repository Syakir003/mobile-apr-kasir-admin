import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import { BCRYPT_ROUNDS } from '../src/common/password.util';

// Sama seperti PrismaService (src/prisma/prisma.service.ts) — Prisma 7.x +
// driver adapter WAJIB dikasih connectionString-nya sendiri, gak otomatis
// baca .env kayak versi lama. `dotenv/config` di atas yang bikin
// process.env.DATABASE_URL kebaca duluan sebelum PrismaPg dipanggil.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Daftar baku "kemungkinan kerusakan / jenis servis AC" buat autocomplete
// input temuan (Siklus 5 revisi — checklist). Bukan daftar final — Admin
// bisa nambah lewat POST /technician-jobs/categories, dan daftar ini juga
// tumbuh sendiri tiap kali teknisi ketik kategori baru yang belum ada.
const PROBLEM_CATEGORY_SEEDS = [
  'AC tidak dingin',
  'Freon bocor/kurang',
  'Kompresor rusak',
  'Cuci unit indoor',
  'Cuci unit outdoor',
  'Pemasangan baru',
  'Kebocoran air (drain mampet)',
  'Remote/PCB error',
  'Ganti kapasitor',
  'Noise/getaran tidak normal',
];

// Satu akun contoh per role — buat login pertama kali / testing lokal.
// SEMUA password di bawah WAJIB diganti begitu dipakai di server beneran
// (lewat endpoint ganti-password sendiri atau reset admin), bukan buat
// dipakai permanen di production.
const ROLE_SEEDS = [
  {
    email: 'admin@toko.local',
    password: 'admin12345',
    displayName: 'Admin Toko',
    role: 'admin' as const,
  },
  {
    email: 'kasir@toko.local',
    password: 'kasir12345',
    displayName: 'Kasir Toko',
    role: 'kasir' as const,
  },
  {
    email: 'teknisi@toko.local',
    password: 'teknisi12345',
    displayName: 'Teknisi Toko',
    role: 'teknisi' as const,
  },
];

async function main() {
  for (const seedUser of ROLE_SEEDS) {
    const password = await bcrypt.hash(seedUser.password, BCRYPT_ROUNDS);
    // Fix: sebelumnya `update: {}` — kalau baris emailnya UDAH ADA dari
    // sebelum seed ini ditulis (mis. dibuat manual pas awal-awal proyek),
    // upsert diem aja gak nyentuh password sama sekali, jadi password lama
    // (apapun itu, gak ketauan) tetap kepake — padahal log di bawah selalu
    // ngaku sukses set ke `seedUser.password`. Sekarang re-run seed SELALU
    // nyamain ulang ke kredensial contoh di ROLE_SEEDS (itu emang tujuannya
    // akun ini: kredensial dev/testing yang diketahui, bukan data asli).
    const user = await prisma.user.upsert({
      where: { email: seedUser.email },
      update: {
        password,
        displayName: seedUser.displayName,
        role: seedUser.role,
        active: true,
      },
      create: {
        email: seedUser.email,
        password,
        displayName: seedUser.displayName,
        role: seedUser.role,
        active: true,
      },
    });
    console.log(
      `Seed ${user.role} siap: ${user.email} (password: ${seedUser.password})`,
    );
  }

  for (const name of PROBLEM_CATEGORY_SEEDS) {
    await prisma.problemCategory.upsert({
      where: { name },
      update: {},
      create: { name, source: 'seed' },
    });
  }
  console.log(`Seed ${PROBLEM_CATEGORY_SEEDS.length} kategori masalah siap.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
