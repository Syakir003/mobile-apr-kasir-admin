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
  constructor(public readonly warnings: BelowCostWarning[]) {
    super('Butuh konfirmasi: ada item yang dijual/dibeli di bawah harga modal');
    this.name = 'ConfirmationRequiredException';
  }
}
