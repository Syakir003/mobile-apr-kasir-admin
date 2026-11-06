#!/usr/bin/env bash
# Siapkan VPS untuk membagikan APK app mobile (SEKALI saja, jalankan DI VPS sebagai root, aman diulang):
#   bash /var/www/mobile-apr-kasir-admin/Nest/setup-apk-hosting.sh
#
# Hasil:
#   /var/www/epos-apk/downloads/   -> file .apk, dilayani nginx di https://api.ayubpodorukun.com/downloads/
#   /var/www/epos-apk/version.json -> dibaca backend lewat GET /app-version (TIDAK dilayani langsung oleh nginx)
# Keduanya di luar repo, jadi git pull / deploy-vps.sh tidak pernah menimpanya.
# Hanya menyisipkan satu blok `location` ke site epos-api; bagian SSL/Certbot tidak disentuh.
# Kalau `nginx -t` gagal, konfigurasi dikembalikan otomatis.
set -euo pipefail

CONF=/etc/nginx/sites-available/epos-api
STAMP=$(date +%Y%m%d-%H%M)

mkdir -p /var/www/epos-apk/downloads /root/backup
chmod 755 /var/www/epos-apk /var/www/epos-apk/downloads

if grep -q "location /downloads/" "$CONF"; then
  echo "Blok /downloads/ sudah ada di $CONF, tidak diubah."
  exit 0
fi

BAK=/root/backup/nginx-epos-api-$STAMP.bak
cp "$CONF" "$BAK"

python3 - "$CONF" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
marker = "    location / {\n        proxy_pass http://127.0.0.1:3000;"
assert s.count(marker) == 1, "bentuk konfigurasi tidak dikenal, tidak diubah"
block = '''    # APK app mobile (dibagikan tanpa Play Store). Hanya subfolder downloads/ yang dilayani;
    # version.json ada di /var/www/epos-apk/ dan dibaca backend lewat GET /app-version.
    location /downloads/ {
        alias /var/www/epos-apk/downloads/;
        autoindex off;
        types { application/vnd.android.package-archive apk; }
        add_header Cache-Control "no-cache";
        add_header X-Content-Type-Options "nosniff";
    }

'''
open(p, "w").write(s.replace(marker, block + marker))
PY

if nginx -t; then
  systemctl reload nginx
  echo "OK: nginx dimuat ulang. Cadangan konfigurasi lama: $BAK"
else
  echo "nginx -t GAGAL, mengembalikan konfigurasi lama."
  cp "$BAK" "$CONF"
  nginx -t
  exit 1
fi
