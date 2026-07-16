import 'package:flutter/material.dart';

/// Palet mengikuti desain Figma "E-POS AC Realtime" (Tailwind teal + slate).
abstract final class AppColors {
  // Primary (teal)
  static const teal50 = Color(0xFFF0FDFA);
  static const teal100 = Color(0xFFCCFBF1);
  static const teal600 = Color(0xFF0D9488); // interaktif utama
  static const teal700 = Color(0xFF0F766E); // kuat / grafik
  static const primaryTeal = teal700; // kompat lama

  // Netral (slate)
  static const slate50 = Color(0xFFF8FAFC); // background
  static const slate100 = Color(0xFFF1F5F9);
  static const slate200 = Color(0xFFE2E8F0); // border
  static const slate300 = Color(0xFFCBD5E1);
  static const slate400 = Color(0xFF94A3B8); // label kecil
  static const slate500 = Color(0xFF64748B); // muted
  static const slate600 = Color(0xFF475569); // body
  static const slate700 = Color(0xFF334155);
  static const slate900 = Color(0xFF0F172A); // heading

  // Aksen
  static const blue600 = Color(0xFF2563EB);
  static const indigo600 = Color(0xFF4F46E5);
  static const orange600 = Color(0xFFEA580C);
  static const green600 = Color(0xFF16A34A);
  static const red600 = Color(0xFFDC2626);

  // Alias semantik (kompat lama)
  static const background = slate50;
  static const surface = Colors.white;
  static const border = slate200;
  static const textPrimary = slate900;
  static const textSecondary = slate500;
  static const danger = red600;
  static const warning = Color(0xFFF59E0B);
  static const success = green600;
  static const accentCyan = Color(0xFF06B6D4);
  static const darkTeal = Color(0xFF115E59);
  static const softTeal = teal100;
}

abstract final class AppRadius {
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
}

abstract final class AppTheme {
  static ThemeData light() {
    final scheme = ColorScheme.fromSeed(
      seedColor: AppColors.teal700,
      brightness: Brightness.light,
    ).copyWith(
      // primary = teal700 (dokumen fitur / #0F766E); elemen interaktif spesifik
      // (tombol, FAB) memakai teal600 lewat tema masing-masing.
      primary: AppColors.teal700,
      onPrimary: Colors.white,
      secondary: AppColors.teal600,
      surface: Colors.white,
      onSurface: AppColors.slate900,
      surfaceContainerHighest: AppColors.slate100,
      outline: AppColors.slate200,
      outlineVariant: AppColors.slate200,
      error: AppColors.red600,
    );

    final base = ThemeData(useMaterial3: true, colorScheme: scheme);

    final text = base.textTheme.apply(
      bodyColor: AppColors.slate700,
      displayColor: AppColors.slate900,
    );

    OutlineInputBorder border(Color c, [double w = 1]) => OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.sm + 2),
          borderSide: BorderSide(color: c, width: w),
        );

    return base.copyWith(
      scaffoldBackgroundColor: AppColors.slate50,
      dividerColor: AppColors.slate200,
      dividerTheme: const DividerThemeData(
        color: AppColors.slate200,
        thickness: 1,
        space: 1,
      ),
      textTheme: text.copyWith(
        titleLarge: text.titleLarge?.copyWith(
          fontWeight: FontWeight.bold,
          color: AppColors.slate900,
        ),
        titleMedium: text.titleMedium?.copyWith(
          fontWeight: FontWeight.w600,
          color: AppColors.slate900,
        ),
      ),

      // Header putih bersih (bukan teal), teks slate — sesuai desain.
      appBarTheme: const AppBarTheme(
        backgroundColor: Colors.white,
        foregroundColor: AppColors.slate900,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0.5,
        centerTitle: false,
        titleTextStyle: TextStyle(
          color: AppColors.slate900,
          fontSize: 18,
          fontWeight: FontWeight.bold,
        ),
        iconTheme: IconThemeData(color: AppColors.slate600),
      ),

      cardTheme: CardThemeData(
        color: Colors.white,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.md),
          side: const BorderSide(color: AppColors.slate200),
        ),
      ),

      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Colors.white,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        border: border(AppColors.slate200),
        enabledBorder: border(AppColors.slate200),
        focusedBorder: border(AppColors.teal600, 1.5),
        errorBorder: border(AppColors.red600),
        focusedErrorBorder: border(AppColors.red600, 1.5),
        labelStyle: const TextStyle(color: AppColors.slate500),
        hintStyle: const TextStyle(color: AppColors.slate400),
        prefixIconColor: AppColors.slate400,
      ),

      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: AppColors.teal600,
          foregroundColor: Colors.white,
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppRadius.sm + 2),
          ),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.teal600,
          foregroundColor: Colors.white,
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppRadius.sm + 2),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.slate700,
          side: const BorderSide(color: AppColors.slate200),
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppRadius.sm + 2),
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(foregroundColor: AppColors.teal700),
      ),

      floatingActionButtonTheme: const FloatingActionButtonThemeData(
        backgroundColor: AppColors.teal600,
        foregroundColor: Colors.white,
      ),

      navigationRailTheme: const NavigationRailThemeData(
        backgroundColor: Colors.white,
        indicatorColor: AppColors.teal50,
        selectedIconTheme: IconThemeData(color: AppColors.teal700),
        unselectedIconTheme: IconThemeData(color: AppColors.slate500),
        selectedLabelTextStyle: TextStyle(
          color: AppColors.teal700,
          fontWeight: FontWeight.w600,
        ),
        unselectedLabelTextStyle: TextStyle(color: AppColors.slate600),
      ),

      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        indicatorColor: AppColors.teal50,
        elevation: 0,
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: states.contains(WidgetState.selected)
                ? AppColors.teal700
                : AppColors.slate500,
          ),
        ),
        iconTheme: WidgetStateProperty.resolveWith(
          (states) => IconThemeData(
            color: states.contains(WidgetState.selected)
                ? AppColors.teal700
                : AppColors.slate500,
          ),
        ),
      ),

      chipTheme: ChipThemeData(
        backgroundColor: AppColors.slate100,
        side: BorderSide.none,
        labelStyle: const TextStyle(
          color: AppColors.slate700,
          fontWeight: FontWeight.w500,
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(999),
        ),
      ),

      listTileTheme: const ListTileThemeData(
        iconColor: AppColors.slate500,
        textColor: AppColors.slate900,
      ),

      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: AppColors.slate900,
        contentTextStyle: const TextStyle(color: Colors.white),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.sm),
        ),
      ),
    );
  }
}
