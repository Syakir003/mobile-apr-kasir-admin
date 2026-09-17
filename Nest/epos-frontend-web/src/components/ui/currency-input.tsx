'use client';

import * as React from 'react';

import { Input } from '@/components/ui/input';

// Live thousand-separator (titik) buat SEMUA kolom input Rupiah — biar
// "50000" kebaca jelas jadi "50.000" pas diketik, sama kayak AppMoneyField
// di app mobile. React-hook-form di baliknya TETAP nyimpen angka polos
// TANPA titik (mis. "50000"), karena semua validator di form-number.ts
// (requiredNumberField/optionalNumberField/numberOrUndefined) manggil
// Number(v) LANGSUNG ke string field itu — kalau titiknya ikut kesimpen,
// Number("50.000") kebaca 50 (titik dianggap koma desimal), harga jadi
// korup. Titik cuma tampil di layar lewat formatThousands() pas render,
// gak pernah nyampe ke field.value/payload API.
function formatThousands(digits: string): string {
  if (!digits) return '';
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function toPlainDigits(v: string): string {
  return v.replace(/\D/g, '');
}

export interface CurrencyInputProps
  extends Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> {
  // String angka POLOS (tanpa titik) — cocok langsung dipasang ke field
  // react-hook-form (`value={field.value}` / `onChange={field.onChange}`),
  // sama kontrak persis kayak <Input {...field}> yang digantikan. Optional
  // karena field kayak discount/transportFee (optionalNumberField) bisa
  // undefined pas belum diisi.
  value: string | undefined;
  onChange: (value: string) => void;
}

export function CurrencyInput({ value, onChange, ...props }: CurrencyInputProps) {
  return (
    <Input
      inputMode="numeric"
      placeholder="0"
      {...props}
      value={formatThousands(value ?? '')}
      onChange={(e) => onChange(toPlainDigits(e.target.value))}
    />
  );
}
