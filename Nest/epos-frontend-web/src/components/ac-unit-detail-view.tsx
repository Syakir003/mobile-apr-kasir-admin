'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, Pencil } from 'lucide-react';

import { formatDate, formatDateTime, statusLabel } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { statusBadgeVariant } from '@/app/(dashboard)/teknisi/queue/queue-client';

// Bentuk data ini SAMA PERSIS antara AcUnitsService.findOne (by id, dipakai
// halaman Member -> detail unit) dan .lookupByBarcode (by barcodeValue,
// dipakai halaman scan teknisi) — keduanya lewat buildDetail() yang sama di
// backend. Makanya tampilannya diekstrak ke sini biar 2 halaman itu (fetch
// by id vs fetch by barcode) nampilin hasil yang identik, gak dobel kode.
export interface Finding {
  id: string;
  title: string;
  note: string | null;
  origin: string;
}
export interface ServiceHistoryEntry {
  id: string;
  type: string;
  status: string;
  scheduledDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  technician: { id: string; displayName: string } | null;
  findings: Finding[];
}
export interface AcUnitDetail {
  unit: {
    id: string;
    memberId: string;
    brand: string | null;
    model: string | null;
    pk: string | null;
    roomLocation: string | null;
    barcodeValue: string;
    serialNumber: string | null;
    installationDate: string | null;
    lastServiceDate: string | null;
    nextServiceDate: string | null;
    status: string;
  };
  member: { id: string; name: string; phone: string | null; address: string | null } | null;
  activeJob: ServiceHistoryEntry | null;
  serviceHistory: ServiceHistoryEntry[];
}

export function AcUnitDetailView({
  data,
  onEdit,
}: {
  data: AcUnitDetail;
  // Cuma dikasih dari halaman detail unit (/ac-units/[id], admin) — halaman
  // scan teknisi (/ac-units/scan) pakai komponen yang sama TAPI gak pernah
  // ngoper prop ini, jadi tombol Edit otomatis gak nongol di sana (scan itu
  // buat lookup cepat di lapangan, bukan buat ngedit data master unit).
  onEdit?: () => void;
}) {
  const { unit, member, activeJob, serviceHistory } = data;

  return (
    <div className="grid gap-6">
      <div>
        {member && (
          <Link
            href={`/members/${member.id}`}
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Kembali ke {member.name}
          </Link>
        )}
        <h1 className="text-2xl font-semibold tracking-tight">
          {[unit.brand, unit.model].filter(Boolean).join(' ') || 'Unit AC'}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{unit.roomLocation || 'Lokasi belum diisi'}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card className="h-fit">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Data Unit</CardTitle>
            {onEdit && (
              <Button variant="ghost" size="icon" title="Edit" onClick={onEdit}>
                <Pencil className="size-4" />
              </Button>
            )}
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <DetailRow label="Pemilik" value={member?.name || '-'} />
            <DetailRow label="No. HP" value={member?.phone || '-'} />
            <DetailRow label="Barcode" value={unit.barcodeValue} />
            <DetailRow label="PK" value={unit.pk ? `${unit.pk} PK` : '-'} />
            <DetailRow label="No. Seri" value={unit.serialNumber || '-'} />
            <DetailRow
              label="Status"
              value=""
              valueNode={
                <Badge variant={unitStatusVariant(unit.status)}>{statusLabel(unit.status)}</Badge>
              }
            />
            <DetailRow
              label="Tgl. Pemasangan"
              value={unit.installationDate ? formatDate(unit.installationDate) : '-'}
            />
            <DetailRow
              label="Servis Terakhir"
              value={unit.lastServiceDate ? formatDate(unit.lastServiceDate) : '-'}
            />
            <DetailRow
              label="Servis Berikutnya"
              value={unit.nextServiceDate ? formatDate(unit.nextServiceDate) : '-'}
            />
          </CardContent>
        </Card>

        <div className="grid gap-6">
          {activeJob && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Job Servis Berjalan</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{activeJob.type}</span>
                  <Badge variant={statusBadgeVariant(activeJob.status)}>
                    {statusLabel(activeJob.status)}
                  </Badge>
                </div>
                <DetailRow
                  label="Teknisi"
                  value={activeJob.technician?.displayName || 'Belum ditugaskan'}
                />
                {activeJob.scheduledDate && (
                  <DetailRow label="Dijadwalkan" value={formatDate(activeJob.scheduledDate)} />
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Riwayat Servis</CardTitle>
              <CardDescription>
                Job servis yang sudah selesai di unit ini, beserta temuan teknisi.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {serviceHistory.length === 0 && (
                <p className="text-sm text-muted-foreground">Belum ada riwayat servis.</p>
              )}
              {serviceHistory.length > 0 && (
                <div className="grid gap-3">
                  {serviceHistory.map((job) => (
                    <div key={job.id} className="rounded-md border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{job.type}</span>
                        <span className="text-xs text-muted-foreground">
                          {job.completedAt ? formatDateTime(job.completedAt) : '-'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Teknisi: {job.technician?.displayName || '-'}
                      </p>
                      {job.findings.length > 0 && (
                        <ul className="mt-2 grid gap-1 text-sm">
                          {job.findings.map((f) => (
                            <li key={f.id} className="rounded bg-muted/50 p-2">
                              <span className="font-medium">{f.title}</span>
                              {f.note && (
                                <span className="text-muted-foreground"> — {f.note}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      {job.findings.length === 0 && (
                        <p className="mt-2 text-xs text-muted-foreground">Tidak ada temuan.</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function unitStatusVariant(status: string): 'success' | 'secondary' | 'warning' {
  if (status === 'aktif') return 'success';
  if (status === 'menunggu_pemasangan' || status === 'dalam_maintenance') return 'warning';
  return 'secondary';
}

export function DetailRow({
  label,
  value,
  valueNode,
}: {
  label: string;
  value: string;
  valueNode?: ReactNode;
}) {
  return (
    <div className="flex justify-between gap-4 border-b py-1.5 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{valueNode ?? value}</span>
    </div>
  );
}
