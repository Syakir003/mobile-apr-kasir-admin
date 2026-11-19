import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:print_bluetooth_thermal/print_bluetooth_thermal.dart';

import '../../core/theme/app_theme.dart';

/// Cetak langsung ke printer thermal 58mm lewat Bluetooth (padanan "Cetak ke Thermal" di web, yang memakai Web Serial).
/// Printer cukup dipasangkan sekali di pengaturan Bluetooth HP; pilihan printer diingat untuk cetak berikutnya.
const _macKey = 'thermal_printer_mac';
const _storage = FlutterSecureStorage();

class ThermalPrintException implements Exception {
  const ThermalPrintException(this.message);
  final String message;
  @override
  String toString() => message;
}

/// Kirim [bytes] ke printer. Melempar [ThermalPrintException] dengan pesan siap tampil bila gagal.
Future<void> printThermal(BuildContext context, Uint8List bytes) async {
  if (!await PrintBluetoothThermal.isPermissionBluetoothGranted) {
    throw const ThermalPrintException('Izin Bluetooth belum diberikan. Izinkan lewat pengaturan aplikasi.');
  }
  if (!await PrintBluetoothThermal.bluetoothEnabled) {
    throw const ThermalPrintException('Bluetooth belum aktif. Nyalakan Bluetooth lalu coba lagi.');
  }
  final paired = await PrintBluetoothThermal.pairedBluetooths;
  if (paired.isEmpty) {
    throw const ThermalPrintException('Belum ada printer yang dipasangkan. Pasangkan printer di pengaturan Bluetooth HP.');
  }

  final saved = await _storage.read(key: _macKey);
  var mac = paired.any((p) => p.macAdress == saved) ? saved : null;
  if (mac == null) {
    if (!context.mounted) return;
    mac = await _pickPrinter(context, paired);
    if (mac == null) return; // dibatalkan
  }

  if (!await PrintBluetoothThermal.connect(macPrinterAddress: mac)) {
    await _storage.delete(key: _macKey); // printer berganti/mati: tanya lagi di cetak berikutnya
    throw const ThermalPrintException('Tidak bisa terhubung ke printer. Nyalakan printer lalu ketuk Cetak Thermal lagi.');
  }
  try {
    await _storage.write(key: _macKey, value: mac);
    // Printer Bluetooth punya buffer kecil: kirim per potongan dengan jeda (sama dengan web).
    for (var i = 0; i < bytes.length; i += 128) {
      final end = i + 128 > bytes.length ? bytes.length : i + 128;
      if (!await PrintBluetoothThermal.writeBytes(bytes.sublist(i, end))) {
        throw const ThermalPrintException('Gagal mengirim data ke printer.');
      }
      await Future<void>.delayed(const Duration(milliseconds: 40));
    }
    await Future<void>.delayed(const Duration(milliseconds: 300));
  } finally {
    await PrintBluetoothThermal.disconnect;
  }
}

Future<String?> _pickPrinter(BuildContext context, List<BluetoothInfo> paired) {
  return showModalBottomSheet<String>(
    context: context,
    builder: (sheet) => SafeArea(
      child: ListView(
        shrinkWrap: true,
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(16, 16, 16, 4),
            child: Text('Pilih printer thermal', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
          ),
          for (final p in paired)
            ListTile(
              leading: const Icon(Icons.print_outlined, color: AppColors.slate500),
              title: Text(p.name),
              subtitle: Text(p.macAdress),
              onTap: () => Navigator.of(sheet).pop(p.macAdress),
            ),
        ],
      ),
    ),
  );
}
