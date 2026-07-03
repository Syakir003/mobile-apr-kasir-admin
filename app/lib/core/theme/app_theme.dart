import 'package:flutter/material.dart';

abstract final class AppColors {
  static const primaryTeal = Color(0xFF0F766E);
  static const darkTeal = Color(0xFF115E59);
  static const softTeal = Color(0xFFCCFBF1);
  static const accentCyan = Color(0xFF06B6D4);
  static const background = Color(0xFFF8FAFC);
  static const textPrimary = Color(0xFF0F172A);
  static const textSecondary = Color(0xFF64748B);
  static const danger = Color(0xFFDC2626);
  static const warning = Color(0xFFF59E0B);
  static const success = Color(0xFF16A34A);
}

abstract final class AppTheme {
  static ThemeData light() {
    final scheme = ColorScheme.fromSeed(
      seedColor: AppColors.primaryTeal,
    ).copyWith(
      primary: AppColors.primaryTeal,
      secondary: AppColors.accentCyan,
      error: AppColors.danger,
    );
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: AppColors.background,
      appBarTheme: const AppBarTheme(
        backgroundColor: AppColors.primaryTeal,
        foregroundColor: Colors.white,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(backgroundColor: AppColors.primaryTeal),
      ),
    );
  }
}
