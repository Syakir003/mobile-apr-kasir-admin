import { photoUploadOptions } from './photo-upload';

describe('photoUploadOptions', () => {
  const opts = photoUploadOptions('avatars', 5);
  const check = (mimetype: string) =>
    new Promise<[unknown, boolean]>((done) =>
      opts.fileFilter!({}, { mimetype } as never, (err, ok) => done([err, ok])),
    );

  it('menerima JPG/PNG/WEBP', async () => {
    for (const m of ['image/jpeg', 'image/png', 'image/webp'])
      expect(await check(m)).toEqual([null, true]);
  });

  it('menolak SVG/HTML (stored XSS) dan tipe lain', async () => {
    for (const m of [
      'image/svg+xml',
      'text/html',
      'application/octet-stream',
    ]) {
      const [err, ok] = await check(m);
      expect(err).toBeInstanceOf(Error);
      expect(ok).toBe(false);
    }
  });

  it('batas ukuran dari parameter', () => {
    expect(opts.limits?.fileSize).toBe(5 * 1024 * 1024);
  });
});
