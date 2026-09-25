import { Injectable } from '@nestjs/common';
import { SupabaseRpcService } from '../prisma/supabase-rpc.service';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CheckoutDto } from './dto/checkout.dto';

export interface CheckoutResult {
  invoiceId: string;
  invoiceNumber: string;
  memberId: string;
  transactionId: string;
}

@Injectable()
export class PosService {
  constructor(private readonly rpc: SupabaseRpcService) {}

  /** RPC `checkout_transaction` (definisi terakhir: migrasi 0030) — satu
   * implementasi dengan aplikasi Flutter: validasi, harga, stok, member,
   * voucher, invoice, order/job pemasangan & servis semuanya di RPC. */
  checkout(dto: CheckoutDto, actor: CurrentUserPayload) {
    return this.rpc.call<CheckoutResult>(actor, 'checkout_transaction', dto);
  }
}
