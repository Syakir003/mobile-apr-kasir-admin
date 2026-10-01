/** 1 baris peringatan "jual/beli di bawah modal" — dikirim balik ke FE
 * biar bisa ditampilin di dialog konfirmasi. */
export interface BelowCostWarning {
  refId: string;
  itemCostId: string | null; // null kalau batchnya belum kebuat (stock-in)
  name: string;
  buyPrice: number;
  sellPrice: number;
  discount: number;
  effectivePrice: number;
}

/**
 * Dilempar DI DALAM Prisma `$transaction` (PosService.checkout /
 * StockService.stockIn) begitu ketauan ada baris yang harga efektifnya di
 * bawah/pas modal DAN request belum bawa `confirmOverride: true`. Prisma
 * otomatis ROLLBACK transaksi begitu callback-nya throw apapun — jadi gak
 * ada data yang sempet ke-commit. Method pemanggil WAJIB nangkep exception
 * ini DI LUAR `$transaction` dan balikin `{ status: 'confirm_required',
 * warnings }` (HTTP 200, BUKAN error) — pola "soft-warn + confirm"
 * (bukan blokir keras) yang disepakati user 2026-09-08.
 */
export class ConfirmationRequiredException extends Error {
  constructor(
    public readonly warnings: BelowCostWarning[],
    public readonly singleUnitWarnings: SingleUnitWarning[] = [],
  ) {
    super('Butuh konfirmasi: ada item yang dijual/dibeli di bawah harga modal');
    this.name = 'ConfirmationRequiredException';
  }
}

/** BARU (Paket AC Split, 2026-09-30) — 1 baris konfirmasi "jual 1 unit dari
 * paket AC" (Indoor saja / Outdoor saja dari produk berpasangan). Modal
 * restock dicatat per PAKET (gak dipecah per unit), jadi yang ditampilin ke
 * kasir itu modal total 1 paket + harga jual unit yang dia isi — kasir yang
 * mutusin lanjut atau batal. Dilempar bareng `warnings` di atas lewat
 * exception yang sama (1 dialog konfirmasi, 1 `confirmOverride`). */
export interface SingleUnitWarning {
  refId: string;
  name: string;
  unitRole: 'indoor' | 'outdoor';
  /** "<nama Indoor> + <nama Outdoor>" */
  packageName: string;
  /** Modal total 1 paket (Indoor + Outdoor) — MAX buyPrice batch Indoor yang masih ada unitnya. */
  packageBuyPrice: number;
  /** Harga jual 1 unit ini (harga yang diisi kasir, sebelum diskon). */
  sellPrice: number;
  qty: number;
}
