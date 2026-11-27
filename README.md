<p align="center">
  <img src="panel/public/assets/logo-cp.svg" alt="Cipi Panel — monogram CP" width="104" height="104" />
</p>

# 🌸 BotCipiSMP WhatsApp — Kawaii Anime 24/7 (Minecraft & Discord Ready)

Bot WhatsApp serbaguna bertema **Kawaii Anime Pink** berbasis **Node.js (>=20)** dan **@whiskeysockets/baileys**, dirancang berjalan stabil 24 jam di **Hosting Panel (Pterodactyl)** maupun **VPS (PM2)**, serta terintegrasi dengan **Minecraft (Java + Geyser Bedrock)** dan **Discord**.

---

## ✦ Daftar Isi
1. [Persyaratan Lingkungan & Alternatif Dependensi Panel](#1-persyaratan-lingkungan--alternatif-dependensi-panel)
2. [Instalasi Cepat (Panel & VPS)](#2-instalasi-cepat-panel--vps)
3. [Konfigurasi File `.env`](#3-konfigurasi-file-env)
4. [Cara Login Pairing Code (Tanpa QR)](#4-cara-login-pairing-code-tanpa-qr)
5. [Menjalankan 24 Jam dengan PM2 atau Panel](#5-menjalankan-24-jam-dengan-pm2-atau-panel)
6. [Tombol Interaktif (`USE_BUTTONS`), Fallback & Risikonya](#6-tombol-interaktif-use_buttons-fallback--risikonya)
7. [Mode Simulasi (`DRY_RUN`)](#7-mode-simulasi-dry_run)
8. [Cara Menambah Command Baru](#8-cara-menambah-command-baru)
9. [Cara Mengganti Gambar Anime, Background & Font](#9-cara-mengganti-gambar-anime-background--font)
10. [Setup Webhook Discord & Pterodactyl API](#10-setup-webhook-discord--pterodactyl-api)
11. [Daftar Command Aktif (Fase 1 & Fase 2)](#11-daftar-command-aktif-fase-1--fase-2)

---

## 1. Persyaratan Lingkungan & Alternatif Dependensi Panel
- **Node.js**: Versi **20.0.0** atau lebih baru (direkomendasikan Node.js 20 LTS / 22 LTS).
- **Tanpa Kompilasi Manual**: Seluruh dependensi dipilih menggunakan *prebuilt binary* N-API / WebAssembly sehingga tidak membutuhkan `python3`/`g++`/`make` di panel hosting.

### ❖ Bagaimana jika `@napi-rs/canvas` atau `better-sqlite3` gagal di Panel tertentu?
Arsitektur bot ini sudah dilengkapi **Fallback Berlapis Otomatis** tanpa perlu mengubah kode:

1. **Alternatif Database (`lib/database.js`)**:
   - **Utama**: `better-sqlite3` (`13.2.0`) — memakai prebuild N-API resmi dengan mode WAL berkecepatan tinggi.
   - **Alternatif 1 (Otomatis)**: `node:sqlite` (`DatabaseSync` bawaan Node.js >= 22.5) tanpa paket tambahan.
   - **Alternatif 2 (Otomatis)**: `sql.js` (`1.13.0`, WebAssembly murni) — berjalan di **100% semua container/panel** (termasuk Alpine/musl/ARM) tanpa kompilasi native sama sekali! Kamu juga bisa memaksa driver tertentu lewat `.env`: `DB_DRIVER=sql.js` (atau memasang `sqlite3` bila dibutuhkan).
2. **Alternatif Kartu Gambar (`lib/card.js`)**:
   - **Utama**: `@napi-rs/canvas` (`1.2.0`) + `sharp` (`0.35.5`).
   - **Alternatif 1 (Otomatis)**: Jika `@napi-rs/canvas` gagal dimuat di arsitektur CPU panel kamu, `lib/card.js` otomatis merender kartu bertema pink pastel lewat **SVG Rasterizer `sharp`**.
   - **Alternatif 2 (Otomatis)**: Jika proses gambar gagal total, setiap command otomatis mengirim **pesan teks kawaii berbingkai** (bot tidak pernah crash).
3. **Pembuat Stiker Gambar & Video (`lib/sticker.js` — Fase 2)**:
   - Stiker foto diproses langsung oleh `sharp` + `node-webpmux` (murni JS untuk metadata EXIF WhatsApp).
   - Stiker video/GIF memakai `@ffmpeg-installer/ffmpeg` (binary statis dari npm tanpa `apt install` di panel) dan otomatis beralih ke `ffmpeg` sistem bila tersedia.

---

## 2. Instalasi Cepat (Panel & VPS)

```bash
# 1. Jalankan installer otomatis (membuat folder, menyalin .env, dan memasang paket)
bash ./install.sh

# 2. Uji kesiapan seluruh modul inti (opsional namun disarankan)
npm run check
```

Jika di panel Pterodactyl kamu hanya memiliki akses tombol **Startup**, cukup isi *Startup Command* dengan:
```bash
bash ./start.sh
```

---

## 3. Konfigurasi File `.env`
Salin `.env.example` menjadi `.env`, lalu sesuaikan nilainya:
```bash
cp .env.example .env
nano .env
```

| Variabel | Contoh Nilai | Penjelasan |
|---|---|---|
| `BOT_NAME` | `CipiSMP Bot` | Nama bot yang tampil di kartu & header menu |
| `PREFIX` | `.` | Awalan pemicu command (misal `.menu`, `.profil`) |
| `PAIRING_NUMBER` | `6281234567890` | Nomor WhatsApp khusus akun bot (tanpa `+`, tanpa `-`, diawali kode negara `62`) |
| `OWNER_NUMBERS` | `6281234567890,628987654321` | Nomor WhatsApp Owner (pisahkan koma jika >1). Mengunci command `ownerOnly` |
| `USE_BUTTONS` | `true` | `true` untuk tombol interaktif, `false` untuk mode kartu + teks biasa |
| `DRY_RUN` | `false` | `true` untuk mode simulasi aman (broadcast/bridge/kontrol server tidak benar-benar dikirim) |
| `TZ` | `Asia/Jakarta` | Zona waktu wajib WIB untuk ucapan waktu, jadwal backup, & reset limit 00:00 WIB |

> **Keamanan**: Jangan pernah membagikan atau meng-commit file `.env`. Logger bawaan (`lib/logger.js`) juga otomatis menyensor seluruh token/API key agar tidak pernah bocor di konsol maupun `logs/error.log`.

---

## 4. Cara Login Pairing Code (Tanpa QR)
Bot ini **100% menggunakan Pairing Code** tanpa perlu scan QR:

1. Pastikan `PAIRING_NUMBER=628xxxxxxxxxx` di `.env` sudah diisi dengan nomor WhatsApp yang akan dijadikan bot.
2. Jalankan bot:
   ```bash
   npm start
   ```
   *(Atau lewat argumen langsung: `node index.js --pairing=6281234567890`)*
3. Tunggu ~3 detik hingga muncul kotak di konsol seperti berikut:
   ```text
   ╭─❖ ᴋᴏᴅᴇ ᴘᴀɪʀɪɴɢ ᴡʜᴀᴛsᴀᴘᴘ ❖
   │ ✦ ɴᴏᴍᴏʀ ʙᴏᴛ   : +6281234567890
   │ ✦ ᴋᴏᴅᴇ ᴘᴀɪʀɪɴɢ: ABCD-EFGH
   ╰────────────
   ```
4. Buka aplikasi WhatsApp di HP akun bot -> **Perangkat Tertaut (Linked Devices)** -> **Tautkan Perangkat** -> pilih **Tautkan dengan nomor telepon saja**, lalu ketik 8 karakter kode tersebut.
5. Sesi tersimpan otomatis di folder `./session` dan bot akan **auto-reconnect** sendiri bila jaringan terputus.

---

## 5. Menjalankan 24 Jam dengan PM2 (VPS) atau Panel

### A. Di VPS Menggunakan PM2 (`ecosystem.config.js`)
```bash
# Pasang PM2 secara global bila belum ada
npm install -g pm2

# Jalankan bot di background 24/7
npm run pm2:start

# Simpan daftar proses agar otomatis menyala saat VPS reboot
pm2 save
pm2 startup

# Cek log real-time / restart / stop
npm run pm2:logs
npm run pm2:restart
npm run pm2:stop
```

### B. Di Hosting Panel (Pterodactyl)
Gunakan `./start.sh` sebagai startup script atau `node index.js`. Script `start.sh` sudah memiliki loop auto-restart aman dengan jeda 5 detik apabila proses berhenti tak terduga.

---

## 6. Tombol Interaktif (`USE_BUTTONS`), Fallback & Risikonya
Bot memakai pembungkus `lib/buttons.js` di atas paket `gifted-btns@1.0.2` dan `@whiskeysockets/baileys@7.0.0-rc14` (versi **dikunci ketat/exact** di `package.json` tanpa tanda `^` atau `~`).

- **Cara mematikan tombol**: Ubah `USE_BUTTONS=false` di `.env`, lalu restart bot.
- **Fallback Wajib**: Saat `USE_BUTTONS=false` atau pengiriman tombol gagal, bot otomatis mengirim kartu gambar beserta daftar petunjuk command teks biasa. **Semua aksi tombol selalu bisa dijalankan lewat ketikan command biasa**.
- **Keamanan Tombol**: Tombol terikat pada pengirim (`ownerJid`) sehingga orang lain di grup tidak bisa menekan tombol menu/konfirmasi milikmu, dan otomatis **kedaluwarsa setelah 5 menit**.
- **⚠️ Catatan Risiko Plugin Tombol**:
  WhatsApp Web tidak menyediakan API resmi tombol *native flow* untuk akun non-bisnis. Paket seperti `gifted-btns` menyuntikkan binary node tambahan (`biz` / `interactive` / `native_flow`). Pembaruan protokol WhatsApp sewaktu-waktu dapat membuat tombol tidak tampil di sebagian versi klien, atau meningkatkan risiko pembatasan akun jika dipakai spam massal. Karena itu versi paket dikunci di `package.json`, tersedia `USE_BUTTONS=false`, dan semua fitur tetap berjalan mulus via teks.

---

## 7. Mode Simulasi (`DRY_RUN`)
Ubah `DRY_RUN=true` di `.env` saat ingin menguji fitur sensitif di grup produksi. Saat aktif, fitur **broadcast, bridge chat, dan kontrol server Pterodactyl** hanya menampilkan pratinjau apa yang *akan* dikirim tanpa benar-benar mengeksekusinya ke server Minecraft/Discord/grup lain.

---

## 8. Cara Menambah Command Baru (3 Template Siap Pakai)
Setiap command berdiri sendiri per file di dalam `commands/<kategori>/<nama>.js` dan **dimuat otomatis** saat bot menyala (atau cukup ketik `.reload` di WhatsApp Owner tanpa perlu restart bot!).

Tersedia **3 file template siap pakai** di folder `commands/` (otomatis diabaikan loader selama masih berawalan `_`):
1. `commands/_template.js` — **Template 1**: Command dasar balasan teks kawaii berbingkai.
2. `commands/_template-buttons-card.js` — **Template 2**: Command dengan Kartu Gambar Canvas lokal + Tombol Interaktif (`sendButtons`) beserta fallback teks otomatis.
3. `commands/_template-api-limit.js` — **Template 3**: Command pemanggil API eksternal dengan kuota Limit Harian WIB (`consumeDailyLimit`) & rantai multi-fallback (`runWithApiFallback`).

Salin salah satu template ke subfolder kategori yang diinginkan, misalnya `cp commands/_template.js commands/fun/sapa.js`, lalu sesuaikan isinya:

```js
const { formatSuccess, keep } = require('../../lib/smallcaps');

module.exports = {
  name: 'sapa',
  alias: ['hi', 'halo'],
  category: 'fun',
  description: 'Menyapa bot dengan manis',
  cooldown: 4,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    await ctx.reply(
      formatSuccess('Sapaan Manis', [
        `Halo kak ${keep(ctx.pushName)} ♡ Semoga harimu menyenangkan ya!`,
      ])
    );
  },
};
```

> **Tips `smallcaps`**: Gunakan `keep(teks)` dari `lib/smallcaps.js` jika ingin menampilkan username/kode yang tidak boleh diubah ke huruf small caps. Trigger command (`.menu`), angka, `@mention`, monospace (`` `.ping` ``), dan link URL otomatis terlindungi.

---

## 9. Cara Mengganti Gambar Anime, Background & Font
Seluruh aset disimpan secara lokal di folder `assets/` (tanpa hotlink URL luar agar cepat & tahan offline):
- `assets/mascot.png` — Ilustrasi karakter anime utama di kartu Menu & Status (disarankan PNG persegi `512x512`).
- `assets/default-avatar.png` — Avatar cadangan bila user WhatsApp menyembunyikan foto profil (`320x320`).
- `assets/backgrounds/` — Berisi tema latar belakang kartu (`1080x680`): `pink-sakura.jpg`, `starlight-night.jpg`, `mint-meadow.jpg`, dan `sunset-shrine.jpg` yang terhubung langsung ke `.toko` & `.profil`.
- `assets/gacha/` — Potret ilustrasi anime lokal (`480x480`) untuk kartu Gacha & Pet Virtual (`ssr-sakura.png`, `ssr-celestia.png`, `sr-kitsune.png`, `r-clover.png`, `n-berry.png`).
- `assets/fonts/` — Berisi `DejaVuSans.ttf`, `DejaVuSans-Bold.ttf`, dan `DejaVuSansMono.ttf` yang sudah teruji mendukung seluruh karakter Small Caps Unicode (`ᴀ-ᴢ`) dan simbol `✦ ❖ ◦ ♡ ✿`.

---

## 10. Setup Integrasi AI, Downloader, Webhook Discord & Pterodactyl API

### A. Multi-Provider AI (`.ai`)
Atur di `.env`:
- `AI_PROVIDER=gemini` (mendukung `gemini`, `openai`, `groq`, atau `openrouter`)
- `AI_API_KEY=...` (kunci API resmi provider pilihanmu)
- `AI_MODEL=gemini-2.0-flash` (atau `llama-3.3-70b-versatile` untuk Groq, `gpt-4o-mini` untuk OpenAI/OpenRouter)
- `AI_BASE_URL=` *(opsional bila menggunakan endpoint kustom yang kompatibel dengan OpenAI)*

### B. Downloader Multi-API & Cobalt Opsional (`.tiktok`, `.ig`, `.yt`, `.dl`)
- Secara bawaan, bot memakai **rantai fallback antar API publik** otomatis sehingga bila satu API sedang penuh/down, bot langsung berpindah ke API cadangan berikutnya tanpa error.
- Bila kamu memiliki instance **Cobalt** sendiri untuk stabilitas maksimal, isi `COBALT_API_URL=https://cobalt.domainkamu.com` (dan `DOWNLOADER_API_KEY=` bila memakai proteksi kunci) di `.env`.

### C. Webhook & Bot Discord 2 Arah (`.bcdc`, `.bcall`, Bridge)
1. Buka **Server Settings > Integrations > Webhooks > New Webhook** di server Discord kamu.
2. Pilih channel pengumuman, klik **Copy Webhook URL**, lalu tempel ke `DISCORD_WEBHOOK_URL=` di `.env`. Pengumuman akan dikirim otomatis sebagai **Embed Pink (`#FF5C97`)** lengkap dengan thumbnail maskot anime lokal (`assets/mascot.png`) serta proteksi anti-`@everyone`/`@here`.
3. Untuk **Bridge Chat 2 Arah (`WA <-> Minecraft <-> Discord`)** & tiket: buat aplikasi di [Discord Developer Portal](https://discord.com/developers/applications), aktifkan **Message Content Intent** pada menu **Bot**, salin token ke `DISCORD_BOT_TOKEN=`, lalu isi ID channel pada `DISCORD_BRIDGE_CHANNEL_ID`, `DISCORD_STATUS_CHANNEL_ID`, dan `DISCORD_TICKET_CHANNEL_ID`.

### D. Pterodactyl Client API, WebSocket Wings, Fallback RCON & Geyser
1. Masuk ke Panel Pterodactyl kamu -> klik profil akun di kanan atas -> tab **API Credentials**.
2. Buat Client API Key baru (format `ptlc_...`), lalu isi di `.env`:
   - `PTERO_PANEL_URL=https://panel.domainkamu.com` (tanpa garis miring di akhir)
   - `PTERO_CLIENT_API_KEY=ptlc_xxxxxxxxxxxxxxxx`
   - `PTERO_SERVER_ID=abcd1234` (8 karakter ID pendek server dari URL panel `/server/abcd1234`)
3. Bot otomatis tersambung ke **WebSocket Pterodactyl Wings** (lengkap dengan pembaruan token otomatis & *auto-reconnect*) untuk membaca chat in-game real-time, notifikasi pemain Join/Leave, perubahan status server Online/Offline, dan verifikasi kode `.link`.
4. **Fallback RCON Otomatis**: Isi `RCON_HOST`, `RCON_PORT`, dan `RCON_PASSWORD` di `.env` agar bila Pterodactyl API sedang gangguan, eksekusi command/pengumuman otomatis berpindah ke protokol TCP Source RCON.
5. **GeyserMC (Bedrock)**: Atur awalan nama pemain Bedrock di `MC_BEDROCK_PREFIX=.` (default titik `.`). Sistem `.link` mendukung penuh pemain Java (`NamaJava`) maupun Bedrock (`.NamaBedrock` atau Gamertag berspasi `.Nama Bedrock`) melalui verifikasi chat in-game `CP-XXXXXX` ataupun PIN bisikan `/tell` (`.link verif <PIN>`).
6. **Privasi Bridge**: Aktifkan grup WA sebagai jembatan lewat `.bridge on` di dalam grup (atau isi `WA_BRIDGE_GROUP_JIDS` di `.env`). Saat diaktifkan, bot otomatis menampilkan **Pemberitahuan Privasi** kepada anggota grup dan **tidak pernah menyimpan isi percakapan bridge ke dalam database**.
7. **Mode Uji Aman (`DRY_RUN=true`)**: Aktifkan `DRY_RUN=true` di `.env` saat ingin mengetes alur broadcast, bridge, `.tukar`, dan kontrol server (`.start`/`.stop`/`.restart`/`.backup`/`.console`) tanpa mengeksekusi aksi nyata ke produksi.

### E. Sistem Tiket 2 Arah Discord, Giveaway, Event Cron WIB & Quest Harian (Fase 5)
1. **Tiket Tersinkron Discord (`.lapor` & `.tiket`)**: Isi `DISCORD_TICKET_CHANNEL_ID` (dan opsional `DISCORD_ADMIN_ROLE_ID`) di `.env`. Setiap laporan `.lapor` otomatis membuat Embed & Thread diskusi khusus di Discord. Admin Discord cukup membalas langsung di dalam Thread tersebut (atau mengetik `!balas TKT-XXXX <pesan>` / `!tutup TKT-XXXX <solusi>`), dan balasan akan langsung terkirim ke WhatsApp pelapor!
2. **Event Terjadwal WIB (`.event`)**: Mendukung jadwal sekali jalan (`2026-11-28 19:30`), harian (`harian 19:00`), mingguan (`mingguan sabtu 20:00`), maupun ekspresi `node-cron` dengan zona waktu `Asia/Jakarta` (WIB).
3. **Giveaway & 3 Misi Harian (`.giveaway`, `.ikut`, `.quest`, `.topserver`)**: Undian giveaway berjalan otomatis sesuai durasi (tetap aman meski bot restart), sedangkan 3 misi harian acak per user otomatis direset pukul `00:00 WIB` lengkap dengan bonus sapu bersih `3/3`.

### F. Gacha Waifu, Pet Virtual, Toko Profil, Ulang Tahun WIB & Hiburan (Fase 6)
1. **Gacha Karakter & Starlight Shards (`.gacha`, `.koleksi`)**: Mendukung `1x Pull` maupun `10x Multi-Pull` (diskon 10% + jaminan minimal 1 karakter `SR+`) serta **Pity SSR di pull ke-50**. Karakter duplikat otomatis berubah menjadi **Starlight Shards** yang dapat ditukarkan langsung menjadi karakter `SR`/`SSR` pilihan lewat `.gacha tukar <id>`.
2. **Pet Virtual & Toko Kustomisasi Profil (`.pet`, `.toko`)**: Adopsi 5 spesies peliharaan (`neko`, `kitsune`, `usagi`, `slime`, `dragon`) lengkap dengan kartu Canvas status kenyang/ceria/energi. Di `.toko`, member dapat membeli & memasang **Background**, **Bingkai**, dan **Gelar Kustom** yang langsung memperbarui kartu `.profil`!
3. **Pengingat Ulang Tahun Otomatis (`.ultah`)**: Setiap hari pukul `08:05 WIB`, bot otomatis memeriksa warga yang berulang tahun, memberikan kado `+1.000 Sakura Coin` & `+150 XP`, serta mengirim ucapan selamat di grup.
4. **Game Hiburan Interaktif (`.kuis`, `.tebakgambar`, `.ramalan`, `.quotes`, `.suit`, `.slot`)**: Sesi `.kuis` dan `.tebakgambar` (kartu visual Canvas) dapat dijawab langsung di chat tanpa prefix!

### G. Manajemen Owner Lengkap, Sakura VIP & Sandbox `.eval` Aman (Fase 7)
1. **Kontrol Akses & Maintenance (`.ban`, `.unban`, `.banlist`, `.self`, `.public`, `.maintenance`)**: Owner dapat membatasi user bermasalah (akun Owner terlindungi anti-ban), mengubah bot ke Mode Self (hening terhadap non-Owner), atau mengaktifkan Mode Maintenance dengan pesan pemberitahuan kustom.
2. **Manajemen Sakura VIP Berdurasi (`.addprem`, `.delprem`, `.listprem`, `.vip`)**: Mendukung satuan waktu fleksibel (`12h`, `7d`, `30d`, `1bulan`, `1tahun`, `permanen`). Penambahan durasi pada member VIP aktif otomatis **memperpanjang** sisa waktu sebelumnya!
3. **Hot-Reload Command vs Restart Proses (`.reload` & `.restartbot`)**: Ketik `.reload` untuk memperbarui seluruh file di `commands/` tanpa memutus koneksi WhatsApp, atau `.restartbot` untuk membuat snapshot backup SQLite `pre-restart` lalu me-restart penuh proses Node.js melalui PM2/Panel. *(Catatan: `.restart` tetap khusus me-restart server Minecraft Pterodactyl, sedangkan `.restartbot` me-restart proses bot WhatsApp.)*
4. **Sandbox `.eval` Terkontrol & Panel `.logs`**: Demi keamanan tingkat produksi, `.eval` **mati secara bawaan** (`ENABLE_OWNER_EVAL=false` di `.env`). Saat diaktifkan Owner untuk debugging, kode dieksekusi di dalam `node:vm` terisolasi berbatas waktu (`3s`), tanpa akses `child_process`/hapus file, database dikunci mode baca (`SELECT`), seluruh kunci API/password otomatis disensor (`[REDACTED]`), dan setiap eksekusi tercatat permanen di `.logs`.

---

## 11. Daftar Command Lengkap (Fase 1 s/d Fase 7 — 79 Command Utama)

| Kategori | Command | Fungsi Singkat |
|---|---|---|
| **Info** | `.menu` (`all` / `<kategori>`), `.ping`, `.profil`, `.vip`, `.owner` | Kartu menu utama, status respon & RAM, kartu profil kustom, cek masa aktif Sakura VIP, & vCard Owner |
| **Grup** | `.welcome` (`on`/`off`/`setjoin`/`setleave`/`test`) | Kartu sambutan & perpisahan member bergambar |
| **Grup** | `.antilink` (`on`/`off`), `.antispam` (`on`/`off`), `.mute` (`on`/`off`) | Sensor tautan luar otomatis, pelindung banjir pesan, & bisukan bot di grup |
| **Grup** | `.tagall`, `.hidetag`, `.kick`, `.promote`, `.demote`, `.buka`, `.tutup` | Panggil member, pengumuman tersembunyi, moderasi member & buka/tutup grup |
| **Ekonomi & Level** | `.saldo`, `.daily`, `.weekly`, `.kerja`, `.transfer`, `.leaderboard` (`saldo`/`level`), `.level` | Dompet Sakura Coin, klaim beruntun, kerja kawaii, transfer koin, kartu Top 10 & progres XP otomatis |
| **Tools** | `.sticker` (`.s` / `.s crop` / `.s Pack \| Author`), `.toimg` | Pembuat stiker foto & video/GIF ber-EXIF serta pengubah stiker menjadi PNG |
| **Tools** | `.tiktok` (`.tt`), `.ig`, `.yt` / `.ytmp3`, `.dl` | Downloader TikTok tanpa WM, Reels/Post IG, YouTube MP4/MP3 & auto-router dengan fallback API + info sisa limit |
| **Minecraft & AI** | `.server` (`.mc` / `.ip`), `.ai` (`.tanya`) | Kartu status server Minecraft (Java + Geyser Bedrock) via `mcsrvstat` & chat AI multi-provider berlimit harian |
| **Minecraft & AI** | `.link` (`bedrock` / `verif`), `.unlink`, `.akun`, `.tukar` | Verifikasi akun WA $\leftrightarrow$ Minecraft Java/Bedrock, info jam bermain, & tukar koin ke item in-game berkuota harian (auto-refund bila gagal) |
| **Komunitas** | `.giveaway` (`list`/`buat`/`end`/`reroll`/`batal`), `.ikut` | Giveaway berdurasi dengan tombol publik & undian pemenang + pembagian koin otomatis |
| **Komunitas** | `.event` (`tambah`/`uji`/`hapus`), `.lapor`, `.tiket` (`balas`/`tutup`) | Pengingat event sekali/berulang via `node-cron` WIB & tiket bantuan 2 arah WA $\leftrightarrow$ Discord |
| **Komunitas** | `.topserver` (`playtime`/`quest`), `.quest` (`klaim`) | Kartu Canvas Top 10 Jam Main MC / Penyelesai Misi & 3 Quest Harian acak per user (reset 00:00 WIB) |
| **Kawaii** | `.anime`, `.gacha` (`1`/`10`/`info`/`tukar`), `.koleksi` | Gambar anime acak, Gacha Waifu `N/R/SR/SSR` berkartu Canvas + Pity 50x, & album koleksi |
| **Kawaii** | `.pet` (`adopsi`/`makan`/`main`/`tidur`/`nama`), `.toko`, `.ultah` | Pet Virtual berkartu Canvas, Butik Background/Bingkai/Gelar `.profil`, & pengingat ulang tahun WIB |
| **Hiburan & Game** | `.kuis`, `.tebakgambar`, `.ramalan`, `.quotes`, `.suit`, `.slot` | Kuis trivia & tebak gambar rebus (jawab langsung di chat), Omikuji harian, kutipan anime, suit & mesin slot |
| **Owner** | `.bc`, `.bcmc`, `.bcdc`, `.bcall`, `.ya`, `.batal` | Broadcast ke WA / Minecraft / Discord / Semua dengan preview, konfirmasi 30 detik & cooldown 60 detik |
| **Owner** | `.bridge`, `.start`, `.stop`, `.restart`, `.backup`, `.console`, `.backupdb` | Kelola bridge 2 arah + privasi, kontrol power & backup Pterodactyl, console ber-whitelist aman, & backup DB |
| **Owner** | `.ban`, `.unban`, `.banlist`, `.self`, `.public`, `.maintenance` | Blokir/pulihkan user, daftar ban, kontrol Mode Self/Public, & Mode Maintenance berpesan kustom |
| **Owner** | `.addprem`, `.delprem`, `.listprem`, `.restartbot` (`.reload`), `.eval`, `.logs` | Kelola Sakura VIP berdurasi, hot-reload command / restart proses bot, sandbox `.eval` aman, & panel diagnostik 24/7 |

---

## 12. Cipi Panel (`CP`) — Bot & Resource Control Dashboard

**Cipi Panel (`CP`)** adalah dashboard web bergaya infrastruktur (*Pterodactyl Wings / Vercel*) untuk memantau resource proses & VPS secara real-time serta mengoperasikan seluruh modul bot dari browser.

### Fitur Utama Cipi Panel (`CP`)
- **Brand & Tema Ganda**: Monogram **`CP` (Cipi Panel)** dengan dukungan penuh **Dark Mode** (`Zinc Carbon`) & **Light Mode** (`Daylight Slate`), font lokal *self-hosted* (`Inter` + `JetBrains Mono`), dan angka `tabular-nums`.
- **Real-Time Telemetry & Live Console (`SSE /api/stream`)**: Grafik HiDPI 60-sampel untuk CPU %, Node RSS / V8 Heap, Event-Loop Latency (`ms`), serta *live console* interaktif (`help`, `status`, `mem`, `reload`, `gc`, `backup`, `say <jid> <pesan>`).
- **7 Modul Operasional**: `Console & Graphs`, `Runtime & Commands` (79 command + pairing code), `Minecraft & Wings` (probe server + power + RCON ber-whitelist), `Users & Economy` (inspektor koin/VIP/ban), `Broadcast & Tickets`, `Backups & Storage` (snapshot `.db` + WAL checkpoint), serta `Audit & Access` (`HMAC-SHA256` session + rate-limiter).

### Cara Menjalankan Cipi Panel
```bash
# Aktif otomatis bersama bot WhatsApp jika PANEL_ENABLED=true di .env:
PANEL_ENABLED=true PANEL_PORT=3000 PANEL_PASSWORD=rahasia_kuat npm start

# Atau jalankan Cipi Panel secara mandiri:
npm run panel

# Uji otomatis seluruh endpoint, SSE, CLI, keamanan, & UI Cipi Panel:
npm run test:panel
```


