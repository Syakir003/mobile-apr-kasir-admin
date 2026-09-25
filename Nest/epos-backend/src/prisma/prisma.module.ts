import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { SupabaseRpcService } from './supabase-rpc.service';

@Global()
@Module({
  providers: [PrismaService, SupabaseRpcService],
  exports: [PrismaService, SupabaseRpcService],
})
export class PrismaModule {}