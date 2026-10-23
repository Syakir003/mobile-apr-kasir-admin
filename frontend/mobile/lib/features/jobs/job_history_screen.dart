import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/empty_state.dart';
import 'job_list_screen.dart' show JobCard;
import 'job_providers.dart';

/// Riwayat Servis teknisi: job yang sudah diselesaikan, 20 per halaman
/// (padanan `/teknisi/riwayat` di web).
class JobHistoryScreen extends ConsumerStatefulWidget {
  const JobHistoryScreen({super.key});

  @override
  ConsumerState<JobHistoryScreen> createState() => _JobHistoryScreenState();
}

class _JobHistoryScreenState extends ConsumerState<JobHistoryScreen> {
  int _page = 1;

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(jobHistoryProvider(_page));
    return Scaffold(
      appBar: AppBar(
        title: const Text('Riwayat Servis'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Muat ulang',
            onPressed: () => ref.invalidate(jobHistoryProvider(_page)),
          ),
        ],
      ),
      body: async.when(
        loading: () => const AppSkeletonList(),
        error: (e, _) => AppErrorState(error: e, title: 'Gagal memuat riwayat'),
        data: (data) {
          if (data.items.isEmpty) {
            return const Center(
              child: Text('Belum ada job selesai.',
                  style: TextStyle(color: AppColors.slate500)),
            );
          }
          return Column(
            children: [
              Expanded(
                child: ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                  itemCount: data.items.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 10),
                  itemBuilder: (_, i) => JobCard(job: data.items[i]),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Halaman $_page dari ${data.totalPages} (${data.total} job)',
                        style: const TextStyle(color: AppColors.slate500, fontSize: 13),
                      ),
                    ),
                    IconButton(
                      key: const Key('riwayat-prev'),
                      icon: const Icon(Icons.chevron_left),
                      onPressed: _page <= 1 ? null : () => setState(() => _page--),
                    ),
                    IconButton(
                      key: const Key('riwayat-next'),
                      icon: const Icon(Icons.chevron_right),
                      onPressed: _page >= data.totalPages ? null : () => setState(() => _page++),
                    ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
