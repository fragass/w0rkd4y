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
      const users = Array.isArray(data) ? data : [];
      const now = Date.now();

      const online = users.filter(user => {
        const last = new Date(user.last_seen).getTime();
        return Number.isFinite(last) && now - last < 15000; // 15 segundos tolerância
      });

      return res.status(200).json(online);
    }

    if (req.method === "POST") {
      const {
        name,
        typing,
        typing_room = null,
        room = null,
      } = req.body || {};

      if (!name) {
        return res.status(200).json({ success: false }); // fail silent
      }

      const nowIso = new Date().toISOString();
      const isTyping =
        typing === true ||
        typing === 1 ||
        typing === "1" ||
        String(typing).toLowerCase() === "true";

      const activeRoom = typing_room ?? room ?? null;

      const payload = {
        name,
        last_seen: nowIso,
        typing: isTyping,
        typing_room: isTyping ? activeRoom : null,
        last_typing: nowIso,
      };

      let response = await fetch(endpoint, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const fallbackPayload = {
          name,
          last_seen: nowIso,
          typing: isTyping,
          typing_room: isTyping ? activeRoom : null,
        };

        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates,return=minimal",
          },
          body: JSON.stringify(fallbackPayload),
        });
      }

      return res.status(200).json({ success: response.ok });
    }

    return res.status(200).json({ success: false });

  } catch (error) {
    return res.status(200).json([]); // nunca quebra o site
  }
}

