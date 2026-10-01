/**
 * Terjemahan pesan class-validator (ValidationPipe) ke Bahasa Indonesia.
 * Nama field dibiarkan apa adanya (mis. `sellPrice`) supaya jelas isian
 * mana yang salah. Pesan yang tak dikenali dipertahankan.
 */
const RULES: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^(.+) should not be empty$/, (m) => `${m[1]} wajib diisi`],
  [/^(.+) must be a string$/, (m) => `${m[1]} harus berupa teks`],
  [/^(.+) must be a number conforming to the specified constraints$/, (m) => `${m[1]} harus berupa angka`],
  [/^(.+) must be an integer number$/, (m) => `${m[1]} harus bilangan bulat`],
  [/^(.+) must not be less than (.+)$/, (m) => `${m[1]} tidak boleh kurang dari ${m[2]}`],
  [/^(.+) must not be greater than (.+)$/, (m) => `${m[1]} tidak boleh lebih dari ${m[2]}`],
  [/^(.+) must be a boolean value$/, (m) => `${m[1]} harus bernilai ya/tidak`],
  [/^(.+) must be an array$/, (m) => `${m[1]} harus berupa daftar`],
  [/^(.+) must contain at least (\d+) elements$/, (m) => `${m[1]} minimal ${m[2]} isian`],
  [/^(.+) must be one of the following values: (.+)$/, (m) => `${m[1]} harus salah satu dari: ${m[2]}`],
  [/^(.+) must be an email$/, (m) => `${m[1]} harus berupa email yang valid`],
  [/^property (.+) should not exist$/, (m) => `Isian ${m[1]} tidak dikenal`],
  [/^(.+) must be a valid ISO 8601 date string$/, (m) => `${m[1]} harus berupa tanggal yang valid`],
];

function translateOne(msg: string): string {
  for (const [re, fn] of RULES) {
    const m = msg.match(re);
    if (m) return fn(m);
  }
  return msg;
}

/** Array pesan validasi -> satu kalimat (tanpa duplikat). String tunggal
 * diterjemahkan juga. */
export function translateValidationMessage(message: string | string[]): string {
  const list = Array.isArray(message) ? message : [message];
  const out: string[] = [];
  for (const raw of list) {
    const t = translateOne(raw);
    if (!out.includes(t)) out.push(t);
  }
  return out.join('; ');
}
