import { translateValidationMessage } from './validation-message.util';

describe('translateValidationMessage', () => {
  it('menerjemahkan pesan umum & menggabungkan jadi satu kalimat', () => {
    expect(
      translateValidationMessage([
        'name must be a string',
        'sellPrice must not be less than 0',
        'sellPrice must be a number conforming to the specified constraints',
        'unit should not be empty',
      ]),
    ).toBe('name harus berupa teks; sellPrice tidak boleh kurang dari 0; sellPrice harus berupa angka; unit wajib diisi');
  });

  it('pesan tak dikenal dipertahankan, duplikat dibuang', () => {
    expect(translateValidationMessage(['foo bar', 'foo bar'])).toBe('foo bar');
  });

  it('enum & property asing', () => {
    expect(translateValidationMessage('trackingMode must be one of the following values: a, b')).toBe(
      'trackingMode harus salah satu dari: a, b',
    );
    expect(translateValidationMessage('property x should not exist')).toBe('Isian x tidak dikenal');
  });
});
