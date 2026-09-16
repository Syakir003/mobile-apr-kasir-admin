import { IsIn, IsNotEmpty, IsString } from 'class-validator';

// Padanan payload RPC `register_device_token` di Supabase lama
// (fcm_service.dart: {'token': token, 'platform': _platform}). `platform`
// dibatasi 3 nilai yang dikirim FcmService (`android`/`ios`/`web` dari
// `defaultTargetPlatform.name` atau literal 'web' via kIsWeb) — kalau nanti
// ada platform baru, tambahin di sini juga.
export class RegisterDeviceTokenDto {
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsString()
  @IsIn(['android', 'ios', 'web'])
  platform: string;
}
