#!/usr/bin/env bash
set -euo pipefail

echo "╭─❖ ᴄɪᴘɪsᴍᴘ ʙᴏᴛ ɪɴsᴛᴀʟʟᴇʀ ❖"
echo "│ ✦ Memeriksa lingkungan Node.js..."

if ! command -v node >/dev/null 2>&1; then
  echo "│ ❌ Node.js tidak ditemukan! Gunakan Node.js versi 20 atau lebih baru."
  echo "╰────────────"
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "│ ❌ Versi Node.js saat ini $(node -v). Wajib Node.js >= 20!"
  echo "╰────────────"
  exit 1
fi

echo "│ ✦ Node.js terdeteksi: $(node -v) | npm: $(npm -v)"
mkdir -p database backups session logs assets/fonts assets/backgrounds assets/gacha

if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  echo "│ ✿ File .env berhasil dibuat dari .env.example (jangan lupa diisi ya!)"
fi

echo "│ ✦ Memasang dependensi npm tanpa kompilasi manual..."
if ! npm install --no-audit --no-fund; then
  echo "│ ⚠️  Instalasi standar mengalami kendala, mencoba mode kompatibilitas panel..."
  npm install --no-audit --no-fund --ignore-scripts
fi

echo "│ ✦ Menguji modul inti (SQLite + Canvas/Sharp)..."
node -e "
  let dbDriver = 'sql.js (WASM fallback)';
  try { require('better-sqlite3'); dbDriver = 'better-sqlite3 (native prebuild)'; } catch {}
  let gfxDriver = 'sharp (SVG fallback)';
  try { require('@napi-rs/canvas'); gfxDriver = '@napi-rs/canvas + sharp'; } catch {}
  console.log('│ ✅ Database driver aktif :', dbDriver);
  console.log('│ ✅ Graphics driver aktif :', gfxDriver);
"

echo "│ ♡ Instalasi selesai! Edit file .env lalu jalankan: npm start"
echo "╰────────────"
