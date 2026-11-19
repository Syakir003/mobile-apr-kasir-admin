import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/models/app_user.dart';
import '../router/app_router.dart';
import '../theme/app_motion.dart';
import '../theme/app_theme.dart';

typedef Destination = ({IconData icon, String label, String route});

/// Daftar destinasi navigasi menurut role.
/// Admin melihat POS + riwayat + seluruh modul master + member + scan; kasir
/// melihat Dashboard + Transaksi + Riwayat; teknisi mendapat Scan.
List<Destination> destinationsForRole(UserRole? role) {
  const dashboard = (
    icon: Icons.dashboard_outlined,
    label: 'Dashboard',
    route: '/',
  );
  const pos = (
    icon: Icons.point_of_sale,
    label: 'Kasir (POS)',
    route: '/pos',
  );
  const riwayat = (
    icon: Icons.receipt_long_outlined,
    label: 'Riwayat Transaksi',
    route: '/transactions',
  );
  const scan = (
    icon: Icons.qr_code_scanner,
    label: 'Scan Unit',
    route: '/scan',
  );
  const order = (
    icon: Icons.assignment_outlined,
    label: 'Order Servis',
    route: '/orders',
  );
  const job = (
    icon: Icons.handyman_outlined,
    label: 'Antrian Servis',
    route: '/jobs',
  );
  const riwayatServis = (
    icon: Icons.history,
    label: 'Riwayat',
    route: '/riwayat',
  );
  const profile = (
    icon: Icons.person_outline,
    label: 'Profil',
    route: '/profile',
  );
  // Antrean pengingat servis WhatsApp — admin & kasir saja (teknisi tidak boleh
  // melihat data pelanggan, lihat `redirect.dart`).
  const pengingat = (
    icon: Icons.notifications_active_outlined,
    label: 'Pengingat WA',
    route: '/pengingat',
  );
  // Kelola voucher/undian — admin only. Kasir menukar kode lewat Checkout,
  // bukan lewat layar ini (lihat `redirect.dart`).
  const voucher = (
    icon: Icons.confirmation_number_outlined,
    label: 'Voucher',
    route: '/voucher',
  );
  const undian = (
    icon: Icons.card_giftcard_outlined,
    label: 'Undian',
    route: '/undian',
  );
  // Unit AC yang sudah dijatah kasir dikeluarkan gudang dengan scan QR —
  // admin & gudang saja (sama seperti backend `/kasir-scan`).
  const keluarGudang = (
    icon: Icons.outbox_outlined,
    label: 'Keluar Gudang (Scan)',
    route: '/keluar-gudang',
  );
  if (role == UserRole.admin) {
    return const [
      dashboard,
      pos,
      riwayat,
      (icon: Icons.ac_unit, label: 'Produk AC', route: '/products'),
      (icon: Icons.build_outlined, label: 'Sparepart', route: '/spareparts'),
      (icon: Icons.room_service_outlined, label: 'Jasa', route: '/services'),
      (icon: Icons.inventory_2_outlined, label: 'Paket Instalasi', route: '/packages'),
      (icon: Icons.people_outlined, label: 'Member', route: '/members'),
      order,
      job,
      (icon: Icons.playlist_add_check_outlined, label: 'Permintaan Material', route: '/pengajuan'),
      (icon: Icons.rule_folder_outlined, label: 'Koreksi Unit', route: '/koreksi-unit'),
      (icon: Icons.history_edu_outlined, label: 'Input Data Lampau', route: '/data-lampau'),
      pengingat,
      voucher,
      undian,
      (icon: Icons.inventory_outlined, label: 'Stok', route: '/stok'),
      keluarGudang,
      (icon: Icons.bar_chart_outlined, label: 'Laporan', route: '/laporan'),
      (icon: Icons.manage_accounts_outlined, label: 'Pengguna', route: '/users'),
      (icon: Icons.history, label: 'Log Audit', route: '/audit'),
      scan,
      profile,
    ];
  }
  if (role == UserRole.kasir) {
    return const [dashboard, pos, riwayat, order, pengingat, profile];
  }
  if (role == UserRole.teknisi) {
    // Urutan dan nama sama dengan menu teknisi di web (nav-config.ts).
    return const [
      dashboard,
      (icon: Icons.handyman_outlined, label: 'Job Saya', route: '/jobs'),
      scan,
      riwayatServis,
      profile,
    ];
  }
  if (role == UserRole.gudang) {
    return const [
      dashboard,
      (icon: Icons.ac_unit, label: 'Produk AC', route: '/products'),
      (icon: Icons.build_outlined, label: 'Sparepart', route: '/spareparts'),
      (icon: Icons.inventory_outlined, label: 'Stok', route: '/stok'),
      keluarGudang,
      // Admin membacanya di tab Stok Laporan Rinci, jadi hanya gudang punya menu ini (sama dengan web).
      (icon: Icons.summarize_outlined, label: 'Laporan Stok', route: '/stok/laporan'),
      profile,
    ];
  }
  return const [dashboard];
}

/// Indeks destinasi terpilih berdasarkan lokasi saat ini (prefix match).
int selectedIndexFor(List<Destination> destinations, String location) {
  var best = 0;
  var bestLen = -1;
  for (var i = 0; i < destinations.length; i++) {
    final route = destinations[i].route;
    final isMatch = route == '/'
        ? location == '/'
        : location == route || location.startsWith('$route/');
    if (isMatch && route.length > bestLen) {
      best = i;
      bestLen = route.length;
    }
  }
  return best;
}

/// Satu bagian menu: grup yang bisa dibuka-tutup (label != null) atau item
/// lepas (label == null). Dipakai sidebar dan sheet "Lainnya".
typedef MenuSection = ({String? label, IconData? icon, List<Destination> items});

/// Menu bergrup yang mengikuti sidebar web (nav-config.ts). Web hanya
/// mengelompokkan admin; role lain tetap datar. Nama menu (di sini dan di
/// `destinationsForRole`) sama dengan web.
List<MenuSection> menuSectionsFor(UserRole? role) {
  final dests = destinationsForRole(role);
  if (role != UserRole.admin) return [(label: null, icon: null, items: dests)];

  Destination d(String route) => dests.firstWhere((x) => x.route == route);

  MenuSection leaf(String route) => (label: null, icon: null, items: [d(route)]);
  MenuSection group(String label, IconData icon, List<Destination> items) =>
      (label: label, icon: icon, items: items);

  return [
    leaf('/'),
    group('Penjualan', Icons.shopping_cart_outlined, [
      d('/pos'),
      d('/transactions'),
      d('/voucher'),
      d('/undian'),
    ]),
    group('Servis AC', Icons.handyman_outlined, [
      d('/jobs'),
      d('/orders'),
      d('/pengajuan'),
      d('/scan'),
    ]),
    group('Pelanggan', Icons.favorite_border, [
      d('/members'),
      d('/pengingat'),
    ]),
    group('Stok & Gudang', Icons.warehouse_outlined, [
      d('/keluar-gudang'),
      d('/stok'),
      d('/koreksi-unit'),
    ]),
    group('Data Master', Icons.storage_outlined, [
      d('/products'),
      d('/spareparts'),
      d('/services'),
      d('/packages'),
    ]),
    leaf('/laporan'),
    group('Pengaturan', Icons.settings_outlined, [
      d('/users'),
      d('/data-lampau'),
      d('/audit'),
    ]),
    leaf('/profile'),
  ];
}

String _roleLabel(UserRole? role) => switch (role) {
      UserRole.admin => 'Admin',
      UserRole.kasir => 'Kasir',
      UserRole.teknisi => 'Teknisi',
      UserRole.gudang => 'Gudang',
      null => 'Pengguna',
    };

class AdaptiveScaffold extends ConsumerWidget {
  const AdaptiveScaffold({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider).value;
    final role = user?.role;
    final destinations = destinationsForRole(role);

    // NavigationBar/Rail butuh minimal 2 destinasi. Bila hanya satu (mis. null
    // saat memuat), tampilkan child polos tanpa navigasi.
    if (destinations.length < 2) {
      return Scaffold(body: child);
    }

    // Menu dibuka lewat push, dan push TIDAK mengubah GoRouterState milik shell
    // (selalu "/" dari halaman pertama). Lokasi dibaca dari route teratas router
    // dan didengarkan, kalau tidak tab yang menyala tetap Dashboard.
    final router = GoRouter.of(context);
    return ListenableBuilder(
      listenable: router.routerDelegate,
      builder: (context, _) {
        final location = router.state.matchedLocation;
        final selectedIndex = selectedIndexFor(destinations, location);

        // push (bukan go) supaya berpindah antar-menu tersusun di back stack —
        // tombol back Android kembali ke menu sebelumnya sesuai urutan
        // kunjungan, bukan langsung keluar app. Dijaga dari push duplikat
        // kalau menu yang sama ditekan lagi saat sudah aktif.
        void onRoute(String route) {
          if (location != route) context.push(route);
        }

        void onSelected(int index) => onRoute(destinations[index].route);

        final sections = menuSectionsFor(role);
        final wide = MediaQuery.sizeOf(context).width >= 800;
        if (wide) {
          return Scaffold(
            body: Row(
              children: [
                _Sidebar(
                  sections: sections,
                  selectedRoute: destinations[selectedIndex].route,
                  onRoute: onRoute,
                  user: user,
                  onLogout: () => ref.read(authRepositoryProvider).signOut(),
                ),
                Expanded(child: child),
              ],
            ),
          );
        }
        return Scaffold(
          body: child,
          bottomNavigationBar: _MobileNav(
            destinations: destinations,
            selectedIndex: selectedIndex,
            onSelected: onSelected,
            sections: sections,
            onRoute: onRoute,
          ),
        );
      },
    );
  }
}

/// Bottom navigation untuk layar sempit. Bila destinasi lebih dari 5 (mis.
/// admin dengan 10 menu), tampilkan 4 destinasi utama + tab "Lainnya" yang
/// membuka sheet berisi sisanya, agar label tidak berdesakan/terpotong.
class _MobileNav extends StatelessWidget {
  const _MobileNav({
    required this.destinations,
    required this.selectedIndex,
    required this.onSelected,
    required this.sections,
    required this.onRoute,
  });

  final List<Destination> destinations;
  final int selectedIndex;
  final ValueChanged<int> onSelected;
  final List<MenuSection> sections;
  final ValueChanged<String> onRoute;

  /// Jumlah destinasi utama sebelum digantikan tab "Lainnya".
  static const _maxPrimary = 4;

  @override
  Widget build(BuildContext context) {
    // Cukup muat dalam satu baris (≤ 5 total) → NavigationBar biasa.
    if (destinations.length <= _maxPrimary + 1) {
      return NavigationBar(
        selectedIndex: selectedIndex,
        destinations: [
          for (final d in destinations)
            NavigationDestination(icon: Icon(d.icon), label: d.label),
        ],
        onDestinationSelected: onSelected,
      );
    }

    final primary = destinations.take(_maxPrimary).toList();
    final inOverflow = selectedIndex >= _maxPrimary;

    return NavigationBar(
      selectedIndex: inOverflow ? _maxPrimary : selectedIndex,
      destinations: [
        for (final d in primary)
          NavigationDestination(icon: Icon(d.icon), label: d.label),
        NavigationDestination(
          // Saat menu di dalam "Lainnya" sedang aktif, tampilkan ikonnya
          // agar tetap terlihat destinasi mana yang terpilih.
          icon: Icon(
            inOverflow ? destinations[selectedIndex].icon : Icons.more_horiz,
          ),
          label: 'Lainnya',
        ),
      ],
      onDestinationSelected: (index) {
        if (index < _maxPrimary) {
          onSelected(index);
        } else {
          _openMore(context);
        }
      },
    );
  }

  void _openMore(BuildContext context) {
    final selectedRoute = destinations[selectedIndex].route;
    showModalBottomSheet<void>(
      context: context,
      // Admin punya 23 menu — tanpa ini sheet dibatasi 9/16 tinggi layar dan
      // Column-nya (tidak scroll) meluber, jadi sebagian menu tak terjangkau.
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
      ),
      builder: (sheetContext) {
        void go(String route) {
          Navigator.of(sheetContext).pop();
          onRoute(route);
        }

        Widget tile(Destination d, {bool nested = false}) {
          final selected = d.route == selectedRoute;
          return ListTile(
            dense: nested,
            contentPadding: EdgeInsets.only(left: nested ? 40 : 16, right: 16),
            leading: Icon(
              d.icon,
              size: nested ? 20 : null,
              color: selected ? AppColors.teal700 : AppColors.slate500,
            ),
            title: Text(
              d.label,
              style: TextStyle(
                color: selected ? AppColors.teal700 : AppColors.slate900,
                fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
              ),
            ),
            selected: selected,
            selectedTileColor: AppColors.teal50,
            onTap: () => go(d.route),
          );
        }

        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const SizedBox(height: 10),
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.slate200,
                  borderRadius: BorderRadius.circular(AppRadius.pill),
                ),
              ),
              const SizedBox(height: 6),
              Flexible(
                child: ListView(
                  shrinkWrap: true,
                  children: [
                    for (final s in sections)
                      if (s.label == null)
                        for (final d in s.items) tile(d)
                      else
                        // Grup yang berisi halaman aktif terbuka dulu, seperti web.
                        ExpansionTile(
                          shape: const Border(),
                          collapsedShape: const Border(),
                          initiallyExpanded:
                              s.items.any((d) => d.route == selectedRoute),
                          leading: Icon(s.icon, color: AppColors.slate500),
                          title: Text(
                            s.label!,
                            style: const TextStyle(
                              color: AppColors.slate900,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                          children: [for (final d in s.items) tile(d, nested: true)],
                        ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
            ],
          ),
        );
      },
    );
  }
}

/// Sidebar bergaya desain Figma: header logo, menu per-role, footer user.
class _Sidebar extends StatelessWidget {
  const _Sidebar({
    required this.sections,
    required this.selectedRoute,
    required this.onRoute,
    required this.user,
    required this.onLogout,
  });

  final List<MenuSection> sections;
  final String selectedRoute;
  final ValueChanged<String> onRoute;
  final AppUser? user;
  final VoidCallback onLogout;

  @override
  Widget build(BuildContext context) {
    // Sidebar teal dengan sudut kanan membulat 32px dan bayangan ke arah
    // konten — mengikuti frame `SideNavBar` (10:267) pada desain.
    final routes = [for (final s in sections) for (final d in s.items) d.route];
    final showCta = routes.contains('/pos');

    return Container(
      width: 260,
      padding: const EdgeInsets.symmetric(vertical: 32),
      decoration: const BoxDecoration(
        color: AppColors.tealDeep,
        borderRadius: BorderRadius.horizontal(right: Radius.circular(32)),
        boxShadow: [
          BoxShadow(
            color: AppColors.shadowSoft,
            offset: Offset(4, 0),
            blurRadius: 20,
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Header: avatar bercincin Teal Bright + brand + peran.
          Padding(
            padding: const EdgeInsets.fromLTRB(24, 0, 24, 32),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    shape: BoxShape.circle,
                    border: Border.all(color: AppColors.navAvatarRing, width: 2),
                  ),
                  clipBehavior: Clip.antiAlias,
                  padding: const EdgeInsets.all(4),
                  child: Image.asset('assets/brand/favicon-512.png'),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text(
                        'APR-POS',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontFamily: AppFonts.display,
                          fontSize: 18,
                          height: 24 / 18,
                          fontWeight: FontWeight.w700,
                          color: Colors.white,
                        ),
                      ),
                      Text(
                        _roleLabel(user?.role),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontFamily: AppFonts.body,
                          fontSize: 12,
                          height: 16 / 12,
                          color: AppColors.navMuted,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          // CTA transaksi baru — hanya untuk peran yang punya akses POS.
          if (showCta)
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
              child: Material(
                color: AppColors.navAccent,
                borderRadius: BorderRadius.circular(AppRadius.sm),
                child: InkWell(
                  // Lewat onRoute (bukan context.go langsung) supaya ikut
                  // masuk back stack seperti menu lain.
                  onTap: () => onRoute('/pos'),
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                  child: const Padding(
                    padding:
                        EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.add, size: 16, color: Colors.white),
                        SizedBox(width: 8),
                        Text(
                          'Transaksi Baru',
                          style: TextStyle(
                            fontFamily: AppFonts.display,
                            fontSize: 15,
                            height: 20 / 15,
                            fontWeight: FontWeight.w500,
                            color: Colors.white,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),

          // Menu — item aktif berupa pill yang membulat di sisi kiri saja.
          //
          // Admin punya 16 destinasi, jadi daftar ini hampir selalu menggulir.
          // Tanpa peredup di kedua ujung, item yang setengah tergulir terpotong
          // rata di tengah huruf dan terbaca seperti tampilan yang rusak, bukan
          // seperti daftar yang masih ada lanjutannya.
          Expanded(
            child: ShaderMask(
              blendMode: BlendMode.dstIn,
              shaderCallback: (rect) => const LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  Colors.transparent,
                  Colors.black,
                  Colors.black,
                  Colors.transparent,
                ],
                stops: [0, 0.05, 0.94, 1],
              ).createShader(rect),
              child: ListView(
                padding: const EdgeInsets.only(left: 8, top: 6, bottom: 10),
                children: [
                  _SidebarMenu(
                    sections: sections,
                    selectedRoute: selectedRoute,
                    onRoute: onRoute,
                  ),
                ],
              ),
            ),
          ),

          // Footer: profil + logout, dipisah garis Teal Pale 10%.
          Container(
            margin: const EdgeInsets.only(top: 16),
            padding: const EdgeInsets.fromLTRB(24, 17, 24, 0),
            decoration: const BoxDecoration(
              border: Border(top: BorderSide(color: AppColors.navDivider)),
            ),
            child: Column(
              children: [
                _SidebarAction(
                  icon: Icons.person_outline,
                  label: user?.displayName.isNotEmpty == true
                      ? user!.displayName
                      : 'Profil',
                  onTap: () => onRoute('/profile'),
                ),
                _SidebarAction(
                  icon: Icons.logout,
                  label: 'Logout',
                  onTap: onLogout,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Baris aksi pada footer sidebar (profil / logout).
class _SidebarAction extends StatelessWidget {
  const _SidebarAction({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(AppRadius.sm),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        hoverColor: Colors.white.withValues(alpha: 0.06),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Row(
            children: [
              Icon(icon, size: 16, color: AppColors.navMuted),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontFamily: AppFonts.display,
                    fontSize: 15,
                    height: 20 / 15,
                    fontWeight: FontWeight.w500,
                    color: AppColors.navMuted,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Daftar menu sidebar: grup accordion (seperti sidebar web) dan item lepas.
/// Grup yang berisi halaman aktif otomatis terbuka.
class _SidebarMenu extends StatefulWidget {
  const _SidebarMenu({
    required this.sections,
    required this.selectedRoute,
    required this.onRoute,
  });

  final List<MenuSection> sections;
  final String selectedRoute;
  final ValueChanged<String> onRoute;

  @override
  State<_SidebarMenu> createState() => _SidebarMenuState();
}

class _SidebarMenuState extends State<_SidebarMenu> {
  final _open = <String>{};

  @override
  void initState() {
    super.initState();
    _openActiveGroup();
  }

  @override
  void didUpdateWidget(_SidebarMenu old) {
    super.didUpdateWidget(old);
    if (old.selectedRoute != widget.selectedRoute) _openActiveGroup();
  }

  void _openActiveGroup() {
    for (final s in widget.sections) {
      if (s.label != null &&
          s.items.any((d) => d.route == widget.selectedRoute)) {
        _open.add(s.label!);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (final s in widget.sections)
          if (s.label == null)
            for (final d in s.items)
              _SidebarItem(
                destination: d,
                selected: d.route == widget.selectedRoute,
                onTap: () => widget.onRoute(d.route),
              )
          else
            _SidebarGroup(
              label: s.label!,
              icon: s.icon!,
              open: _open.contains(s.label),
              hasActive: s.items.any((d) => d.route == widget.selectedRoute),
              onToggle: () => setState(() {
                if (!_open.remove(s.label)) _open.add(s.label!);
              }),
              children: [
                for (final d in s.items)
                  _SidebarItem(
                    destination: d,
                    selected: d.route == widget.selectedRoute,
                    onTap: () => widget.onRoute(d.route),
                    indent: 20,
                  ),
              ],
            ),
      ],
    );
  }
}

/// Header grup yang bisa dibuka-tutup beserta anak-anaknya.
class _SidebarGroup extends StatelessWidget {
  const _SidebarGroup({
    required this.label,
    required this.icon,
    required this.open,
    required this.hasActive,
    required this.onToggle,
    required this.children,
  });

  final String label;
  final IconData icon;
  final bool open;
  final bool hasActive;
  final VoidCallback onToggle;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final fg = hasActive ? Colors.white : AppColors.navMuted;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: InkWell(
            onTap: onToggle,
            borderRadius: const BorderRadius.horizontal(
              left: Radius.circular(AppRadius.pill),
            ),
            hoverColor: Colors.white.withValues(alpha: 0.06),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
              child: Row(
                children: [
                  Icon(icon, size: 18, color: fg),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontFamily: AppFonts.display,
                        fontSize: 15,
                        height: 20 / 15,
                        fontWeight: FontWeight.w500,
                        color: fg,
                      ),
                    ),
                  ),
                  AnimatedRotation(
                    turns: open ? 0.5 : 0,
                    duration: AppDurations.base,
                    child: Icon(Icons.expand_more, size: 18, color: fg),
                  ),
                ],
              ),
            ),
          ),
        ),
        AnimatedSize(
          duration: AppDurations.base,
          curve: AppCurves.standard,
          alignment: Alignment.topCenter,
          child: open ? Column(children: children) : const SizedBox(width: double.infinity),
        ),
      ],
    );
  }
}

class _SidebarItem extends StatelessWidget {
  const _SidebarItem({
    required this.destination,
    required this.selected,
    required this.onTap,
    this.indent = 0,
  });

  final Destination destination;
  final bool selected;
  final VoidCallback onTap;
  final double indent;

  @override
  Widget build(BuildContext context) {
    // Item aktif sengaja menempel ke tepi kanan sidebar (hanya sudut kiri yang
    // membulat) supaya menyatu dengan area konten, seperti pada desain.
    const shape = BorderRadius.horizontal(left: Radius.circular(AppRadius.pill));
    final fg = selected ? AppColors.navAccent : AppColors.navMuted;

    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      // Pil aktif berpindah dengan memudar, bukan berkedip dari satu baris ke
      // baris lain: sidebar adalah elemen yang paling sering dilihat, dan
      // pergantian mendadak di sana yang paling terasa kaku.
      child: AnimatedContainer(
        duration: AppDurations.base,
        curve: AppCurves.standard,
        decoration: BoxDecoration(
          color: selected ? AppColors.mistDeep : Colors.transparent,
          borderRadius: shape,
        ),
        child: Material(
          type: MaterialType.transparency,
          borderRadius: shape,
          child: InkWell(
            onTap: onTap,
            borderRadius: shape,
            hoverColor: Colors.white.withValues(alpha: 0.06),
            child: Padding(
              padding: EdgeInsets.fromLTRB(24 + indent, 12, 24, 12),
              child: Row(
                children: [
                  AnimatedScale(
                    duration: AppDurations.base,
                    curve: AppCurves.emphasized,
                    scale: selected ? 1.08 : 1,
                    child: Icon(destination.icon, size: 18, color: fg),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: AnimatedDefaultTextStyle(
                      duration: AppDurations.base,
                      curve: AppCurves.standard,
                      style: TextStyle(
                        fontFamily: AppFonts.display,
                        fontSize: 15,
                        height: 20 / 15,
                        fontWeight:
                            selected ? FontWeight.w600 : FontWeight.w500,
                        color: fg,
                      ),
                      child: Text(
                        destination.label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
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
