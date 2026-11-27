import { isFieldComplete } from './job-field-complete';

const photo = (kind: string) => ({ kind });

describe('isFieldComplete', () => {
  it('tanpa temuan = belum lengkap', () => {
    expect(isFieldComplete([])).toBe(false);
  });

  it('satu temuan dengan foto sebelum dan sesudah = lengkap', () => {
    expect(
      isFieldComplete([{ photos: [photo('sebelum'), photo('sesudah')] }]),
    ).toBe(true);
  });

  it('foto boleh banyak per jenis', () => {
    expect(
      isFieldComplete([
        {
          photos: [
            photo('sebelum'),
            photo('sebelum'),
            photo('sesudah'),
            photo('sesudah'),
          ],
        },
      ]),
    ).toBe(true);
  });

  it('hanya foto sebelum, atau hanya sesudah, atau tanpa foto = belum lengkap', () => {
    expect(isFieldComplete([{ photos: [photo('sebelum')] }])).toBe(false);
    expect(isFieldComplete([{ photos: [photo('sesudah')] }])).toBe(false);
    expect(isFieldComplete([{ photos: [] }])).toBe(false);
  });

  it('SETIAP temuan harus lengkap: satu temuan kurang foto = belum lengkap', () => {
    expect(
      isFieldComplete([
        { photos: [photo('sebelum'), photo('sesudah')] },
        { photos: [photo('sebelum')] },
      ]),
    ).toBe(false);
  });

  it('beberapa temuan lengkap semua = lengkap', () => {
    expect(
      isFieldComplete([
        { photos: [photo('sebelum'), photo('sesudah')] },
        { photos: [photo('sesudah'), photo('sebelum')] },
      ]),
    ).toBe(true);
  });
});
