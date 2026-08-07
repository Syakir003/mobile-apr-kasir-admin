import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme/app_motion.dart';
import '../theme/app_theme.dart';

/// Jarak vertikal baku antar-field dalam satu form (31:1036).
const kFieldGap = 20.0;

/// Pembungkus satu baris form: label di atas, kolom isian di bawah.
///
/// Desain menaruh label **di luar** kolom (bukan floating label Material),
/// dengan tanda bintang merah untuk field wajib. Pola ini dipakai karena label
/// tetap terbaca setelah kolom terisi — pada floating label, label menyusut
/// jadi 12px dan sering terpotong pada nama field yang panjang.
///
/// Saat kolom di dalamnya mendapat fokus, muncul halo tipis di sekelilingnya.
class AppFormField extends StatefulWidget {
  const AppFormField({
    super.key,
    required this.label,
    required this.child,
    this.required = false,
    this.helper,
  });

  final String label;
  final Widget child;
  final bool required;

  /// Keterangan kecil di bawah kolom (mis. "Kosongkan bila tidak dipakai").
  final String? helper;

  @override
  State<AppFormField> createState() => _AppFormFieldState();
}

class _AppFormFieldState extends State<AppFormField> {
  bool _focused = false;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        // Label ikut menyala saat kolomnya fokus, jadi di form panjang selalu
        // jelas baris mana yang sedang diisi tanpa harus mencari kursor.
        AnimatedDefaultTextStyle(
          duration: AppDurations.quick,
          style: TextStyle(
            fontFamily: AppFonts.display,
            fontSize: 13,
            height: 19.5 / 13,
            fontWeight: _focused ? FontWeight.w600 : FontWeight.w500,
            color: _focused ? AppColors.tealDeep : AppColors.textBody,
          ),
          child: _Label(text: widget.label, required: widget.required),
        ),
        const SizedBox(height: 6),
        // Halo fokus digambar lewat `AnimatedContainer` di luar kolom karena
        // `InputDecoration` cuma bisa menggambar garis tepi, bukan bayangan.
        // Radiusnya harus sama dengan radius kolom (`AppRadius.md`), kalau
        // tidak halonya menyembul di sudut.
        Focus(
          canRequestFocus: false,
          skipTraversal: true,
          onFocusChange: (v) => setState(() => _focused = v),
          child: AnimatedContainer(
            duration: AppDurations.quick,
            curve: AppCurves.standard,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(AppRadius.md),
              boxShadow: _focused
                  ? const [
                      BoxShadow(color: AppColors.focusRing, blurRadius: 0, spreadRadius: 3),
                    ]
                  : const [],
            ),
            child: widget.child,
          ),
        ),
        if (widget.helper != null) ...[
          const SizedBox(height: 6),
          Text(
            widget.helper!,
            style: const TextStyle(
              fontFamily: AppFonts.body,
              fontSize: 12,
              height: 16 / 12,
              color: AppColors.textMuted,
            ),
          ),
        ],
      ],
    );
  }
}

class _Label extends StatelessWidget {
  const _Label({required this.text, required this.required});

  final String text;
  final bool required;

  @override
  Widget build(BuildContext context) {
    // Gaya dasarnya datang dari `AnimatedDefaultTextStyle` di induk supaya
    // warna & tebalnya bisa beranimasi saat kolom mendapat fokus; di sini
    // hanya tanda bintangnya yang diwarnai sendiri.
    return Text.rich(
      TextSpan(
        text: text,
        children: required
            ? const [
                TextSpan(
                  text: ' *',
                  style: TextStyle(color: AppColors.requiredMark),
                ),
              ]
            : null,
      ),
    );
  }
}

/// Kolom teks satu baris dengan label di atas.
class AppTextField extends StatelessWidget {
  const AppTextField({
    super.key,
    this.fieldKey,
    required this.label,
    this.controller,
    this.hint,
    this.helper,
    this.required = false,
    this.validator,
    this.keyboardType,
    this.textInputAction,
    this.obscureText = false,
    this.enabled = true,
    this.readOnly = false,
    this.maxLines = 1,
    this.prefixIcon,
    this.suffixIcon,
    this.suffixText,
    this.onChanged,
    this.onFieldSubmitted,
    this.autofillHints,
    this.inputFormatters,
  });

  final String label;

  /// Key untuk `TextFormField`/`DropdownButtonFormField` **di dalam** widget
  /// ini, bukan untuk widget ini sendiri.
  ///
  /// Dipakai kalau pemanggil perlu memeriksa properti kolom aslinya (mis. uji
  /// yang membaca `enabled` atau `onChanged`); untuk sekadar mengetik atau
  /// menekan, `key` biasa di widget ini sudah cukup.
  final Key? fieldKey;

  final TextEditingController? controller;
  final String? hint;
  final String? helper;
  final bool required;
  final String? Function(String?)? validator;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final bool obscureText;
  final bool enabled;

  /// Kolom tetap terlihat normal tapi tidak bisa disunting — untuk nilai yang
  /// datang dari tempat lain (mis. nama pelanggan yang diambil dari member).
  final bool readOnly;

  final int maxLines;
  final Widget? prefixIcon;
  final Widget? suffixIcon;

  /// Satuan di ujung kanan kolom (mis. "min", "pcs"). Dirender sebagai
  /// `suffixIcon`, bukan `suffixText`, karena Material menyembunyikan
  /// `suffixText` selama kolom kosong dan tidak fokus — padahal satuannya
  /// justru paling membantu saat kolom masih kosong.
  final String? suffixText;

  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onFieldSubmitted;
  final List<String>? autofillHints;
  final List<TextInputFormatter>? inputFormatters;

  @override
  Widget build(BuildContext context) {
    return AppFormField(
      label: label,
      required: required,
      helper: helper,
      child: TextFormField(
        key: fieldKey,
        controller: controller,
        validator: validator,
        keyboardType: keyboardType,
        textInputAction: textInputAction,
        obscureText: obscureText,
        enabled: enabled,
        readOnly: readOnly,
        maxLines: obscureText ? 1 : maxLines,
        onChanged: onChanged,
        onFieldSubmitted: onFieldSubmitted,
        autofillHints: autofillHints,
        inputFormatters: inputFormatters,
        style: const TextStyle(
          fontFamily: AppFonts.body,
          fontSize: 16,
          height: 24 / 16,
          color: AppColors.textInk,
        ),
        decoration: InputDecoration(
          hintText: hint,
          prefixIcon: prefixIcon,
          suffixIcon: suffixIcon ??
              (suffixText == null
                  ? null
                  : Padding(
                      padding: const EdgeInsets.only(left: 8, right: 16),
                      child: Text(
                        suffixText!,
                        style: const TextStyle(
                          fontFamily: AppFonts.body,
                          fontSize: 16,
                          height: 24 / 16,
                          color: AppColors.inputPlaceholder,
                        ),
                      ),
                    )),
          suffixIconConstraints:
              const BoxConstraints(minWidth: 0, minHeight: 0),
        ),
      ),
    );
  }
}

/// Kolom angka: papan ketik numerik, hanya menerima digit (dan titik desimal
/// bila [decimal]), dan nilainya dirender monospace supaya deretan angka pada
/// satu form berbaris rata.
///
/// Sebelum ada widget ini tiap form menuliskan sendiri `keyboardType` +
/// `inputFormatters` + validator angka — sebelas kali di form produk saja, dan
/// tidak selalu sama.
class AppNumberField extends StatelessWidget {
  const AppNumberField({
    super.key,
    this.fieldKey,
    required this.label,
    this.controller,
    this.hint,
    this.helper,
    this.required = false,
    this.decimal = false,
    this.validator,
    this.enabled = true,
    this.suffixText,
    this.onChanged,
  });

  final String label;

  /// Key untuk `TextFormField`/`DropdownButtonFormField` **di dalam** widget
  /// ini, bukan untuk widget ini sendiri.
  ///
  /// Dipakai kalau pemanggil perlu memeriksa properti kolom aslinya (mis. uji
  /// yang membaca `enabled` atau `onChanged`); untuk sekadar mengetik atau
  /// menekan, `key` biasa di widget ini sudah cukup.
  final Key? fieldKey;

  final TextEditingController? controller;
  final String? hint;
  final String? helper;
  final bool required;

  /// Izinkan titik desimal (mis. PK, qty dalam kg).
  final bool decimal;

  final String? Function(String?)? validator;
  final bool enabled;

  /// Satuan di ujung kanan (mis. "menit", "pcs", "%").
  final String? suffixText;

  final ValueChanged<String>? onChanged;

  @override
  Widget build(BuildContext context) {
    return AppFormField(
      label: label,
      required: required,
      helper: helper,
      child: TextFormField(
        key: fieldKey,
        controller: controller,
        validator: validator,
        enabled: enabled,
        onChanged: onChanged,
        keyboardType: TextInputType.numberWithOptions(decimal: decimal),
        inputFormatters: [
          decimal
              ? FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))
              : FilteringTextInputFormatter.digitsOnly,
        ],
        style: AppTextStyles.monoCode.copyWith(fontSize: 15),
        decoration: InputDecoration(
          hintText: hint,
          hintStyle: AppTextStyles.monoCode.copyWith(
            fontSize: 15,
            color: AppColors.inputPlaceholder,
          ),
          suffixIcon: suffixText == null
              ? null
              : Padding(
                  padding: const EdgeInsets.only(left: 8, right: 16),
                  child: Text(
                    suffixText!,
                    style: const TextStyle(
                      fontFamily: AppFonts.body,
                      fontSize: 14,
                      height: 24 / 14,
                      color: AppColors.inputPlaceholder,
                    ),
                  ),
                ),
          suffixIconConstraints:
              const BoxConstraints(minWidth: 0, minHeight: 0),
        ),
      ),
    );
  }
}

/// Kolom password dengan tombol lihat/sembunyikan.
///
/// Tanpa tombol ini pengguna tidak punya cara memeriksa apa yang diketiknya —
/// keluhan yang wajar pada perangkat kasir bertuts kecil, dan penyebab paling
/// sering "password salah" yang sebenarnya salah ketik.
class AppPasswordField extends StatefulWidget {
  const AppPasswordField({
    super.key,
    this.fieldKey,
    required this.label,
    this.controller,
    this.hint,
    this.helper,
    this.required = false,
    this.validator,
    this.enabled = true,
    this.textInputAction,
    this.onFieldSubmitted,
    this.autofillHints,
  });

  final String label;

  /// Diteruskan ke `TextFormField` di dalamnya — lihat [AppTextField.fieldKey].
  final Key? fieldKey;

  final TextEditingController? controller;
  final String? hint;
  final String? helper;
  final bool required;
  final String? Function(String?)? validator;
  final bool enabled;
  final TextInputAction? textInputAction;
  final ValueChanged<String>? onFieldSubmitted;
  final List<String>? autofillHints;

  @override
  State<AppPasswordField> createState() => _AppPasswordFieldState();
}

class _AppPasswordFieldState extends State<AppPasswordField> {
  bool _hidden = true;

  @override
  Widget build(BuildContext context) {
    return AppTextField(
      fieldKey: widget.fieldKey,
      label: widget.label,
      controller: widget.controller,
      hint: widget.hint,
      helper: widget.helper,
      required: widget.required,
      validator: widget.validator,
      enabled: widget.enabled,
      obscureText: _hidden,
      textInputAction: widget.textInputAction,
      onFieldSubmitted: widget.onFieldSubmitted,
      autofillHints: widget.autofillHints,
      suffixIcon: IconButton(
        icon: Icon(
          _hidden ? Icons.visibility_outlined : Icons.visibility_off_outlined,
          size: 20,
        ),
        tooltip: _hidden ? 'Tampilkan password' : 'Sembunyikan password',
        onPressed: () => setState(() => _hidden = !_hidden),
      ),
    );
  }
}

/// Kolom nominal rupiah: prefiks "Rp", angka monospace, pemisah ribuan
/// otomatis. Nilai dibaca kembali lewat [parseRupiahInput].
class AppMoneyField extends StatelessWidget {
  const AppMoneyField({
    super.key,
    this.fieldKey,
    required this.label,
    this.controller,
    this.hint = '0',
    this.helper,
    this.required = false,
    this.validator,
    this.enabled = true,
    this.onChanged,
  });

  final String label;

  /// Key untuk `TextFormField`/`DropdownButtonFormField` **di dalam** widget
  /// ini, bukan untuk widget ini sendiri.
  ///
  /// Dipakai kalau pemanggil perlu memeriksa properti kolom aslinya (mis. uji
  /// yang membaca `enabled` atau `onChanged`); untuk sekadar mengetik atau
  /// menekan, `key` biasa di widget ini sudah cukup.
  final Key? fieldKey;

  final TextEditingController? controller;
  final String? hint;
  final String? helper;
  final bool required;
  final String? Function(String?)? validator;
  final bool enabled;
  final ValueChanged<String>? onChanged;

  @override
  Widget build(BuildContext context) {
    return AppFormField(
      label: label,
      required: required,
      helper: helper,
      child: TextFormField(
        key: fieldKey,
        controller: controller,
        validator: validator,
        enabled: enabled,
        onChanged: onChanged,
        keyboardType: const TextInputType.numberWithOptions(decimal: false),
        inputFormatters: [ThousandsSeparatorFormatter()],
        style: AppTextStyles.monoCode.copyWith(fontSize: 15),
        decoration: InputDecoration(
          hintText: hint,
          hintStyle: AppTextStyles.monoCode.copyWith(
            fontSize: 15,
            color: AppColors.inputPlaceholder,
          ),
          prefixIcon: const Padding(
            padding: EdgeInsets.only(left: 16, right: 8),
            child: Text('Rp', style: TextStyle(
              fontFamily: AppFonts.mono,
              fontSize: 14,
              height: 21 / 14,
              color: AppColors.inputPlaceholder,
            )),
          ),
          prefixIconConstraints: const BoxConstraints(minWidth: 0, minHeight: 0),
        ),
      ),
    );
  }
}

/// Sisipkan titik sebagai pemisah ribuan sambil mempertahankan posisi kursor
/// relatif terhadap jumlah digit di kanannya.
class ThousandsSeparatorFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    final digits = newValue.text.replaceAll(RegExp(r'[^0-9]'), '');
    if (digits.isEmpty) {
      return const TextEditingValue(text: '');
    }

    final buffer = StringBuffer();
    for (var i = 0; i < digits.length; i++) {
      if (i > 0 && (digits.length - i) % 3 == 0) buffer.write('.');
      buffer.write(digits[i]);
    }
    final text = buffer.toString();

    // Hitung ulang posisi kursor dari jumlah digit setelahnya supaya kursor
    // tidak melompat ke ujung setiap kali titik disisipkan.
    final digitsAfterCursor = newValue.text
        .substring(newValue.selection.end)
        .replaceAll(RegExp(r'[^0-9]'), '')
        .length;
    var offset = text.length;
    var seen = 0;
    for (var i = text.length - 1; i >= 0 && seen < digitsAfterCursor; i--) {
      if (RegExp(r'[0-9]').hasMatch(text[i])) seen++;
      offset = i;
    }

    return TextEditingValue(
      text: text,
      selection: TextSelection.collapsed(offset: offset.clamp(0, text.length)),
    );
  }
}

/// Baca nilai [AppMoneyField] jadi bilangan bulat.
int parseRupiahInput(String text) =>
    int.tryParse(text.replaceAll(RegExp(r'[^0-9]'), '')) ?? 0;

/// Kebalikan [parseRupiahInput]: siapkan teks awal `TextEditingController`
/// sebuah [AppMoneyField] dari nilai tersimpan.
///
/// Tanpa ini kolom edit menampilkan `150000` polos sampai pengguna
/// menyentuhnya — pemisah ribuan baru muncul saat diketik ulang.
String formatRupiahInput(int value) {
  final digits = '$value'.replaceAll(RegExp(r'[^0-9]'), '');
  if (digits.isEmpty) return '';
  final buffer = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buffer.write('.');
    buffer.write(digits[i]);
  }
  return buffer.toString();
}

/// Validator wajib-isi untuk [AppMoneyField]; angkanya sudah dijamin digit
/// oleh formatter, jadi yang perlu dicek hanya kekosongan.
String? rupiahRequiredValidator(String? v) =>
    (v == null || v.trim().isEmpty) ? 'Wajib diisi' : null;

/// Dropdown dengan label di atas, disamakan dengan kolom teks.
class AppSelectField<T> extends StatelessWidget {
  const AppSelectField({
    super.key,
    this.fieldKey,
    required this.label,
    required this.items,
    required this.onChanged,
    this.value,
    this.hint,
    this.helper,
    this.required = false,
    this.validator,
    this.enabled = true,
  });

  final String label;

  /// Key untuk `TextFormField`/`DropdownButtonFormField` **di dalam** widget
  /// ini, bukan untuk widget ini sendiri.
  ///
  /// Dipakai kalau pemanggil perlu memeriksa properti kolom aslinya (mis. uji
  /// yang membaca `enabled` atau `onChanged`); untuk sekadar mengetik atau
  /// menekan, `key` biasa di widget ini sudah cukup.
  final Key? fieldKey;

  final List<DropdownMenuItem<T>> items;
  final ValueChanged<T?>? onChanged;
  final T? value;
  final String? hint;
  final String? helper;
  final bool required;
  final String? Function(T?)? validator;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return AppFormField(
      label: label,
      required: required,
      helper: helper,
      child: DropdownButtonFormField<T>(
        key: fieldKey,
        initialValue: value,
        items: items,
        onChanged: enabled ? onChanged : null,
        validator: validator,
        isExpanded: true,
        icon: const Icon(Icons.keyboard_arrow_down, size: 20),
        style: const TextStyle(
          fontFamily: AppFonts.body,
          fontSize: 16,
          height: 24 / 16,
          color: AppColors.textInk,
        ),
        hint: hint == null ? null : Text(hint!),
        decoration: const InputDecoration(),
      ),
    );
  }
}

/// Baris sakelar dengan judul + keterangan, dipisah garis di atasnya —
/// mengikuti "Field: Status Toggle" (31:1084).
class AppSwitchTile extends StatelessWidget {
  const AppSwitchTile({
    super.key,
    required this.title,
    required this.value,
    required this.onChanged,
    this.subtitle,
    this.divider = true,
  });

  final String title;
  final String? subtitle;
  final bool value;
  final ValueChanged<bool>? onChanged;
  final bool divider;

  @override
  Widget build(BuildContext context) {
    final row = Padding(
      // Padding kanan lebih kecil karena `Switch` sudah punya ruang sendiri.
      padding: const EdgeInsets.fromLTRB(4, 10, 0, 6),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontFamily: AppFonts.display,
                    fontSize: 14,
                    height: 21 / 14,
                    color: AppColors.textInk,
                  ),
                ),
                if (subtitle != null)
                  Text(
                    subtitle!,
                    style: const TextStyle(
                      fontFamily: AppFonts.body,
                      fontSize: 13,
                      height: 18 / 13,
                      color: AppColors.helperInk,
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 16),
          // Sakelar dimatikan lewat `IgnorePointer` supaya tap-nya ditangani
          // baris (lihat di bawah) dan tidak ada dua target sentuh bertumpuk.
          IgnorePointer(
            child: Switch(value: value, onChanged: onChanged),
          ),
        ],
      ),
    );

    // Seluruh baris jadi target sentuh, bukan cuma sakelar selebar 50px —
    // konsisten dengan `SwitchListTile` yang digantikannya.
    final tappable = onChanged == null
        ? Opacity(opacity: 0.6, child: row)
        : InkWell(
            onTap: () => onChanged!(!value),
            borderRadius: BorderRadius.circular(AppRadius.md),
            child: row,
          );

    return Material(
      type: MaterialType.transparency,
      child: Container(
        decoration: divider
            ? const BoxDecoration(
                border: Border(
                  top: BorderSide(color: Color(0x80D4E6E4)),
                ),
              )
            : null,
        child: tappable,
      ),
    );
  }
}
