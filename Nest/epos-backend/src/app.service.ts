import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Injectable()
export class AppService {
  constructor(private prisma: PrismaService) {}

  async getHello() {
    const userCount = await this.prisma.user.count();
    return `Halo! Jumlah user di database saat ini: ${userCount}`;
  }
}