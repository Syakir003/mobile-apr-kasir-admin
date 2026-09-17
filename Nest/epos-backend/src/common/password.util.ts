/**
 * Hal-hal seputar password yang dipakai BARENGAN sama AuthService (login &
 * ganti password sendiri) dan UsersService (bikin user & reset password
 * admin). Ditaruh di common/ — bukan di salah satu service-nya — biar gak
 * ada modul fitur yang import dari file service modul fitur lain; polanya
 * sama kayak invoice-status.util.ts dan wib-date.util.ts.
 */

/**
 * Cost bcrypt buat SEMUA jalur yang nge-hash password. Dulu angkanya
 * di-hardcode `10` di UsersService doang; begitu ada jalur kedua & ketiga
 * (ganti sendiri, reset admin), angka yang di-copy-paste itu cepat atau
 * lambat bakal lari beda pas salah satunya di-update.
 */
export const BCRYPT_ROUNDS = 10;

/**
 * Stempel waktu buat `User.passwordChangedAt`, DI-TRUNCATE ke detik penuh.
 *
 * Kenapa: `iat` di JWT satuannya DETIK (hasil Math.floor). Kalau stempelnya
 * disimpan lengkap dengan milidetik (mis. 10:00:00.500), token yang
 * diterbitkan di detik yang sama punya iat 10:00:00 → ke-baca 10:00:00.000 →
 * dianggap "lebih tua dari waktu ganti password" → token yang BARU AJA
 * dikasih ke user langsung ditolak JwtStrategy, dan user gak bisa ngapa-
 * ngapain sampai login ulang.
 *
 * Konsekuensinya ada jendela ≤1 detik di mana token lama masih lolos. Itu
 * jauh lebih kecil daripada masalah yang dicegah.
 */
export function passwordChangeStamp(): Date {
  return new Date(Math.floor(Date.now() / 1000) * 1000);
}
