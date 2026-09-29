import { encodeCode128B } from '@/lib/code128';

/**
 * Render Code 128 (Set B) sebagai SVG. Satu `<rect>` per modul '1' (bar
 * hitam); modul '0' dibiarin kosong (background putih dari `<rect>` dasar).
 *
 * SUDAH GAK DIPAKAI di label unit AC / preview barcode lagi (2026-09) —
 * diganti QR Code (lihat components/barcode-qr.tsx, `BarcodeQr`) atas
 * permintaan user karena bentuk "kotak" lebih familiar. File ini (+
 * lib/code128.ts) dibiarin nganggur, bukan dihapus, siapa tau kepake lagi
 * buat kebutuhan lain (mis. barcode fisik yang butuh format linear).
 */
export function Barcode128({
  value,
  moduleWidth = 2,
  height = 70,
  className,
}: {
  value: string;
  moduleWidth?: number;
  height?: number;
  className?: string;
}) {
  const bits = encodeCode128B(value);
  const totalWidth = bits.length * moduleWidth;

  return (
    <svg
      viewBox={`0 0 ${totalWidth} ${height}`}
      width={totalWidth}
      height={height}
      className={className}
      role="img"
      aria-label={`Barcode ${value}`}
    >
      <rect x={0} y={0} width={totalWidth} height={height} fill="white" />
      {Array.from(bits).map((bit, i) =>
        bit === '1' ? (
          <rect key={i} x={i * moduleWidth} y={0} width={moduleWidth} height={height} fill="black" />
        ) : null,
      )}
    </svg>
  );
}
