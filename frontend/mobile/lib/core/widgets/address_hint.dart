import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../utils/address_check.dart';

/// Petunjuk di bawah kolom alamat (cerminan `address-hint.tsx` di web): contoh format saat kosong; saat diisi, pesan
/// wajib (merah) bila kabupaten/kota belum disebut dan saran (oranye) lainnya. Link Maps sungguhan mengalahkan aturan,
/// jadi petunjuk disembunyikan. Alamat yang sama dengan [original] (data lama) tidak ditegur.
///
/// [hideBlocking] true bila pesan wajib yang sama sudah tampil di tempat lain (mis. error validator form).
class AddressHint extends StatelessWidget {
  const AddressHint({
    super.key,
    required this.address,
    this.maps,
    this.original,
    this.hideBlocking = false,
  });

  final TextEditingController address;
  final TextEditingController? maps;
  final String? original;
  final bool hideBlocking;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([address, if (maps != null) maps!]),
      builder: (context, _) {
        final text = address.text.trim();
        if (maps != null && isMapsLink(maps!.text)) return const SizedBox.shrink();
        const small = TextStyle(fontSize: 12, height: 1.3);
        if (text.isEmpty) {
          return const Padding(
            padding: EdgeInsets.only(top: 4),
            child: Text(
              'Format: jalan/perumahan, desa, kecamatan, kabupaten/kota. Contoh: $addressExample.',
              style: TextStyle(fontSize: 12, height: 1.3, color: AppColors.slate600),
            ),
          );
        }
        if (text == (original ?? '').trim()) return const SizedBox.shrink();
        final c = checkAddress(text);
        final blocking = hideBlocking ? null : c.blocking;
        if (blocking == null && c.warnings.isEmpty) return const SizedBox.shrink();
        return Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (blocking != null)
                Text(blocking, style: small.copyWith(color: AppColors.danger, fontWeight: FontWeight.w600)),
              for (final w in c.warnings) Text(w, style: small.copyWith(color: AppColors.warning)),
            ],
          ),
        );
      },
    );
  }
}
