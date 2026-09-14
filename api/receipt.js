const MODEL = process.env.GEMINI_MODEL === 'gemini-2.5-flash' ? 'gemini-3.6-flash' : (process.env.GEMINI_MODEL || 'gemini-3.6-flash');
export const maxDuration = 60;
const requestsByClient = new Map();

function send(response, status, body) {
  response.status(status).setHeader('Content-Type', 'application/json; charset=utf-8').end(JSON.stringify(body));
}

async function geminiFailure(geminiResponse, fallback) {
  const payload = await geminiResponse.json().catch(() => ({}));
  const message = String(payload?.error?.message || '').replace(/AIza[\w-]+/g, '[redacted]').slice(0, 180);
  return { error: message ? `${fallback} (${geminiResponse.status}: ${message})` : fallback };
}

function isRateLimited(request) {
  const key = String(request.headers['x-forwarded-for'] || request.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const recent = (requestsByClient.get(key) || []).filter((time) => now - time < 60_000);
  recent.push(now);
  requestsByClient.set(key, recent);
  return recent.length > 10;
}

function parseGeminiJson(text) {
  const source = String(text || '').trim();
  if (!source) throw new Error('Respons Gemini kosong.');
  try {
    return JSON.parse(source);
  } catch (error) {
    const withoutFence = source.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try {
      return JSON.parse(withoutFence);
    } catch (nestedError) {
      const object = withoutFence.match(/\{[\s\S]*\}/)?.[0];
      if (!object) throw new Error('Format respons Gemini tidak dikenali.');
      return JSON.parse(object);
    }
  }
}

function parseGeminiParts(parts) {
  const texts = (Array.isArray(parts) ? parts : []).map((part) => part?.text).filter(Boolean);
  let lastError;
  for (const text of [...texts].reverse()) {
    try {
      return parseGeminiJson(text);
    } catch (error) {
      lastError = error;
    }
  }
  if (texts.length > 1) return parseGeminiJson(texts.join('\n'));
  throw lastError || new Error('Respons Gemini kosong.');
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
  if (!body || typeof body.image !== 'string' || body.image.length > 800_000 || !['image/jpeg', 'image/png', 'image/webp'].includes(body.mimeType)) return send(response, 422, { error: 'Foto struk tidak valid atau terlalu besar.' });
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
  const timeout = setTimeout(() => controller.abort(), 45000);
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
    if (!geminiResponse.ok) return send(response, 502, await geminiFailure(geminiResponse, 'Gemini tidak dapat membaca struk.'));
    const payload = await geminiResponse.json();
    const parsed = parseGeminiParts(payload.candidates?.[0]?.content?.parts);
    const draft = parsed.draft || {};
    const amount = String(draft.amount_idr ?? '').replace(/[^0-9]/g, '');
    const walletId = walletIds.includes(draft.wallet_id) ? draft.wallet_id : walletIds[0];
    const allowedCategories = Array.isArray(categories.expense) ? categories.expense : [];
    const category = allowedCategories.includes(draft.category) ? draft.category : (allowedCategories.at(-1) || 'Lainnya');
    const date = /^\d{4}-\d{2}-\d{2}$/.test(draft.transaction_date || '') ? draft.transaction_date : body.today;
    if (!amount) return send(response, 422, { error: 'Gemini belum menemukan total pembayaran pada struk. Pastikan bagian TOTAL atau BAYAR terlihat jelas.' });
    return send(response, 200, { draft: { type: 'expense', amount, walletId, category, date, note: String(draft.note || 'Belanja dari struk').slice(0, 500) } });
  } catch (error) {
    const message = String(error.message || '').replace(/AIza[\w-]+/g, '[redacted]').slice(0, 160);
    return send(response, error.name === 'AbortError' ? 504 : 502, {
      error: error.name === 'AbortError' ? 'Analisis struk melewati batas waktu.' : `Struk tidak dapat dianalisis (${message || 'respons server tidak valid'}).`,
    });
  } finally {
    clearTimeout(timeout);
  }
}
