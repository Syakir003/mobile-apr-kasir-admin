import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotFoundException } from '@nestjs/common';
import { AppUpdateController, parseAppUpdateInfo } from './app-update.controller';

const ok = {
  versionName: '1.0.1',
  buildNumber: 2,
  minBuildNumber: 1,
  downloadUrl: 'https://api.ayubpodorukun.com/downloads/epos-ac-1.0.1.apk',
  notes: 'Tambah unit AC',
};

describe('parseAppUpdateInfo', () => {
  it('file lengkap diterima apa adanya', () => {
    expect(parseAppUpdateInfo(ok)).toEqual(ok);
  });

  it('minBuildNumber & notes opsional: default 0 dan kosong', () => {
    const r = parseAppUpdateInfo({ buildNumber: 3, downloadUrl: ok.downloadUrl });
    expect(r).toMatchObject({ buildNumber: 3, minBuildNumber: 0, notes: '', versionName: '3' });
  });

  it.each([
    ['bukan objek', 'x'],
    ['buildNumber 0', { ...ok, buildNumber: 0 }],
    ['buildNumber pecahan', { ...ok, buildNumber: 1.5 }],
    ['buildNumber teks', { ...ok, buildNumber: '2' }],
    ['URL http (bukan https)', { ...ok, downloadUrl: 'http://x.com/a.apk' }],
    ['URL javascript:', { ...ok, downloadUrl: 'javascript:alert(1)' }],
    ['URL mengandung spasi', { ...ok, downloadUrl: 'https://x.com/a b.apk' }],
    ['min lebih besar dari build', { ...ok, minBuildNumber: 9 }],
  ])('ditolak: %s', (_n, raw) => {
    expect(parseAppUpdateInfo(raw)).toBeNull();
  });
});

describe('AppUpdateController.latest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'appupd-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  afterEach(() => delete process.env.APP_UPDATE_FILE);

  it('membaca file dari APP_UPDATE_FILE', async () => {
    const f = join(dir, 'version.json');
    writeFileSync(f, JSON.stringify(ok));
    process.env.APP_UPDATE_FILE = f;
    await expect(new AppUpdateController().latest()).resolves.toEqual(ok);
  });

  it('file tidak ada -> 404', async () => {
    process.env.APP_UPDATE_FILE = join(dir, 'tidak-ada.json');
    await expect(new AppUpdateController().latest()).rejects.toBeInstanceOf(NotFoundException);
  });

  it('JSON rusak atau tak valid -> 404, bukan 500', async () => {
    const f = join(dir, 'rusak.json');
    writeFileSync(f, '{ bukan json');
    process.env.APP_UPDATE_FILE = f;
    await expect(new AppUpdateController().latest()).rejects.toBeInstanceOf(NotFoundException);
    writeFileSync(f, JSON.stringify({ ...ok, downloadUrl: 'http://x.com/a.apk' }));
    await expect(new AppUpdateController().latest()).rejects.toBeInstanceOf(NotFoundException);
  });
});
