'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ArrowRight, Eye, EyeOff, Loader2, Lock, Mail, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { ROLE_HOME, type Role } from '@/lib/session';

const loginSchema = z.object({
  email: z.string().min(1, 'Email wajib diisi').email('Format email salah'),
  password: z.string().min(1, 'Password wajib diisi'),
});

type LoginValues = z.infer<typeof loginSchema>;

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [submitting, setSubmitting] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);
  const [capsLock, setCapsLock] = React.useState(false);
  const [shake, setShake] = React.useState(false);
  const [showHelp, setShowHelp] = React.useState(false);

  function fail(message: string) {
    toast.error(message);
    setShake(true);
    form.setFocus('password');
  }

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: LoginValues) {
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (!res.ok) {
        fail(data?.message ?? 'Login gagal');
        return;
      }
      const role = data.user.role as Role;
      const next = searchParams.get('next');
      router.push(next && next !== '/' ? next : ROLE_HOME[role]);
      router.refresh();
    } catch {
      fail('Gagal menghubungi server. Coba lagi.');
    } finally {
      setSubmitting(false);
    }
  }

  const fieldCls =
    'h-12 rounded-lg border-border bg-muted/40 text-[15px] transition-colors placeholder:text-muted-foreground/70 hover:border-primary/40 focus-visible:bg-white';
  const iconCls =
    'pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground transition-colors peer-focus-visible:text-primary';

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn('grid gap-5', shake && 'animate-shake')}
        onAnimationEnd={() => setShake(false)}
      >
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <div className="relative">
                <FormControl>
                  <Input
                    type="email"
                    placeholder="nama@toko.local"
                    autoComplete="username"
                    autoFocus
                    className={cn(fieldCls, 'peer pl-10')}
                    {...field}
                  />
                </FormControl>
                <Mail className={iconCls} />
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel>Password</FormLabel>
                <button
                  type="button"
                  onClick={() => setShowHelp((v) => !v)}
                  aria-expanded={showHelp}
                  className="text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
                >
                  Lupa password?
                </button>
              </div>
              <div className="relative">
                <FormControl>
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    className={cn(fieldCls, 'peer pr-11 pl-10')}
                    {...field}
                    onKeyUp={(e) => setCapsLock(e.getModifierState('CapsLock'))}
                    onBlur={() => {
                      setCapsLock(false);
                      field.onBlur();
                    }}
                  />
                </FormControl>
                <Lock className={iconCls} />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Sembunyikan password' : 'Lihat password'}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {capsLock && (
                <p className="flex items-center gap-1.5 text-xs text-status-warning-foreground dark:text-status-warning">
                  <TriangleAlert className="size-3.5" />
                  Caps Lock sedang aktif.
                </p>
              )}
              {showHelp && (
                <p className="rounded-lg bg-secondary px-3 py-2.5 text-xs leading-relaxed text-secondary-foreground motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1">
                  Password diatur ulang oleh admin toko. Hubungi admin, lalu masuk dengan password baru.
                </p>
              )}
              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          type="submit"
          disabled={submitting}
          size="lg"
          className="group/btn mt-1 h-12 w-full text-[15px] shadow-md shadow-primary/25 transition-shadow hover:shadow-lg hover:shadow-primary/30 active:scale-[0.98]"
        >
          {submitting && <Loader2 className="size-4 animate-spin" />}
          {submitting ? 'Memeriksa...' : 'Masuk'}
          {!submitting && <ArrowRight className="size-4 transition-transform group-hover/btn:translate-x-1" />}
        </Button>
      </form>
    </Form>
  );
}
