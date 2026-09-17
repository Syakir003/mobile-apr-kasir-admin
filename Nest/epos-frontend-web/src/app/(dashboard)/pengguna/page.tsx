'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { KeyRound, MoreHorizontal, Plus } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

// Padanan hasil UsersService.findAll() — cuma field yang di-`select` di
// backend (password/hash gak pernah keikut lewat API).
interface AppUser {
  id: string;
  email: string;
  displayName: string;
  role: 'admin' | 'kasir' | 'teknisi';
  active: boolean;
  createdAt: string;
}

const ROLE_LABEL: Record<AppUser['role'], string> = {
  admin: 'Admin',
  kasir: 'Kasir',
  teknisi: 'Teknisi',
};

const ROLE_TABS = ['semua', 'admin', 'kasir', 'teknisi'] as const;
type RoleTab = (typeof ROLE_TABS)[number];

// Aturan password disalin dari IsStrongPassword (backend, satu-satunya
// sumber kebenaran) — cuma buat validasi cepat di form sebelum submit;
// backend tetap yang final nentuin lolos/enggak.
const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).+$/;
const passwordField = z
  .string()
  .min(8, 'Password minimal 8 karakter')
  .regex(PASSWORD_RULE, 'Password wajib kombinasi huruf dan angka');

// Password cuma ada di form TAMBAH. Form EDIT sengaja gak punya field
// password/email sama sekali (ganti nama & role doang) — ganti password
// lewat dialog "Reset Password" terpisah (PATCH /users/:id/password, gak
// minta password lama, lihat UsersService.resetPassword), dan email gak
// bisa diubah sama sekali (gak ada endpoint buat itu).
const createSchema = z.object({
  email: z.string().email('Email tidak valid'),
  password: passwordField,
  displayName: z.string().min(1, 'Wajib diisi'),
  role: z.enum(['admin', 'kasir', 'teknisi']),
});
type CreateFormValues = z.infer<typeof createSchema>;

const editSchema = z.object({
  displayName: z.string().min(1, 'Wajib diisi'),
  role: z.enum(['admin', 'kasir', 'teknisi']),
});
type EditFormValues = z.infer<typeof editSchema>;

const passwordSchema = z
  .object({
    newPassword: passwordField,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Konfirmasi password tidak cocok',
    path: ['confirmPassword'],
  });
type PasswordFormValues = z.infer<typeof passwordSchema>;

const emptyCreateValues: CreateFormValues = {
  email: '',
  password: '',
  displayName: '',
  role: 'kasir',
};

export default function PenggunaPage() {
  const queryClient = useQueryClient();
  const [roleTab, setRoleTab] = React.useState<RoleTab>('semua');
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<AppUser | null>(null);
  const [resetting, setResetting] = React.useState<AppUser | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['users'],
    queryFn: () => apiClient.get<AppUser[]>('/users'),
  });

  const filtered = React.useMemo(() => {
    if (!data) return [];
    if (roleTab === 'semua') return data;
    return data.filter((u) => u.role === roleTab);
  }, [data, roleTab]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['users'] });
  }

  // ---- Tambah pengguna baru ----
  const createForm = useForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
    defaultValues: emptyCreateValues,
  });

  function openCreate() {
    createForm.reset(emptyCreateValues);
    setCreateOpen(true);
  }

  const createMutation = useMutation({
    mutationFn: (values: CreateFormValues) =>
      apiClient.post<AppUser>('/users', {
        email: values.email.trim(),
        password: values.password,
        displayName: values.displayName.trim(),
        role: values.role,
      }),
    onSuccess: () => {
      toast.success('Pengguna ditambahkan.');
      invalidate();
      setCreateOpen(false);
    },
    onError: (err) => {
      // Backend balikin 409 kalau email udah dipakai — ApiError.message
      // udah jelas ("Email sudah dipakai user lain"), tampilin apa adanya.
      toast.error(err instanceof ApiError ? err.message : 'Gagal menambahkan pengguna.');
    },
  });

  // ---- Edit nama & role ----
  const editForm = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { displayName: '', role: 'kasir' },
  });

  function openEdit(u: AppUser) {
    setEditing(u);
    editForm.reset({ displayName: u.displayName, role: u.role });
  }

  const editMutation = useMutation({
    mutationFn: (values: EditFormValues) => {
      if (!editing) throw new Error('Tidak ada pengguna yang sedang diedit');
      return apiClient.patch<AppUser>(`/users/${editing.id}`, values);
    },
    onSuccess: () => {
      toast.success('Pengguna diperbarui.');
      invalidate();
      setEditing(null);
    },
    onError: (err) => {
      // Termasuk pengaman "gak bisa ganti role diri sendiri keluar dari
      // admin kalau dia admin aktif terakhir" — pesannya udah jelas dari
      // backend, tampilin apa adanya (bukan pesan generik).
      toast.error(err instanceof ApiError ? err.message : 'Gagal memperbarui pengguna.');
    },
  });

  // ---- Reset password ----
  const passwordForm = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });

  function openReset(u: AppUser) {
    setResetting(u);
    passwordForm.reset({ newPassword: '', confirmPassword: '' });
  }

  const resetMutation = useMutation({
    mutationFn: (values: PasswordFormValues) => {
      if (!resetting) throw new Error('Tidak ada pengguna yang di-reset passwordnya');
      return apiClient.patch<{ message: string }>(`/users/${resetting.id}/password`, {
        newPassword: values.newPassword,
      });
    },
    onSuccess: () => {
      toast.success('Password berhasil di-reset — sesi lama akun ini otomatis logout.');
      setResetting(null);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal reset password.');
    },
  });

  // ---- Aktif/nonaktifkan akun ----
  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiClient.patch<AppUser>(`/users/${id}/toggle-active`, { active }),
    onSuccess: (_res, vars) => {
      toast.success(vars.active ? 'Pengguna diaktifkan.' : 'Pengguna dinonaktifkan.');
      invalidate();
    },
    onError: (err) => {
      // Backend punya 2 pengaman anti-kunci-diri-sendiri (gak bisa
      // nonaktifin akun sendiri / nonaktifin admin aktif terakhir) —
      // pesannya udah jelas, tampilin apa adanya biar admin ngerti kenapa.
      toast.error(err instanceof ApiError ? err.message : 'Gagal mengubah status pengguna.');
    },
  });

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pengguna</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Akun staff untuk login — kasir dan teknisi masing-masing wajib punya akun sendiri.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus />
          Tambah Pengguna
        </Button>
      </div>

      <Tabs value={roleTab} onValueChange={(v) => setRoleTab(v as RoleTab)}>
        <TabsList>
          <TabsTrigger value="semua">Semua</TabsTrigger>
          <TabsTrigger value="admin">Admin</TabsTrigger>
          <TabsTrigger value="kasir">Kasir</TabsTrigger>
          <TabsTrigger value="teknisi">Teknisi</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading && <p className="text-sm text-muted-foreground">Memuat pengguna...</p>}
      {isError && <p className="text-sm text-destructive">Gagal memuat data pengguna.</p>}
      {!isLoading && !isError && filtered.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Belum ada pengguna di kategori ini. Klik &ldquo;Tambah Pengguna&rdquo; untuk mulai.
        </p>
      )}
      {!isLoading && !isError && filtered.length > 0 && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Dibuat</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.displayName}</TableCell>
                  <TableCell className="text-muted-foreground">{u.email}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{ROLE_LABEL[u.role]}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.active ? 'success' : 'secondary'}>
                      {u.active ? 'Aktif' : 'Nonaktif'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(u.createdAt)}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(u)}>
                          Edit Nama & Role
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openReset(u)}>
                          <KeyRound className="size-4" />
                          Reset Password
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant={u.active ? 'destructive' : 'default'}
                          onClick={() =>
                            toggleActiveMutation.mutate({ id: u.id, active: !u.active })
                          }
                        >
                          {u.active ? 'Nonaktifkan' : 'Aktifkan'}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Tambah Pengguna */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tambah Pengguna</DialogTitle>
            <DialogDescription>
              Bikin akun login baru buat staff. Tiap kasir/teknisi wajib punya akunnya
              sendiri-sendiri (bukan akun bersama) biar jelas siapa ngerjain apa.
            </DialogDescription>
          </DialogHeader>
          <Form {...createForm}>
            <form
              className="grid gap-4"
              onSubmit={createForm.handleSubmit((values) => createMutation.mutate(values))}
            >
              <FormField
                control={createForm.control}
                name="displayName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nama</FormLabel>
                    <FormControl>
                      <Input placeholder="Nama lengkap" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="nama@toko.local" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="kasir">Kasir</SelectItem>
                        <SelectItem value="teknisi">Teknisi</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="Minimal 8 karakter, kombinasi huruf & angka"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Menyimpan...' : 'Simpan'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Edit Nama & Role */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Pengguna</DialogTitle>
            <DialogDescription>
              Email tidak bisa diubah dari sini. Buat ganti password, pakai menu &ldquo;Reset
              Password&rdquo; di daftar.
            </DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form
              className="grid gap-4"
              onSubmit={editForm.handleSubmit((values) => editMutation.mutate(values))}
            >
              <FormField
                control={editForm.control}
                name="displayName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nama</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="kasir">Kasir</SelectItem>
                        <SelectItem value="teknisi">Teknisi</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="submit" disabled={editMutation.isPending}>
                  {editMutation.isPending ? 'Menyimpan...' : 'Simpan'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Reset Password */}
      <Dialog open={!!resetting} onOpenChange={(open) => !open && setResetting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              {resetting
                ? `Set password baru untuk ${resetting.displayName}. Sesi lama akun ini otomatis logout begitu disimpan.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <Form {...passwordForm}>
            <form
              className="grid gap-4"
              onSubmit={passwordForm.handleSubmit((values) => resetMutation.mutate(values))}
            >
              <FormField
                control={passwordForm.control}
                name="newPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password Baru</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
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
                      <Input type="password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="submit" disabled={resetMutation.isPending}>
                  {resetMutation.isPending ? 'Menyimpan...' : 'Reset Password'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
