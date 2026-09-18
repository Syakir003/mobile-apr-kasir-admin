'use client';

import { QRCodeSVG } from 'qrcode.react';

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
 */
export function BarcodeQr({
  value,
  size = 70,
  className,
}: {
  value: string;
  size?: number;
  className?: string;
}) {
  return (
    <QRCodeSVG
      value={value}
      size={size}
      level="M"
      className={className}
      role="img"
      aria-label={`Barcode ${value}`}
    />
  );
}
