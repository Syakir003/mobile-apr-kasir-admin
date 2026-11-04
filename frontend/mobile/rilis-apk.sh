#!/usr/bin/env bash
# Rilis APK baru ke teknisi (jalankan DI LAPTOP, dari folder frontend/mobile, lewat Git Bash):
#
#   1. naikkan `version:` di pubspec.yaml, MISAL 1.0.1+2 (angka setelah + WAJIB lebih besar dari rilis sebelumnya)
#   2. flutter build apk --release --split-per-abi      (atau tanpa --split-per-abi bila mau satu APK universal)
#   3. bash rilis-apk.sh [--min <build>] "catatan rilis"
#
# --min <build>: HP dengan build di bawah angka itu DIPAKSA update (pakai bila kontrak API berubah dan APK lama
#                bisa error). Tanpa --min, update hanya ditawarkan (bisa "Nanti").
# APK yang diunggah: build/app/outputs/flutter-apk/app-release.apk, atau ABI arm64-v8a bila dibuild dengan
# --split-per-abi (hampir semua HP Android sekarang).
#
# Pengaman: menolak bila APK bukan ditandatangani keystore release (APK debug-signed tidak bisa meng-update HP yang
# sudah terpasang) atau bila build tidak lebih besar dari yang sudah terbit.
set -euo pipefail
cd "$(dirname "$0")"

VPS=root@72.62.126.51
API=https://api.ayubpodorukun.com
OUT=build/app/outputs/flutter-apk

MIN=0
if [ "${1:-}" = "--min" ]; then MIN=${2:?--min butuh angka build}; shift 2; fi
NOTES=${1:-}

VER=$(grep -E '^version:' pubspec.yaml | head -1 | awk '{print $2}')
NAME=${VER%%+*}
BUILD=${VER##*+}
[[ "$VER" == *+* && "$BUILD" =~ ^[0-9]+$ ]] || { echo "version di pubspec.yaml harus berbentuk 1.0.1+2 (ada +angka build)"; exit 1; }

# Yang TERBARU di antara APK universal dan arm64 (folder ini menyimpan build lama juga, mis. yang masih kunci debug).
APK=$(ls -t "$OUT/app-release.apk" "$OUT/app-arm64-v8a-release.apk" 2>/dev/null | head -1)
[ -n "$APK" ] || { echo "APK release tidak ditemukan di $OUT. Jalankan flutter build apk --release dulu."; exit 1; }
[ "$APK" -nt pubspec.yaml ] || { echo "APK lebih lama dari pubspec.yaml: build ulang dulu supaya versinya cocok."; exit 1; }

# Tanda tangan APK harus sama dengan keystore release.
KP=android/key.properties
[ -f "$KP" ] || { echo "android/key.properties tidak ada: ini bukan laptop yang memegang kunci rilis."; exit 1; }
prop() { grep -E "^$1=" "$KP" | head -1 | cut -d= -f2-; }
# keytool tidak bisa membaca tanda tangan APK v2/v3, jadi pakai apksigner dari Android SDK build-tools.
SDK=$(python - <<'PY'
import os, re
d = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT") or ""
if not d and os.path.exists("android/local.properties"):
    m = re.search(r"^sdk\.dir=(.*)$", open("android/local.properties").read(), re.M)
    d = m.group(1).strip().replace("\\\\", "/").replace("\\:", ":") if m else ""
print(d)
PY
)
APKSIGNER=$(ls -d "$(cygpath -u "$SDK" 2>/dev/null || echo "$SDK")"/build-tools/*/apksigner* 2>/dev/null | grep -v '\.jar$' | sort -V | tail -1)
[ -n "$APKSIGNER" ] || { echo "apksigner tidak ditemukan (Android SDK build-tools). Atur ANDROID_HOME."; exit 1; }
norm() { tr -d ': \r' | tr 'A-F' 'a-f'; }
want=$(keytool -list -keystore "$(prop storeFile)" -storepass "$(prop storePassword)" 2>/dev/null | grep -i 'fingerprint' | head -1 | awk '{print $NF}' | norm)
have=$("$APKSIGNER" verify --print-certs "$APK" 2>/dev/null | grep -i 'certificate SHA-256 digest' | head -1 | awk '{print $NF}' | norm)
[ -n "$want" ] && [ "$want" = "$have" ] || { echo "APK TIDAK ditandatangani keystore release (APK: ${have:-?}, keystore: ${want:-?})."; exit 1; }

# Build harus lebih besar dari yang sudah terbit.
CUR=$(curl -fsS -m 10 "$API/app-version" 2>/dev/null | python -c "import sys,json; print(json.load(sys.stdin).get('buildNumber',0))" 2>/dev/null || echo 0)
[ "$BUILD" -gt "$CUR" ] || { echo "Build $BUILD tidak lebih besar dari yang terbit ($CUR). Naikkan angka setelah + di pubspec.yaml."; exit 1; }

FILE="epos-ac-$NAME-b$BUILD.apk"
JSON=$(python - "$NAME" "$BUILD" "$MIN" "$API/downloads/$FILE" "$NOTES" <<'PY'
import json, sys
n, b, m, u, notes = sys.argv[1:6]
print(json.dumps({"versionName": n, "buildNumber": int(b), "minBuildNumber": int(m), "downloadUrl": u, "notes": notes}, ensure_ascii=False))
PY
)

echo "Rilis $NAME (build $BUILD, min $MIN) dari $APK ($(du -h "$APK" | cut -f1))"
scp -q "$APK" "$VPS:/var/www/epos-apk/downloads/$FILE.part"
# version.json diganti paling akhir dan atomik: app tidak pernah melihat info versi yang file-nya belum utuh.
ssh "$VPS" "chmod 644 /var/www/epos-apk/downloads/$FILE.part && mv /var/www/epos-apk/downloads/$FILE.part /var/www/epos-apk/downloads/$FILE && cat > /var/www/epos-apk/version.json.tmp && mv /var/www/epos-apk/version.json.tmp /var/www/epos-apk/version.json" <<<"$JSON"

echo "Selesai. Cek:"
curl -fsS -m 10 "$API/app-version"; echo
curl -fsSI -m 10 "$API/downloads/$FILE" | head -4
