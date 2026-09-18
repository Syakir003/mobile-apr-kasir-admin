import { Suspense } from 'react';
import Image from 'next/image';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { LoginForm } from './login-form';

export default function LoginPage() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="items-center text-center">
        {/* Logo APR (Ayub Podo Rukun) — brand mark yang sama dipakai di
            sidebar admin, biar identitas toko konsisten dari halaman
            login sampai dalem aplikasi. */}
        <Image src="/logo-apr.png" alt="AYUB AC" width={96} height={54} className="mb-1" />
        <CardTitle className="text-xl">E-POS AC</CardTitle>
        <CardDescription>Masuk pakai akun yang sudah didaftarkan admin.</CardDescription>
      </CardHeader>
      <CardContent>
        {/* useSearchParams butuh Suspense boundary di App Router */}
        <Suspense>
          <LoginForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}
