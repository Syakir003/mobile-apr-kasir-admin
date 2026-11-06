// Tanggal bisnis memakai WIB (jangan pakai timezone browser/proses). Kunci tanggal berbentuk 'YYYY-MM-DD'.
const WIB_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 'YYYY-MM-DD' menurut WIB dari sebuah waktu (string ISO atau Date). Cocok untuk nilai `<input type="date">`. */
export function wibDateKey(value: string | Date): string {
  return WIB_DATE.format(typeof value === 'string' ? new Date(value) : value);
}
