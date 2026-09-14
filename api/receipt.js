const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const requestsByClient = new Map();

function send(response, status, body) {
  response.status(status).setHeader('Content-Type', 'application/json; charset=utf-8').end(JSON.stringify(body));
}

function isRateLimited(request) {
  const key = String(request.headers['x-forwarded-for'] || request.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const recent = (requestsByClient.get(key) || []).filter((time) => now - time < 60_000);
  recent.push(now);
  requestsByClient.set(key, recent);
  return recent.length > 10;
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return send(response, 405, { error: 'Method tidak didukung.' });
  if (!process.env.GEMINI_API_KEY) return send(response, 503, { error: 'Gemini belum dikonfigurasi.' });
  if (process.env.APP_ORIGIN && request.headers.origin !== process.env.APP_ORIGIN) return send(response, 403, { error: 'Origin tidak diizinkan.' });
  if (isRateLimited(request)) return send(response, 429, { error: 'Terlalu banyak scan struk. Coba lagi sebentar.' });
  let body;
  try {
    body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
  } catch (error) {
    return send(response, 400, { error: 'Body JSON tidak valid.' });
  }
  if (!body || typeof body.image !== 'string' || body.image.length > 4_000_000 || !['image/jpeg', 'image/png', 'image/webp'].includes(body.mimeType)) return send(response, 422, { error: 'Foto struk tidak valid atau terlalu besar.' });
  if (!Array.isArray(body.wallets) || !body.wallets.length || !/^\d{4}-\d{2}-\d{2}$/.test(body.today || '')) return send(response, 422, { error: 'Konteks transaksi tidak valid.' });
  const walletIds = body.wallets.map((wallet) => wallet.id);
  const categories = body.categories || {};
  const schema = {
    type: 'object',
    properties: {
      draft: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['expense'] },
          amount_idr: { type: 'string' },
          wallet_id: { type: 'string', enum: walletIds },
          category: { type: 'string', enum: categories.expense || [] },
          transaction_date: { type: 'string' },
          note: { type: 'string', maxLength: 500 },
        },
        required: ['type', 'amount_idr', 'wallet_id', 'category', 'transaction_date', 'note'],
      },
    },
    required: ['draft'],
  };
  const prompt = `Baca foto struk ini dan buat SATU draf pengeluaran pribadi Indonesia. Ambil total akhir, bukan subtotal atau pajak. Jika tanggal tidak terbaca gunakan ${body.today}. Pilih wallet_id dari daftar tersedia dan kategori dari daftar yang diizinkan. Jangan mengarang nominal: jika total tidak terbaca, amount_idr harus "0". Gunakan nama toko dan ringkasan item sebagai note. Dompet: ${JSON.stringify(body.wallets)}. Kategori: ${JSON.stringify(categories.expense || [])}.`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: body.mimeType, data: body.image } }] }],
        generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema, temperature: 0.1, maxOutputTokens: 500 },
      }),
    });
    if (!geminiResponse.ok) return send(response, 502, { error: 'Gemini tidak dapat membaca struk.' });
    const payload = await geminiResponse.json();
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = JSON.parse(text || '{}');
    const draft = parsed.draft || {};
    if (!walletIds.includes(draft.wallet_id) || !/^\d+$/.test(draft.amount_idr || '')) return send(response, 422, { error: 'Hasil pembacaan struk tidak valid.' });
    return send(response, 200, { draft: { type: 'expense', amount: draft.amount_idr, walletId: draft.wallet_id, category: draft.category, date: draft.transaction_date, note: draft.note } });
  } catch (error) {
    return send(response, error.name === 'AbortError' ? 504 : 502, { error: error.name === 'AbortError' ? 'Analisis struk melewati batas waktu.' : 'Struk tidak dapat dianalisis.' });
  } finally {
    clearTimeout(timeout);
  }
}
