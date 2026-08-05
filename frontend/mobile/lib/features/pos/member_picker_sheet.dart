import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../data/models/member.dart';
import '../members/member_providers.dart';

/// Bottom sheet pemilihan member terdaftar untuk transaksi POS. Pola sama
/// dengan `ItemPickerSheet` (`item_picker_sheet.dart`): filter di client atas
/// data stream, satu tap memilih. Ditutup dengan `Navigator.pop(context,
/// member)` — pemanggil (`checkout_screen.dart`) yang menaruhnya ke keranjang.
///
/// Hanya member aktif yang ditampilkan; member nonaktif tidak boleh dipakai
/// transaksi baru.
class MemberPickerSheet extends ConsumerStatefulWidget {
  const MemberPickerSheet({super.key});

  @override
  ConsumerState<MemberPickerSheet> createState() => _MemberPickerSheetState();
}

class _MemberPickerSheetState extends ConsumerState<MemberPickerSheet> {
  final _query = TextEditingController();
  String _filter = '';

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  bool _matches(Member m) {
    if (_filter.isEmpty) return true;
    return m.name.toLowerCase().contains(_filter) ||
        m.phone.replaceAll(RegExp(r'[\s\-.()]'), '').contains(_filter);
  }

  @override
  Widget build(BuildContext context) {
    final members = ref.watch(membersStreamProvider);

    return SafeArea(
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.85,
        child: Column(
          children: [
            const SizedBox(height: 8),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: const Color(0xFFCBD5E1),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 14, 16, 0),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  'Pilih Member',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: AppColors.slate900,
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
              child: TextField(
                key: const Key('member-filter'),
                controller: _query,
                decoration: const InputDecoration(
                  labelText: 'Cari nama / nomor HP',
                  prefixIcon: Icon(Icons.search),
                ),
                onChanged: (v) =>
                    setState(() => _filter = v.trim().toLowerCase()),
              ),
            ),
            Expanded(
              child: members.when(
                data: (list) {
                  final filtered =
                      list.where((m) => m.active && _matches(m)).toList()
                        ..sort((a, b) => a.name
                            .toLowerCase()
                            .compareTo(b.name.toLowerCase()));
                  if (filtered.isEmpty) {
                    return const Center(
                      child: Padding(
                        padding: EdgeInsets.all(24),
                        child: Text(
                          'Member tidak ditemukan.\n'
                          'Tutup sheet ini dan isi data pelanggan manual — '
                          'member baru dibuat otomatis saat checkout.',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: AppColors.slate500),
                        ),
                      ),
                    );
                  }
                  return ListView.builder(
                    itemCount: filtered.length,
                    itemBuilder: (_, i) {
                      final m = filtered[i];
                      return ListTile(
                        key: Key('member-${m.id}'),
                        title: Text(
                          m.name,
                          style: const TextStyle(fontWeight: FontWeight.w500),
                        ),
                        subtitle: Text(
                          m.address.trim().isEmpty
                              ? m.phone
                              : '${m.phone} • ${m.address}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(color: AppColors.slate500),
                        ),
                        trailing: Text(
                          '${m.totalAcUnits} unit',
                          style: const TextStyle(
                            color: AppColors.teal700,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        onTap: () => Navigator.of(context).pop(m),
                      );
                    },
                  );
                },
                loading: () =>
                    const Center(child: CircularProgressIndicator()),
                error: (e, _) => Center(child: Text('Gagal memuat member: $e')),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
