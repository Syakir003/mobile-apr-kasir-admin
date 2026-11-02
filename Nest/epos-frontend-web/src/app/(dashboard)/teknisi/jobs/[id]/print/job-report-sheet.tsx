import * as React from 'react';

// Laporan Pekerjaan A4 potret — tata letak dan isinya sama dengan PDF di app mobile
// (frontend/mobile/lib/features/jobs/job_report_pdf.dart): kop CV, kotak identitas,
// tabel pekerjaan, tabel petugas, catatan kaki, dan kolom tanda tangan. Ukuran dalam pt
// supaya proporsinya sama dengan PDF-nya.

export interface JobReportRow {
  /** mis. "2 meter" */
  qty: string;
  text: string;
}

export interface JobReportInfo {
  number: string;
  /** dd-mm-yyyy */
  date: string;
  name: string;
  address: string;
  phone: string;
  /** nama petugas; kosong = "-" */
  petugas: string;
  /** dd-mm-yyyy HH:mm; kosong = "-" */
  start: string;
  end: string;
}

/** Baris kosong di bawah tabel pekerjaan (seperti formulir kertas): 6 dikurangi jumlah material. */
const BLANK_ROWS = 6;

const LINE = '0.8pt solid #000';
const GREY = '#e0e0e0';

const cell: React.CSSProperties = { border: LINE, padding: '4pt', fontSize: '8pt', lineHeight: 1.17, verticalAlign: 'top' };
const head: React.CSSProperties = { ...cell, background: GREY, fontWeight: 700, textAlign: 'center' };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' };

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={{ ...cell, width: `${(2 / 7) * 100}%`, fontWeight: 700 }}>{label}</td>
      <td style={cell}>{value}</td>
    </tr>
  );
}

export function JobReportSheet({
  rows,
  info,
  logoSrc = '/logo-apr.png',
}: {
  rows: JobReportRow[];
  info: JobReportInfo;
  logoSrc?: string;
}) {
  const blank = Math.min(Math.max(BLANK_ROWS - (rows.length - 1), 0), BLANK_ROWS);

  return (
    <div
      style={{
        width: '210mm',
        boxSizing: 'border-box',
        padding: '28pt',
        background: '#fff',
        color: '#000',
        fontFamily: 'Roboto, Arial, Helvetica, sans-serif',
        WebkitPrintColorAdjust: 'exact',
        printColorAdjust: 'exact',
      }}
    >
      {/* Roboto yang sama dengan PDF di app mobile (assets/fonts), supaya lebar teks & pemenggalan baris identik. */}
      <style>{`
        @font-face { font-family: 'Roboto'; font-weight: 400; src: url('/fonts/roboto-regular.ttf') format('truetype'); }
        @font-face { font-family: 'Roboto'; font-weight: 700; src: url('/fonts/roboto-bold.ttf') format('truetype'); }
      `}</style>

      {/* ---- header ---- */}
      <div style={{ display: 'flex', gap: '10pt', alignItems: 'flex-start' }}>
        <div style={{ flex: 5, minWidth: 0, border: LINE, padding: '8pt', display: 'flex', alignItems: 'center', gap: '6pt' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoSrc} alt="APR" style={{ height: '32pt', width: 'auto' }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '11pt', fontWeight: 700, lineHeight: 1.17 }}>CV. AYUB PODO RUKUN</div>
            <div style={{ fontSize: '7pt', fontWeight: 700, lineHeight: 1.17 }}>Penjualan • Service • Spare Part • Rental AC</div>
            <div style={{ fontSize: '7pt', lineHeight: 1.17 }}>JL. GUNUNG ANYAR RT. 01 RW. 06</div>
            <div style={{ fontSize: '7pt', lineHeight: 1.17 }}>KEL. GUNUNG GEDANGAN - MOJOKERTO</div>
            <div style={{ fontSize: '7pt', lineHeight: 1.17 }}>TLP. : 0857 332 7112 - 0822 3388 9990</div>
          </div>
        </div>
        <div style={{ flex: 3, minWidth: 0, alignSelf: 'center', textAlign: 'center', fontSize: '16pt', fontWeight: 700, lineHeight: 1.17 }}>
          LAPORAN
          <br />
          PEKERJAAN
        </div>
        <div style={{ flex: 6, minWidth: 0 }}>
          <table style={table}>
            <tbody>
              <InfoRow label="NO." value={info.number} />
              <InfoRow label="TGL." value={info.date} />
              <InfoRow label="NAMA" value={info.name} />
              <InfoRow label="ALAMAT" value={info.address} />
              <InfoRow label="TLP." value={info.phone} />
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- tabel pekerjaan ---- */}
      <table style={{ ...table, marginTop: '12pt' }}>
        <colgroup>
          <col style={{ width: `${(1 / 11) * 100}%` }} />
          <col style={{ width: `${(2 / 11) * 100}%` }} />
          <col style={{ width: `${(8 / 11) * 100}%` }} />
        </colgroup>
        <thead>
          <tr>
            <th style={head}>NO.</th>
            <th style={head}>
              JUMLAH
              <br />
              BARANG
            </th>
            <th style={head}>KETERANGAN</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td style={{ ...cell, textAlign: 'center' }}>{i + 1}</td>
              <td style={{ ...cell, textAlign: 'center' }}>{row.qty}</td>
              <td style={cell}>{row.text}</td>
            </tr>
          ))}
          {Array.from({ length: blank }).map((_, i) => (
            <tr key={`b${i}`}>
              <td style={cell}>&nbsp;</td>
              <td style={cell}>&nbsp;</td>
              <td style={cell}>&nbsp;</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ---- tabel petugas ---- */}
      <table style={{ ...table, marginTop: '10pt' }}>
        <colgroup>
          <col style={{ width: '30%' }} />
          <col style={{ width: '20%' }} />
          <col style={{ width: '20%' }} />
          <col style={{ width: '30%' }} />
        </colgroup>
        <thead>
          <tr>
            <th style={head}>NAMA PETUGAS</th>
            <th style={head}>MULAI</th>
            <th style={head}>SELESAI</th>
            <th style={head}>GARANSI</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ ...cell, textAlign: 'center' }}>{info.petugas || '-'}</td>
            <td style={{ ...cell, textAlign: 'center' }}>{info.start || '-'}</td>
            <td style={{ ...cell, textAlign: 'center' }}>{info.end || '-'}</td>
            {/* GARANSI dibiarkan titik-titik: diisi tangan sesuai kesepakatan di lapangan */}
            <td style={{ ...cell, textAlign: 'center' }}>.......... Bln</td>
          </tr>
        </tbody>
      </table>

      {/* ---- catatan kaki + tanda tangan ---- */}
      <div style={{ marginTop: '16pt', fontSize: '7pt', lineHeight: 1.17 }}>
        <div>* Garansi berlaku apabila kerusakan sama &amp; dalam batas waktu yang sudah ditentukan</div>
        <div>* Laporan Pekerjaan ini berlaku sebagai kartu garansi. Tunjukkan ini apabila perbaikan dalam masa garansi</div>
        <div>* Jangan memberi tip kepada teknisi / petugas kami. Mintalah kwitansi / tanda terima yang resmi dalam pembayaran</div>
      </div>
      <div style={{ display: 'flex', marginTop: '24pt', textAlign: 'center', fontSize: '9pt', lineHeight: 1.17 }}>
        {['Petugas,', 'Pelanggan,'].map((label) => (
          <div key={label} style={{ flex: 1 }}>
            <div>{label}</div>
            <div style={{ height: '32pt' }} />
            <div>...................................</div>
          </div>
        ))}
      </div>
    </div>
  );
}
