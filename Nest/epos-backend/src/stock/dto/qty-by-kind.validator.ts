import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/**
 * Fix dari audit: `Product.stock` kolomnya INTEGER di DB, sedangkan
 * `Sparepart.stock` DECIMAL(10,2) — tapi StockInDto.qty & OpnameItemDto
 * (physicalQty) sebelumnya cuma `@IsNumber() @Min(...)` generik, gak bedain
 * `kind`. Qty pecahan buat produk (mis. 1.5) lolos validasi lalu meledak pas
 * StockLockingService jalanin raw SQL `UPDATE products SET stock = stock +
 * $1` ke kolom INTEGER (500 mentah di tengah transaction). Validator ini
 * baca field `kind` di objek yang sama (lewat `args.object`) buat mutusin
 * qty produk WAJIB bilangan bulat, qty sparepart boleh desimal maks 2 angka.
 */
export function IsQtyValidForKind(
  kindField = 'kind',
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isQtyValidForKind',
      target: object.constructor,
      propertyName,
      constraints: [kindField],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          // Batas positif/nol (0 valid buat opname "stok fisik abis", tapi
          // gak valid buat qty barang masuk) TETAP tanggung jawab @Min di
          // masing-masing DTO — validator ini CUMA ngecek tipe & presisi
          // (integer buat produk, maks 2 desimal buat sparepart).
          if (typeof value !== 'number' || !Number.isFinite(value))
            return false;
          const kind = (args.object as Record<string, unknown>)[
            args.constraints[0]
          ];
          if (kind === 'product') return Number.isInteger(value);
          // sparepart (atau kind lain yang lolos @IsIn di field kind) — boleh
          // desimal, maks 2 angka di belakang koma (match DECIMAL(10,2)).
          return Math.round(value * 100) / 100 === value;
        },
        defaultMessage(args: ValidationArguments): string {
          const kind = (args.object as Record<string, unknown>)[
            args.constraints[0]
          ];
          return kind === 'product'
            ? 'qty produk harus bilangan bulat positif'
            : 'qty harus angka positif, maksimal 2 angka desimal';
        },
      },
    });
  };
}
