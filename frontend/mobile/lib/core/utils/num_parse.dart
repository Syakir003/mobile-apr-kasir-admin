/// Angka dari JSON backend Nest. Kolom `Decimal` Prisma (harga, total, qty,
/// stok, PK, ...) di-serialize sebagai STRING (decimal.js `toJSON()`), bukan
/// number — parser mobile WAJIB lewat sini, jangan `as num?` langsung
/// (crash `String is not a subtype of num?`).
num? numFromNest(Object? v) => switch (v) {
      num n => n,
      String s => num.tryParse(s),
      _ => null,
    };
