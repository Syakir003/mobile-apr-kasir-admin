// Kunci acak untuk korelasi/idempotensi (mis. clientRef pembayaran lapangan).
//
// GOTCHA browser: `crypto.randomUUID()` hanya ada di "secure context" (HTTPS atau http://localhost). Perangkat teknisi/kasir
// biasanya membuka web lewat IP LAN (http://192.168.x.x:3001) yang dianggap TIDAK secure: randomUUID tidak ada di sana dan
// memanggilnya melempar TypeError (halaman crash). `crypto.getRandomValues` tetap jalan di konteks mana pun. Kunci ini bukan
// untuk keamanan, jadi tidak perlu format RFC4122; cukup unik per percobaan.
export function randomKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}
