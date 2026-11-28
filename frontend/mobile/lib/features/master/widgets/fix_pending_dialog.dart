import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/utils/error_message.dart';
import '../../../core/widgets/form_field.dart';
import '../master_providers.dart';

/// Gudang membetulkan barang yang masih "menunggu harga": nama, kategori, dan
/// SKU (hanya sparepart, [sku] null untuk produk). Harga tetap urusan admin;
/// server menolak bila barangnya sudah diberi harga. true = tersimpan.
Future<bool> showFixPendingDialog(
  BuildContext context, {
  required String path,
  required String name,
  required String category,
  String? sku,
  VoidCallback? onCorrectStock,
}) async =>
    await showDialog<bool>(
      context: context,
      builder: (_) => _FixPendingDialog(
          path: path, name: name, category: category, sku: sku, onCorrectStock: onCorrectStock),
    ) ??
    false;

class _FixPendingDialog extends ConsumerStatefulWidget {
  const _FixPendingDialog(
      {required this.path, required this.name, required this.category, this.sku, this.onCorrectStock});

  final VoidCallback? onCorrectStock;

  final String path;
  final String name;
  final String category;
  final String? sku;

  @override
  ConsumerState<_FixPendingDialog> createState() => _FixPendingDialogState();
}

class _FixPendingDialogState extends ConsumerState<_FixPendingDialog> {
  late final _name = TextEditingController(text: widget.name);
  late final _category = TextEditingController(text: widget.category);
  late final _sku = TextEditingController(text: widget.sku ?? '');
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _category.dispose();
    _sku.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      setState(() => _error = 'Nama wajib diisi');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(fixPendingCallerProvider)(widget.path, {
        'name': _name.text.trim(),
        if (widget.sku != null) 'sku': _sku.text.trim(),
        'category': _category.text.trim(),
      });
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = errorMessage(e);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Betulkan barang'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AppTextField(key: const Key('fix-name'), label: 'Nama', controller: _name, enabled: !_busy),
            if (widget.sku != null) ...[
              const SizedBox(height: 12),
              AppTextField(label: 'SKU', hint: 'Opsional', controller: _sku, enabled: !_busy),
            ],
            const SizedBox(height: 12),
            AppTextField(label: 'Kategori', hint: 'Opsional', controller: _category, enabled: !_busy),
            const SizedBox(height: 12),
            const Text('Harga diisi admin.', style: TextStyle(fontSize: 12, color: AppColors.slate600)),
            if (widget.onCorrectStock != null)
              OutlinedButton.icon(
                key: const Key('fix-stock'),
                onPressed: _busy
                    ? null
                    : () {
                        Navigator.of(context).pop(false);
                        widget.onCorrectStock!();
                      },
                icon: const Icon(Icons.fact_check_outlined, size: 18),
                label: const Text('Koreksi stok'),
              ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(_error!, style: const TextStyle(fontSize: 12, color: AppColors.danger)),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: _busy ? null : () => Navigator.of(context).pop(false), child: const Text('Batal')),
        FilledButton(key: const Key('fix-save'), onPressed: _busy ? null : _save, child: const Text('Simpan')),
      ],
    );
  }
}
