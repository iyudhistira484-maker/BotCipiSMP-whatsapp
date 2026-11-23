#!/usr/bin/env bash
set -u

export TZ="${TZ:-Asia/Jakarta}"
export NODE_ENV="${NODE_ENV:-production}"

mkdir -p database backups session logs

if [ ! -d node_modules ]; then
  echo "✦ node_modules belum ada, menjalankan install.sh terlebih dahulu..."
  bash ./install.sh
fi

echo "╭─❖ ᴍᴇɴᴊᴀʟᴀɴᴋᴀɴ ᴄɪᴘɪsᴍᴘ ʙᴏᴛ ❖"
echo "│ ✦ Zona Waktu : $TZ"
echo "│ ✦ Node.js    : $(node -v)"
echo "╰────────────"

# Loop auto-restart aman untuk Panel Hosting (Pterodactyl) tanpa PM2
while true; do
  node index.js
  EXIT_CODE=$?
  if [ "$EXIT_CODE" -eq 0 ]; then
    echo "✿ Bot berhenti secara normal (exit 0)."
    break
  fi
  echo "⚠️ Bot berhenti dengan kode $EXIT_CODE. Menyalakan ulang dalam 5 detik..."
  sleep 5
done
