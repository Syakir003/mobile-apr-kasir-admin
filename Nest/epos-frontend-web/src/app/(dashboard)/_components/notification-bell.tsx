'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';

import { apiClient, ApiError } from '@/lib/api-client';
import { getSocket } from '@/lib/socket';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface NotificationItem {
  id: string;
  title: string;
  body: string | null;
  type: string;
  target: string | null;
  read: boolean;
  createdAt: string;
}
interface NotificationsPage {
  items: NotificationItem[];
}

// Bell notifikasi — padanan `notificationsStreamProvider`/`unreadCountProvider`
// Supabase Realtime di app mobile lama, sekarang lewat NestJS: unread count +
// daftar dari REST (`GET /notifications*`), update INSTAN lewat event socket
// 'notification.new' yang di-emit NotificationsService.notify() ke room
// pribadi user (`user:<id>`, lihat RealtimeGateway.handleConnection di
// backend). refetchInterval di unreadQuery cuma jaring pengaman kalau socket
// lagi putus — bukan sumber update utama.
//
// SENGAJA gak ngedaftarin device token FCM dari sini (POST /device-tokens) —
// push notif ke browser butuh setup terpisah (firebase client SDK, service
// worker, VAPID key), di luar scope bell in-app ini. Bell ini fokus ke
// notifikasi yang muncul SELAGI user buka web-nya, bukan push pas app ditutup.
export function NotificationBell() {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);

  const unreadQuery = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => apiClient.get<{ count: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
  });

  const listQuery = useQuery({
    queryKey: ['notifications', 'list'],
    // pageSize=10 — dropdown cuma nampilin notif terakhir, bukan halaman
    // penuh (belum ada halaman "semua notifikasi" tersendiri, YAGNI dulu
    // sampai kebutuhannya nyata).
    queryFn: () => apiClient.get<NotificationsPage>('/notifications?pageSize=10'),
    enabled: open,
  });

  React.useEffect(() => {
    let cancelled = false;
    let socket: Awaited<ReturnType<typeof getSocket>> | null = null;

    function onNew(notif: NotificationItem) {
      toast(notif.title, { description: notif.body ?? undefined });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    }

    getSocket()
      .then((s) => {
        if (cancelled) return;
        socket = s;
        socket.on('notification.new', onNew);
      })
      .catch(() => {
        // Gagal konek (mis. token belum siap) — badge tetap ke-update lewat
        // refetchInterval di unreadQuery, jadi gak fatal.
      });

    return () => {
      cancelled = true;
      socket?.off('notification.new', onNew);
    };
  }, [queryClient]);

  const markReadMutation = useMutation({
    mutationFn: (notificationId?: string) =>
      apiClient.patch('/notifications/read', notificationId ? { notificationId } : {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menandai notifikasi.');
    },
  });

  const unreadCount = unreadQuery.data?.count ?? 0;
  const items = listQuery.data?.items ?? [];

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifikasi">
          <Bell className="size-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-white">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2">
          <DropdownMenuLabel className="p-0 text-sm">Notifikasi</DropdownMenuLabel>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              disabled={markReadMutation.isPending}
              onClick={() => markReadMutation.mutate(undefined)}
            >
              <CheckCheck className="size-3.5" />
              Tandai semua
            </Button>
          )}
        </div>
        <DropdownMenuSeparator className="my-0" />
        <div className="max-h-96 overflow-y-auto">
          {listQuery.isLoading && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Memuat...</p>
          )}
          {!listQuery.isLoading && items.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Belum ada notifikasi.
            </p>
          )}
          {items.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => !n.read && markReadMutation.mutate(n.id)}
              className={cn(
                'flex w-full flex-col gap-0.5 border-b px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-accent',
                !n.read && 'bg-primary/5',
              )}
            >
              <span className="flex items-center gap-1.5 font-medium">
                {!n.read && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
                {n.title}
              </span>
              {n.body && <span className="text-xs text-muted-foreground">{n.body}</span>}
              <span className="text-[11px] text-muted-foreground">
                {formatRelativeTime(n.createdAt)}
              </span>
            </button>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
