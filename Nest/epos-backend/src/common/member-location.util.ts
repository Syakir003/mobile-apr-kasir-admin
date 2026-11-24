import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * Multi lokasi member (2026-11). Satu member bisa punya AC di beberapa tempat (mis. kantor lama & kantor baru) dengan satu
 * nomor HP. Lokasi 1 = alamat utama member (members.address + maps_url) dan TIDAK punya baris di member_locations:
 * unit/order dengan location_id NULL berada di Lokasi 1. Lokasi tambahan = baris member_locations.
 */

/** Nilai `locationId` pada body request untuk "Lokasi 1 (utama)"; selain itu id baris member_locations. */
export const MAIN_LOCATION_CHOICE = 'utama';

export const DEFAULT_MAIN_LOCATION_NAME = 'Lokasi 1';

export interface LocationMember {
  id: string;
  multiLocation: boolean;
  mainLocationName: string | null;
  address: string | null;
  mapsUrl: string | null;
}

/** Lokasi yang sudah dipilih/diperiksa. `locationId` NULL = Lokasi 1 atau member tanpa multi lokasi. */
export interface ResolvedLocation {
  locationId: string | null;
  /** Nama lokasi; null bila member tidak memakai multi lokasi. */
  name: string | null;
  address: string | null;
  mapsUrl: string | null;
}

export function mainLocationName(member: { mainLocationName: string | null }): string {
  return member.mainLocationName?.trim() || DEFAULT_MAIN_LOCATION_NAME;
}

/**
 * Terjemahkan pilihan lokasi dari request menjadi lokasi yang sah untuk member itu.
 *  - Member tanpa multi lokasi: pilihan tidak boleh dikirim (400), hasilnya "tanpa lokasi" (semua null).
 *  - Member multi lokasi: pilihan WAJIB ('utama' atau id lokasi miliknya), kecuali `fallbackToMain` (member yang baru saja
 *    diaktifkan multi lokasinya di request yang sama, belum punya lokasi lain).
 */
export async function resolveLocationChoice(
  db: Pick<Prisma.TransactionClient, 'memberLocation'>,
  member: LocationMember,
  choice: string | undefined | null,
  opts: { fallbackToMain?: boolean } = {},
): Promise<ResolvedLocation> {
  const chosen = choice?.trim() || undefined;
  if (!member.multiLocation) {
    if (chosen) throw new BadRequestException('Member ini belum memakai multi lokasi, jadi lokasi tidak perlu dipilih');
    return { locationId: null, name: null, address: null, mapsUrl: null };
  }
  const main = (): ResolvedLocation => ({
    locationId: null,
    name: mainLocationName(member),
    address: member.address,
    mapsUrl: member.mapsUrl,
  });
  if (!chosen) {
    if (opts.fallbackToMain) return main();
    throw new BadRequestException('Pilih lokasi dulu: member ini memakai multi lokasi');
  }
  if (chosen === MAIN_LOCATION_CHOICE) return main();
  const loc = await db.memberLocation.findFirst({ where: { id: chosen, memberId: member.id } });
  if (!loc) throw new BadRequestException('Lokasi yang dipilih bukan milik member ini');
  return { locationId: loc.id, name: loc.name, address: loc.address, mapsUrl: loc.mapsUrl };
}

/**
 * Lokasi kerja job (technician_jobs.work_address / work_maps_url) dari lokasi order. Lokasi 1 dan member tanpa multi lokasi
 * = null/null (ikut alamat & link member, perilaku lama); lokasi tambahan memakai alamat + link miliknya sendiri.
 */
export function jobWorkLocation(loc: ResolvedLocation): { workAddress: string | null; workMapsUrl: string | null } {
  if (!loc.locationId) return { workAddress: null, workMapsUrl: null };
  return { workAddress: loc.address?.trim() || null, workMapsUrl: loc.mapsUrl?.trim() || null };
}

/**
 * Unit harus berada di lokasi pekerjaan order (member multi lokasi). Unit yang discan/ditambah teknisi di lokasi lain
 * ditolak dengan pesan yang menyebut kedua lokasi, supaya teknisi tahu AC itu milik kantor mana.
 */
export function assertUnitAtLocation(
  unit: { locationId: string | null; location?: { name: string } | null },
  member: { multiLocation: boolean; mainLocationName: string | null },
  target: { locationId: string | null; name: string | null },
): void {
  if (!member.multiLocation) return;
  if ((unit.locationId ?? null) === (target.locationId ?? null)) return;
  const unitName = unit.location?.name ?? mainLocationName(member);
  throw new BadRequestException(
    `Unit ini terdaftar di lokasi "${unitName}", bukan lokasi pekerjaan ini ("${target.name ?? mainLocationName(member)}"). ` +
      'Pastikan AC yang dipindai benar, atau minta admin memindahkan unit ke lokasi yang sesuai.',
  );
}
