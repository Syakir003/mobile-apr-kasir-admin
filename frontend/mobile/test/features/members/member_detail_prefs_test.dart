import 'package:epos_ac/core/theme/app_theme.dart';
import 'package:epos_ac/data/models/ac_unit.dart';
import 'package:epos_ac/data/models/member.dart';
import 'package:epos_ac/features/members/member_detail_screen.dart';
import 'package:epos_ac/features/members/member_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

const _member = Member(
  id: 'm1',
  name: 'Budi',
  phone: '0812',
  address: 'Jl. A',
  customerType: 'rumah',
  priceTier: 'retail',
  waOptOut: false,
);

void main() {
  test('Member.fromMap membaca price_tier dan wa_opt_out (default ritel, tidak berhenti)', () {
    final m = Member.fromMap('1', {'name': 'A', 'phone': '1', 'price_tier': 'installer', 'wa_opt_out': true});
    expect(m.priceTier, 'installer');
    expect(m.waOptOut, isTrue);
    final d = Member.fromMap('2', {'name': 'B', 'phone': '2'});
    expect(d.priceTier, 'retail');
    expect(d.waOptOut, isFalse);
  });

  testWidgets('ubah tipe pembeli dan opt-out WA memanggil endpoint', (t) async {
    final tiers = <(String, String)>[];
    final optOuts = <(String, bool)>[];
    await t.pumpWidget(ProviderScope(
      overrides: [
        membersStreamProvider.overrideWith((ref) => Stream.value(const [_member])),
        memberUnitsProvider.overrideWith((ref, id) => Stream.value(const <AcUnit>[])),
        setMemberPriceTierProvider.overrideWithValue((id, tier) async => tiers.add((id, tier))),
        setMemberWaOptOutProvider.overrideWithValue((id, v) async => optOuts.add((id, v))),
      ],
      child: MaterialApp(theme: AppTheme.light(), home: const MemberDetailScreen(memberId: 'm1')),
    ));
    await t.pumpAndSettle();

    await t.tap(find.byKey(const Key('member-price-tier')));
    await t.pumpAndSettle();
    await t.tap(find.text('Installer').last);
    await t.pumpAndSettle();
    expect(tiers, [('m1', 'installer')]);

    await t.tap(find.byKey(const Key('member-wa-opt-out')));
    await t.pumpAndSettle();
    expect(optOuts, [('m1', true)]);
  });
}
