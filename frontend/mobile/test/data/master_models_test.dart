import 'package:flutter_test/flutter_test.dart';
import 'package:epos_ac/data/models/installation_package.dart';
import 'package:epos_ac/data/models/product.dart';
import 'package:epos_ac/data/models/service_item.dart';
import 'package:epos_ac/data/models/sparepart.dart';

void main() {
  test('Product roundtrip fromMap/toMap', () {
    const p = Product(
      id: 'p1',
      name: 'AC Sharp 1 PK',
      brand: 'Sharp',
      type: 'AH-X9',
      pk: 1.0,
      inverter: true,
      btu: 9000,
      watt: 780,
      warranty: '3 tahun',
      buyPrice: 3000000,
      sellPrice: 3500000,
      stock: 10,
      photoUrl: null,
      description: 'hemat listrik',
      category: 'AC 1 PK',
      active: true,
    );
    final map = p.toMap();
    expect(map.containsKey('id'), isFalse, reason: 'toMap tidak boleh memuat id');
    final back = Product.fromMap('p1', map);
    expect(back.id, 'p1');
    expect(back.name, p.name);
    expect(back.brand, p.brand);
    expect(back.type, p.type);
    expect(back.pk, p.pk);
    expect(back.inverter, p.inverter);
    expect(back.btu, p.btu);
    expect(back.watt, p.watt);
    expect(back.warranty, p.warranty);
    // Harga modal SENGAJA tidak ikut roundtrip: sejak migrasi 0021 ia disimpan
    // di tabel `item_costs` (khusus admin), bukan kolom `products`. Kalau
    // `toMap` sampai memuatnya lagi, insert/update ke Supabase akan gagal
    // dengan "column buy_price does not exist" — jadi ini dijaga eksplisit.
    expect(map.containsKey('buy_price'), isFalse,
        reason: 'harga modal tidak boleh ikut ke baris products');
    expect(back.buyPrice, 0);
    expect(back.sellPrice, p.sellPrice);
    expect(back.stock, p.stock);
    expect(back.description, p.description);
    expect(back.category, p.category);
    expect(back.active, p.active);
  });

  test('Product default active true & nullable kosong', () {
    const p = Product(
      name: 'X',
      brand: 'B',
      type: 'T',
      pk: 0.5,
      inverter: false,
      buyPrice: 1,
      sellPrice: 2,
      stock: 0,
      category: 'AC 1/2 PK',
    );
    expect(p.active, isTrue);
    expect(p.id, '');
    expect(p.btu, isNull);
    final back = Product.fromMap('gen', p.toMap());
    expect(back.btu, isNull);
    expect(back.watt, isNull);
    expect(back.warranty, isNull);
  });

  test('Sparepart roundtrip fromMap/toMap dengan stok num', () {
    const s = Sparepart(
      id: 's1',
      name: 'Pipa AC 1/4',
      sku: 'PIPA-14',
      category: 'material',
      unit: 'meter',
      buyPrice: 25000,
      sellPrice: 35000,
      stock: 12.5,
      minStock: 5,
      active: false,
    );
    final map = s.toMap();
    expect(map.containsKey('id'), isFalse);
    final back = Sparepart.fromMap('s1', map);
    expect(back.id, 's1');
    expect(back.name, s.name);
    expect(back.sku, s.sku);
    expect(back.category, s.category);
    expect(back.unit, s.unit);
    // Sama seperti Product: harga modal hidup di `item_costs`, bukan di sini.
    expect(map.containsKey('buy_price'), isFalse,
        reason: 'harga modal tidak boleh ikut ke baris spareparts');
    expect(back.buyPrice, 0);
    expect(back.sellPrice, s.sellPrice);
    expect(back.stock, 12.5);
    expect(back.minStock, 5);
    expect(back.active, isFalse);
  });

  test('ServiceItem roundtrip fromMap/toMap', () {
    const svc = ServiceItem(
      id: 'sv1',
      name: 'Cuci AC',
      category: 'perawatan',
      basePrice: 75000,
      durationMinutes: 45,
      description: 'termasuk cek freon',
    );
    final map = svc.toMap();
    expect(map.containsKey('id'), isFalse);
    final back = ServiceItem.fromMap('sv1', map);
    expect(back.id, 'sv1');
    expect(back.name, svc.name);
    expect(back.category, svc.category);
    expect(back.basePrice, svc.basePrice);
    expect(back.durationMinutes, svc.durationMinutes);
    expect(back.description, svc.description);
    expect(back.active, isTrue);
  });

  test('InstallationPackage roundtrip termasuk items', () {
    const pkg = InstallationPackage(
      id: 'pk1',
      name: 'Paket Pasang Standar',
      description: 'pipa 3 meter + bracket',
      items: [
        PackageItem(
          sparepartId: 's1',
          name: 'Pipa AC 1/4',
          qty: 3,
          unit: 'meter',
          extraPricePerUnit: 35000,
        ),
        PackageItem(
          sparepartId: 's2',
          name: 'Bracket',
          qty: 1,
          unit: 'set',
          extraPricePerUnit: 50000,
        ),
      ],
    );
    final map = pkg.toMap();
    expect(map.containsKey('id'), isFalse);
    final back = InstallationPackage.fromMap('pk1', map);
    expect(back.id, 'pk1');
    expect(back.name, pkg.name);
    expect(back.description, pkg.description);
    expect(back.active, isTrue);
    expect(back.items.length, 2);
    expect(back.items.first.sparepartId, 's1');
    expect(back.items.first.qty, 3);
    expect(back.items.first.unit, 'meter');
    expect(back.items.first.extraPricePerUnit, 35000);
    expect(back.items[1].name, 'Bracket');
  });

  test('PackageItem roundtrip mandiri', () {
    const item = PackageItem(
      sparepartId: 'x',
      name: 'Freon',
      qty: 0.5,
      unit: 'tabung',
      extraPricePerUnit: 120000,
    );
    final back = PackageItem.fromMap(item.toMap());
    expect(back.sparepartId, 'x');
    expect(back.qty, 0.5);
    expect(back.unit, 'tabung');
    expect(back.extraPricePerUnit, 120000);
  });
}
