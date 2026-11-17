import { ADDRESS_EXAMPLE, checkAddress } from '@/lib/address-check';

/**
 * Petunjuk di bawah kolom alamat: contoh format saat kosong; saat diisi, pesan wajib (merah) bila kabupaten/kota belum
 * disebut dan saran (kuning) lainnya. Link Maps berkoordinat mengalahkan aturan, jadi petunjuk disembunyikan.
 */
export function AddressHint({
  value,
  hasMapsLink,
  hideBlocking,
}: {
  value: string | undefined | null;
  hasMapsLink?: boolean;
  /** true bila pesan wajib yang sama sudah tampil di tempat lain (mis. FormMessage setelah simpan ditolak). */
  hideBlocking?: boolean;
}) {
  const text = (value ?? '').trim();
  if (hasMapsLink) return null;
  if (!text) {
    return (
      <p className="text-xs text-muted-foreground">
        Format: jalan/perumahan, desa, kecamatan, <strong>kabupaten/kota</strong>. Contoh: {ADDRESS_EXAMPLE}. Atau
        isi Link Maps di bawahnya.
      </p>
    );
  }
  const { blocking, warnings } = checkAddress(text);
  if (!blocking && warnings.length === 0) return null;
  return (
    <div className="grid gap-0.5 text-xs">
      {blocking && !hideBlocking && <p className="font-medium text-destructive">{blocking}</p>}
      {warnings.map((w) => (
        <p key={w} className="text-status-warning-foreground dark:text-status-warning">
          {w}
        </p>
      ))}
    </div>
  );
}
