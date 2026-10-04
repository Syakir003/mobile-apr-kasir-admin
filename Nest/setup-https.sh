#!/usr/bin/env bash
# HTTPS via Nginx + Let's Encrypt (jalankan DI VPS sebagai root):
#   APP_DOMAIN=app.contoh.com API_DOMAIN=api.contoh.com EMAIL=kamu@mail.com bash Nest/setup-https.sh
# Prasyarat: A record APP_DOMAIN & API_DOMAIN sudah menunjuk ke IP VPS (cek: dig +short $APP_DOMAIN).
# APP_DOMAIN -> Next (3001, web admin). API_DOMAIN -> Nest (3000, mobile + websocket).
set -euo pipefail
: "${APP_DOMAIN:?isi APP_DOMAIN}" "${API_DOMAIN:?isi API_DOMAIN}" "${EMAIL:?isi EMAIL}"
IP=$(curl -s https://api.ipify.org)
for d in "$APP_DOMAIN" "$API_DOMAIN"; do
  [ "$(dig +short "$d" | tail -1)" = "$IP" ] || { echo "$d belum menunjuk ke $IP. Berhenti."; exit 1; }
done

apt-get update -qq && apt-get install -y -qq nginx certbot python3-certbot-nginx

site() { # nama domain port
cat > "/etc/nginx/sites-available/$1" <<CONF
server {
  listen 80;
  server_name $2;
  client_max_body_size 20m;   # upload foto job
  location / {
    proxy_pass http://127.0.0.1:$3;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Upgrade \$http_upgrade;       # websocket
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 300s;
  }
}
CONF
ln -sf "/etc/nginx/sites-available/$1" "/etc/nginx/sites-enabled/$1"
}
site epos-web "$APP_DOMAIN" 3001
site epos-api "$API_DOMAIN" 3000
nginx -t && systemctl reload nginx

certbot --nginx --non-interactive --agree-tos -m "$EMAIL" --redirect -d "$APP_DOMAIN" -d "$API_DOMAIN"
systemctl list-timers | grep -i certbot || true

echo
echo "Cek: curl -sI https://$APP_DOMAIN/login | head -1 ; curl -sI https://$API_DOMAIN/ | head -1"
echo "LANGKAH LANJUT (manual): set NEXT_PUBLIC_BACKEND_WS_URL=https://$API_DOMAIN di env frontend lalu rebuild (dibake saat build),"
echo "arahkan base URL aplikasi mobile ke https://$API_DOMAIN, lalu batasi CORS backend ke https://$APP_DOMAIN."
