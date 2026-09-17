import { IsNotEmpty, IsString } from 'class-validator';

// Padanan RPC `unregister_device_token` lama — dipanggil FcmService.stop()
// saat logout, biar user berikutnya yang login di HP yang sama gak ikut
// kebagian push punya user sebelumnya.
export class UnregisterDeviceTokenDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}
