/**
 * "Lengkap di lapangan" untuk SATU unit (job): minimal 1 temuan dan SETIAP temuan punya foto sebelum DAN sesudah.
 * Dipakai Performa Teknisi untuk progres realtime (unit sedang dikerjakan yang sudah lengkap dihitung tuntas walau
 * belum Ajukan Selesai). Aturan temuan/foto SAMA dengan gate submitJobInTx; sparepart sengaja tidak diperiksa di sini
 * karena itu syarat pengajuan, bukan progres di lapangan.
 */
export function isFieldComplete(
  findings: { photos: { kind: string }[] }[],
): boolean {
  return (
    findings.length > 0 &&
    findings.every(
      (f) =>
        f.photos.some((p) => p.kind === 'sebelum') &&
        f.photos.some((p) => p.kind === 'sesudah'),
    )
  );
}
