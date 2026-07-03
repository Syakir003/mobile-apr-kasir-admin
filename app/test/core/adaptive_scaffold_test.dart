import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:epos_ac/core/widgets/adaptive_scaffold.dart';

const _app = MaterialApp(home: AdaptiveScaffold(child: Text('isi')));

void main() {
  testWidgets('layar sempit memakai NavigationBar bawah', (tester) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(_app);
    expect(find.byType(NavigationBar), findsOneWidget);
    expect(find.byType(NavigationRail), findsNothing);
  });

  testWidgets('layar lebar memakai NavigationRail samping', (tester) async {
    tester.view.physicalSize = const Size(1200, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(_app);
    expect(find.byType(NavigationRail), findsOneWidget);
    expect(find.byType(NavigationBar), findsNothing);
  });
}
