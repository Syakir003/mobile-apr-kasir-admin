'use client';

import Link from 'next/link';
import { ChevronDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// 3 pilihan cetak — Invoice selalu ada, Surat Jalan & Label Unit cuma
// relevan buat invoice yang lahir dari servis/instalasi (punya
// ServiceOrder). Invoice retail biasa (jual sparepart doang, gak ada
// servis) cuma nampilin 1 pilihan. Dipakai di 2 tempat: Riwayat Transaksi
// (list) & halaman Detail Invoice (yang sekarang jadi tujuan auto-redirect
// abis checkout POS, padanan context.go ke halaman transaksi di app mobile)
// — diekstrak ke sini biar perilaku & tampilannya konsisten di keduanya.
export function PrintMenu({
  invoiceId,
  serviceOrders,
  variant = 'ghost',
  size = 'sm',
  className,
}: {
  invoiceId: string;
  serviceOrders: { id: string; _count: { serviceOrderUnits: number } }[];
  variant?: React.ComponentProps<typeof Button>['variant'];
  size?: React.ComponentProps<typeof Button>['size'];
  className?: string;
}) {
  const order = serviceOrders[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} className={className}>
          Cetak
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/invoices/${invoiceId}/print`}>Cetak Invoice</Link>
        </DropdownMenuItem>
        {order && (
          <DropdownMenuItem asChild>
            <Link href={`/service-orders/${order.id}/print`}>Cetak Surat Jalan</Link>
          </DropdownMenuItem>
        )}
        {order && order._count.serviceOrderUnits > 0 && (
          <DropdownMenuItem asChild>
            <Link href={`/service-orders/${order.id}/print-labels`}>Cetak Label Unit</Link>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
