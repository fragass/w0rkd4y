export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: "Supabase not configured" });
  }

  const endpoint = `${SUPABASE_URL}/rest/v1/messages`;

  if (req.method === "GET") {
    const response = await fetch(
      `${endpoint}?select=*&order=created_at.asc`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      }
    );

    const data = await response.json();
    return res.status(response.status).json(data);
  }

  if (req.method === "POST") {
    const { name, content } = req.body;

    if (!name || !content) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ name, content }),
    });

    return res.status(response.status).json({ success: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
