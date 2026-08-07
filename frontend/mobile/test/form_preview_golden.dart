// Harness sementara: merender komponen form jadi PNG untuk dibandingkan
// dengan frame `Form` (31:1036) di Figma.
// Jalankan: flutter test --update-goldens test/form_preview_golden.dart
import 'package:epos_ac/core/theme/app_theme.dart';
import 'package:epos_ac/core/widgets/app_card.dart';
import 'package:epos_ac/core/widgets/form_field.dart';
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

  testWidgets('form fields', (tester) async {
    await tester.binding.setSurfaceSize(const Size(560, 900));
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light(),
        home: const Scaffold(
          backgroundColor: AppColors.cloud,
          body: Padding(
            padding: EdgeInsets.all(24),
            child: SingleChildScrollView(child: _FormDemo()),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await expectLater(
      find.byType(_FormDemo),
      matchesGoldenFile('preview_form.png'),
    );
  });
}

class _FormDemo extends StatelessWidget {
  const _FormDemo();

  @override
  Widget build(BuildContext context) {
    return const AppSectionCard(
      title: 'Tambah Jasa',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AppTextField(
            label: 'Nama Jasa',
            required: true,
            hint: 'Contoh: Cuci AC Split',
          ),
          SizedBox(height: kFieldGap),
          AppSelectField<String>(
            label: 'Kategori',
            required: true,
            hint: 'Pilih Kategori...',
            items: [
              DropdownMenuItem(value: 'cuci', child: Text('Cuci')),
              DropdownMenuItem(value: 'servis', child: Text('Servis')),
            ],
            onChanged: null,
          ),
          SizedBox(height: kFieldGap),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: AppMoneyField(
                  label: 'Harga Dasar (Rp)',
                  required: true,
                ),
              ),
              SizedBox(width: 16),
              Expanded(
                child: AppTextField(
                  label: 'Estimasi Durasi (Menit)',
                  hint: '45',
                  suffixText: 'min',
                ),
              ),
            ],
          ),
          SizedBox(height: kFieldGap),
          AppTextField(
            label: 'Keterangan Singkat',
            hint: 'Deskripsi layanan atau rincian pekerjaan...',
            maxLines: 3,
          ),
          SizedBox(height: kFieldGap),
          AppSwitchTile(
            title: 'Status Jasa Aktif',
            subtitle: 'Tampil di pilihan kasir dan teknisi',
            value: true,
            onChanged: null,
          ),
        ],
      ),
    );
  }
}
