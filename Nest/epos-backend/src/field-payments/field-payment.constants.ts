// Metode bayar yang boleh dicatat teknisi (sama dengan RecordPaymentDto kasir).
export const FIELD_PAYMENT_METHODS = ['tunai', 'transfer', 'qris', 'ewallet', 'debit'] as const;
export type FieldPaymentMethod = (typeof FIELD_PAYMENT_METHODS)[number];

export const METHOD_LABEL: Record<FieldPaymentMethod, string> = {
  tunai: 'Tunai',
  transfer: 'Transfer',
  qris: 'QRIS',
  ewallet: 'E-Wallet',
  debit: 'Debit',
};

// Tunai: uang dibawa pulang teknisi. Non-tunai: tidak ada uang yang dibawa, admin mencocokkan dengan mutasi/notifikasi toko.
export const STATUS_HELD = 'dipegang_teknisi';
export const STATUS_AWAITING_MATCH = 'menunggu_cocok';
export const STATUS_VERIFIED = 'diverifikasi';
export const STATUS_REJECTED = 'ditolak';

/** Pembayaran yang uangnya masih di teknisi / belum dicocokkan admin: dihitung sebagai "sudah tertagih" saat membatasi sisa. */
export const ACTIVE_FIELD_PAYMENT_STATUSES = [STATUS_HELD, STATUS_AWAITING_MATCH] as const;
