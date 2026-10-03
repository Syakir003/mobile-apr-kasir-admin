#!/usr/bin/env bash
# Deploy E-POS AC ke VPS (jalankan DI VPS sebagai root):
#   scp Nest/deploy-vps.sh root@72.62.126.51:/root/ && ssh -t root@72.62.126.51 "bash /root/deploy-vps.sh"
# atau salin ke VPS lalu: bash deploy-vps.sh [branch]
#
# Urutan: cek awal -> backup DB -> pull -> migrasi -> build -> restart -> cek sehat.
# Berhenti di langkah pertama yang gagal. Migrasi Prisma TIDAK bisa di-undo otomatis;
# jalan balik = restore dump (lihat pesan di akhir kalau gagal).
set -euo pipefail

APP=/var/www/mobile-apr-kasir-admin
BRANCH=${1:-syakir}
BE=$APP/Nest/epos-backend
FE=$APP/Nest/epos-frontend-web
BACKUP_DIR=/root/backup
STAMP=$(date +%Y%m%d-%H%M)
DUMP=$BACKUP_DIR/epos_db-$STAMP.dump

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }

cd "$APP"
PREV=$(git rev-parse HEAD)

on_fail() {
  cat <<EOF

DEPLOY GAGAL. Kode sebelumnya: $PREV   Dump DB: $DUMP
Kalau MIGRASI belum jalan  -> cukup: git checkout $PREV && pm2 restart epos-backend epos-frontend
Kalau MIGRASI sudah jalan  -> kembalikan DB dulu:
  pg_restore --clean --if-exists --no-owner -d "$DB_URL_PLAIN" $DUMP
  lalu: git checkout $PREV && (cd $BE && npx prisma generate && npm run build) && (cd $FE && npm run build) && pm2 restart epos-backend epos-frontend
EOF
}
DB_URL_PLAIN=""
trap on_fail ERR

say "1/7 Cek awal"
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "Ada perubahan lokal di VPS:"; git status --short; echo "Commit/stash dulu, lalu ulangi."; exit 1; }
git fetch origin "$BRANCH"
echo "VPS sekarang : $(git log --oneline -1)"
echo "Akan deploy  : $(git log --oneline -1 FETCH_HEAD)"
git merge-base --is-ancestor HEAD FETCH_HEAD || { echo "Bukan fast-forward (VPS punya commit yang tidak ada di origin/$BRANCH). Berhenti."; exit 1; }
echo "Jumlah commit baru: $(git rev-list --count HEAD..FETCH_HEAD)"

# DATABASE_URL dari .env backend; buang ?schema=... karena psql/pg_dump tidak mengenalnya.
DB_URL_PLAIN=$(grep -E '^DATABASE_URL=' "$BE/.env" | head -1 | cut -d= -f2- | tr -d '"' | sed 's/?.*$//')
[ -n "$DB_URL_PLAIN" ] || { echo "DATABASE_URL tidak ketemu di $BE/.env"; exit 1; }

say "2/7 Pra-cek data (migrasi 20260922 mewajibkan products.sell_price terisi)"
NULLS=$(psql "$DB_URL_PLAIN" -Atc "select count(*) from products where sell_price is null" 2>/dev/null || echo "?")
echo "products dengan sell_price NULL: $NULLS"
if [ "$NULLS" != "0" ]; then
  echo "Isi dulu (atau cek migrasi 20260922000000_uniform_sell_price) sebelum lanjut."; exit 1
fi
echo "Ringkasan isi DB:"
psql "$DB_URL_PLAIN" -Atc "select 'invoices='||count(*) from invoices union all select 'members='||count(*) from members union all select 'products='||count(*) from products"

say "3/7 Backup database -> $DUMP"
mkdir -p "$BACKUP_DIR"
pg_dump -Fc "$DB_URL_PLAIN" -f "$DUMP"
cp "$BE/.env" "$BACKUP_DIR/backend-env-$STAMP.bak"
pg_restore -l "$DUMP" >/dev/null && echo "Dump valid: $(du -h "$DUMP" | cut -f1)"

read -r -p $'\nLanjut pull + migrasi + restart? Ketik "ya": ' OK </dev/tty
[ "$OK" = "ya" ] || { echo "Dibatalkan. (Backup tetap tersimpan.)"; trap - ERR; exit 0; }

say "4/7 Pull kode"
git merge --ff-only FETCH_HEAD
git log --oneline -1

say "5/7 Backend: install, migrasi, build"
cd "$BE"
npm ci
npx prisma generate
npx prisma migrate status || true
npx prisma migrate deploy
npm run build
[ -f dist/src/main.js ] || { echo "dist/src/main.js tidak ada setelah build"; exit 1; }

say "6/7 Frontend: install + build"
cd "$FE"
npm ci
npm run build

say "7/7 Restart + cek sehat"
pm2 restart epos-backend epos-frontend
sleep 8
BE_CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/ || true)
FE_CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/login || true)
echo "backend  :3000/       -> $BE_CODE"
echo "frontend :3001/login  -> $FE_CODE"
[ "$BE_CODE" = "200" ] && [ "$FE_CODE" = "200" ] || { echo "Health check gagal. Cek: pm2 logs --lines 50"; exit 1; }
pm2 save >/dev/null
pm2 ls

trap - ERR
say "SELESAI. Kode: $(git -C "$APP" log --oneline -1). Backup: $DUMP"
echo "Cek manual: login admin, buka POS, Keluar Gudang, Pengingat WA. Log: pm2 logs epos-backend --lines 30"
