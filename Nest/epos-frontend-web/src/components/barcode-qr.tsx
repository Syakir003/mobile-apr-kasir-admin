'use client';

import { QRCodeSVG } from 'qrcode.react';

// Ukuran logo-apr.png (public/) — dipakai menghitung tinggi logo supaya proporsinya tidak berubah.
const LOGO_SRC = '/logo-apr.png';
const LOGO_RATIO = 136 / 263;
// Lebar logo = 34% lebar QR. Diuji dengan decoder html5-qrcode (yang dipakai scanner web) pada ukuran 48-104px,
// untuk QR unit AC maupun token UUID unit stok, termasuk gambar beresolusi rendah + buram: terbaca sampai 40%,
// dan QR stok yang padat baru mulai gagal di sekitar 44% pada gambar bersih. Jangan dinaikkan tanpa uji ulang.
const LOGO_WIDTH_RATIO = 0.34;

/**
 * Render barcode unit AC sebagai QR Code — dipakai di label cetak
 * (unit-labels-print-client.tsx), preview card "Data Unit"
 * (ac-unit-detail-view.tsx), dan discan balik lewat scan teknisi
 * (barcode-scanner.tsx sudah daftarin Html5QrcodeSupportedFormats.QR_CODE
 * dari awal, jadi gak ada perubahan apa pun di sisi scan — cuma format
 * yang di-generate untuk dicetak/preview yang berubah).
 *
 * Sebelumnya (nama lama `Barcode128`) ini Code128 — barcode garis
 * memanjang, lihat src/lib/code128.ts, sekarang gak dipakai lagi tapi
 * filenya dibiarin (encodeCode128B) siapa tau kepake lagi nanti — diganti
 * ke QR ("barcode kotak") atas permintaan user karena lebih familiar
 * secara visual buat orang awam.
 *
 * Logo AYUB di tengah (`logo`, bawaan aktif): kotak QR di balik logo dikosongkan, jadi level koreksi
 * dinaikkan M -> Q supaya hilangnya sebagian kotak itu tetap bisa dipulihkan scanner.
 */
export function BarcodeQr({
  value,
  size = 70,
  className,
  logo = true,
}: {
  value: string;
  size?: number;
  className?: string;
  logo?: boolean;
}) {
  const logoWidth = Math.round(size * LOGO_WIDTH_RATIO);
  return (
    <QRCodeSVG
      value={value}
      size={size}
      level={logo ? 'Q' : 'M'}
      imageSettings={
        logo
          ? { src: LOGO_SRC, width: logoWidth, height: Math.round(logoWidth * LOGO_RATIO), excavate: true }
          : undefined
      }
      className={className}
      role="img"
      aria-label={`Barcode ${value}`}
    />
  );
}
