import 'package:flutter/material.dart';

import '../theme/app_motion.dart';
import '../theme/app_theme.dart';
import 'empty_state.dart';

/// Definisi satu kolom tabel.
class TableColumnSpec {
  const TableColumnSpec({
    required this.label,
    this.flex = 1,
    this.alignRight = false,
  });

  final String label;
  final int flex;
  final bool alignRight;
}

/// Kartu tabel sesuai frame `Recent Transactions Table` (10:185): judul + aksi
/// di kepala kartu, baris header berlatar teal muda, lalu baris data yang
/// dipisah garis hairline.
///
/// Di bawah [AppSpacing.wideBreakpoint] kolom tidak muat, jadi baris header
/// disembunyikan dan tiap baris dirender lewat [narrowBuilder] sebagai kartu
/// bertumpuk. Desain hanya menyediakan versi desktop.
class DataTableCard extends StatelessWidget {
  const DataTableCard({
    super.key,
    required this.title,
    required this.columns,
    required this.rowCount,
    required this.cellsBuilder,
    required this.narrowBuilder,
    this.action,
    this.onRowTap,
    this.emptyMessage = 'Belum ada data.',
  });

  final String title;
  final List<TableColumnSpec> columns;
  final int rowCount;

  /// Sel untuk baris ke-i pada layout lebar; panjangnya harus sama dengan
  /// jumlah [columns].
  final List<Widget> Function(int index) cellsBuilder;

  /// Tampilan baris ke-i pada layar sempit.
  final Widget Function(int index) narrowBuilder;

  final Widget? action;
  final void Function(int index)? onRowTap;
  final String emptyMessage;

  @override
  Widget build(BuildContext context) {
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppRadius.xl),
        border: Border.all(color: AppColors.cardHairline),
        boxShadow: AppShadows.metric,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _CardHead(title: title, action: action),
          if (rowCount == 0)
            AppEmptyState(
              icon: Icons.receipt_long_outlined,
              title: emptyMessage,
              compact: true,
            )
          else
            LayoutBuilder(
              builder: (context, constraints) {
                final wide = constraints.maxWidth >= AppSpacing.wideBreakpoint;
                if (!wide) {
                  return Column(
                    children: [
                      for (var i = 0; i < rowCount; i++)
                        _RowShell(
                          onTap: onRowTap == null ? null : () => onRowTap!(i),
                          topBorder: i > 0,
                          padding: const EdgeInsets.symmetric(
                            horizontal: AppSpacing.card,
                            vertical: 16,
                          ),
                          child: narrowBuilder(i),
                        ),
                    ],
                  );
                }
                return Column(
                  children: [
                    _HeaderRow(columns: columns),
                    for (var i = 0; i < rowCount; i++)
                      _RowShell(
                        onTap: onRowTap == null ? null : () => onRowTap!(i),
                        topBorder: i > 0,
                        child: _DataRow(
                          columns: columns,
                          cells: cellsBuilder(i),
                        ),
                      ),
                  ],
                );
              },
            ),
        ],
      ),
    );
  }
}

class _CardHead extends StatelessWidget {
  const _CardHead({required this.title, this.action});

  final String title;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(AppSpacing.card, 24, AppSpacing.card, 17),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppColors.mist)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(title, style: Theme.of(context).textTheme.titleLarge),
          ),
          if (action != null) action!,
        ],
      ),
    );
  }
}

class _HeaderRow extends StatelessWidget {
  const _HeaderRow({required this.columns});

  final List<TableColumnSpec> columns;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.tableHeader,
        border: Border(bottom: BorderSide(color: AppColors.mist)),
      ),
      child: Row(
        children: [
          for (final c in columns)
            Expanded(
              flex: c.flex,
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.card,
                  vertical: 16,
                ),
                child: Text(
                  c.label,
                  textAlign: c.alignRight ? TextAlign.right : TextAlign.left,
                  style: const TextStyle(
                    fontFamily: AppFonts.display,
                    fontSize: 15,
                    height: 20 / 15,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textBody,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _DataRow extends StatelessWidget {
  const _DataRow({required this.columns, required this.cells});

  final List<TableColumnSpec> columns;
  final List<Widget> cells;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        for (var i = 0; i < columns.length; i++)
          Expanded(
            flex: columns[i].flex,
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.card,
                vertical: 16,
              ),
              child: Align(
                alignment: columns[i].alignRight
                    ? Alignment.centerRight
                    : Alignment.centerLeft,
                child: cells.length > i ? cells[i] : const SizedBox.shrink(),
              ),
            ),
          ),
      ],
    );
  }
}

/// Satu baris tabel.
///
/// Pemisah antar-baris digambar sendiri (bukan `Border` penuh) supaya bisa
/// menjorok ke dalam sejauh padding kartu. Garis selebar kartu memotong kartu
/// menjadi ruas-ruas dan membuat tabel terbaca seperti kisi; garis yang
/// menjorok tetap memisahkan baris tanpa menyentuh tepi.
class _RowShell extends StatefulWidget {
  const _RowShell({
    required this.child,
    required this.topBorder,
    this.onTap,
    this.padding,
  });

  final Widget child;
  final bool topBorder;
  final VoidCallback? onTap;
  final EdgeInsetsGeometry? padding;

  @override
  State<_RowShell> createState() => _RowShellState();
}

class _RowShellState extends State<_RowShell> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    Widget content = AnimatedContainer(
      duration: AppDurations.base,
      curve: AppCurves.standard,
      padding: widget.padding,
      color: _hovered && widget.onTap != null
          ? AppColors.mist.withValues(alpha: 0.55)
          : Colors.transparent,
      child: widget.child,
    );

    if (widget.topBorder) {
      content = Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: AppSpacing.card),
            child: Divider(
              height: 1,
              thickness: 1,
              color: AppColors.mist,
            ),
          ),
          content,
        ],
      );
    }

    if (widget.onTap == null) return content;
    return MouseRegion(
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: widget.onTap,
          hoverColor: Colors.transparent,
          child: content,
        ),
      ),
    );
  }
}
