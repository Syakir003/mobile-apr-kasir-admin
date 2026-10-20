/// Kunci camelCase respons Nest (Prisma) -> snake_case yang dibaca `fromMap`
/// model lama (bentuk kolom Postgres). Hanya level atas; nilai tak diubah.
Map<String, dynamic> snakeKeys(Map<dynamic, dynamic> row) => {
      for (final e in row.entries)
        (e.key as String).replaceAllMapped(
            RegExp(r'[A-Z]'), (m) => '_${m[0]!.toLowerCase()}'): e.value,
    };
