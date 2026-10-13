import { BadRequestException } from '@nestjs/common';
import { assertTierCanBuy, resolveTierUnitPrice } from './price-tier.util';

describe('assertTierCanBuy', () => {
  const ac = { kind: 'product' };
  const part = { kind: 'sparepart' };
  const jasa = { kind: 'service' };

  it('Ritel boleh AC, Sparepart, Jasa, dan instalasi', () => {
    expect(() =>
      assertTierCanBuy('retail', [ac, part, jasa], [{}]),
    ).not.toThrow();
  });

  it.each(['installer', 'reseller'] as const)(
    '%s boleh AC & Sparepart',
    (tier) => {
      expect(() => assertTierCanBuy(tier, [ac, part], [])).not.toThrow();
      expect(() => assertTierCanBuy(tier, [ac, part], undefined)).not.toThrow();
    },
  );

  it.each(['installer', 'reseller'] as const)(
    '%s ditolak beli Jasa',
    (tier) => {
      expect(() => assertTierCanBuy(tier, [ac, jasa])).toThrow(
        BadRequestException,
      );
    },
  );

  it.each(['installer', 'reseller'] as const)(
    '%s ditolak pakai instalasi',
    (tier) => {
      expect(() => assertTierCanBuy(tier, [ac], [{}])).toThrow(
        BadRequestException,
      );
    },
  );
});

describe('resolveTierUnitPrice', () => {
  it('pakai harga eceran/unit secara default', () => {
    expect(
      resolveTierUnitPrice('reseller', 'AC X', {
        price: 3000000,
        pricePack: null,
      }),
    ).toBe(3000000);
    expect(
      resolveTierUnitPrice(
        'installer',
        'Pipa',
        { price: 50000, pricePack: 700000 },
        'eceran',
      ),
    ).toBe(50000);
  });

  it('jual utuh pakai harga utuh', () => {
    expect(
      resolveTierUnitPrice(
        'installer',
        'Pipa',
        { price: 50000, pricePack: 700000 },
        'utuh',
      ),
    ).toBe(700000);
  });

  it('harga belum diisi ditolak, bukan jatuh ke harga Ritel', () => {
    expect(() => resolveTierUnitPrice('reseller', 'AC X', undefined)).toThrow(
      /Harga Reseller untuk AC X belum diisi/,
    );
  });

  it('jual utuh tanpa harga utuh ditolak', () => {
    expect(() =>
      resolveTierUnitPrice(
        'installer',
        'Pipa',
        { price: 50000, pricePack: null },
        'utuh',
      ),
    ).toThrow(/Harga Installer \(utuh\)/);
  });

  it('harga 0 dianggap terisi', () => {
    expect(
      resolveTierUnitPrice('reseller', 'Bonus', { price: 0, pricePack: null }),
    ).toBe(0);
  });
});
