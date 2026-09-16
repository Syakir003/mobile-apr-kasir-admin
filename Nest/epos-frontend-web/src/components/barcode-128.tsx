import { encodeCode128B } from '@/lib/code128';

/**
 * Render Code 128 (Set B) sebagai SVG — buat label unit AC yang ditempel
 * teknisi (lihat src/lib/code128.ts). Satu `<rect>` per modul '1' (bar
 * hitam); modul '0' dibiarkan kosong (background putih dari `<rect>` dasar).
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
