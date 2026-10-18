// Struk ESC/POS untuk printer thermal 58mm (32 kolom, font A), dikirim lewat Web Serial
// (Chrome/Edge, hanya di localhost atau HTTPS). Printer Bluetooth (mis. Rongta RPP02N) cukup
// dipasangkan di Windows; port COM Bluetooth-nya dipilih sekali lewat dialog browser.
// ponytail: teks saja (tanpa logo/raster), tanpa cutter. Tambah GS v 0 kalau logo dibutuhkan.

const COLS = 32;
const ESC = 0x1b;
const GS = 0x1d;

export interface ReceiptData {
  header: string[]; // baris identitas toko, rata tengah
  meta: [string, string][]; // No, Tanggal, Pelanggan, ...
  alamat?: string;
  items: { name: string; qty: string; total: string }[]; // qty = "2 unit x Rp4.500.000"
  extras: [string, string][]; // diskon, pajak, ongkir, ...
  total: string;
  pembayaran: [string, string][]; // DP / Dibayar / SISA TAGIHAN (kosong kalau lunas)
  lunas: boolean;
  notes?: string;
  footer: string[];
}

const ascii = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[•–—]/g, '-')
    .replace(/[^\x20-\x7e]/g, '');

function wrap(text: string, width = COLS): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of ascii(text).split(/\s+/).filter(Boolean)) {
    if (word.length > width) {
      if (line) out.push(line);
      for (let i = 0; i < word.length; i += width) out.push(word.slice(i, i + width));
      line = '';
    } else if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out;
}

// Kiri-kanan dalam satu baris; kalau tidak muat, kiri membungkus lalu kanan rata kanan di baris baru.
function pair(left: string, right: string): string[] {
  const l = ascii(left);
  const r = ascii(right);
  if (l.length + 1 + r.length <= COLS) return [l + ' '.repeat(COLS - l.length - r.length) + r];
  return [...wrap(l), ' '.repeat(Math.max(0, COLS - r.length)) + r.slice(-COLS)];
}

export function buildReceiptBytes(d: ReceiptData): Uint8Array {
  const bytes: number[] = [ESC, 0x40]; // init
  const text = (s: string) => bytes.push(...Array.from(s, (c) => c.charCodeAt(0)), 0x0a);
  const align = (n: 0 | 1) => bytes.push(ESC, 0x61, n);
  const dash = () => text('-'.repeat(COLS));
  const left = (lines: string[]) => {
    align(0);
    lines.forEach(text);
  };

  align(1);
  bytes.push(GS, 0x21, 0x11); // judul 2x lebar & tinggi
  text('AYUB AC');
  bytes.push(GS, 0x21, 0x00);
  d.header.flatMap((h) => wrap(h)).forEach(text);
  dash();
  left(d.meta.flatMap(([l, r]) => pair(l, r)));
  if (d.alamat) left(wrap(`Alamat: ${d.alamat}`));
  dash();
  left(
    d.items.flatMap((it) => [...wrap(it.name), ...wrap(it.qty), ...pair('', it.total), '']).slice(0, -1),
  );
  if (d.extras.length) {
    dash();
    left(d.extras.flatMap(([l, r]) => pair(l, r)));
  }
  dash();
  left(pair('TOTAL', d.total));
  if (d.lunas) {
    align(1);
    text('*** LUNAS ***');
  } else left(d.pembayaran.flatMap(([l, r]) => pair(l, r)));
  dash();
  if (d.notes) left(wrap(`Catatan: ${d.notes}`));
  align(1);
  d.footer.flatMap((f) => wrap(f)).forEach(text);
  bytes.push(0x0a, 0x0a, 0x0a, 0x0a); // dorong kertas keluar
  return Uint8Array.from(bytes);
}

// Web Serial belum ada di tipe bawaan TypeScript; cukup antarmuka yang dipakai di sini.
interface SerialPortLike {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  writable: { getWriter(): { write(b: Uint8Array): Promise<void>; releaseLock(): void } } | null;
}
interface SerialLike {
  getPorts(): Promise<SerialPortLike[]>;
  requestPort(): Promise<SerialPortLike>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Kirim bytes ke printer serial. Port yang pernah diizinkan dipakai ulang tanpa dialog. */
export async function printToSerial(bytes: Uint8Array): Promise<void> {
  const serial = (navigator as Navigator & { serial?: SerialLike }).serial;
  if (!serial) throw new Error('Browser tidak mendukung Web Serial. Pakai Chrome/Edge lewat localhost atau HTTPS.');
  const port = (await serial.getPorts())[0] ?? (await serial.requestPort());
  await port.open({ baudRate: 9600 }); // baud diabaikan oleh Bluetooth SPP
  try {
    const writer = port.writable!.getWriter();
    // Printer Bluetooth punya buffer kecil: kirim per potongan dengan jeda.
    for (let i = 0; i < bytes.length; i += 128) {
      await writer.write(bytes.slice(i, i + 128));
      await sleep(40);
    }
    writer.releaseLock();
    await sleep(300);
  } finally {
    await port.close();
  }
}
