import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseRpcService, RpcActor } from '../prisma/supabase-rpc.service';
import { CreateUndianDto, UpdateUndianParticipantsDto } from './dto/undian.dto';

/** Padanan undian_providers.dart. Semua tulis lewat RPC Supabase (admin). */
@Injectable()
export class UndianService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rpc: SupabaseRpcService,
  ) {}

  findAll() {
    return this.prisma.undian.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { participants: true } } },
    });
  }

  async findOne(id: string) {
    const undian = await this.prisma.undian.findUnique({
      where: { id },
      include: {
        participants: {
          orderBy: { addedAt: 'asc' },
          include: { member: { select: { id: true, name: true } } },
        },
      },
    });
    if (!undian) throw new NotFoundException('Undian tidak ditemukan');
    return undian;
  }

  create(actor: RpcActor, dto: CreateUndianDto) {
    return this.rpc.call(actor, 'create_undian', dto);
  }

  updateParticipants(actor: RpcActor, undianId: string, dto: UpdateUndianParticipantsDto) {
    return this.rpc.call(actor, 'update_undian_participants', { undianId, ...dto });
  }

  draw(actor: RpcActor, undianId: string) {
    return this.rpc.call(actor, 'draw_undian', { undianId });
  }

  cancel(actor: RpcActor, undianId: string) {
    return this.rpc.call(actor, 'cancel_undian', { undianId });
  }
}
