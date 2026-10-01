'use client';

import * as React from 'react';

import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

// Pengingat servis per unit AC (2026-09-30). "Unit AC" = 1 set AC
// (indoor + outdoor) = 1 pengingat. Batas sinkron sama backend
// (service-schedule.util.ts / UpdateAcUnitDto).
export const MIN_INTERVAL_DAYS = 7;
export const MAX_INTERVAL_DAYS = 730;
const QUICK_DAYS = [60, 90, 120, 180];

/** null = valid; selain itu pesan error. String kosong dianggap belum diisi. */
export function intervalError(days: string): string | null {
  const t = days.trim();
  if (!t) return 'Siklus servis wajib diisi.';
  const n = Number(t);
  if (!Number.isInteger(n)) return 'Siklus harus bilangan bulat (hari).';
  if (n < MIN_INTERVAL_DAYS || n > MAX_INTERVAL_DAYS) {
    return `Siklus harus ${MIN_INTERVAL_DAYS}–${MAX_INTERVAL_DAYS} hari.`;
  }
  return null;
}

function Toggle({
  checked,
  onChange,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'border-primary bg-primary' : 'border-input bg-muted',
      )}
    >
      <span
        className={cn(
          'pointer-events-none block size-4 rounded-full bg-background shadow transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

export function ReminderScheduleFields({
  enabled,
  onEnabledChange,
  days,
  onDaysChange,
  baseDate,
  disabled,
  title = 'Ingatkan servis berikutnya',
}: {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  days: string;
  onDaysChange: (v: string) => void;
  /** Tanggal acuan buat preview jadwal (default: hari ini). */
  baseDate?: Date;
  disabled?: boolean;
  title?: string;
}) {
  const uid = React.useId();
  const err = enabled ? intervalError(days) : null;
  const n = Number(days);
  const preview =
    enabled && !err
      ? formatDate(new Date((baseDate ?? new Date()).getTime() + n * 86400000))
      : null;

  return (
    <div className="grid gap-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label htmlFor={`${uid}-sw`} className="text-sm font-medium">
          {title}
        </label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{enabled ? 'Nyala' : 'Mati'}</span>
          <Toggle id={`${uid}-sw`} checked={enabled} onChange={onEnabledChange} disabled={disabled} />
        </div>
      </div>

      {enabled ? (
        <div className="grid gap-2">
          <label htmlFor={`${uid}-days`} className="text-xs text-muted-foreground">
            Servis berikutnya (hari dari sekarang)
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id={`${uid}-days`}
              type="number"
              inputMode="numeric"
              min={MIN_INTERVAL_DAYS}
              max={MAX_INTERVAL_DAYS}
              className="w-28"
              placeholder="Mis. 90"
              value={days}
              disabled={disabled}
              aria-invalid={!!err}
              onChange={(e) => onDaysChange(e.target.value)}
            />
            {QUICK_DAYS.map((d) => (
              <button
                key={d}
                type="button"
                disabled={disabled}
                onClick={() => onDaysChange(String(d))}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-accent disabled:opacity-50',
                  days.trim() === String(d) && 'border-primary bg-primary/10 text-primary',
                )}
              >
                {d} hari
              </button>
            ))}
          </div>
          {err ? (
            <p className="text-xs text-destructive">{err}</p>
          ) : (
            <p className="text-xs text-muted-foreground">Jadwal berikutnya: {preview}</p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Pengingat WA untuk AC ini dimatikan (mis. AC sudah dibongkar atau tidak dipakai lagi).
          Bisa dinyalakan lagi kapan saja dari halaman detail unit.
        </p>
      )}
    </div>
  );
}
