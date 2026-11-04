import { BarcodeQr } from '@/components/barcode-qr';

export interface UnitLabelUnit {
  barcodeValue: string;
  // 'menunggu_data' = unit "QR dulu" (tipe belum diketahui): baris tipe dikosongkan, tanpa tulisan apa pun.
  status?: string | null;
  brand?: string | null;
  model?: string | null;
  pk?: number | null;
  roomLocation?: string | null;
  indoorName?: string | null;
  outdoorName?: string | null;
}

/** Baris tipe label: "Merk Model · 1 PK". Kosong untuk unit "QR dulu" atau bila datanya memang belum ada. */
export function unitTypeLine(u: Pick<UnitLabelUnit, 'status' | 'brand' | 'model' | 'pk'>): string {
  if (u.status === 'menunggu_data') return '';
  return [[u.brand, u.model].filter(Boolean).join(' '), u.pk != null ? `${u.pk} PK` : '']
    .filter(Boolean)
    .join(' · ');
}

/** Lembar stiker A4 2 kolom, dipakai semua cetak label unit AC member (Input Data Lampau dan job/order servis). */
export const UNIT_LABEL_SHEET_CSS = '@page { size: A4; margin: 8mm; }';
export const UNIT_LABEL_SHEET_CLASS = 'grid grid-cols-2 gap-2 bg-white text-black';

// Satu stiker untuk ditempel di unit AC member: QR di kiri, identitas di kanan. Setiap label SELALU memuat nama member +
// alamat + ruangan supaya tim yang keliling tahu tujuannya tanpa buka sistem.
// Proporsi (kertas 97 x 62 mm): QR 104px (+/- 27 mm) dan teks 13-17px, supaya QR tetap gampang discan tetapi teks terbaca
// dari jarak biasa; kalau diubah, uji ulang scan QR (lihat catatan ukuran logo di barcode-qr.tsx).
export function UnitLabelCard({
  unit,
  memberName,
  memberAddress,
}: {
  unit: UnitLabelUnit;
  memberName?: string | null;
  memberAddress?: string | null;
}) {
  const tipeLine = unitTypeLine(unit);
  return (
    <div
      className="flex h-[62mm] items-center gap-3 border border-dashed border-neutral-400 p-3"
      style={{ breakInside: 'avoid' }}
    >
      <div className="flex shrink-0 flex-col items-center gap-1">
        <BarcodeQr value={unit.barcodeValue} size={104} />
        <p className="text-[10px] leading-none">{unit.barcodeValue}</p>
      </div>
      <div className="min-w-0 flex-1 text-[13px] leading-snug">
        <p className="text-[11px] font-bold uppercase tracking-wide">AYUB AC</p>
        {memberName && <p className="line-clamp-2 text-[17px] font-bold leading-tight">{memberName}</p>}
        {memberAddress && <p className="mt-0.5 line-clamp-3">{memberAddress}</p>}
        {unit.roomLocation && <p className="mt-0.5 font-semibold">Ruang: {unit.roomLocation}</p>}
        {tipeLine && <p className="mt-0.5">{tipeLine}</p>}
        {unit.indoorName && <p className="text-[11px]">Indoor: {unit.indoorName}</p>}
        {unit.outdoorName && <p className="text-[11px]">Outdoor: {unit.outdoorName}</p>}
      </div>
    </div>
  );
}
