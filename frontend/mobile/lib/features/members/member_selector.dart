import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';
import '../../data/models/member.dart';
import '../pos/member_picker_sheet.dart';
import 'member_providers.dart' show memberTierLabels;

/// Kolom pemilih member yang bisa dicari: ketuk untuk membuka daftar (cari nama / HP / alamat), dan setelah dipilih
/// detail member tampil di bawahnya (HP, alamat, link lokasi, tipe pembeli, jumlah unit AC, catatan).
/// Dipakai di Terima Servis dan Input Data Lampau.
class MemberSelector extends StatelessWidget {
  const MemberSelector({
    super.key,
    required this.members,
    required this.selectedId,
    required this.onChanged,
    this.fieldKey,
    this.enabled = true,
  });

  final List<Member> members;
  final String? selectedId;
  final ValueChanged<Member> onChanged;

  /// Key untuk kolom yang diketuk (uji / pencarian elemen).
  final Key? fieldKey;
  final bool enabled;

  Member? get _selected {
    for (final m in members) {
      if (m.id == selectedId) return m;
    }
    return null;
  }

  Future<void> _open(BuildContext context) async {
    final picked = await showModalBottomSheet<Member>(
      context: context,
      isScrollControlled: true,
      showDragHandle: false,
      builder: (_) => const MemberPickerSheet(),
    );
    if (picked != null) onChanged(picked);
  }

  @override
  Widget build(BuildContext context) {
    final m = _selected;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        InkWell(
          key: fieldKey,
          borderRadius: BorderRadius.circular(AppRadius.md),
          onTap: enabled ? () => _open(context) : null,
          child: InputDecorator(
            decoration: InputDecoration(
              hintText: 'Pilih member (cari nama / nomor HP)',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: const Icon(Icons.arrow_drop_down),
              enabled: enabled,
            ),
            isEmpty: m == null,
            child: m == null
                ? null
                : Text('${m.name} · ${m.phone}', maxLines: 1, overflow: TextOverflow.ellipsis),
          ),
        ),
        if (m != null) ...[const SizedBox(height: 8), _MemberDetailCard(member: m)],
      ],
    );
  }
}

class _MemberDetailCard extends StatelessWidget {
  const _MemberDetailCard({required this.member});
  final Member member;

  @override
  Widget build(BuildContext context) {
    final m = member;
    Widget row(IconData icon, String text) => Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Icon(icon, size: 16, color: AppColors.slate600),
            const SizedBox(width: 8),
            Expanded(child: Text(text, style: const TextStyle(fontSize: 13))),
          ]),
        );
    return Container(
      key: const Key('member-detail'),
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.mist,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.hairline),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(m.name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
        row(Icons.phone_outlined, m.phone.isEmpty ? '-' : m.phone),
        row(Icons.home_outlined, m.address.trim().isEmpty ? 'Alamat belum diisi' : m.address),
        if (m.mapsUrl.trim().isNotEmpty) row(Icons.place_outlined, m.mapsUrl),
        row(Icons.sell_outlined, 'Tipe pembeli: ${memberTierLabels[m.priceTier] ?? m.priceTier}'),
        row(Icons.ac_unit, '${m.totalAcUnits} unit AC terdaftar'),
        if ((m.notes ?? '').trim().isNotEmpty) row(Icons.notes_outlined, m.notes!),
        if (m.waOptOut) row(Icons.notifications_off_outlined, 'Berhenti pengingat WA'),
      ]),
    );
  }
}
