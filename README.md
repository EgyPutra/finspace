# FinSpace

FinSpace adalah implementasi mobile-first dari desain dashboard yang diberikan. Aplikasi dapat dipakai tanpa akun untuk mencatat keuangan secara lokal di satu browser, tetap terbuka saat offline setelah kunjungan pertama, dan dapat dipasang sebagai PWA.

## Menjalankan lokal

Jalankan server statis dari folder ini:

```bash
python3 -m http.server 4173
```

Buka `http://localhost:4173`. Fitur pencatatan lokal juga dapat berjalan ketika `index.html` dibuka langsung, tetapi service worker, instalasi PWA, dan endpoint Gemini membutuhkan HTTP localhost atau HTTPS.

## Deploy ke Vercel

1. Impor folder ini sebagai project Vercel.
2. Framework preset dapat dibiarkan sebagai `Other` dan build command dikosongkan.
3. Tambahkan `GEMINI_API_KEY`, `APP_ORIGIN`, dan opsional `GEMINI_MODEL` pada Environment Variables.
4. Deploy.

## Sinkronisasi laptop dan HP

FinSpace tetap dapat dipakai secara lokal tanpa akun. Untuk mengaktifkan sinkronisasi, gunakan Supabase:

1. Buat project Supabase, lalu jalankan [supabase/schema.sql](./supabase/schema.sql) melalui SQL Editor.
2. Buat bucket Storage private bernama `receipts`.
3. Pada Authentication → URL Configuration, tambahkan URL Vercel aplikasi ke Redirect URLs.
4. Tambahkan `SUPABASE_URL` dan `SUPABASE_ANON_KEY` ke Environment Variables Vercel, lalu redeploy.
5. Masuk melalui Pengaturan → Sinkronisasi menggunakan email yang sama di laptop dan HP.

Data dari perangkat pertama akan dipadukan dengan data cloud secara aman berdasarkan waktu perubahan. Foto struk diunggah ke bucket private hanya setelah transaksi dikonfirmasi dan akun sinkronisasi aktif.

## Goals, skor, dan scan struk

- Goals adalah alokasi virtual: mengubah progres goal tidak otomatis mengubah saldo dompet.
- Skor kesehatan finansial memakai arus kas, rasio menabung, kepatuhan anggaran, dana aman, dan konsistensi pencatatan bulan berjalan. Ini indikator kebiasaan, bukan nasihat keuangan profesional.
- Scan struk menerima JPG, PNG, atau WebP hingga 6 MB. Gemini membuat draf pengeluaran; pengguna wajib memeriksa dan mengonfirmasi sebelum disimpan.

Jika Gemini belum dikonfigurasi atau tidak dapat dihubungi, input AI memakai parser lokal sederhana. Hasil tetap menjadi draf dan membutuhkan konfirmasi.

## Data dan batas versi ini

- Dompet, transaksi, anggaran, dan preferensi disimpan di IndexedDB browser.
- Gunakan backup JSON dari Pengaturan secara rutin. CSV ditujukan untuk analisis, bukan pemulihan.
- Sinkronisasi akun/cloud belum aktif karena membutuhkan project database dan kredensial pemilik.
- API Gemini hanya menerima teks transaksi, tanggal hari ini, label dompet, dan daftar kategori. API key tidak pernah dikirim ke browser.

## Struktur

- `index.html`: seluruh struktur aplikasi dan dialog.
- `styles.css`: sistem visual responsif neo-brutalist.
- `app.js`: IndexedDB, ledger, laporan, parser lokal, backup, dan interaksi.
- `api/gemini.js`: Vercel Function untuk structured parsing Gemini.
- `sw.js`: cache app shell untuk penggunaan offline.
- `manifest.webmanifest`: metadata PWA dan shortcut Catat.
