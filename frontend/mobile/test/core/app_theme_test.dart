import 'package:flutter_test/flutter_test.dart';
import 'package:epos_ac/core/theme/app_theme.dart';
import 'package:flutter/material.dart';

void main() {
  group('style guide "Corporate Modernism" (Figma node 78:5723)', () {
    test('palet inti terpasang di ColorScheme & background', () {
      final theme = AppTheme.light();

      expect(theme.colorScheme.primary, const Color(0xFF0B6B62)); // Teal Deep
      expect(theme.colorScheme.secondary, const Color(0xFF14B8A6)); // Bright
      expect(theme.colorScheme.error, const Color(0xFFDC2626)); // Coral
      expect(theme.scaffoldBackgroundColor, const Color(0xFFF6F8F8)); // Cloud
      expect(theme.colorScheme.outline, const Color(0xFFD4E6E4));
    });

    test('token palet sesuai swatch style guide', () {
      expect(AppColors.ink, const Color(0xFF0B1B1A));
      expect(AppColors.tealDeep, const Color(0xFF0B6B62));
      expect(AppColors.tealBright, const Color(0xFF14B8A6));
      expect(AppColors.mist, const Color(0xFFEAF6F4));
      expect(AppColors.cloud, const Color(0xFFF6F8F8));
      expect(AppColors.successGreen, const Color(0xFF16A34A));
      expect(AppColors.amber, const Color(0xFFF59E0B));
      expect(AppColors.coral, const Color(0xFFDC2626));
    });

    test('tipografi memakai tiga keluarga font yang di-bundle', () {
      final text = AppTheme.light().textTheme;

      // Heading: Plus Jakarta Sans, H2 = 18/24 SemiBold.
      expect(text.titleLarge?.fontFamily, 'PlusJakartaSans');
      expect(text.titleLarge?.fontSize, 18);
      expect(text.titleLarge?.fontWeight, FontWeight.w600);

      // Body: Inter 16/24.
      expect(text.bodyLarge?.fontFamily, 'Inter');
      expect(text.bodyLarge?.fontSize, 16);

      // Monospace hanya untuk uang/kode.
      expect(AppTextStyles.monoAmount.fontFamily, 'JetBrainsMono');
      expect(AppTextStyles.monoCode.fontFamily, 'JetBrainsMono');
    });

    test('kartu datar: radius 16, border 1px, tanpa bayangan', () {
      final theme = AppTheme.light();
      final shape = theme.cardTheme.shape! as RoundedRectangleBorder;

      expect(shape.borderRadius, BorderRadius.circular(16));
      expect(shape.side.color, const Color(0xFFD4E6E4));
      expect(shape.side.width, 1);
      expect(theme.cardTheme.elevation, 0);
    });

    test('tombol berradius 12 (bukan pil); sekunder putih bergaris abu; kolom isian putih bergaris abu', () {
      final theme = AppTheme.light();
      const states = <WidgetState>{};

      RoundedRectangleBorder shapeOf(ButtonStyle s) => s.shape!.resolve(states)! as RoundedRectangleBorder;

      final filled = theme.filledButtonTheme.style!;
      expect(filled.backgroundColor?.resolve(states), const Color(0xFF0B6B62));
      expect(shapeOf(filled).borderRadius, BorderRadius.circular(12));

      final outlined = theme.outlinedButtonTheme.style!;
      expect(outlined.backgroundColor?.resolve(states), Colors.white);
      expect(outlined.foregroundColor?.resolve(states), const Color(0xFF0B6B62));
      expect(outlined.side?.resolve(states)?.color, const Color(0xFFBCD2CF));
      expect(shapeOf(outlined).borderRadius, BorderRadius.circular(12));

      // Kolom isian tidak lagi sewarna tombol sekunder/chip (teal pucat).
      final input = theme.inputDecorationTheme;
      expect(input.fillColor, Colors.white);
      expect((input.enabledBorder! as OutlineInputBorder).borderSide.color, const Color(0xFFBCD2CF));
    });

    test('badge status: latar 10% + teks/titik warna penuh', () {
      expect(AppBadgeTone.pending.foreground, const Color(0xFFF59E0B));
      expect(AppBadgeTone.pending.background, const Color(0x1AF59E0B));
      expect(AppBadgeTone.success.foreground, const Color(0xFF16A34A));
      expect(AppBadgeTone.danger.foreground, const Color(0xFFDC2626));

      // Draft memakai abu-abu netral, bukan turunan warna semantik.
      expect(AppBadgeTone.draft.background, const Color(0xFFD4E6E4));
      expect(AppBadgeTone.draft.dot, const Color(0xFF6F7977));
      expect(AppBadgeTone.draft.foreground, const Color(0xFF3E4947));
    });
  });
}
