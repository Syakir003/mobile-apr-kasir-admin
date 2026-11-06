import { Controller, Get, NotFoundException } from '@nestjs/common';
import { readFile } from 'node:fs/promises';

/** Isi `version.json` yang diletakkan admin di VPS bersama file APK-nya (di luar repo, tidak ditimpa deploy). */
export interface AppUpdateInfo {
  versionName: string;
  /** Angka setelah `+` di pubspec.yaml (versionCode Android): satu-satunya yang dibandingkan app. */
  buildNumber: number;
  /** HP dengan build di bawah ini dipaksa update (mis. kontrak API berubah). 0/kosong = update opsional. */
  minBuildNumber: number;
  downloadUrl: string;
  notes: string;
}

const DEFAULT_FILE = '/var/www/epos-apk/version.json';

/**
 * Baca + validasi isi file. Null bila rusak/tidak lengkap, supaya salah ketik di file itu tidak pernah mendorong
 * app ke URL yang bukan HTTPS atau angka yang tidak masuk akal.
 */
export function parseAppUpdateInfo(raw: unknown): AppUpdateInfo | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const isBuild = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
  if (!isBuild(r.buildNumber) || r.buildNumber < 1) return null;
  if (typeof r.downloadUrl !== 'string' || !/^https:\/\/\S+$/.test(r.downloadUrl)) return null;
  const min = r.minBuildNumber === undefined ? 0 : r.minBuildNumber;
  if (!isBuild(min) || min > r.buildNumber) return null;
  return {
    versionName: typeof r.versionName === 'string' ? r.versionName.slice(0, 30) : String(r.buildNumber),
    buildNumber: r.buildNumber,
    minBuildNumber: min,
    downloadUrl: r.downloadUrl,
    notes: typeof r.notes === 'string' ? r.notes.slice(0, 500) : '',
  };
}

/**
 * Info versi terbaru app mobile (Flutter, dibagikan sebagai APK tanpa Play Store). PUBLIK (tanpa login) karena app
 * memeriksanya saat dibuka, sebelum login; isinya bukan rahasia. Sumbernya satu file JSON yang diisi admin saat
 * merilis APK baru, jadi tanpa tabel DB dan tanpa build ulang backend.
 */
@Controller('app-version')
export class AppUpdateController {
  @Get()
  async latest(): Promise<AppUpdateInfo> {
    let info: AppUpdateInfo | null = null;
    try {
      info = parseAppUpdateInfo(JSON.parse(await readFile(process.env.APP_UPDATE_FILE ?? DEFAULT_FILE, 'utf8')));
    } catch {
      info = null;
    }
    if (!info) throw new NotFoundException('Info versi app belum tersedia');
    return info;
  }
}
