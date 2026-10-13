#!/usr/bin/env bash
# Hardening SSH + fail2ban (jalankan DI VPS sebagai root).
# URUTAN WAJIB agar tidak terkunci:
#  1. Di LAPTOP: ssh-keygen -t ed25519   lalu   ssh-copy-id root@72.62.126.51   (atau tempel .pub ke ~/.ssh/authorized_keys)
#  2. Di laptop, buka terminal BARU, buktikan: ssh -o PasswordAuthentication=no root@72.62.126.51  -> masuk tanpa password
#  3. Baru jalankan skrip ini. JANGAN tutup sesi SSH yang lama sampai langkah 2 diulang berhasil sesudahnya.
set -euo pipefail
[ -s /root/.ssh/authorized_keys ] || { echo "authorized_keys kosong -> kamu akan terkunci. Berhenti."; exit 1; }
read -r -p 'Sudah buktikan login pakai KUNCI dari terminal lain? Ketik "ya": ' OK </dev/tty
[ "$OK" = "ya" ] || { echo "Dibatalkan."; exit 0; }

# 00- supaya menang atas 50-cloud-init.conf (sshd: nilai pertama yang dipakai).
cat > /etc/ssh/sshd_config.d/00-hardening.conf <<CONF
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
CONF
sshd -t
systemctl reload ssh || systemctl reload sshd

apt-get install -y -qq fail2ban
cat > /etc/fail2ban/jail.d/sshd.local <<CONF
[sshd]
enabled = true
maxretry = 5
findtime = 10m
bantime = 1h
CONF
systemctl enable --now fail2ban && systemctl restart fail2ban

echo; sshd -T | grep -E '^(passwordauthentication|permitrootlogin|pubkeyauthentication)'
fail2ban-client status sshd | head -5
echo "SEKARANG, dari laptop (terminal baru): ssh root@72.62.126.51 harus masuk pakai kunci. Sesi ini jangan ditutup dulu."
