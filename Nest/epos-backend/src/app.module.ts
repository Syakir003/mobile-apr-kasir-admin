import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { CountersModule } from './counters/counters.module';
import { MembersModule } from './members/members.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ProductsModule } from './products/products.module';
import { SparepartsModule } from './spareparts/spareparts.module';
import { ServicesCatalogModule } from './services-catalog/services-catalog.module';
import { AcUnitsModule } from './ac-units/ac-units.module';
import { InstallationPackagesModule } from './installation-packages/installation-packages.module';
import { PosModule } from './pos/pos.module';
import { RealtimeModule } from './realtime/realtime.module';
import { TechnicianJobsModule } from './technician-jobs/technician-jobs.module';
import { MaterialRequestsModule } from './material-requests/material-requests.module';
import { PaymentsModule } from './payments/payments.module';
import { InvoicesModule } from './invoices/invoices.module';
import { ServiceOrdersModule } from './service-orders/service-orders.module';
import { StockModule } from './stock/stock.module';
import { ShiftsModule } from './shifts/shifts.module';
import { VouchersModule } from './vouchers/vouchers.module';
import { AppConfigModule } from './app-config/app-config.module';
import { ReportsModule } from './reports/reports.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { NotificationsModule } from './notifications/notifications.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { RemindersModule } from './reminders/reminders.module';

@Module({
  imports: [
    // Siklus WA/Fonnte — daftarin sekali di root, dipakai @Cron() di
    // RemindersService.handleDailyCron().
    ScheduleModule.forRoot(),
    PrismaModule,
    CommonModule,
    CountersModule,
    MembersModule,
    RealtimeModule,
    AuthModule,
    UsersModule,
    ProductsModule,
    SparepartsModule,
    ServicesCatalogModule,
    AcUnitsModule,
    InstallationPackagesModule,
    VouchersModule,
    PosModule,
    TechnicianJobsModule,
    MaterialRequestsModule,
    PaymentsModule,
    InvoicesModule,
    ServiceOrdersModule,
    StockModule,
    ShiftsModule,
    AppConfigModule,
    ReportsModule,
    DashboardModule,
    AuditLogsModule,
    NotificationsModule,
    WhatsappModule,
    RemindersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}