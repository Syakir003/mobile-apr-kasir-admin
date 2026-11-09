import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/utils/error_message.dart';
import '../pos/pos_providers.dart' show techniciansProvider;
import 'job_providers.dart' show BusyJob, technicianWorkloadProvider;

/// Maksimal teknisi per job (sama dengan batas backend).
const maxTechnicians = 5;

/// Teks konfirmasi saat admin/kasir memilih teknisi yang sedang mengerjakan job lain.
String busyWarningText(String name, List<BusyJob> jobs) {
  final first = jobs.first;
  final who = first.customerName == null ? '' : ' untuk ${first.customerName}';
  final where = first.location == null ? '' : ' (${first.location})';
  final more = jobs.length > 1 ? ' dan ${jobs.length - 1} job lain' : '';
  return '$name sedang mengerjakan job$who$where$more. Tetap tugaskan?';
}

/// Pilih beberapa teknisi (semua setara, maks 5). Teknisi yang sedang mengerjakan job lain (status
/// sedang_dikerjakan, dari `GET /technician-jobs/workload`) diberi lencana; memilihnya meminta konfirmasi dulu tapi
/// tetap boleh. [excludeJobId] = job yang sedang diatur (pekerjaannya sendiri tidak dihitung "sibuk").
class TechnicianMultiPicker extends ConsumerWidget {
  const TechnicianMultiPicker({
    super.key,
    required this.value,
    required this.onChanged,
    this.enabled = true,
    this.excludeJobId,
  });

  final List<String> value;
  final ValueChanged<List<String>> onChanged;
  final bool enabled;
  final String? excludeJobId;

  Future<bool> _confirmBusy(BuildContext context, String text) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Teknisi sedang bekerja'),
        content: Text(text),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Batal'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Tetap tugaskan'),
          ),
        ],
      ),
    );
    return ok ?? false;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final techsAsync = ref.watch(techniciansProvider);
    // Gagal memuat beban kerja = tanpa peringatan (picker tetap berfungsi).
    final workload = ref.watch(technicianWorkloadProvider).valueOrNull ?? const <String, List<BusyJob>>{};

    return techsAsync.when(
      loading: () => const LinearProgressIndicator(),
      error: (e, _) => Text(
        'Gagal memuat teknisi: ${errorMessage(e)}',
        style: const TextStyle(color: AppColors.slate500),
      ),
      data: (list) {
        if (list.isEmpty) {
          return const Text(
            'Belum ada teknisi aktif',
            style: TextStyle(color: AppColors.slate500),
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final t in list)
              Builder(builder: (context) {
                final checked = value.contains(t.uid);
                final busyJobs = [
                  for (final j in workload[t.uid] ?? const <BusyJob>[])
                    if (j.jobId != excludeJobId) j,
                ];
                final canToggle = enabled && (checked || value.length < maxTechnicians);
                return CheckboxListTile(
                  key: Key('tech-${t.uid}'),
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  value: checked,
                  title: Text(t.name),
                  secondary: busyJobs.isEmpty
                      ? null
                      : const Chip(
                          label: Text('Sedang mengerjakan'),
                          visualDensity: VisualDensity.compact,
                        ),
                  onChanged: !canToggle
                      ? null
                      : (c) async {
                          if (c != true) {
                            onChanged([...value.where((id) => id != t.uid)]);
                            return;
                          }
                          if (busyJobs.isNotEmpty &&
                              !await _confirmBusy(context, busyWarningText(t.name, busyJobs))) {
                            return;
                          }
                          onChanged([...value, t.uid]);
                        },
                );
              }),
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                '${value.length}/$maxTechnicians teknisi dipilih. Semua teknisi yang dipilih sama-sama melihat dan mengerjakan job.',
                style: const TextStyle(fontSize: 12, color: AppColors.slate500),
              ),
            ),
          ],
        );
      },
    );
  }
}
