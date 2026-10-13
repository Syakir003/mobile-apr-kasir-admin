'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronsUpDown } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormLabel } from '@/components/ui/form';

export interface MemberOption {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
}

const PAGE_SIZE = 20; // sama dengan `take` di MembersService.search

// Dropdown pilih member lama (POS, servis mandiri). Klik kolomnya langsung
// membuka daftar member; ketik untuk mempersempit. Dikosongkan = pelanggan
// baru (datanya diisi di form di bawahnya). Setelah dipilih tampil sebagai
// kartu kecil dengan tombol "Ganti".
export function MemberPicker({
  value,
  onSelect,
  onClear,
}: {
  value: MemberOption | null;
  onSelect: (m: MemberOption) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [active, setActive] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  // Tutup saat klik di luar.
  React.useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const query = useQuery({
    queryKey: ['members-pick', debounced],
    queryFn: () => apiClient.get<MemberOption[]>(`/members/search?q=${encodeURIComponent(debounced)}`),
    enabled: open && !value,
    placeholderData: (prev) => prev,
  });
  const items = query.data ?? [];

  function pick(m: MemberOption) {
    onSelect(m);
    setSearch('');
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(items.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && open && items[active]) {
      e.preventDefault(); // jangan ikut submit form checkout
      pick(items[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="grid gap-1.5">
      <FormLabel>Member</FormLabel>
      {value ? (
        <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm">
          <div className="min-w-0">
            <p className="truncate font-medium">{value.name}</p>
            <p className="truncate text-xs text-muted-foreground">{value.phone || 'Tanpa nomor HP'}</p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            Ganti
          </Button>
        </div>
      ) : (
        <div className="relative" ref={rootRef}>
          <Input
            role="combobox"
            aria-expanded={open}
            aria-controls="member-picker-list"
            autoComplete="off"
            placeholder="Pilih member lama (opsional)"
            className="pr-9"
            value={search}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onChange={(e) => {
              setSearch(e.target.value);
              setActive(0); // hasil berubah: sorotan balik ke item pertama
              setOpen(true);
            }}
            onKeyDown={onKeyDown}
          />
          <button
            type="button"
            tabIndex={-1}
            aria-label={open ? 'Tutup daftar member' : 'Buka daftar member'}
            onClick={() => setOpen((o) => !o)}
            className="absolute top-0 right-0 flex h-full w-9 items-center justify-center text-muted-foreground"
          >
            <ChevronsUpDown className="size-4" />
          </button>
          {open && (
            <div
              id="member-picker-list"
              role="listbox"
              className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover shadow-md"
            >
              {query.isLoading && <p className="p-3 text-xs text-muted-foreground">Memuat member...</p>}
              {query.data && items.length === 0 && (
                <p className="p-3 text-xs text-muted-foreground">
                  {debounced
                    ? 'Member tidak ditemukan. Isi data pelanggan di bawah untuk membuat member baru.'
                    : 'Belum ada member. Isi data pelanggan di bawah untuk membuat member baru.'}
                </p>
              )}
              {items.map((m, i) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  key={m.id}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(m)}
                  className={cn('block w-full px-3 py-2 text-left text-sm', i === active && 'bg-accent')}
                >
                  <p className="font-medium">{m.name}</p>
                  <p className="text-xs text-muted-foreground">{m.phone || 'Tanpa nomor HP'}</p>
                </button>
              ))}
              {items.length >= PAGE_SIZE && (
                <p className="border-t p-2 text-center text-xs text-muted-foreground">
                  Menampilkan {PAGE_SIZE} member pertama. Ketik nama atau nomor HP untuk mencari yang lain.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
