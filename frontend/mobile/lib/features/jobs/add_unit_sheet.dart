import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/form_field.dart';
import 'job_providers.dart' show AddUnitInput;

const _jobTypes = {'perbaikan': 'Perbaikan', 'cuci': 'Cuci AC', 'maintenance': 'Maintenance'};

/// Sheet "Tambah Unit AC" (teknisi): customer minta AC lain ikut diservis di tempat. Dua jalur sama dengan web:
/// unit sudah berlabel (scan QR-nya lewat [onScan]) atau AC tanpa label (QR baru, dicetak setelah ditambahkan).
/// Mengembalikan [AddUnitInput] lewat `Navigator.pop`; pemanggil yang menembak API-nya.
class AddUnitSheet extends StatefulWidget {
  const AddUnitSheet({super.key, required this.jobType, required this.onScan});

  /// Jenis job yang sedang dikerjakan: jadi pilihan awal jenis pekerjaan unit tambahan.
  final String jobType;

  /// Buka pemindai; kembalikan kode yang terbaca (null bila dibatalkan).
  final Future<String?> Function() onScan;

  @override
  State<AddUnitSheet> createState() => _AddUnitSheetState();
}

class _AddUnitSheetState extends State<AddUnitSheet> {
  late String _type = _jobTypes.containsKey(widget.jobType) ? widget.jobType : 'perbaikan';
  final _complaint = TextEditingController();
  final _room = TextEditingController();
  bool _newUnit = false;
  String? _barcode;

  @override
  void dispose() {
    _complaint.dispose();
    _room.dispose();
    super.dispose();
  }

  bool get _ready => _complaint.text.trim().isNotEmpty && (_newUnit || _barcode != null);

  Future<void> _scan() async {
    final code = await widget.onScan();
    if (code != null && mounted) setState(() => _barcode = code);
  }

  void _submit() => Navigator.of(context).pop<AddUnitInput>((
        jobType: _type,
        complaint: _complaint.text.trim(),
        barcode: _newUnit ? null : _barcode,
        newUnit: _newUnit,
        roomLocation: _newUnit ? _room.text.trim() : null,
      ));

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(20, 12, 20, 20 + MediaQuery.of(context).viewInsets.bottom),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.slate300,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: 14),
            const Text('Tambah Unit AC ke Job Ini',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppColors.slate900)),
            const SizedBox(height: 4),
            const Text(
              'Customer minta AC lain ikut diservis. Unit tambahan masuk job yang sama (satu nota), '
              'dengan tempat temuan dan foto sebelum/sesudahnya sendiri.',
              style: TextStyle(color: AppColors.slate500),
            ),
            const SizedBox(height: kFieldGap),
            AppSelectField<String>(
              key: const Key('add-unit-type'),
              label: 'Jenis pekerjaan',
              value: _type,
              items: [
                for (final e in _jobTypes.entries) DropdownMenuItem(value: e.key, child: Text(e.value)),
              ],
              onChanged: (v) => setState(() => _type = v ?? _type),
            ),
            const SizedBox(height: kFieldGap),
            AppTextField(
              key: const Key('add-unit-complaint'),
              label: 'Pekerjaan / keluhan unit ini',
              hint: 'Mis. AC kurang dingin, atau Cuci AC',
              helper: 'Wajib. Kalau tidak ada keluhan, isi pekerjaannya, mis. Cuci AC. Jadi temuan awal unit ini.',
              maxLines: 2,
              controller: _complaint,
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: kFieldGap),
            SegmentedButton<bool>(
              key: const Key('add-unit-mode'),
              segments: const [
                ButtonSegment(value: false, label: Text('Sudah berlabel')),
                ButtonSegment(value: true, label: Text('AC tanpa label')),
              ],
              selected: {_newUnit},
              onSelectionChanged: (v) => setState(() => _newUnit = v.first),
            ),
            const SizedBox(height: 12),
            if (_newUnit) ...[
              const Text(
                'Untuk AC yang belum punya label. QR baru dibuat dan langsung bisa dicetak. Setelah ditempel di AC, '
                'scan QR itu di Scan Unit untuk mengisi merk dan PK. AC ini otomatis masuk daftar AC pelanggan.',
                style: TextStyle(fontSize: 13, color: AppColors.slate500),
              ),
              const SizedBox(height: 12),
              AppTextField(
                key: const Key('add-unit-room'),
                label: 'Ruangan (opsional)',
                hint: 'Mis. Kamar Utama',
                controller: _room,
              ),
            ] else ...[
              const Text(
                'Scan QR yang tertempel di AC. Unit harus milik pelanggan yang sama dan tidak sedang punya job lain.',
                style: TextStyle(fontSize: 13, color: AppColors.slate500),
              ),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                key: const Key('add-unit-scan'),
                onPressed: _scan,
                icon: const Icon(Icons.qr_code_scanner),
                label: Text(_barcode == null ? 'Scan QR unit' : 'Scan ulang'),
              ),
              if (_barcode != null)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text('Kode terbaca: $_barcode',
                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.teal700)),
                ),
            ],
            const SizedBox(height: 16),
            FilledButton(
              key: const Key('add-unit-submit'),
              onPressed: _ready ? _submit : null,
              child: Text(_newUnit ? 'Buat QR Baru & Cetak Label' : 'Tambahkan Unit'),
            ),
          ],
        ),
      ),
    );
  }
}
