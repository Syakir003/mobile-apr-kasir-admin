import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// Pilihan mode unit AC baru, sama dengan web (Terima Servis & Input Data Lampau): "Tipe diketahui" (merk/model/PK
/// boleh diisi) atau "QR dulu" (hanya QR dibuat, teknisi mengisi tipe saat scan di lokasi).
/// [qrDulu] true = mode QR dulu. [hint] = keterangan kecil di bawah pilihan QR dulu.
class UnitTypeMode extends StatelessWidget {
  const UnitTypeMode({
    super.key,
    required this.qrDulu,
    required this.onChanged,
    this.enabled = true,
    this.hint = 'Tipe AC diisi teknisi saat scan di lokasi.',
  });

  final bool qrDulu;
  final ValueChanged<bool>? onChanged;
  final bool enabled;
  final String hint;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: double.infinity,
          child: SegmentedButton<bool>(
            showSelectedIcon: false,
            segments: const [
              ButtonSegment(value: false, label: Text('Tipe diketahui')),
              ButtonSegment(value: true, label: Text('QR dulu')),
            ],
            selected: {qrDulu},
            onSelectionChanged: enabled && onChanged != null ? (s) => onChanged!(s.first) : null,
          ),
        ),
        if (qrDulu) ...[
          const SizedBox(height: 6),
          Text(hint, style: const TextStyle(fontSize: 12.5, color: AppColors.slate500)),
        ],
      ],
    );
  }
}
