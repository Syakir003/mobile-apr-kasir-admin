import 'package:flutter_test/flutter_test.dart';
import 'package:epos_ac/data/models/installation_package.dart';
import 'package:epos_ac/data/models/product.dart';
import 'package:epos_ac/data/models/service_item.dart';
import 'package:epos_ac/data/models/sparepart.dart';
import 'package:epos_ac/data/repositories/master_data_repository.dart';
import 'package:epos_ac/data/repositories/package_repository.dart';

/// Body request Nest dibangun manual (camelCase) — beda dari `toMap()`
/// (snake_case, punya Supabase). Tes ini mengunci bentuk body persis sama
/// dengan DTO Nest (`CreateProductDto`/`CreateSparepartDto`/
/// `CreateServiceDto`/`CreateInstallationPackageDto`), termasuk field yang
/// SENGAJA tidak ikut (buyPrice — sudah pindah ke item_costs).
void main() {
  test('productToNestBody: camelCase, buyPrice tidak ikut', () {
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
      photoUrl: 'https://x/y.png',
      description: 'hemat listrik',
      category: 'AC 1 PK',
      active: true,
    );
    expect(productToNestBody(p), {
      'name': 'AC Sharp 1 PK',
      'brand': 'Sharp',
      'type': 'AH-X9',
      'pk': 1.0,
      'inverter': true,
      'btu': 9000,
      'watt': 780,
      'warranty': '3 tahun',
      'sellPrice': 3500000,
      'stock': 10,
      'photoUrl': 'https://x/y.png',
      'description': 'hemat listrik',
      'category': 'AC 1 PK',
      'active': true,
    });
    expect(productToNestBody(p).containsKey('buyPrice'), isFalse);
    expect(productToNestBody(p).containsKey('id'), isFalse);
  });

  test('sparepartToNestBody: camelCase, buyPrice tidak ikut', () {
    const s = Sparepart(
      id: 's1',
      name: 'Freon R32',
      sku: 'SP-0001',
      category: 'sparepart',
      unit: 'tabung',
      buyPrice: 400000,
      sellPrice: 500000,
      stock: 10,
      minStock: 2,
      active: true,
    );
    expect(sparepartToNestBody(s), {
      'name': 'Freon R32',
      'sku': 'SP-0001',
      'category': 'sparepart',
      'unit': 'tabung',
      'sellPrice': 500000,
      'stock': 10,
      'minStock': 2,
      'active': true,
    });
    expect(sparepartToNestBody(s).containsKey('buyPrice'), isFalse);
  });

  test('serviceToNestBody: camelCase', () {
    const svc = ServiceItem(
      id: 'sv1',
      name: 'Cuci AC',
      category: 'cuci',
      basePrice: 75000,
      durationMinutes: 60,
      description: 'cuci standar',
      active: true,
    );
    expect(serviceToNestBody(svc), {
      'name': 'Cuci AC',
      'category': 'cuci',
      'basePrice': 75000,
      'durationMinutes': 60,
      'description': 'cuci standar',
      'active': true,
    });
  });

  test('installationPackageToNestBody: item camelCase (bukan snake_case toMap())', () {
    const pkg = InstallationPackage(
      id: 'pk1',
      name: 'Paket Pasang Standar',
      description: 'termasuk pipa 3m',
      items: [
        PackageItem(
          sparepartId: 'sp-1',
          name: 'Pipa AC 1/4-3/8',
          qty: 3,
          unit: 'meter',
          extraPricePerUnit: 25000,
        ),
      ],
      active: true,
    );
    expect(installationPackageToNestBody(pkg), {
      'name': 'Paket Pasang Standar',
      'description': 'termasuk pipa 3m',
      'active': true,
      'items': [
        {
          'sparepartId': 'sp-1',
          'name': 'Pipa AC 1/4-3/8',
          'qty': 3,
          'unit': 'meter',
          'extraPricePerUnit': 25000,
        },
      ],
    });
  });
}
