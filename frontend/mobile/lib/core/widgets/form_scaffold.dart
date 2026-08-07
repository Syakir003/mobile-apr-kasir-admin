import 'package:flutter/material.dart';

import '../theme/app_motion.dart';
import '../theme/app_theme.dart';
import 'app_card.dart';

/// Kerangka layar formulir: app bar, isi yang bisa digulir, dan bilah aksi
/// yang menempel di bawah.
///
/// Sebelumnya tiap form menaruh tombol "Simpan" sebagai widget terakhir di
/// dalam `ListView`. Pada form produk yang punya dua belas kolom, tombol itu
/// baru terlihat setelah menggulir habis — dan setelah memperbaiki satu
/// kesalahan validasi di kolom kedua, pengguna harus menggulir turun lagi.
/// Bilah yang menempel membuat aksi utama selalu terjangkau, dan karena
/// `bottomNavigationBar` ikut terangkat papan ketik, tombolnya tetap terlihat
/// saat mengetik.
///
/// Isi ([children]) adalah daftar widget untuk area gulir — bungkus kelompok
/// kolom dengan [AppFormCard].
class AppFormScaffold extends StatelessWidget {
  const AppFormScaffold({
    super.key,
    required this.title,
    required this.formKey,
    required this.children,
    required this.submitLabel,
    required this.onSubmit,
    this.busy = false,
    this.secondary,
    this.appBarActions,
    this.autovalidateMode = AutovalidateMode.onUserInteraction,
    this.submitKey,
  });

  final String title;
  final GlobalKey<FormState> formKey;
  final List<Widget> children;

  final String submitLabel;
  final VoidCallback? onSubmit;
  final Key? submitKey;

  /// Menonaktifkan aksi dan menampilkan indikator di dalam tombol.
  final bool busy;

  /// Aksi sekunder di kiri bilah (mis. "Reset Password", "Hapus").
  final Widget? secondary;

  final List<Widget>? appBarActions;
  final AutovalidateMode autovalidateMode;

  /// Lebar maksimum kolom isian. Di layar lebar, form selebar 1200px membuat
  /// mata harus melompat jauh antara label dan kolom.
  static const _maxWidth = 640.0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(title), actions: appBarActions),
      body: Form(
        key: formKey,
        // Pesan validasi hilang begitu field diperbaiki, tidak menunggu
        // tombol simpan ditekan lagi.
        autovalidateMode: autovalidateMode,
        child: LayoutBuilder(
          builder: (context, constraints) {
            final pad = constraints.maxWidth >= AppSpacing.wideBreakpoint
                ? 24.0
                : 16.0;
            return ListView(
              padding: EdgeInsets.fromLTRB(pad, pad, pad, pad + 8),
              children: [
                Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: _maxWidth),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: children,
                    ),
                  ),
                ),
              ],
            );
          },
        ),
      ),
      bottomNavigationBar: _ActionBar(
        submitLabel: submitLabel,
        submitKey: submitKey,
        onSubmit: onSubmit,
        busy: busy,
        secondary: secondary,
        maxWidth: _maxWidth,
      ),
    );
  }
}

class _ActionBar extends StatelessWidget {
  const _ActionBar({
    required this.submitLabel,
    required this.onSubmit,
    required this.busy,
    required this.secondary,
    required this.maxWidth,
    this.submitKey,
  });

  final String submitLabel;
  final VoidCallback? onSubmit;
  final bool busy;
  final Widget? secondary;
  final double maxWidth;
  final Key? submitKey;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: AppColors.mist)),
        boxShadow: [
          BoxShadow(
            color: Color(0x14006B5F),
            offset: Offset(0, -2),
            blurRadius: 12,
          ),
        ],
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          // `heightFactor: 1` wajib: `Scaffold` mengukur `bottomNavigationBar`
          // dengan tinggi longgar setinggi layar, dan `Center` tanpa faktor
          // akan memuai memenuhi tinggi itu — bilah aksi jadi menutupi seluruh
          // layar dan area isi tersisa nol piksel.
          child: Center(
            heightFactor: 1,
            child: ConstrainedBox(
              constraints: BoxConstraints(maxWidth: maxWidth),
              child: Row(
                children: [
                  if (secondary != null) ...[
                    secondary!,
                    const SizedBox(width: 12),
                  ],
                  Expanded(
                    child: SizedBox(
                      height: 48,
                      child: FilledButton(
                        key: submitKey,
                        onPressed: busy ? null : onSubmit,
                        // Label bertukar dengan indikator lewat cross-fade,
                        // jadi tombolnya tidak berkedip saat menyimpan.
                        child: AppSwap(
                          alignment: Alignment.center,
                          switchKey: busy,
                          child: busy
                              ? const SizedBox(
                                  height: 20,
                                  width: 20,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : Text(submitLabel),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Satu kelompok kolom dalam formulir.
///
/// Form yang panjang dipecah jadi beberapa kartu bertajuk ("Identitas",
/// "Harga & Stok") alih-alih satu kartu berisi dua belas kolom berderet —
/// satu blok panjang tidak memberi tahu apa pun tentang isinya.
class AppFormCard extends StatelessWidget {
  const AppFormCard({
    super.key,
    required this.children,
    this.title,
    this.subtitle,
  });

  final String? title;
  final String? subtitle;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final body = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: children,
    );

    if (title == null) return AppCard(child: body);
    return AppSectionCard(title: title!, subtitle: subtitle, child: body);
  }
}
