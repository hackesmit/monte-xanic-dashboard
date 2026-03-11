// Vercel Serverless Function — returns Supabase public credentials
// Env vars are set in Vercel Dashboard → Settings → Environment Variables
// Never hardcode keys here.

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json({
    supabaseUrl:     process.env.SUPABASE_URL     || null,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null
  });
}
