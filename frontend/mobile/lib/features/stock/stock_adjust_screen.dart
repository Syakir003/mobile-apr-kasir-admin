import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/utils/error_message.dart';
import 'stock_providers.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/empty_state.dart';

/// Arah mutasi. Backend hanya menerima `qtyChange` bertanda; pemisahan
/// arah/jumlah di UI menghindari user mengetik minus secara manual.
enum StockDirection {
  masuk('Barang Masuk', Icons.arrow_downward),
  keluar('Barang Keluar', Icons.arrow_upward);

  const StockDirection(this.label, this.icon);
  final String label;
  final IconData icon;
}

/// Menyusun payload RPC `adjust_stock`. Dipisah dari widget supaya logika
/// tanda (+/-) bisa diuji tanpa membangun UI.
Map<String, dynamic> buildAdjustPayload({
  required StockRow item,
  required StockDirection direction,
  required num qty,
  required String reason,
  String note = '',
}) {
  final signed = direction == StockDirection.masuk ? qty : -qty;
  return {
    'itemKind': item.kind,
    'refId': item.id,
    'qtyChange': signed,
    'reason': reason,
    if (note.trim().isNotEmpty) 'note': note.trim(),
  };
}

/// Stok setelah mutasi diterapkan — dipakai untuk pratinjau & mencegah kirim
/// yang pasti ditolak backend ("stok tidak cukup").
num previewStock({
  required num current,
  required StockDirection direction,
  required num qty,
}) =>
    direction == StockDirection.masuk ? current + qty : current - qty;

/// Form barang masuk & penyesuaian stok (admin). Menulis lewat RPC
/// `adjust_stock`; stok dan mutasi ikut ter-refresh setelah sukses.
class StockAdjustScreen extends ConsumerStatefulWidget {
  const StockAdjustScreen({super.key});

  @override
  ConsumerState<StockAdjustScreen> createState() => _StockAdjustScreenState();
}

class _StockAdjustScreenState extends ConsumerState<StockAdjustScreen> {
  String _kind = 'product';
  String? _itemId;
  StockDirection _direction = StockDirection.masuk;
  String _reason = 'pembelian';
  final _qty = TextEditingController();
  final _note = TextEditingController();
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    // Pratinjau stok akhir ikut berubah saat jumlah diketik.
    _qty.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _qty.dispose();
    _note.dispose();
    super.dispose();
  }

  num get _qtyValue => num.tryParse(_qty.text.trim().replaceAll(',', '.')) ?? 0;

  Future<void> _submit(StockRow item) async {
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    final router = GoRouter.of(context);
    try {
      await ref.read(adjustStockCallerProvider)(buildAdjustPayload(
        item: item,
        direction: _direction,
        qty: _qtyValue,
        reason: _reason,
        note: _note.text,
      ));
      ref.invalidate(stockOverviewProvider);
      messenger.showSnackBar(
        SnackBar(content: Text('Stok ${item.name} diperbarui.')),
      );
      router.pop();
    } catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(
        content: Text(errorMessage(e)),
        backgroundColor: AppColors.danger,
      ));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(stockOverviewProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Stok Masuk & Penyesuaian')),
      body: async.when(
        loading: () => const AppSkeletonDetail(),
        error: (e, _) => AppErrorState(error: e, title: 'Gagal memuat item'),
        data: (d) {
          final items = _kind == 'product' ? d.products : d.spareparts;
          final selected =
              items.where((i) => i.id == _itemId).cast<StockRow?>().firstOrNull;
          final qty = _qtyValue;
          final after = selected == null
              ? null
              : previewStock(
                  current: selected.stock, direction: _direction, qty: qty);
          final kurang = after != null && after < 0;
          final valid = selected != null && qty > 0 && !kurang && !_busy;

          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
            children: [
              _label('Jenis Item'),
              Row(
                children: [
                  Expanded(
                    child: _Choice(
                      label: 'Produk AC',
                      selected: _kind == 'product',
                      onTap: _busy
                          ? null
                          : () => setState(() {
                                _kind = 'product';
                                _itemId = null;
                              }),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: _Choice(
                      label: 'Sparepart',
                      selected: _kind == 'sparepart',
                      onTap: _busy
                          ? null
                          : () => setState(() {
                                _kind = 'sparepart';
                                _itemId = null;
                              }),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              _label('Item'),
              DropdownButtonFormField<String>(
                key: const Key('adjust-item'),
                initialValue: items.any((i) => i.id == _itemId) ? _itemId : null,
                isExpanded: true,
                decoration: const InputDecoration(hintText: 'Pilih item'),
                items: [
                  for (final i in items)
                    DropdownMenuItem(
                      value: i.id,
                      child: Text('${i.name} · stok ${_n(i.stock)}',
                          maxLines: 1, overflow: TextOverflow.ellipsis),
                    ),
                ],
                onChanged:
                    _busy ? null : (v) => setState(() => _itemId = v),
              ),
              if (items.isEmpty)
                const Padding(
                  padding: EdgeInsets.only(top: 8),
                  child: Text('Belum ada item aktif pada kategori ini.',
                      style: TextStyle(color: AppColors.slate500)),
                ),
              const SizedBox(height: 16),
              _label('Arah Mutasi'),
              Row(
                children: [
                  for (final dir in StockDirection.values) ...[
                    Expanded(
                      child: _Choice(
                        label: dir.label,
                        icon: dir.icon,
                        selected: _direction == dir,
                        onTap: _busy
                            ? null
                            : () => setState(() {
                                  _direction = dir;
                                  // Alasan default mengikuti arah supaya
                                  // kombinasi paling lazim terpilih sendiri.
                                  _reason = dir == StockDirection.masuk
                                      ? 'pembelian'
                                      : 'rusak';
                                }),
                      ),
                    ),
                    if (dir != StockDirection.values.last)
                      const SizedBox(width: 8),
                  ],
                ],
              ),
              const SizedBox(height: 16),
              _label('Alasan'),
              DropdownButtonFormField<String>(
                key: const Key('adjust-reason'),
                initialValue: _reason,
                isExpanded: true,
                decoration: const InputDecoration(),
                items: [
                  for (final e in manualStockReasons.entries)
                    DropdownMenuItem(value: e.key, child: Text(e.value)),
                ],
                onChanged:
                    _busy ? null : (v) => setState(() => _reason = v!),
              ),
              const SizedBox(height: 16),
              _label('Jumlah'),
              TextField(
                key: const Key('adjust-qty'),
                controller: _qty,
                enabled: !_busy,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                inputFormatters: [
                  FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
                ],
                decoration: const InputDecoration(hintText: 'Mis. 10'),
              ),
              if (selected != null && qty > 0) ...[
                const SizedBox(height: 10),
                _Preview(
                  before: selected.stock,
                  after: after!,
                  kurang: kurang,
                  name: selected.name,
                ),
              ],
              const SizedBox(height: 16),
              _label('Catatan (opsional)'),
              TextField(
                controller: _note,
                enabled: !_busy,
                maxLines: 2,
                decoration: const InputDecoration(
                  hintText: 'Mis. nota pembelian #123, hasil stok opname…',
                ),
              ),
              const SizedBox(height: 24),
              SizedBox(
                height: 52,
                child: FilledButton.icon(
                  key: const Key('adjust-submit'),
                  onPressed: valid ? () => _submit(selected) : null,
                  icon: _busy
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white))
                      : const Icon(Icons.check),
                  label: const Text('Simpan Mutasi'),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _label(String text) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(text,
            style: const TextStyle(
                fontWeight: FontWeight.w600, color: AppColors.slate700)),
      );
}

String _n(num v) => v == v.roundToDouble() ? v.toInt().toString() : v.toString();

class _Preview extends StatelessWidget {
  const _Preview({
    required this.before,
    required this.after,
    required this.kurang,
    required this.name,
  });

  final num before;
  final num after;
  final bool kurang;
  final String name;

  @override
  Widget build(BuildContext context) {
    final color = kurang ? AppColors.danger : AppColors.teal700;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: kurang ? AppColors.dangerSurface : AppColors.tealSurface,
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Text(
        kurang
            ? 'Stok $name tidak cukup: tersedia ${_n(before)}.'
            : 'Stok $name: ${_n(before)} → ${_n(after)}',
        style: TextStyle(color: color, fontWeight: FontWeight.w600),
      ),
    );
  }
}

class _Choice extends StatelessWidget {
  const _Choice({
    required this.label,
    required this.selected,
    required this.onTap,
    this.icon,
  });

  final String label;
  final bool selected;
  final VoidCallback? onTap;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final fg = selected ? Colors.white : AppColors.slate600;
    return Material(
      color: selected ? AppColors.teal600 : Colors.white,
      borderRadius: BorderRadius.circular(AppRadius.md),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppRadius.md),
            border: Border.all(
                color: selected ? AppColors.teal600 : AppColors.slate200),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (icon != null) ...[
                Icon(icon, size: 16, color: fg),
                const SizedBox(width: 6),
              ],
              Flexible(
                child: Text(label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                        color: fg,
                        fontWeight: FontWeight.w600,
                        fontSize: 13)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
