'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Pencarian + pagination sisi-browser untuk daftar Master Data (Sparepart, Jasa,
// Paket Instalasi). Daftarnya kecil (ratusan baris) dan sudah dimuat utuh oleh
// useQuery, jadi tidak perlu pagination server.
// ponytail: kalau satu daftar tembus ribuan baris, pindah ke pagination server
// seperti halaman Invoices.
export const PAGE_SIZE = 25;

export function useListView<T>(items: T[] | undefined, searchText: (item: T) => string) {
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);
  // Balik ke halaman 1 saat kata pencarian berubah (reset saat render, bukan di effect).
  const [prevSearch, setPrevSearch] = React.useState(search);
  if (prevSearch !== search) {
    setPrevSearch(search);
    setPage(1);
  }

  const filtered = React.useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return items ?? [];
    return (items ?? []).filter((it) => {
      const hay = searchText(it).toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- searchText sengaja tidak jadi dependensi (fungsi inline per render)
  }, [items, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return { search, setSearch, page: currentPage, setPage, totalPages, total: filtered.length, pageItems };
}

export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative w-full sm:max-w-sm">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-9"
        aria-label={placeholder}
      />
    </div>
  );
}

export function PaginationFooter({
  page,
  totalPages,
  total,
  noun,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  noun: string;
  onPage: (page: number) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-sm text-muted-foreground">
        Halaman {page} dari {totalPages} ({total} {noun})
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="icon" aria-label="Halaman sebelumnya" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft className="size-4" />
        </Button>
        <Button variant="outline" size="icon" aria-label="Halaman berikutnya" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
