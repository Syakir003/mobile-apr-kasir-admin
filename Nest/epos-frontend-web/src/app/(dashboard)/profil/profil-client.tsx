'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { BadgeCheck, ChevronRight, Lock, Mail, User as UserIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import type { Role, SessionUser } from '@/lib/session';

const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  kasir: 'Kasir',
  teknisi: 'Teknisi',
};

// Aturan sama persis kayak backend IsStrongPassword (satu-satunya sumber
// kebenaran) & disalin dari dialog "Reset Password" di pengguna/page.tsx —
// TAPI di sini ada currentPassword tambahan, karena ini ganti password
// SENDIRI (PATCH /auth/me/password wajib currentPassword, beda dari
// PATCH /users/:id/password yang admin pakai buat reset punya orang lain).
const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).+$/;
const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Password lama wajib diisi'),
    newPassword: z
      .string()
      .min(8, 'Password minimal 8 karakter')
      .regex(PASSWORD_RULE, 'Password wajib kombinasi huruf dan angka'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Konfirmasi password tidak cocok',
    path: ['confirmPassword'],
  });
type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

const emptyPasswordValues: ChangePasswordValues = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
};

function initialOf(user: SessionUser) {
  const source = user.displayName.trim() || user.email || '?';
  return source.charAt(0).toUpperCase();
}

// Kontennya padanan `ProfileScreen` di app mobile (profile_screen.dart):
// avatar+nama+role, "Informasi Akun", "Keamanan Akun" -> Ubah Password.
// Tata letaknya SENGAJA bukan port 1:1 dari layar HP — di web, layar
// selebar ini kalau isinya dipaksa jadi satu kolom sempit malah keliatan
// aneh & banyak ruang kosong di kanan-kiri. Jadi dipakein pola halaman
// pengaturan web pada umumnya: header + tombol aksi di kanan (sama kayak
// pengguna/page.tsx), kartu profil horizontal, lalu Informasi Akun &
// Keamanan Akun berdampingan dalam grid 2 kolom di layar lebar.
// Mekanisme ganti password sendiri beda dari mobile: mobile lama manggil
// `Supabase.auth.updateUser()` (udah mati sejak pindah dari Supabase),
// versi web ini manggil PATCH /auth/me/password lewat
// /api/auth/change-password (lihat route itu buat alasan kenapa gak lewat
// proxy generik).
export function ProfilClient({ user }: { user: SessionUser }) {
  const [passwordOpen, setPasswordOpen] = React.useState(false);

  const passwordForm = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: emptyPasswordValues,
  });

  const changePasswordMutation = useMutation({
    mutationFn: async (values: ChangePasswordValues) => {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message ?? 'Gagal mengubah password');
      return data;
    },
    onSuccess: () => {
      toast.success('Password berhasil diperbarui.');
      passwordForm.reset(emptyPasswordValues);
      setPasswordOpen(false);
    },
    onError: (err) => {
      // Termasuk "Password lama salah" dari backend — tampilin apa adanya,
      // itu udah jelas buat user.
      toast.error(err instanceof Error ? err.message : 'Gagal mengubah password.');
    },
  });

  return (
    // max-w-3xl + mx-auto -- konten profil emang gak butuh selebar layar
    // (beda sama tabel data di halaman lain), dan ditengahin biar gak
    // nempel rata kiri di area konten yang lebar.
    <div className="mx-auto grid max-w-3xl gap-6">
      {/* Tombol Keluar GAK di sini — itu udah ada di sidebar (& dropdown
          nav mobile) lewat DashboardShell, jadi gak perlu diduplikat di
          halaman ini. Di sini cukup judul + subjudul. */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profil Saya</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Informasi akun dan keamanan login Anda.
        </p>
      </div>

      {/* Kartu profil horizontal — avatar di kiri, identitas di kanan,
          bukan ditumpuk vertikal-center kayak layar HP. */}
      <Card>
        <CardContent className="flex flex-col items-center gap-5 text-center sm:flex-row sm:text-left">
          <div className="flex size-20 shrink-0 items-center justify-center rounded-full border-4 border-white bg-primary/10 text-3xl font-bold text-primary shadow-md">
            {initialOf(user)}
          </div>
          <div className="grid gap-1.5">
            <p className="text-xl font-bold">{user.displayName || 'Pengguna'}</p>
            <p className="text-sm text-muted-foreground">{user.email}</p>
            <span className="mt-1 w-fit rounded-full border bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground sm:mt-0.5">
              Role: {ROLE_LABEL[user.role]}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Informasi Akun & Keamanan Akun berdampingan di layar lebar —
          manfaatin lebar layar web, bukan ditumpuk kebawah kayak HP.
          items-stretch + Card flex-1 biar kartu "Keamanan Akun" (isinya
          cuma 1 baris) ikut setinggi "Informasi Akun" (3 baris), gak
          keliatan cebol sendirian di sebelah kanan. */}
      <div className="grid items-stretch gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <p className="pl-1 text-xs font-bold tracking-wide text-muted-foreground/70 uppercase">
            Informasi Akun
          </p>
          <Card className="flex-1 py-0">
            <CardContent className="grid divide-y px-4">
              <InfoRow icon={<UserIcon className="size-5" />} label="Nama" value={user.displayName || '-'} />
              <InfoRow icon={<Mail className="size-5" />} label="Email" value={user.email} />
              <InfoRow icon={<BadgeCheck className="size-5" />} label="Role" value={ROLE_LABEL[user.role]} />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-3">
          <p className="pl-1 text-xs font-bold tracking-wide text-muted-foreground/70 uppercase">
            Keamanan Akun
          </p>
          <Card className="flex-1 py-0">
            <CardContent className="flex h-full items-center px-2">
              <button
                type="button"
                onClick={() => setPasswordOpen(true)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-accent"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Lock className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <p className="font-semibold">Ubah Password</p>
                  <p className="text-sm text-muted-foreground">Ganti kata sandi akun Anda</p>
                </span>
                <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
              </button>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={passwordOpen} onOpenChange={(open) => { setPasswordOpen(open); if (!open) passwordForm.reset(emptyPasswordValues); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ubah Password</DialogTitle>
            <DialogDescription>
              Minimal 8 karakter, kombinasi huruf & angka. Anda akan tetap login setelah ini.
            </DialogDescription>
          </DialogHeader>
          <Form {...passwordForm}>
            <form
              className="grid gap-4"
              onSubmit={passwordForm.handleSubmit((values) => changePasswordMutation.mutate(values))}
            >
              <FormField
                control={passwordForm.control}
                name="currentPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password Lama</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="current-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={passwordForm.control}
                name="newPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password Baru</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        autoComplete="new-password"
                        placeholder="Minimal 8 karakter, kombinasi huruf & angka"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={passwordForm.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Konfirmasi Password</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="submit" disabled={changePasswordMutation.isPending}>
                  {changePasswordMutation.isPending ? 'Menyimpan...' : 'Simpan Password'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 py-3.5">
      <span className="text-muted-foreground/70">{icon}</span>
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="ml-auto truncate pl-3 text-sm font-semibold" title={value}>
        {value}
      </span>
    </div>
  );
}
