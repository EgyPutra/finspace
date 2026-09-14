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
