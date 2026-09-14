export default function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method tidak didukung.' });
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return response.status(503).json({ error: 'Sinkronisasi belum dikonfigurasi.' });
  response.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  return response.status(200).json({ url, anonKey });
}
