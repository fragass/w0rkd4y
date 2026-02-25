export default async function handler(req, res) {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return res.status(200).json([]); // fail silent
    }

    const endpoint = `${SUPABASE_URL}/rest/v1/online_users`;

    if (req.method === "GET") {
      const response = await fetch(
        `${endpoint}?select=*`,
        {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
        }
      );

      const data = await response.json();

      const now = Date.now();

      const online = data.filter(user => {
        const last = new Date(user.last_seen).getTime();
        return now - last < 15000; // 15 segundos tolerância
      });

      return res.status(200).json(online);
    }

    if (req.method === "POST") {
      const { name } = req.body;

      if (!name) {
        return res.status(200).json({ success: false }); // fail silent
      }

      await fetch(endpoint, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify({
          name,
          last_seen: new Date().toISOString(),
        }),
      });

      return res.status(200).json({ success: true });
    }

    return res.status(200).json({ success: false });

  } catch (error) {
    return res.status(200).json([]); // nunca quebra o site
  }
}
