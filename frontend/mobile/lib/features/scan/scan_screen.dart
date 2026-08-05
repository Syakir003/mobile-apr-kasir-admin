import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../core/router/app_router.dart';
import '../../core/theme/app_theme.dart';
import '../../data/models/ac_unit.dart';
import '../../data/models/app_user.dart';
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
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
      ),
      builder: (sheetContext) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const _GrabHandle(),
              const SizedBox(height: 12),
              Row(
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      color: AppColors.teal50,
                      borderRadius: BorderRadius.circular(AppRadius.md),
                    ),
                    child: const Icon(Icons.ac_unit, color: AppColors.teal700),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Text(
                      '${unit.brand} ${unit.model}',
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                        color: AppColors.slate900,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              _infoLine(Icons.straighten,
                  '${unit.pk} PK • ${unit.roomLocation.isEmpty ? '-' : unit.roomLocation}'),
              _infoLine(Icons.qr_code, unit.barcodeValue),
              const SizedBox(height: 8),
              Row(
                children: [
                  const Text('Status: ',
                      style: TextStyle(color: AppColors.slate500)),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppColors.teal50,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      unit.status.label,
                      style: const TextStyle(
                        color: AppColors.teal700,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                height: 50,
                child: FilledButton.icon(
                  key: const Key('open-unit-history'),
                  icon: const Icon(Icons.history),
                  label: const Text('Riwayat Service Unit'),
                  onPressed: () {
                    Navigator.pop(sheetContext);
                    context.go('/units/${unit.id}/history', extra: unit);
                  },
                ),
              ),
              // '/members' hanya untuk admin (guard router) — sembunyikan bagi
              // kasir/teknisi supaya tidak terlempar balik ke dashboard.
              if (ref.read(currentUserProvider).value?.role == UserRole.admin)
                Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: SizedBox(
                    width: double.infinity,
                    height: 50,
                    child: OutlinedButton.icon(
                      key: const Key('open-member'),
                      icon: const Icon(Icons.person_outline),
                      label: const Text('Buka Member'),
                      onPressed: () {
                        Navigator.pop(sheetContext);
                        context.go('/members/${unit.memberId}');
                      },
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _infoLine(IconData icon, String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          Icon(icon, size: 18, color: AppColors.slate400),
          const SizedBox(width: 10),
          Expanded(
            child: Text(text,
                style: const TextStyle(color: AppColors.slate700)),
          ),
        ],
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
            child: Stack(
              fit: StackFit.expand,
              children: [
                MobileScanner(
                  onDetect: (capture) {
                    final raw = capture.barcodes.isEmpty
                        ? null
                        : capture.barcodes.first.rawValue;
                    if (raw != null) _lookup(raw);
                  },
                  errorBuilder: (context, error, child) => Container(
                    color: AppColors.slate900,
                    child: const Center(
                      child: Padding(
                        padding: EdgeInsets.all(24),
                        child: Text(
                          'Kamera tidak tersedia.\nGunakan input manual di bawah.',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: Colors.white70),
                        ),
                      ),
                    ),
                  ),
                ),
                // Bingkai pemindai dekoratif.
                IgnorePointer(
                  child: Center(
                    child: Container(
                      width: 220,
                      height: 220,
                      decoration: BoxDecoration(
                        border: Border.all(color: Colors.white, width: 3),
                        borderRadius: BorderRadius.circular(AppRadius.lg),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          Container(
            color: Colors.white,
            padding: const EdgeInsets.all(16),
            child: SafeArea(
              top: false,
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      key: const Key('manual-input'),
                      controller: _manualController,
                      decoration: const InputDecoration(
                        labelText: 'Input barcode manual',
                        prefixIcon: Icon(Icons.qr_code),
                        isDense: true,
                      ),
                      onSubmitted: _lookup,
                    ),
                  ),
                  const SizedBox(width: 10),
                  SizedBox(
                    height: 50,
                    child: FilledButton(
                      key: const Key('manual-search'),
                      onPressed: _searching
                          ? null
                          : () => _lookup(_manualController.text),
                      child: const Text('Cari'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _GrabHandle extends StatelessWidget {
  const _GrabHandle();
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        width: 40,
        height: 4,
        decoration: BoxDecoration(
          color: AppColors.slate300,
          borderRadius: BorderRadius.circular(2),
        ),
      ),
    );
  }
}
