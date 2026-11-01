import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../core/theme/app_theme.dart';
import '../../core/utils/error_message.dart';
import '../../core/utils/tanggal.dart';
import '../../core/widgets/empty_state.dart';
import '../../core/widgets/form_field.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/status_badge.dart';
import 'keluar_gudang_providers.dart';

/// Daftar invoice yang unitnya sudah dijatah kasir tapi belum keluar gudang.
class KeluarGudangScreen extends ConsumerWidget {
  const KeluarGudangScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(pendingInvoicesProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Keluar Gudang'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Muat ulang',
            onPressed: () => ref.invalidate(pendingInvoicesProvider),
          ),
        ],
      ),
      body: async.when(
        loading: () => const AppSkeletonList(),
        error: (e, _) => AppErrorState(
          error: e,
          title: 'Gagal memuat daftar',
          onRetry: () => ref.invalidate(pendingInvoicesProvider),
        ),
        data: (list) {
          if (list.isEmpty) {
            return const AppEmptyState(
              icon: Icons.check_circle_outline,
              title: 'Tidak ada unit yang menunggu',
              message: 'Semua invoice sudah selesai dikeluarkan.',
            );
          }
          return RefreshIndicator(
            onRefresh: () => ref.refresh(pendingInvoicesProvider.future),
            child: ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: list.length + 1,
              separatorBuilder: (_, __) => const SizedBox(height: 10),
              itemBuilder: (context, i) {
                if (i == 0) {
                  return const Text(
                    'Ambil unit dari rak sesuai invoice, lalu scan QR di label. '
                    'Stok resmi berkurang setelah unit discan.',
                    style: TextStyle(color: AppColors.slate500, fontSize: 13),
                  );
                }
                final inv = list[i - 1];
                return Card(
                  margin: EdgeInsets.zero,
                  child: ListTile(
                    key: Key('pending-${inv.invoiceId}'),
                    title: Text(inv.invoiceNumber,
                        style: const TextStyle(fontWeight: FontWeight.w600)),
                    subtitle: Text([
                      inv.customerName ?? '-',
                      if (inv.createdAt != null)
                        formatTanggalSingkat(inv.createdAt!),
                    ].join(' · ')),
                    trailing: StatusBadge.tone(
                      AppBadgeTone.pending,
                      label: '${inv.pendingUnits} unit',
                    ),
                    onTap: () => context.push('/keluar-gudang/${inv.invoiceId}'),
                  ),
                );
              },
            ),
          );
        },
      ),
    );
  }
}

/// Satu invoice: progres, pemindai QR (atau ketik kode label), dan daftar baris.
class KeluarGudangDetailScreen extends ConsumerStatefulWidget {
  const KeluarGudangDetailScreen({
    super.key,
    required this.invoiceId,
    @visibleForTesting this.showCamera = true,
  });

  final String invoiceId;
  final bool showCamera;

  @override
  ConsumerState<KeluarGudangDetailScreen> createState() =>
      _KeluarGudangDetailScreenState();
}

class _KeluarGudangDetailScreenState
    extends ConsumerState<KeluarGudangDetailScreen> {
  final _manualController = TextEditingController();

  /// Kunci selama request berjalan: onDetect menembak berulang untuk QR yang
  /// sama, tanpa ini satu label bisa terkirim dua kali.
  bool _busy = false;
  String? _lastCode;
  DateTime? _lastCodeAt;

  /// Hasil scan terakhir tetap tampil sampai scan berikutnya — gudang sering
  /// menoleh ke rak dulu, snackbar keburu hilang.
  ({bool ok, String text, String? sub})? _result;

  @override
  void dispose() {
    _manualController.dispose();
    super.dispose();
  }

  void _refresh() {
    ref.invalidate(invoiceFulfillmentProvider(widget.invoiceId));
    ref.invalidate(pendingInvoicesProvider);
  }

  Future<void> _run(Future<FulfillResult> Function() call,
      {bool manual = false}) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final res = await call();
      if (!mounted) return;
      setState(() =>
          _result = (ok: true, text: res.message(manual: manual), sub: res.swapNote));
      _refresh();
    } catch (e) {
      if (!mounted) return;
      setState(() => _result = (ok: false, text: errorMessage(e), sub: null));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _scan(String raw) {
    final code = raw.trim();
    if (code.isEmpty) return;
    // Kamera membaca label yang sama berkali-kali; abaikan ulangan < 3 detik.
    final now = DateTime.now();
    if (code == _lastCode &&
        _lastCodeAt != null &&
        now.difference(_lastCodeAt!) < const Duration(seconds: 3)) {
      return;
    }
    _lastCode = code;
    _lastCodeAt = now;
    _run(() => ref.read(keluarGudangApiProvider).scan(widget.invoiceId, code));
  }

  Future<void> _confirmManual(FulfillmentLine line) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Tandai 1 unit keluar tanpa scan?'),
        content: Text(
          '${line.productName}. Sistem mengambil 1 unit yang dijatah paling '
          'lama. Gunakan hanya kalau QR rusak atau tidak terbaca.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Batal'),
          ),
          FilledButton(
            key: const Key('manual-confirm'),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Tandai keluar'),
          ),
        ],
      ),
    );
    if (ok == true) {
      await _run(
        () => ref
            .read(keluarGudangApiProvider)
            .manual(widget.invoiceId, line.refId),
        manual: true,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(invoiceFulfillmentProvider(widget.invoiceId));
    final data = async.value;
    return Scaffold(
      appBar: AppBar(title: Text(data?.invoiceNumber ?? 'Keluar Gudang')),
      body: async.when(
        skipLoadingOnRefresh: true,
        loading: () => const AppSkeletonList(),
        error: (e, _) => AppErrorState(
          error: e,
          title: 'Gagal memuat invoice',
          onRetry: _refresh,
        ),
        data: (inv) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(inv.customerName ?? '-',
                style: const TextStyle(color: AppColors.slate500)),
            const SizedBox(height: 8),
            Text('${inv.doneUnits} dari ${inv.totalUnits} unit sudah keluar',
                style: const TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 6),
            ClipRRect(
              borderRadius: BorderRadius.circular(99),
              child: LinearProgressIndicator(
                minHeight: 8,
                value: inv.totalUnits == 0 ? 0 : inv.doneUnits / inv.totalUnits,
              ),
            ),
            const SizedBox(height: 16),
            if (inv.allDone)
              const _Banner(
                ok: true,
                text: 'Semua unit di invoice ini sudah keluar dari gudang.',
              )
            else
              _scanner(),
            if (_result != null) ...[
              const SizedBox(height: 12),
              _Banner(ok: _result!.ok, text: _result!.text, sub: _result!.sub),
            ],
            const SizedBox(height: 16),
            for (final line in inv.lines) ...[
              _LineCard(
                line: line,
                busy: _busy,
                onManual: () => _confirmManual(line),
              ),
              const SizedBox(height: 10),
            ],
          ],
        ),
      ),
    );
  }

  Widget _scanner() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (widget.showCamera)
          ClipRRect(
            borderRadius: BorderRadius.circular(AppRadius.lg),
            child: SizedBox(
              height: 240,
              child: MobileScanner(
                onDetect: (capture) {
                  final raw = capture.barcodes.isEmpty
                      ? null
                      : capture.barcodes.first.rawValue;
                  if (raw != null) _scan(raw);
                },
                errorBuilder: (context, error, child) => Container(
                  color: AppColors.slate900,
                  alignment: Alignment.center,
                  padding: const EdgeInsets.all(24),
                  child: const Text(
                    'Kamera tidak tersedia.\nKetik kode label di bawah.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.white70),
                  ),
                ),
              ),
            ),
          ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: AppTextField(
                key: const Key('kode-input'),
                label: 'Kode label',
                hint: 'mis. PRD-0001-U0007',
                controller: _manualController,
                prefixIcon: const Icon(Icons.qr_code, size: 18),
                textInputAction: TextInputAction.done,
                onFieldSubmitted: (v) {
                  _scan(v);
                  _manualController.clear();
                },
              ),
            ),
            const SizedBox(width: 10),
            SizedBox(
              height: 50,
              child: FilledButton(
                key: const Key('kode-kirim'),
                onPressed: _busy
                    ? null
                    : () {
                        _scan(_manualController.text);
                        _manualController.clear();
                      },
                child: const Text('Kirim'),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.ok, required this.text, this.sub});
  final bool ok;
  final String text;
  final String? sub;

  @override
  Widget build(BuildContext context) {
    final color = ok ? AppColors.success : AppColors.danger;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        border: Border.all(color: color.withValues(alpha: 0.4)),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(ok ? Icons.check_circle_outline : Icons.warning_amber_rounded,
              size: 18, color: color),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(text,
                    style: TextStyle(color: color, fontWeight: FontWeight.w600)),
                if (sub != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(sub!, style: TextStyle(color: color, fontSize: 12)),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _LineCard extends StatelessWidget {
  const _LineCard({
    required this.line,
    required this.busy,
    required this.onManual,
  });

  final FulfillmentLine line;
  final bool busy;
  final VoidCallback onManual;

  @override
  Widget build(BuildContext context) {
    final role = line.acRole == 'indoor'
        ? 'Indoor'
        : line.acRole == 'outdoor'
            ? 'Outdoor'
            : null;
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    role == null ? line.productName : '${line.productName} · $role',
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  if (line.pairName != null)
                    Text(
                      'Satu paket. Pasangan '
                      '${line.acRole == 'indoor' ? 'Outdoor' : 'Indoor'}: ${line.pairName}',
                      style: const TextStyle(
                          color: AppColors.slate500, fontSize: 12),
                    ),
                  const SizedBox(height: 2),
                  Text(
                    '${line.qtyFulfilled} dari ${line.qtyTotal} unit sudah keluar',
                    style: const TextStyle(color: AppColors.slate500, fontSize: 13),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 10),
            if (line.qtyRemaining > 0)
              OutlinedButton(
                key: Key('manual-${line.refId}'),
                onPressed: busy ? null : onManual,
                child: const Text('Tandai manual'),
              )
            else
              StatusBadge.tone(AppBadgeTone.success, label: 'Selesai'),
          ],
        ),
      ),
    );
  }
}
