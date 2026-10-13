'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Tabel data. Di layar HP (<768px) tabel otomatis tampil sebagai kartu per
 * baris (CSS di globals.css, `[data-slot=table-container]`): header kolom
 * disembunyikan dan tiap sel diberi label dari teks header-nya lewat atribut
 * `data-label` yang dipasang di sini. Ingin tetap berupa tabel yang bisa
 * digeser horizontal di HP? Beri prop `keepTable`.
 */
function Table({
  className,
  keepTable,
  ...props
}: React.ComponentProps<'table'> & { keepTable?: boolean }) {
  const ref = React.useRef<HTMLTableElement>(null);

  React.useEffect(() => {
    const table = ref.current;
    if (!table || keepTable) return;
    const apply = () => {
      const heads = Array.from(table.querySelectorAll('thead th')).map(
        (th) => th.textContent?.trim() ?? '',
      );
      table.querySelectorAll('tbody tr').forEach((tr) => {
        Array.from(tr.children).forEach((cell, i) => {
          const label = heads[i];
          if (cell.getAttribute('colspan') || !label) cell.removeAttribute('data-label');
          else if (cell.getAttribute('data-label') !== label) cell.setAttribute('data-label', label);
        });
      });
    };
    apply();
    // childList saja (bukan attributes) supaya setAttribute di atas tidak memicu loop.
    const observer = new MutationObserver(apply);
    observer.observe(table, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [keepTable]);

  return (
    <div
      data-slot="table-container"
      data-keep-table={keepTable ? '' : undefined}
      className="relative w-full overflow-x-auto"
    >
      <table
        ref={ref}
        data-slot="table"
        className={cn('w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn('bg-muted/40 [&_tr]:border-b', className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        'bg-muted/50 border-t font-medium [&>tr]:last:border-b-0',
        className,
      )}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors',
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'text-muted-foreground h-10 px-3 text-left align-middle text-xs font-medium tracking-wide whitespace-nowrap uppercase [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        'p-3 align-middle whitespace-nowrap tabular-nums [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
        className,
      )}
      {...props}
    />
  );
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('text-muted-foreground mt-4 text-sm', className)}
      {...props}
    />
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};
