import { Suspense } from 'react';
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
      <CardHeader>
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
