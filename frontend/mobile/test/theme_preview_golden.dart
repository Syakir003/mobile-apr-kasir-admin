// Harness sementara: merender token dari app_theme.dart jadi PNG supaya bisa
// dibandingkan langsung dengan frame Style Guide di Figma (node 78:5723).
// Jalankan: flutter test --update-goldens test_theme_preview.dart
import 'package:epos_ac/core/theme/app_theme.dart';
import 'package:epos_ac/core/widgets/app_filter_chip.dart';
import 'package:epos_ac/core/widgets/notice_panel.dart';
import 'package:epos_ac/core/widgets/status_badge.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

Future<void> _loadFont(String family, List<String> assets) async {
  final loader = FontLoader(family);
  for (final a in assets) {
    loader.addFont(rootBundle.load(a));
  }
  await loader.load();
}

void main() {
  setUpAll(() async {
    await _loadFont('PlusJakartaSans', const [
      'assets/fonts/PlusJakartaSans-Medium.ttf',
      'assets/fonts/PlusJakartaSans-SemiBold.ttf',
      'assets/fonts/PlusJakartaSans-Bold.ttf',
    ]);
    await _loadFont('Inter', const [
      'assets/fonts/Inter-Regular.ttf',
      'assets/fonts/Inter-Medium.ttf',
      'assets/fonts/Inter-SemiBold.ttf',
    ]);
    await _loadFont('JetBrainsMono', const [
      'assets/fonts/JetBrainsMono-Medium.ttf',
      'assets/fonts/JetBrainsMono-Bold.ttf',
    ]);
  });

  testWidgets('style guide preview', (tester) async {
    await tester.binding.setSurfaceSize(const Size(860, 1420));
    await tester.pumpWidget(
      MaterialApp(theme: AppTheme.light(), home: const _Preview()),
    );
    await tester.pumpAndSettle();
    await expectLater(
      find.byType(_Preview),
      matchesGoldenFile('preview_theme.png'),
    );
  });
}

class _Preview extends StatelessWidget {
  const _Preview();

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Scaffold(
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(32),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Design System Reference', style: t.displaySmall),
            const SizedBox(height: 8),
            Text(
              'Corporate Modernism — dirender dari app_theme.dart',
              style: t.bodyLarge?.copyWith(color: AppColors.textBody),
            ),
            const SizedBox(height: 28),
            const _Section('Color Palette'),
            const SizedBox(height: 16),
            const Wrap(
              spacing: 16,
              runSpacing: 16,
              children: [
                _Swatch('Ink', AppColors.ink, '#0B1B1A'),
                _Swatch('Teal Deep', AppColors.tealDeep, '#0B6B62'),
                _Swatch('Teal Bright', AppColors.tealBright, '#14B8A6'),
                _Swatch('Mist', AppColors.mist, '#EAF6F4'),
                _Swatch('Cloud', AppColors.cloud, '#F6F8F8'),
                _Swatch('Success', AppColors.successGreen, '#16A34A'),
                _Swatch('Amber', AppColors.amber, '#F59E0B'),
                _Swatch('Coral', AppColors.coral, '#DC2626'),
              ],
            ),
            const SizedBox(height: 32),
            const _Section('Typography'),
            const SizedBox(height: 16),
            Text('The Quick Brown Fox', style: t.displaySmall),
            const SizedBox(height: 8),
            Text('Semibold Heading Example', style: t.titleLarge),
            const SizedBox(height: 8),
            Text(
              'This is a body paragraph used for descriptive text, general '
              'information, and user instructions.',
              style: t.bodyLarge,
            ),
            const SizedBox(height: 6),
            Text(
              'Small caption or label text used for supplementary details.',
              style: t.bodySmall,
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(17),
              decoration: BoxDecoration(
                color: AppColors.mistDeep,
                border: Border.all(color: AppColors.hairline),
                borderRadius: BorderRadius.circular(AppRadius.sm),
              ),
              child: const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('INV-2024-8892', style: AppTextStyles.monoCode),
                  SizedBox(height: 8),
                  Text('Rp 45.200.000', style: AppTextStyles.monoAmount),
                ],
              ),
            ),
            const SizedBox(height: 32),
            const _Section('Buttons'),
            const SizedBox(height: 16),
            Wrap(
              spacing: 16,
              runSpacing: 12,
              children: [
                FilledButton(onPressed: () {}, child: const Text('Primary Action')),
                OutlinedButton(
                  onPressed: () {},
                  child: const Text('Secondary Action'),
                ),
                OutlinedButton(
                  onPressed: () {},
                  style: AppButtonStyles.destructive(),
                  child: const Text('Destructive'),
                ),
                const FilledButton(onPressed: null, child: Text('Disabled')),
              ],
            ),
            const SizedBox(height: 32),
            const _Section('Komponen Bersama'),
            const SizedBox(height: 16),
            Wrap(
              spacing: 16,
              runSpacing: 12,
              children: [
                StatusBadge.tone(AppBadgeTone.pending, label: 'Pending'),
                const StatusBadge(
                  label: 'Lunas',
                  color: AppColors.successGreen,
                ),
                const StatusBadge(
                  label: 'Admin',
                  color: AppColors.tealDeep,
                  showDot: false,
                ),
                AppFilterChip(label: 'Aktif', selected: true, onTap: () {}),
                AppFilterChip(label: 'Selesai', selected: false, onTap: () {}),
              ],
            ),
            const SizedBox(height: 16),
            const NoticePanel(
              tone: NoticeTone.warning,
              icon: Icons.lock_outline,
              text: 'Unggah foto SEBELUM dulu untuk memulai pekerjaan.',
            ),
            const SizedBox(height: 8),
            const NoticePanel(
              tone: NoticeTone.danger,
              text: 'Stok Kompresor tidak cukup: tersedia 2.',
              bordered: false,
            ),
            const SizedBox(height: 32),
            const _Section('Surface & Elevation (Cards)'),
            const SizedBox(height: 20),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.all(24),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(AppRadius.xl),
                      boxShadow: AppShadows.card,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Standard Container', style: t.titleLarge),
                        const SizedBox(height: 12),
                        const Divider(color: AppColors.mist),
                        const SizedBox(height: 12),
                        Text(
                          'Radius 20px dan soft teal drop shadow '
                          '(15% opacity Teal Deep).',
                          style: t.bodyMedium,
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 24),
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.all(24),
                    decoration: BoxDecoration(
                      gradient: AppGradients.statCard,
                      borderRadius: BorderRadius.circular(AppRadius.xl),
                      boxShadow: AppShadows.elevated,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Total Sales (MTD)',
                          style: t.titleSmall?.copyWith(
                            color: AppColors.tealPale,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          'Rp 128.50M',
                          style: AppTextStyles.monoDisplay.copyWith(
                            fontSize: 32,
                            height: 40 / 32,
                          ),
                        ),
                        const SizedBox(height: 12),
                        Row(
                          children: [
                            const Icon(
                              Icons.trending_up,
                              size: 14,
                              color: AppColors.tealHaze,
                            ),
                            const SizedBox(width: 8),
                            Text(
                              '+12.4% vs last month',
                              style: t.bodySmall?.copyWith(
                                color: AppColors.tealHaze,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section(this.title);
  final String title;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.only(bottom: 17),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppColors.hairline)),
      ),
      child: Text(title, style: Theme.of(context).textTheme.titleLarge),
    );
  }
}

class _Swatch extends StatelessWidget {
  const _Swatch(this.name, this.color, this.hex);
  final String name;
  final Color color;
  final String hex;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 80,
          height: 64,
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(AppRadius.md),
            border: Border.all(color: AppColors.hairline),
          ),
        ),
        const SizedBox(height: 8),
        Text(name, style: AppTextStyles.monoCode.copyWith(fontSize: 11)),
        Text(
          hex,
          style: AppTextStyles.monoCode.copyWith(
            fontSize: 11,
            color: AppColors.textMuted,
          ),
        ),
      ],
    );
  }
}
