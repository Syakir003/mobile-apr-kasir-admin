'use client';

import * as React from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { toast } from 'sonner';
import { Camera, Keyboard, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// Dulu web gak punya akses kamera sama sekali buat baca barcode/QR unit —
// satu-satunya cara "scan" cuma ngetik manual (lihat komentar lama di
// ac-units/scan/scan-client.tsx & teknisi/jobs/[id]/job-detail-client.tsx).
// Komponen ini gantiin itu: 3 mode dalam satu kontrol — Manual (ketik/tempel,
// juga tetap kepake buat scanner fisik/barcode-gun yang nyuntik teks+Enter),
// Kamera (real-time via getUserMedia, minta izin browser pas tombol
// "Aktifkan Kamera" diklik — BUKAN otomatis begitu komponen dirender), dan
// Upload Foto (pilih file yang UDAH ADA lewat <input type="file"> polos
// TANPA atribut `capture` — sengaja, biar gak maksa buka kamera device kayak
// yang diminta user; ini murni file picker/galeri).
//
// Label unit AC di sistem ini dicetak QR Code (components/barcode-qr.tsx,
// sebelumnya Code128 — lihat components/barcode-128.tsx yang sekarang
// nganggur), tapi format lain tetap dibuka -- kalau ke depannya ganti
// format cetak lagi, scanner ini gak perlu diubah.
const SUPPORTED_FORMATS: Html5QrcodeSupportedFormats[] = [
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.UPC_A,
];

interface BarcodeScannerProps {
  /** Dipanggil begitu ada kode valid — dari mode manapun (submit manual,
   * kamera berhasil deteksi, atau upload foto berhasil dipindai). */
  onDetect: (code: string) => void;
  manualPlaceholder?: string;
  /** Default 'manual' — paling aman/cepat buat scanner fisik & desktop
   * tanpa kamera. Set 'camera' kalau halaman ini emang selalu dipakai dari
   * HP teknisi di lapangan. */
  defaultMode?: 'manual' | 'camera' | 'upload';
}

export function BarcodeScanner({
  onDetect,
  manualPlaceholder,
  defaultMode = 'manual',
}: BarcodeScannerProps) {
  const [mode, setMode] = React.useState<'manual' | 'camera' | 'upload'>(defaultMode);
  const [manualValue, setManualValue] = React.useState('');

  function submitManual() {
    const trimmed = manualValue.trim();
    if (!trimmed) return;
    onDetect(trimmed);
    setManualValue('');
  }

  return (
    <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="manual">
          <Keyboard className="size-4" />
          Manual
        </TabsTrigger>
        <TabsTrigger value="camera">
          <Camera className="size-4" />
          Kamera
        </TabsTrigger>
        <TabsTrigger value="upload">
          <Upload className="size-4" />
          Upload Foto
        </TabsTrigger>
      </TabsList>

      <TabsContent value="manual" className="mt-3">
        <div className="flex gap-2">
          <Input
            autoFocus={defaultMode === 'manual'}
            placeholder={manualPlaceholder ?? 'Ketik atau tempel kode di sini'}
            value={manualValue}
            onChange={(e) => setManualValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitManual();
              }
            }}
          />
          <Button type="button" onClick={submitManual} disabled={!manualValue.trim()}>
            Gunakan
          </Button>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Kolom ini juga kepake buat alat scanner fisik (barcode gun) — taruh kursor di sini lalu
          tembak.
        </p>
      </TabsContent>

      {/* Radix TabsContent unmount total pas gak aktif (gak ada forceMount di
          sini) — jadi kamera OTOMATIS berhenti (lihat cleanup effect di
          CameraScanTab) begitu pindah tab, gak nyala nganggur di background. */}
      <TabsContent value="camera" className="mt-3">
        <CameraScanTab onDetect={onDetect} />
      </TabsContent>

      <TabsContent value="upload" className="mt-3">
        <UploadScanTab onDetect={onDetect} />
      </TabsContent>
    </Tabs>
  );
}

function CameraScanTab({ onDetect }: { onDetect: (code: string) => void }) {
  const rawId = React.useId();
  const containerId = React.useMemo(() => `barcode-cam-${rawId.replace(/[^a-zA-Z0-9-]/g, '')}`, [rawId]);
  const scannerRef = React.useRef<Html5Qrcode | null>(null);
  const detectedRef = React.useRef(false);
  const [active, setActive] = React.useState(false);
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const stopCamera = React.useCallback(async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    setActive(false);
    if (!scanner) return;
    try {
      if (scanner.isScanning) await scanner.stop();
    } catch {
      // Kamera mungkin udah kehenti sendiri (tab ditutup dsb) — abaikan.
    }
    try {
      scanner.clear();
    } catch {
      // no-op
    }
  }, []);

  const startCamera = React.useCallback(async () => {
    setError(null);
    setStarting(true);
    detectedRef.current = false;
    try {
      const scanner = new Html5Qrcode(containerId, {
        formatsToSupport: SUPPORTED_FORMATS,
        verbose: false,
      });
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          if (detectedRef.current) return;
          detectedRef.current = true;
          onDetect(decodedText.trim());
          void stopCamera();
        },
        () => {
          // Callback ini kepanggil TIAP FRAME yang gak ketemu kode apapun —
          // itu normal (bukan error), jangan di-toast/di-log biar gak berisik.
        },
      );
      setActive(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Gagal mengakses kamera: ${err.message}`
          : 'Gagal mengakses kamera. Pastikan izin kamera diizinkan di browser.',
      );
      scannerRef.current = null;
    } finally {
      setStarting(false);
    }
  }, [containerId, onDetect, stopCamera]);

  // Kamera WAJIB dimatikan begitu komponen ini lepas dari DOM (pindah tab
  // Manual/Upload, atau pindah halaman) — kalau enggak, lampu kamera tetap
  // nyala walau usernya udah gak lihat preview-nya lagi.
  React.useEffect(() => {
    return () => {
      void stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid gap-2">
      <div
        id={containerId}
        className="mx-auto w-full max-w-xs overflow-hidden rounded-md bg-muted [&_video]:rounded-md"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      {active ? (
        <Button type="button" variant="outline" onClick={() => void stopCamera()}>
          Matikan Kamera
        </Button>
      ) : (
        <Button type="button" variant="outline" disabled={starting} onClick={() => void startCamera()}>
          <Camera className="size-4" />
          {starting ? 'Membuka kamera...' : 'Aktifkan Kamera'}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        Arahkan kamera ke barcode/QR unit — otomatis terdeteksi begitu kebaca jelas.
      </p>
    </div>
  );
}

function UploadScanTab({ onDetect }: { onDetect: (code: string) => void }) {
  const rawId = React.useId();
  const containerId = React.useMemo(
    () => `barcode-file-${rawId.replace(/[^a-zA-Z0-9-]/g, '')}`,
    [rawId],
  );
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    // scanFile tetap butuh elemen DOM valid buat nampung canvas sementara
    // (biar showImage=false, elemennya harus ada) — div tersembunyi di bawah.
    const scanner = new Html5Qrcode(containerId, {
      formatsToSupport: SUPPORTED_FORMATS,
      verbose: false,
    });
    try {
      const decoded = await scanner.scanFile(file, false);
      onDetect(decoded.trim());
    } catch {
      toast.error('Gak ketemu kode QR/barcode di foto itu — coba foto lain yang lebih jelas/dekat.');
    } finally {
      try {
        scanner.clear();
      } catch {
        // no-op
      }
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="grid gap-2">
      <div id={containerId} className="hidden" />
      {/* SENGAJA tanpa atribut `capture` — file picker/galeri biasa, bukan
          buka kamera langsung. Ini permintaan eksplisit: upload = pilih foto
          yang udah ada, bukan jepret baru. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      <Button type="button" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
        <Upload className="size-4" />
        {busy ? 'Memindai foto...' : 'Pilih Foto Berisi Kode'}
      </Button>
      <p className="text-xs text-muted-foreground">
        Pilih foto yang sudah ada di galeri/penyimpanan — bukan membuka kamera.
      </p>
    </div>
  );
}
