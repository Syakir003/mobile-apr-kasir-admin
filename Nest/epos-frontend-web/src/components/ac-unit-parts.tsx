import { Badge } from '@/components/ui/badge';

// Paket AC Split (2026-09-30) — 1 unit AC terpasang = 1 paket yang bisa
// terdiri dari unit Indoor + Outdoor (beda tipe/kode model). Komponen
// bersama ini dipakai semua layar yang nampilin unit AC.
export interface UnitPartProduct {
  id: string;
  name: string;
  sku?: string | null;
}
export interface UnitParts {
  indoorProduct?: UnitPartProduct | null;
  outdoorProduct?: UnitPartProduct | null;
}

export function hasUnitParts(u: UnitParts | null | undefined): boolean {
  return !!(u && (u.indoorProduct || u.outdoorProduct));
}

/** Teks ringkas satu baris, mis. "Indoor AC FT123 · Outdoor AC FK123" (buat label cetak dsb). */
export function unitPartsText(u: UnitParts | null | undefined): string {
  if (!u) return '';
  return [
    u.indoorProduct && `Indoor ${u.indoorProduct.name}`,
    u.outdoorProduct && `Outdoor ${u.outdoorProduct.name}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Nama paket buat judul kalau brand/model kosong, mis. "AC FT123 + AC FK123". */
export function unitPartsTitle(u: UnitParts | null | undefined): string {
  if (!u) return '';
  return [u.indoorProduct?.name, u.outdoorProduct?.name].filter(Boolean).join(' + ');
}

/** Daftar bertumpuk: badge peran + nama unit (+ SKU kecil kalau `showSku`). */
export function UnitPartsList({
  unit,
  showSku = false,
  emptyText = '-',
  compact = false,
}: {
  unit: UnitParts | null | undefined;
  showSku?: boolean;
  emptyText?: string;
  // Varian ringkas buat sel tabel: teks kecil satu baris per unit, tanpa badge
  // (badge + teks panjang bikin kolom tabel melebar & kelihatan berantakan).
  compact?: boolean;
}) {
  if (!hasUnitParts(unit)) return <span className="text-muted-foreground">{emptyText}</span>;
  const rows = [
    { role: 'Indoor', p: unit!.indoorProduct },
    { role: 'Outdoor', p: unit!.outdoorProduct },
  ].filter((r) => r.p);
  if (compact) {
    return (
      <div className="mt-0.5 grid gap-0.5 text-xs font-normal text-muted-foreground">
        {rows.map(({ role, p }) => (
          <div key={role} className="whitespace-nowrap">
            <span className="font-medium text-foreground/80">{role}</span> · {p!.name}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="grid min-w-0 gap-1.5">
      {rows.map(({ role, p }) => (
        <div key={role} className="flex min-w-0 items-start gap-2">
          <Badge variant="outline" className="mt-0.5 shrink-0">
            {role}
          </Badge>
          <span className="min-w-0 break-words">
            {p!.name}
            {showSku && p!.sku && <span className="block text-xs text-muted-foreground">{p!.sku}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
