package com.ayubpodorukun.epos_ac

import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity

class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Channel default untuk push FCM (lihat meta-data di AndroidManifest).
        // Tanpa ini FCM memakai channel cadangannya sendiri
        // (`fcm_fallback_notification_channel`) yang importance-nya DEFAULT (3),
        // sehingga notifikasi hanya masuk tray tanpa pop-up melayang. HIGH (4)
        // yang memunculkan heads-up.
        //
        // Importance sebuah channel tak bisa dinaikkan setelah channel dibuat,
        // jadi kalau nilainya perlu berubah, buat channel dengan id baru.
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                "epos_push_high",
                "Notifikasi APR-POS",
                NotificationManager.IMPORTANCE_HIGH,
            )
        )
    }
}
