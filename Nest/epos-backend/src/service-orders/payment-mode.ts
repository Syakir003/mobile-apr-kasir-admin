// Cara tagih order servis. 'bayar_di_lokasi': teknisi menagih di lokasi dan mencatat pembayaran. 'ditagih_admin':
// pelanggan ditagih admin belakangan (instansi/langganan) — perilaku sebelum fitur pembayaran lapangan.
export const PAYMENT_MODES = ['bayar_di_lokasi', 'ditagih_admin'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];
