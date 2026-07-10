import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../core/theme/app_theme.dart';
import '../../data/models/ac_unit.dart';
import '../members/member_providers.dart';

/// Layar scan barcode unit AC dengan fallback input manual.
/// Validasi terhadap job/servis menyusul di Fase 5; di sini hanya lookup.
class ScanScreen extends ConsumerStatefulWidget {
  const ScanScreen({super.key});

  @override
  ConsumerState<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends ConsumerState<ScanScreen> {
  final _manualController = TextEditingController();

  /// Kunci selama lookup + bottom sheet terbuka agar onDetect yang
  /// menembak berulang tidak memicu pencarian ganda.
  bool _searching = false;

  @override
  void dispose() {
    _manualController.dispose();
    super.dispose();
  }

  Future<void> _lookup(String raw) async {
    final value = raw.trim();
    if (value.isEmpty || _searching) return;
    setState(() => _searching = true);
    final repo = ref.read(acUnitRepositoryProvider);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final unit = await repo.findByBarcode(value);
      if (!mounted) return;
      if (unit == null) {
        messenger.showSnackBar(
          const SnackBar(content: Text('Barcode tidak ditemukan')),
        );
      } else {
        await _showUnitSheet(unit);
      }
    } catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(
        SnackBar(
          content: Text('Gagal mencari: $e'),
          backgroundColor: AppColors.danger,
        ),
      );
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  Future<void> _showUnitSheet(AcUnit unit) async {
    await showModalBottomSheet<void>(
      context: context,
      builder: (sheetContext) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '${unit.brand} ${unit.model}',
                style: Theme.of(sheetContext).textTheme.titleLarge,
              ),
              const SizedBox(height: 8),
              Text(
                '${unit.pk} PK • '
                '${unit.roomLocation.isEmpty ? '-' : unit.roomLocation}',
              ),
              Text('Status: ${unit.status.label}'),
              Text('Barcode: ${unit.barcodeValue}'),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  key: const Key('open-member'),
                  icon: const Icon(Icons.person_outline),
                  label: const Text('Buka Member'),
                  onPressed: () {
                    Navigator.pop(sheetContext);
                    context.go('/members/${unit.memberId}');
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Scan Barcode')),
      body: Column(
        children: [
          Expanded(
            child: MobileScanner(
              onDetect: (capture) {
                final raw = capture.barcodes.isEmpty
                    ? null
                    : capture.barcodes.first.rawValue;
                if (raw != null) _lookup(raw);
              },
              errorBuilder: (context, error, child) => const Center(
                child: Padding(
                  padding: EdgeInsets.all(16),
                  child: Text(
                    'Kamera tidak tersedia. Gunakan input manual di bawah.',
                    textAlign: TextAlign.center,
                  ),
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    key: const Key('manual-input'),
                    controller: _manualController,
                    decoration: const InputDecoration(
                      labelText: 'Input barcode manual',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                    onSubmitted: _lookup,
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton(
                  key: const Key('manual-search'),
                  onPressed: _searching
                      ? null
                      : () => _lookup(_manualController.text),
                  child: const Text('Cari'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
