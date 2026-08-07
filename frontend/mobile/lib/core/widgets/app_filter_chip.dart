import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// Pill filter/segmen yang bisa dipilih — terpilih memakai Teal Deep solid,
/// selainnya putih dengan garis tepi hairline.
///
/// Menggantikan `_Chip` / `_FilterChip` / `_Seg` yang sebelumnya ditulis ulang
/// hampir identik di beberapa layar dengan padding & ukuran teks berbeda-beda.
class AppFilterChip extends StatelessWidget {
  const AppFilterChip({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? AppColors.tealDeep : Colors.white,
      borderRadius: BorderRadius.circular(AppRadius.pill),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.pill),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppRadius.pill),
            border: Border.all(
              color: selected ? AppColors.tealDeep : AppColors.hairline,
            ),
          ),
          child: Text(
            label,
            style: TextStyle(
              fontFamily: AppFonts.body,
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: selected ? Colors.white : AppColors.slate600,
            ),
          ),
        ),
      ),
    );
  }
}

/// Baris [AppFilterChip] yang bisa digeser mendatar.
///
/// Ada karena tiap layar sebelumnya membungkus chip-nya sendiri dalam
/// `SizedBox(height: …)` + `ListView` mendatar dengan angka tinggi yang
/// ditebak — dan tebakannya kekecilan. Satu chip butuh ±37px (padding 8+8,
/// teks 13px, border 1+1); tinggi 46 dikurangi padding vertikal 7+7 hanya
/// menyisakan 32px, sehingga ekor huruf pada "Belum Dibayar" & "Pengajuan"
/// terpotong.
///
/// Di sini tinggi TIDAK dikunci sama sekali: `SingleChildScrollView` + `Row`
/// membiarkan chip menentukan tingginya sendiri, jadi tak ada angka ajaib yang
/// bisa salah lagi saat ukuran font atau padding chip berubah.
class AppFilterChipBar extends StatelessWidget {
  const AppFilterChipBar({
    super.key,
    required this.children,
    this.padding = const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
    this.spacing = 8,
  });

  final List<Widget> children;
  final EdgeInsetsGeometry padding;
  final double spacing;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: padding,
      child: Row(
        children: [
          for (var i = 0; i < children.length; i++) ...[
            if (i > 0) SizedBox(width: spacing),
            children[i],
          ],
        ],
      ),
    );
  }
}
