import 'package:flutter/material.dart';

import 'app_motion.dart';

/// Design system "Corporate Modernism" — mengikuti frame
/// `Style Guide: DealDeck E-POS AC` (node 78:5723) di file Figma "Epos".
///
/// Semua nilai di bawah diambil langsung dari Figma. Nama token lama (ramp
/// `teal*` / `slate*` ala Tailwind) sengaja dipertahankan sebagai alias supaya
/// ~360 pemakaian di `lib/features/**` ikut berubah tanpa perlu disentuh.
abstract final class AppColors {
  // ---------------------------------------------------------------------------
  // Palet inti (Color Palette pada style guide)
  // ---------------------------------------------------------------------------
  static const ink = Color(0xFF0B1B1A);
  static const tealDeep = Color(0xFF0B6B62); // aksi utama, sidebar
  static const tealBright = Color(0xFF14B8A6); // aksen, ujung gradient
  static const mist = Color(0xFFEAF6F4); // permukaan teal lembut
  static const cloud = Color(0xFFF6F8F8); // background halaman
  static const successGreen = Color(0xFF16A34A);
  static const amber = Color(0xFFF59E0B);
  static const coral = Color(0xFFDC2626);

  /// Turunan yang dipakai style guide tapi tidak masuk daftar swatch.
  static const tealMid = Color(0xFF109284); // titik tengah gradient kartu
  static const tealDark = Color(0xFF085A52); // penekanan / state pressed
  static const tealPale = Color(0xFF99E8DD); // label di atas kartu gradient
  static const tealHaze = Color(0xFFEBFDFB); // caption di atas kartu gradient
  static const mistDeep = Color(0xFFE5F7F5); // latar blok monospace
  static const hairline = Color(0xFFD4E6E4); // border & divider utama

  // Teks
  static const textInk = Color(0xFF0E1E1D); // heading
  static const textBody = Color(0xFF3E4947); // paragraf
  static const textMuted = Color(0xFF6F7977); // caption / label sekunder

  // ---------------------------------------------------------------------------
  // Alias ramp teal (kompat dengan kode lama)
  // ---------------------------------------------------------------------------
  static const teal50 = mist;
  static const teal100 = hairline;
  static const teal500 = tealBright;
  static const teal600 = tealDeep; // elemen interaktif utama
  static const teal700 = tealDark; // penekanan / grafik
  static const teal800 = Color(0xFF06463F);
  static const primaryTeal = tealDeep;

  // ---------------------------------------------------------------------------
  // Alias ramp netral (kompat) — netral bernuansa teal sesuai style guide
  // ---------------------------------------------------------------------------
  static const slate50 = cloud;
  static const slate100 = Color(0xFFEDF2F1);
  static const slate200 = hairline;
  static const slate300 = Color(0xFFBCD2CF);
  static const slate400 = Color(0xFF8E9C99);
  static const slate500 = textMuted;
  static const slate600 = Color(0xFF55625F);
  static const slate700 = textBody;
  static const slate900 = textInk;

  // ---------------------------------------------------------------------------
  // Aksen & semantik
  // ---------------------------------------------------------------------------
  static const blue600 = Color(0xFF2563EB);
  static const indigo600 = Color(0xFF4F46E5);
  static const orange600 = Color(0xFFEA580C);
  static const green600 = successGreen;
  static const red600 = coral;

  static const background = cloud;
  static const surface = Colors.white;
  static const border = hairline;
  static const textPrimary = textInk;
  static const textSecondary = textMuted;
  static const danger = coral;
  static const warning = amber;
  static const success = successGreen;
  static const accentCyan = tealBright;
  static const darkTeal = teal800;
  static const softTeal = mist;

  // ---------------------------------------------------------------------------
  // Warna dengan alpha (const, sesuai rgba() di Figma)
  // ---------------------------------------------------------------------------
  /// `rgba(11,107,98,0.2)` — border tombol sekunder.
  static const tealDeepOutline = Color(0x330B6B62);

  /// `rgba(62,73,71,0.5)` — label tombol nonaktif.
  static const disabledLabel = Color(0x803E4947);

  /// `rgba(0,107,95,0.15)` — bayangan kartu standar.
  static const shadowSoft = Color(0x26006B5F);

  /// `rgba(0,107,95,0.25)` — bayangan kartu gradient / elevasi tinggi.
  static const shadowStrong = Color(0x40006B5F);

  // ---------------------------------------------------------------------------
  // Permukaan bernada — panel info/peringatan
  //
  // Latar memakai alpha 10% seperti badge status pada style guide, garis tepi
  // 25%. Teks panel memakai `*Ink` (bukan warna penuh seperti badge) karena
  // kalimat panjang berukuran 13px butuh kontras lebih tinggi daripada label
  // badge yang cuma satu-dua kata.
  // ---------------------------------------------------------------------------
  static const amberSurface = Color(0x1AF59E0B);
  static const amberBorder = Color(0x40F59E0B);
  static const amberInk = Color(0xFF8A5206);

  static const dangerSurface = Color(0x1ADC2626);
  static const dangerBorder = Color(0x40DC2626);
  static const dangerInk = Color(0xFF9B1C1C);

  static const successSurface = Color(0x1A16A34A);
  static const successBorder = Color(0x4016A34A);
  static const successInk = Color(0xFF15803D);

  /// Permukaan bernada merek — sama dengan Mist pada style guide.
  static const tealSurface = mist;
  static const tealBorder = tealDeepOutline;
  static const tealInk = tealDeep;

  // ---------------------------------------------------------------------------
  // Shell aplikasi — sidebar & top app bar (frame Dashboard 10:267 / 10:5)
  // ---------------------------------------------------------------------------
  /// Brand & tab aktif pada top app bar.
  static const navBrand = Color(0xFF00514A);

  /// Tombol CTA sidebar dan teks menu aktif.
  static const navAccent = Color(0xFF006B5F);

  /// Cincin avatar pada header sidebar.
  static const navAvatarRing = Color(0xFF71F8E4);

  /// Teks menu non-aktif di sidebar — Teal Pale 80%.
  static const navMuted = Color(0xCC99E8DD);

  /// Garis pemisah footer sidebar — Teal Pale 10%.
  static const navDivider = Color(0x1A99E8DD);

  /// Titik notifikasi pada tombol lonceng.
  static const notifDot = Color(0xFFBA1A1A);

  /// Latar top app bar — Teal Haze 80% (di desain memakai backdrop blur).
  static const topBarSurface = Color(0xCCEBFDFB);

  /// Garis tepi kolom pencarian pada top app bar.
  static const searchBorder = Color(0x4DBEC9C6);

  // ---------------------------------------------------------------------------
  // Kartu metrik & tombol halaman (frame Dashboard 10:31 / 10:46)
  // ---------------------------------------------------------------------------
  /// Garis tepi tipis kartu metrik — `rgba(190,201,198,0.2)`.
  static const cardHairline = Color(0x33BEC9C6);

  /// Latar tombol aksi pada header halaman (mis. "Ekspor Laporan").
  static const pageActionSurface = Color(0xFFDFF2EF);

  /// Badge "PERLU AKSI" pada kartu metrik peringatan.
  static const alertBadgeSurface = Color(0xFFFFF8E1);
  static const alertBadgeInk = Color(0xFFF57F17);

  /// Sub-teks pada kartu metrik gradient.
  static const metricAccent = navAvatarRing;

  // ---------------------------------------------------------------------------
  // Tabel data (frame Recent Transactions Table 10:185)
  // ---------------------------------------------------------------------------
  /// Latar baris header tabel — `rgba(223,242,239,0.3)`.
  static const tableHeader = Color(0x4DDFF2EF);

  /// Avatar inisial: abu kehijauan, dan varian terang untuk baris teratas.
  static const avatarSurface = Color(0xFFDAECEA);
  static const avatarHighlight = Color(0xFF6DF5E1);
  static const avatarHighlightInk = Color(0xFF006F64);

  // ---------------------------------------------------------------------------
  // Input & form (frame Form 31:1036)
  // ---------------------------------------------------------------------------
  /// Latar kolom isian — teal sangat muda, bukan putih.
  static const inputSurface = mistDeep;

  /// Teks placeholder dan satuan/prefiks yang belum terisi.
  static const inputPlaceholder = Color(0xFFBEC9C6);

  /// Tanda bintang pada label wajib isi.
  static const requiredMark = notifDot;

  /// Teks bantuan di bawah label pada baris pengaturan.
  static const helperInk = Color(0xCC3E4947);

  /// Halo tipis di sekeliling kolom saat fokus.
  static const focusRing = Color(0x330B6B62);
}

abstract final class AppFonts {
  /// Heading & label tombol.
  static const display = 'PlusJakartaSans';

  /// Body, caption, tabel.
  static const body = 'Inter';

  /// Hanya untuk nilai uang, kode, dan barcode.
  static const mono = 'JetBrainsMono';
}

abstract final class AppRadius {
  static const sm = 8.0; // blok kode, ikon kecil
  static const md = 12.0; // field input
  static const lg = 16.0;
  static const xl = 20.0; // kartu — radius standar style guide
  static const pill = 999.0; // tombol & badge
}

/// Irama spasi halaman. Desain memakai canvas 1020px dengan padding 40px dan
/// jarak antar-bagian 24px; di layar sempit padding turun ke 20px supaya kartu
/// tidak tinggal separuh lebar.
abstract final class AppSpacing {
  /// Ambang layar lebar — sama dengan ambang sidebar pada `AdaptiveScaffold`.
  static const wideBreakpoint = 800.0;

  static const pageNarrow = 20.0;
  static const pageWide = 40.0;

  /// Jarak vertikal antar-bagian besar (header → metrik → grafik → tabel).
  static const section = 24.0;

  /// Jarak antar-kartu di dalam satu grid.
  static const grid = 16.0;

  /// Padding dalam kartu.
  static const card = 24.0;

  static double pageFor(double width) =>
      width >= wideBreakpoint ? pageWide : pageNarrow;
}

abstract final class AppShadows {
  /// Soft teal drop shadow kartu standar: `0 4px 10px rgba(0,107,95,0.15)`.
  static const card = <BoxShadow>[
    BoxShadow(
      color: AppColors.shadowSoft,
      offset: Offset(0, 4),
      blurRadius: 10,
    ),
  ];

  /// Kartu gradient / elemen terangkat: `0 8px 40px rgba(0,107,95,0.25)`.
  static const elevated = <BoxShadow>[
    BoxShadow(
      color: AppColors.shadowStrong,
      offset: Offset(0, 8),
      blurRadius: 40,
    ),
  ];

  /// Kartu metrik & permukaan putih.
  ///
  /// Desain menuliskannya sebagai satu bayangan (`4px 4px 10px` / `4px 4px
  /// 20px` pada 5% teal). Di sini dipecah jadi dua lapis — satu rapat untuk
  /// mengangkat tepi kartu, satu lebar dan sangat tipis untuk melembutkan
  /// batasnya — karena satu bayangan tunggal membuat kartu terlihat seperti
  /// kotak yang ditempel.
  static const metric = <BoxShadow>[
    BoxShadow(
      color: Color(0x14006B5F),
      offset: Offset(0, 2),
      blurRadius: 8,
    ),
    BoxShadow(
      color: Color(0x0A006B5F),
      offset: Offset(4, 8),
      blurRadius: 24,
    ),
  ];

  /// Kartu metrik unggulan: `4px 4px 20px rgba(0,107,95,0.2)`.
  static const metricFeatured = <BoxShadow>[
    BoxShadow(
      color: Color(0x33006B5F),
      offset: Offset(4, 4),
      blurRadius: 20,
    ),
  ];

  /// Kartu yang sedang dilewati kursor — [metric] yang dilebarkan & dipekatkan
  /// sedikit. Perbedaannya harus halus: kartu terangkat, bukan menyala.
  static const metricHover = <BoxShadow>[
    BoxShadow(
      color: Color(0x1F006B5F),
      offset: Offset(0, 6),
      blurRadius: 16,
    ),
    BoxShadow(
      color: Color(0x14006B5F),
      offset: Offset(4, 14),
      blurRadius: 32,
    ),
  ];
}

abstract final class AppGradients {
  /// Gradient kartu statistik: terang di sudut kanan atas menuju teal deep.
  static const statCard = RadialGradient(
    center: Alignment.topRight,
    radius: 1.4,
    colors: [AppColors.tealBright, AppColors.tealMid, AppColors.tealDeep],
    stops: [0, 0.5, 1],
  );

  /// Kartu metrik unggulan pada dashboard (10:47): linear 147.88°.
  static const metricFeatured = LinearGradient(
    begin: Alignment(-0.86, -1),
    end: Alignment(0.86, 1),
    colors: [AppColors.tealDeep, AppColors.navAccent],
  );
}

/// Gaya teks yang tidak terwakili slot `TextTheme` bawaan Material.
abstract final class AppTextStyles {
  /// Kode / invoice: JetBrains Mono Medium 14/20, tracking -0.14.
  static const monoCode = TextStyle(
    fontFamily: AppFonts.mono,
    fontSize: 14,
    height: 20 / 14,
    fontWeight: FontWeight.w500,
    letterSpacing: -0.14,
    color: AppColors.textInk,
  );

  /// Nominal rupiah: JetBrains Mono Bold 20/28.
  static const monoAmount = TextStyle(
    fontFamily: AppFonts.mono,
    fontSize: 20,
    height: 28 / 20,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.2,
    color: AppColors.textInk,
  );

  /// Nominal besar pada kartu statistik: JetBrains Mono 40/50.
  static const monoDisplay = TextStyle(
    fontFamily: AppFonts.mono,
    fontSize: 40,
    height: 50 / 40,
    fontWeight: FontWeight.w500,
    color: Colors.white,
  );

  /// Caption miring — "used only for monetary values, codes, and barcodes".
  static const captionItalic = TextStyle(
    fontFamily: AppFonts.body,
    fontSize: 12,
    height: 16 / 12,
    fontStyle: FontStyle.italic,
    color: AppColors.textBody,
  );
}

/// Nada badge status pada style guide (Pending / Disetujui-Lunas / Ditolak /
/// Draft). Setiap nada = latar 10% + titik & teks berwarna penuh.
enum AppBadgeTone { pending, success, danger, draft }

extension AppBadgeToneColors on AppBadgeTone {
  Color get background => switch (this) {
        AppBadgeTone.pending => const Color(0x1AF59E0B),
        AppBadgeTone.success => const Color(0x1A16A34A),
        AppBadgeTone.danger => const Color(0x1ADC2626),
        AppBadgeTone.draft => AppColors.hairline,
      };

  Color get foreground => switch (this) {
        AppBadgeTone.pending => AppColors.amber,
        AppBadgeTone.success => AppColors.successGreen,
        AppBadgeTone.danger => AppColors.coral,
        AppBadgeTone.draft => AppColors.textBody,
      };

  Color get dot => switch (this) {
        AppBadgeTone.draft => AppColors.textMuted,
        _ => foreground,
      };
}

/// Varian tombol yang tidak punya slot tema sendiri di Material.
abstract final class AppButtonStyles {
  static const _shape = RoundedRectangleBorder(
    borderRadius: BorderRadius.all(Radius.circular(AppRadius.pill)),
  );

  static const _label = TextStyle(
    fontFamily: AppFonts.display,
    fontSize: 15,
    height: 20 / 15,
    fontWeight: FontWeight.w500,
  );

  /// Aksi merusak: latar putih, border & teks coral.
  static ButtonStyle destructive() => OutlinedButton.styleFrom(
        backgroundColor: Colors.white,
        foregroundColor: AppColors.coral,
        side: const BorderSide(color: AppColors.coral),
        padding: const EdgeInsets.symmetric(horizontal: 25, vertical: 11),
        textStyle: _label,
        shape: _shape,
      );

  /// Aksi sekunder di atas permukaan gelap/teal.
  static ButtonStyle onTeal() => FilledButton.styleFrom(
        backgroundColor: Colors.white,
        foregroundColor: AppColors.tealDeep,
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 10),
        textStyle: _label,
        shape: _shape,
      );
}

abstract final class AppTheme {
  static ThemeData light() {
    final scheme = ColorScheme.fromSeed(
      seedColor: AppColors.tealDeep,
      brightness: Brightness.light,
    ).copyWith(
      primary: AppColors.tealDeep,
      onPrimary: Colors.white,
      primaryContainer: AppColors.mist,
      onPrimaryContainer: AppColors.tealDeep,
      secondary: AppColors.tealBright,
      onSecondary: Colors.white,
      surface: Colors.white,
      onSurface: AppColors.textInk,
      onSurfaceVariant: AppColors.textBody,
      surfaceContainerLowest: Colors.white,
      surfaceContainerLow: AppColors.cloud,
      surfaceContainerHighest: AppColors.slate100,
      outline: AppColors.hairline,
      outlineVariant: AppColors.hairline,
      error: AppColors.coral,
      shadow: AppColors.shadowSoft,
    );

    final base = ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      fontFamily: AppFonts.body,
    );

    // Desain menggambar kolom isian dengan radius 8px. Dipakai 12px di sini:
    // pada satu layar form, deretan kotak ber-radius 8 di dalam kartu
    // ber-radius 20 membaca sebagai kotak-kotak tegas yang ditempel — jarak
    // dua langkah pada skala radius terlalu jauh. 12px masih jelas lebih kecil
    // daripada kartu, tapi mengikuti lengkung yang sama.
    OutlineInputBorder border(Color c, [double w = 1]) => OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.md),
          borderSide: BorderSide(color: c, width: w),
        );

    return base.copyWith(
      scaffoldBackgroundColor: AppColors.cloud,

      // Satu transisi halaman untuk semua platform; lihat `app_motion.dart`.
      pageTransitionsTheme: const PageTransitionsTheme(
        builders: <TargetPlatform, PageTransitionsBuilder>{
          TargetPlatform.android: AppPageTransitionsBuilder(),
          TargetPlatform.iOS: AppPageTransitionsBuilder(),
          TargetPlatform.windows: AppPageTransitionsBuilder(),
          TargetPlatform.macOS: AppPageTransitionsBuilder(),
          TargetPlatform.linux: AppPageTransitionsBuilder(),
          TargetPlatform.fuchsia: AppPageTransitionsBuilder(),
        },
      ),
      dividerColor: AppColors.hairline,
      dividerTheme: const DividerThemeData(
        color: AppColors.hairline,
        thickness: 1,
        space: 1,
      ),

      textTheme: _textTheme,

      // TopAppBar (10:5): latar Teal Haze, brand/judul Plus Jakarta Sans Bold
      // 18/24 berwarna `navBrand`. Desain memakai backdrop blur 6px di atas
      // latar 80% — di sini dipakai warna solid karena blur seluruh app bar
      // mahal di perangkat kasir kelas bawah dan hasilnya nyaris sama.
      appBarTheme: const AppBarTheme(
        backgroundColor: AppColors.tealHaze,
        foregroundColor: AppColors.navBrand,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0.5,
        shadowColor: AppColors.shadowSoft,
        centerTitle: false,
        titleTextStyle: TextStyle(
          fontFamily: AppFonts.display,
          color: AppColors.navBrand,
          fontSize: 18,
          height: 24 / 18,
          fontWeight: FontWeight.w700,
        ),
        iconTheme: IconThemeData(color: AppColors.navBrand),
      ),

      // Radius 20px + soft teal drop shadow, tanpa border.
      cardTheme: CardThemeData(
        color: Colors.white,
        surfaceTintColor: Colors.transparent,
        shadowColor: AppColors.shadowSoft,
        elevation: 3,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.xl),
        ),
      ),

      // Kolom isian (31:1040): latar teal muda, radius 8, padding 17×13,
      // placeholder Inter 16. Label TIDAK memakai floating label Material —
      // desain menaruhnya di atas kolom, lihat `AppFormField`.
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.inputSurface,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 17, vertical: 13),
        border: border(AppColors.hairline),
        enabledBorder: border(AppColors.hairline),
        focusedBorder: border(AppColors.tealDeep, 1.5),
        errorBorder: border(AppColors.coral),
        focusedErrorBorder: border(AppColors.coral, 1.5),
        disabledBorder: border(AppColors.hairline),
        isDense: true,
        labelStyle: const TextStyle(
          fontFamily: AppFonts.display,
          fontSize: 13,
          color: AppColors.textBody,
        ),
        hintStyle: const TextStyle(
          fontFamily: AppFonts.body,
          fontSize: 16,
          height: 24 / 16,
          color: AppColors.inputPlaceholder,
        ),
        helperStyle: const TextStyle(
          fontFamily: AppFonts.body,
          fontSize: 12,
          height: 16 / 12,
          color: AppColors.textMuted,
        ),
        errorStyle: const TextStyle(
          fontFamily: AppFonts.body,
          fontSize: 12,
          height: 16 / 12,
          fontWeight: FontWeight.w500,
          color: AppColors.coral,
        ),
        prefixIconColor: AppColors.inputPlaceholder,
        suffixIconColor: AppColors.inputPlaceholder,
      ),

      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith(
          (states) => Colors.white,
        ),
        trackColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected)
              ? AppColors.navAccent
              : AppColors.hairline,
        ),
        trackOutlineColor: WidgetStateProperty.resolveWith(
          (states) => Colors.transparent,
        ),
      ),

      // Primary Action: teal deep, pill, Plus Jakarta Sans Medium 15/20.
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: AppColors.tealDeep,
          foregroundColor: Colors.white,
          disabledBackgroundColor: AppColors.hairline,
          disabledForegroundColor: AppColors.disabledLabel,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
          textStyle: AppButtonStyles._label,
          shape: AppButtonStyles._shape,
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.tealDeep,
          foregroundColor: Colors.white,
          disabledBackgroundColor: AppColors.hairline,
          disabledForegroundColor: AppColors.disabledLabel,
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
          textStyle: AppButtonStyles._label,
          shape: AppButtonStyles._shape,
        ),
      ),

      // Secondary Action: latar mist, border teal 20%, teks teal deep.
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          backgroundColor: AppColors.mist,
          foregroundColor: AppColors.tealDeep,
          disabledForegroundColor: AppColors.disabledLabel,
          side: const BorderSide(color: AppColors.tealDeepOutline),
          padding: const EdgeInsets.symmetric(horizontal: 25, vertical: 13),
          textStyle: AppButtonStyles._label,
          shape: AppButtonStyles._shape,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: AppColors.tealDeep,
          textStyle: AppButtonStyles._label,
        ),
      ),

      floatingActionButtonTheme: const FloatingActionButtonThemeData(
        backgroundColor: AppColors.tealDeep,
        foregroundColor: Colors.white,
      ),

      navigationRailTheme: const NavigationRailThemeData(
        backgroundColor: Colors.white,
        indicatorColor: AppColors.mist,
        selectedIconTheme: IconThemeData(color: AppColors.tealDeep),
        unselectedIconTheme: IconThemeData(color: AppColors.textMuted),
        selectedLabelTextStyle: TextStyle(
          fontFamily: AppFonts.body,
          color: AppColors.tealDeep,
          fontWeight: FontWeight.w600,
        ),
        unselectedLabelTextStyle: TextStyle(
          fontFamily: AppFonts.body,
          color: AppColors.slate600,
        ),
      ),

      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        indicatorColor: AppColors.mist,
        elevation: 0,
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => TextStyle(
            fontFamily: AppFonts.body,
            fontSize: 12,
            height: 16 / 12,
            fontWeight: FontWeight.w600,
            color: states.contains(WidgetState.selected)
                ? AppColors.tealDeep
                : AppColors.textMuted,
          ),
        ),
        iconTheme: WidgetStateProperty.resolveWith(
          (states) => IconThemeData(
            color: states.contains(WidgetState.selected)
                ? AppColors.tealDeep
                : AppColors.textMuted,
          ),
        ),
      ),

      // Chip netral berbentuk pill, mengikuti geometri status badge.
      chipTheme: const ChipThemeData(
        backgroundColor: AppColors.hairline,
        side: BorderSide.none,
        padding: EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        labelStyle: TextStyle(
          fontFamily: AppFonts.body,
          fontSize: 12,
          height: 16 / 12,
          color: AppColors.textBody,
          fontWeight: FontWeight.w500,
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(AppRadius.pill)),
        ),
      ),

      listTileTheme: ListTileThemeData(
        iconColor: AppColors.textMuted,
        textColor: AppColors.textInk,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.md),
        ),
      ),

      // Sorotan kursor & sentuh dibuat setipis mungkin di seluruh aplikasi.
      // Umpan balik utamanya adalah gerak (lihat `AppPressable`); riak pekat
      // di atasnya justru membuat permukaan terlihat berkedip.
      hoverColor: AppColors.mist.withValues(alpha: 0.55),
      splashColor: AppColors.tealDeep.withValues(alpha: 0.08),
      highlightColor: Colors.transparent,

      dialogTheme: DialogThemeData(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.xl),
        ),
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(AppRadius.xl),
          ),
        ),
      ),

      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: AppColors.ink,
        contentTextStyle: const TextStyle(
          fontFamily: AppFonts.body,
          color: Colors.white,
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.md),
        ),
      ),
    );
  }

  /// Skala tipografi style guide: Plus Jakarta Sans untuk heading, Inter untuk
  /// body/caption. Nilai `height` mengikuti line-height Figma.
  static const _textTheme = TextTheme(
    displaySmall: TextStyle(
      fontFamily: AppFonts.display,
      fontSize: 32,
      height: 40 / 32,
      fontWeight: FontWeight.w700,
      letterSpacing: -0.64,
      color: AppColors.textInk,
    ),
    headlineMedium: TextStyle(
      fontFamily: AppFonts.display,
      fontSize: 28,
      height: 36 / 28,
      fontWeight: FontWeight.w700,
      letterSpacing: -0.56,
      color: AppColors.textInk,
    ),
    headlineSmall: TextStyle(
      fontFamily: AppFonts.display,
      fontSize: 22,
      height: 30 / 22,
      fontWeight: FontWeight.w700,
      letterSpacing: -0.22,
      color: AppColors.textInk,
    ),
    titleLarge: TextStyle(
      fontFamily: AppFonts.display,
      fontSize: 18,
      height: 24 / 18,
      fontWeight: FontWeight.w600,
      color: AppColors.textInk,
    ),
    titleMedium: TextStyle(
      fontFamily: AppFonts.display,
      fontSize: 16,
      height: 22 / 16,
      fontWeight: FontWeight.w600,
      color: AppColors.textInk,
    ),
    titleSmall: TextStyle(
      fontFamily: AppFonts.display,
      fontSize: 15,
      height: 20 / 15,
      fontWeight: FontWeight.w500,
      color: AppColors.textInk,
    ),
    bodyLarge: TextStyle(
      fontFamily: AppFonts.body,
      fontSize: 16,
      height: 24 / 16,
      color: AppColors.textInk,
    ),
    bodyMedium: TextStyle(
      fontFamily: AppFonts.body,
      fontSize: 14,
      height: 20 / 14,
      color: AppColors.textBody,
    ),
    bodySmall: TextStyle(
      fontFamily: AppFonts.body,
      fontSize: 12,
      height: 16 / 12,
      color: AppColors.textBody,
    ),
    labelLarge: TextStyle(
      fontFamily: AppFonts.display,
      fontSize: 15,
      height: 20 / 15,
      fontWeight: FontWeight.w500,
    ),
    labelMedium: TextStyle(
      fontFamily: AppFonts.body,
      fontSize: 13,
      height: 18 / 13,
      fontWeight: FontWeight.w500,
      color: AppColors.textBody,
    ),
    labelSmall: TextStyle(
      fontFamily: AppFonts.body,
      fontSize: 12,
      height: 16 / 12,
      fontWeight: FontWeight.w500,
      color: AppColors.textMuted,
    ),
  );
}
