# NestJS Backend (Supabase RPC → NestJS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port every write-side business rule currently living in Postgres RPC functions (`backend/supabase/migrations/`) into a NestJS API at `backend/nest-api/`, so the two frontends (Flutter, Next.js) call REST endpoints instead of `supabase.rpc(...)`.

**Architecture:** NestJS connects to the **same** Postgres database Supabase manages, via **Prisma** using a direct (non-PostgREST) connection string. Prisma schema is pulled from the existing DB (`prisma db pull`) — the SQL files in `backend/supabase/migrations/` remain the single source of truth for schema; Prisma never runs its own migrations. Supabase Auth stays as the identity provider (login/signup/session refresh unchanged); NestJS verifies the Supabase-issued JWT and re-checks the caller's live `users.role`/`active` row before privileged writes (mirrors the existing `assert_caller_role()` pattern). Supabase Storage (`job-photos` bucket) is untouched — clients keep uploading/reading photos directly against it; NestJS only records photo metadata.

**Tech Stack:** NestJS 10, Prisma 5, `class-validator`/`class-transformer`, `@nestjs/swagger`, `@nestjs/passport` + `passport-jwt`, `@supabase/supabase-js` (admin client, user-management module only), Jest (Nest default).

## Global Constraints

- Project lives at `backend/nest-api/` (sibling to `backend/supabase/`).
- Prisma schema is generated via `npx prisma db pull` against the local Supabase Postgres (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`) — never hand-edit generated model bodies, never run `prisma migrate`.
- Money columns are `Int` (Rupiah) end to end — never `Float`/`Decimal` for money. `qty` on `products`/`transaction_items` etc. mirrors the DB type exactly (`Int` where the column is `integer`, `Decimal`/`number` where the column is `numeric`) — see Task 4's Prisma schema for the authoritative type per column.
- Every RPC-equivalent endpoint's writes run inside one `prisma.$transaction(async (tx) => { ... })` — matches the original function's atomicity. Where the original SQL used `for update` row locking, use `tx.$queryRaw` with `FOR UPDATE` (Prisma's fluent API has no row-lock option).
- **Do not reimplement DB triggers.** `notify_job_assigned`, `notify_request_submitted`, `notify_request_decided`, `enqueue_push`, `members_sync_unit_count`, `member_ac_units_touch_member`, `handle_new_user` are already installed on the tables (`backend/supabase/migrations/`) and fire automatically on INSERT/UPDATE **regardless of which client performs the write** — Prisma writes trigger them exactly like the old PostgREST/RPC writes did. Only the RPC **function bodies** (the multi-step business logic) get ported to TypeScript.
- Auth: every request carries `Authorization: Bearer <supabase-access-token>`. `JwtStrategy` (Task 2) verifies the signature against `SUPABASE_JWT_SECRET` and exposes `{ uid, role }` as `request.user`. Any endpoint gated by role must **additionally** re-fetch `users.role`/`users.active` from the DB before acting (the JWT claim can be stale until refresh) — use the `assertActiveRole()` helper from Task 2, never trust `request.user.role` alone for a write.
- Error contract: throw `BadRequestException('<pesan>')` / `ForbiddenException('<pesan>')` / `NotFoundException('<pesan>')` with the **exact Indonesian message string** from the SQL source (verbatim, Task-by-task below). The global exception filter (Task 1) serializes every 4xx as `{ "message": "<pesan>" }` — this is the shape both frontends' `errorMessage()`/`Error` unwrapping already expect, so no frontend error-handling code needs to change.
- Validation order inside each service method must match the order documented per task — first failing check throws, exactly like the SQL function did (needed so a given malformed payload produces the same error on both the old and new backend).
- `normalizePhone`, `businessDateKey`, `nextSeq`, `computeInvoiceStatus`, `serviceJobType` are ported as small pure TS functions in `src/common/` (Task 3) — worth reimplementing since they're simple and this is exactly the "logic in TypeScript" the migration is for. Everything else procedural (triggers, above) stays in SQL.
- Every task's Jest tests mock `PrismaService` (`jest.fn()` per method used) — no live DB required to run the unit-test suite. An end-to-end suite against a real local Supabase Postgres is out of scope for this plan (YAGNI — add if/when the team wants it).

### Endpoint contract (authoritative — Flutter/Next.js plans are written against this)

| RPC / read | Method + path |
|---|---|
| products/spareparts/services list+create+update | `GET/POST/PATCH /master/{products,spareparts,services}[/:id]` |
| `save_installation_package` | `POST /master/packages` (create), `PUT /master/packages/:id` (update) |
| item_costs read/upsert | `GET /master/item-costs?kind=&refId=`, `PUT /master/item-costs` |
| members list+create+update | `GET/POST/PATCH /members[/:id]` |
| member_ac_units per member, create/update, barcode | `GET/POST /members/:id/units`, `PATCH /units/:id`, `GET /units/by-barcode/:value`, `POST /units/:id/generate-barcode` (`generate_ac_unit_barcode`) |
| `checkout_transaction` | `POST /pos/checkout` |
| `record_payment` | `POST /invoices/:id/payments` |
| invoices list/detail/payments read | `GET /invoices`, `GET /invoices/:id` |
| `adjust_stock` | `POST /stock/adjust` |
| technician_jobs list/detail, `assign_technician_job` | `GET /jobs`, `GET /jobs/:id`, `POST /jobs/:id/assign` |
| `update_technician_job_status` | `POST /jobs/:id/status` (body `{action, scannedBarcode?, notes?}`) |
| `add_job_photo` | `POST /jobs/:id/photos` |
| `job_payment_info` | `GET /jobs/:id/payment-info` |
| `create_service_order` | `POST /service-orders` |
| `submit_material_request` | `POST /jobs/:id/material-requests` |
| `decide_material_request` | `POST /material-requests/:id/decide` |
| `mark_material_used` | `POST /material-requests/:id/mark-used` |
| notifications list, `mark_notifications_read` | `GET /notifications`, `POST /notifications/mark-read` |
| `register_device_token`/`unregister_device_token` | `POST /device-tokens`, `DELETE /device-tokens/:token` |
| `update_user_account` | `PATCH /users/:id` |
| admin-users `create`/`resetPassword` | `POST /users`, `POST /users/:id/reset-password` |
| audit_logs read | `GET /audit-logs` |

Every response body is the RPC's documented return JSON verbatim (same keys) — this is what lets the frontend plans reuse existing model `fromMap`/TS types unchanged.

---

## Task 1: Project scaffold

**Files:**
- Create: `backend/nest-api/package.json`, `backend/nest-api/tsconfig.json`, `backend/nest-api/nest-cli.json`
- Create: `backend/nest-api/src/main.ts`
- Create: `backend/nest-api/src/app.module.ts`
- Create: `backend/nest-api/src/common/http-exception.filter.ts`
- Create: `backend/nest-api/.env.example`
- Test: `backend/nest-api/src/common/http-exception.filter.spec.ts`

**Interfaces:**
- Produces: `HttpExceptionFilter` (implements `ExceptionFilter`) — every later task's thrown `HttpException` subclasses get serialized by this filter as `{ "message": string }`.

- [ ] **Step 1: Scaffold the Nest project**

```bash
cd "backend"
npx @nestjs/cli new nest-api --package-manager npm --skip-git
cd nest-api
npm install @prisma/client @nestjs/config @nestjs/swagger class-validator class-transformer @nestjs/passport passport passport-jwt jsonwebtoken @supabase/supabase-js
npm install -D prisma @types/passport-jwt @types/jsonwebtoken
npx prisma init --datasource-provider postgresql
```

- [ ] **Step 2: Write the failing test for the exception filter**

```ts
// src/common/http-exception.filter.spec.ts
import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

function mockHost(): { host: ArgumentsHost; json: jest.Mock; status: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, json, status };
}

describe('HttpExceptionFilter', () => {
  it('serializes the exception message as { message }', () => {
    const filter = new HttpExceptionFilter();
    const { host, json, status } = mockHost();
    filter.catch(new BadRequestException('Nama pelanggan wajib diisi'), host);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ message: 'Nama pelanggan wajib diisi' });
  });
});
```

- [ ] **Step 2b: Run test to verify it fails**

Run: `npm test -- http-exception.filter` (from `backend/nest-api/`)
Expected: FAIL — `Cannot find module './http-exception.filter'`

- [ ] **Step 3: Implement the filter**

```ts
// src/common/http-exception.filter.ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception.getStatus();
    const body = exception.getResponse();
    const message = typeof body === 'string' ? body : (body as { message?: string | string[] }).message;
    response.status(status).json({ message: Array.isArray(message) ? message[0] : message });
  }
}
```

```ts
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableCors();
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
```

```ts
// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
})
export class AppModule {}
```

```bash
# .env.example
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
SUPABASE_JWT_SECRET="super-secret-jwt-token-with-at-least-32-characters-long"
SUPABASE_URL="http://127.0.0.1:54321"
SUPABASE_SERVICE_ROLE_KEY="<from supabase status>"
PORT=3001
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- http-exception.filter`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/nest-api
git commit -m "chore(nest-api): scaffold NestJS project with global exception filter"
```

---

## Task 2: Auth — Supabase JWT verification, role guard, live-role recheck

**Files:**
- Create: `backend/nest-api/src/auth/jwt.strategy.ts`
- Create: `backend/nest-api/src/auth/jwt-auth.guard.ts`
- Create: `backend/nest-api/src/auth/roles.guard.ts`
- Create: `backend/nest-api/src/auth/roles.decorator.ts`
- Create: `backend/nest-api/src/auth/current-user.decorator.ts`
- Create: `backend/nest-api/src/auth/assert-active-role.ts`
- Create: `backend/nest-api/src/auth/auth.module.ts`
- Test: `backend/nest-api/src/auth/assert-active-role.spec.ts`
- Test: `backend/nest-api/src/auth/roles.guard.spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (Task 4, but this task only needs its shape — declare it locally as `{ user: { findUnique: (...) => Promise<{ role: string; active: boolean } | null> } }` and import the real class once Task 4 lands; since Task 4 runs before any task that needs `assertActiveRole` in production code, this is safe to type against the real `PrismaService` import directly).
- Produces: `assertActiveRole(prisma: PrismaService, uid: string, allowed: string[], message: string): Promise<void>` — throws `ForbiddenException(message)` if the caller is unauthenticated, inactive, or not in `allowed`. Mirrors SQL `assert_caller_role()`; **every privileged task below calls this exact function**, not the raw JWT claim.
- Produces: `@Roles('admin','kasir')` decorator + `RolesGuard` — cheap first-pass gate at the controller level (checks `request.user.role` from the JWT, fast but can be stale); `assertActiveRole` inside the service is still required for the final live check — `RolesGuard` is an optimization to fail fast, not a substitute.
- Produces: `@CurrentUser()` decorator → injects `{ uid: string, role: string }` (from `request.user`, set by `JwtStrategy`).

- [ ] **Step 1: Write the failing test for `assertActiveRole`**

```ts
// src/auth/assert-active-role.spec.ts
import { ForbiddenException } from '@nestjs/common';
import { assertActiveRole } from './assert-active-role';

function fakePrisma(user: { role: string; active: boolean } | null) {
  return { user: { findUnique: jest.fn().mockResolvedValue(user) } } as any;
}

describe('assertActiveRole', () => {
  it('passes when caller has an allowed, active role', async () => {
    const prisma = fakePrisma({ role: 'admin', active: true });
    await expect(assertActiveRole(prisma, 'uid-1', ['admin', 'kasir'], 'Hanya Admin/Kasir')).resolves.toBeUndefined();
  });

  it('throws with the caller-supplied message when role is not allowed', async () => {
    const prisma = fakePrisma({ role: 'teknisi', active: true });
    await expect(assertActiveRole(prisma, 'uid-1', ['admin', 'kasir'], 'Hanya Admin/Kasir')).rejects.toThrow(
      new ForbiddenException('Hanya Admin/Kasir'),
    );
  });

  it('throws the same message when the user is inactive', async () => {
    const prisma = fakePrisma({ role: 'admin', active: false });
    await expect(assertActiveRole(prisma, 'uid-1', ['admin'], 'Hanya Admin/Kasir')).rejects.toThrow(
      new ForbiddenException('Hanya Admin/Kasir'),
    );
  });

  it('throws the same message when the user row does not exist', async () => {
    const prisma = fakePrisma(null);
    await expect(assertActiveRole(prisma, 'uid-1', ['admin'], 'Hanya Admin/Kasir')).rejects.toThrow(
      new ForbiddenException('Hanya Admin/Kasir'),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- assert-active-role` (from `backend/nest-api/`)
Expected: FAIL — `Cannot find module './assert-active-role'`

- [ ] **Step 3: Implement `assertActiveRole` and the auth scaffolding**

```ts
// src/auth/assert-active-role.ts
import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export async function assertActiveRole(
  prisma: PrismaService,
  uid: string | undefined,
  allowed: string[],
  message: string,
): Promise<void> {
  if (!uid) throw new ForbiddenException(message);
  const user = await prisma.user.findUnique({ where: { id: uid }, select: { role: true, active: true } });
  if (!user || !user.active || !allowed.includes(user.role)) {
    throw new ForbiddenException(message);
  }
}
```

```ts
// src/auth/jwt.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy, ExtractJwt } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get<string>('SUPABASE_JWT_SECRET'),
      algorithms: ['HS256'],
    });
  }

  async validate(payload: { sub: string; user_role?: string }) {
    return { uid: payload.sub, role: payload.user_role };
  }
}
```

```ts
// src/auth/jwt-auth.guard.ts
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

```ts
// src/auth/roles.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
```

```ts
// src/auth/roles.guard.ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!roles) return true;
    const { user } = context.switchToHttp().getRequest();
    if (!user?.role || !roles.includes(user.role)) {
      throw new ForbiddenException('Tidak diizinkan');
    }
    return true;
  }
}
```

```ts
// src/auth/current-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().user as { uid: string; role: string };
});
```

```ts
// src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [PassportModule],
  providers: [JwtStrategy],
})
export class AuthModule {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- assert-active-role`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add backend/nest-api/src/auth
git commit -m "feat(nest-api): Supabase JWT auth, role guard, live-role recheck helper"
```

---
