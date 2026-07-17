import 'package:flutter_test/flutter_test.dart';
import 'package:epos_ac/core/theme/app_theme.dart';
import 'package:flutter/material.dart';

void main() {
  test('warna utama sesuai dokumen fitur (teal #0F766E)', () {
    final theme = AppTheme.light();
    expect(theme.colorScheme.primary, const Color(0xFF0F766E));
    expect(theme.colorScheme.error, const Color(0xFFDC2626));
    expect(theme.scaffoldBackgroundColor, const Color(0xFFF8FAFC));
  });
}
