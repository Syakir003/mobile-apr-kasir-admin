// Angka -> kata Bahasa Indonesia, buat baris "Terbilang" di invoice cetak.
// Port 1:1 dari terbilang.dart (app Flutter lama) — algoritma rekursif yang
// sama persis, cuma pindah bahasa.

const SATUAN = [
  'nol', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan',
  'sembilan', 'sepuluh', 'sebelas',
];

function kata(n: number): string {
  if (n < 12) return SATUAN[n];
  if (n < 20) return `${kata(n - 10)} belas`;
  if (n < 100) {
    const sisa = n % 10;
    return `${kata(Math.floor(n / 10))} puluh${sisa === 0 ? '' : ` ${kata(sisa)}`}`;
  }
  if (n < 200) {
    const sisa = n - 100;
    return `seratus${sisa === 0 ? '' : ` ${kata(sisa)}`}`;
  }
  if (n < 1000) {
    const sisa = n % 100;
    return `${kata(Math.floor(n / 100))} ratus${sisa === 0 ? '' : ` ${kata(sisa)}`}`;
  }
  if (n < 2000) {
    const sisa = n - 1000;
    return `seribu${sisa === 0 ? '' : ` ${kata(sisa)}`}`;
  }
  if (n < 1000000) {
    const sisa = n % 1000;
    return `${kata(Math.floor(n / 1000))} ribu${sisa === 0 ? '' : ` ${kata(sisa)}`}`;
  }
  if (n < 1000000000) {
    const sisa = n % 1000000;
    return `${kata(Math.floor(n / 1000000))} juta${sisa === 0 ? '' : ` ${kata(sisa)}`}`;
  }
  if (n < 1000000000000) {
    const sisa = n % 1000000000;
    return `${kata(Math.floor(n / 1000000000))} miliar${sisa === 0 ? '' : ` ${kata(sisa)}`}`;
  }
  const sisa = n % 1000000000000;
  return `${kata(Math.floor(n / 1000000000000))} triliun${sisa === 0 ? '' : ` ${kata(sisa)}`}`;
}

/** `104900` -> `'Seratus empat ribu sembilan ratus rupiah'`. */
export function terbilangRupiah(value: number): string {
  if (value === 0) return 'Nol rupiah';
  const kataHasil = kata(Math.abs(Math.round(value)));
  const kalimat = `${kataHasil[0].toUpperCase()}${kataHasil.slice(1)} rupiah`;
  return value < 0 ? `Minus ${kalimat}` : kalimat;
}
