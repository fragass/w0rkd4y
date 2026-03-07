export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: "Supabase not configured" });
  }

  const endpoint = `${SUPABASE_URL}/rest/v1/messages`;
  const usersEndpoint = `${SUPABASE_URL}/rest/v1/users`;

  function buildInFilter(values) {
    return values
      .map(v => `"${String(v).replace(/"/g, '\\"')}"`)
      .join(",");
  }

  async function getAdminMap(usernames) {
    const cleanNames = Array.from(new Set((usernames || []).filter(Boolean)));
    if (!cleanNames.length) return {};

    const response = await fetch(
      `${usersEndpoint}?select=username,is_admin&username=in.(${encodeURIComponent(buildInFilter(cleanNames))})`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      }
    );

    const users = await response.json();
    const map = {};

    if (Array.isArray(users)) {
      users.forEach(user => {
        map[user.username] = !!user.is_admin;
      });
    }

    return map;
  }

  if (req.method === "GET") {
    try {
      const response = await fetch(`${endpoint}?select=*&order=created_at.asc`, {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      });

      const data = await response.json();

      if (!Array.isArray(data)) {
        return res.status(response.status).json(data);
      }

      const usernames = data.map(msg => msg.name).filter(Boolean);
      const adminMap = await getAdminMap(usernames);

      const enriched = data.map(msg => ({
        ...msg,
        is_admin: !!adminMap[msg.name]
      }));

      return res.status(response.status).json(enriched);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    const {
      name,
      content,
      image_url,
      to = null,
      reply_to = null,
      reply_preview = null,
    } = req.body || {};

    if (!name || (!content && !image_url)) {
      return res.status(400).json({ error: "Missing fields" });
    }

    async function canReplyToMessage(original) {
      if (!original) return false;
      if (!original.to) return true;
      return original.to === name || original.name === name;
    }

    async function buildReplyPreviewFromDb(id) {
      if (!id) return null;

      const resp = await fetch(
        `${endpoint}?select=id,name,content,image_url,to,created_at&id=eq.${encodeURIComponent(id)}&limit=1`,
        {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
        }
      );

      const arr = await resp.json();
      const original = Array.isArray(arr) && arr.length ? arr[0] : null;

      if (!original) return null;
      if (!(await canReplyToMessage(original))) return null;

      const text = (original.content || "").trim();
      const snippet =
        text
          ? (text.length > 80 ? text.slice(0, 80) + "…" : text)
          : (original.image_url ? "🖼 Imagem" : "");

      return {
        id: original.id,
        name: original.name,
        snippet,
        hasImage: !!original.image_url,
        created_at: original.created_at,
      };
    }

    let finalReplyPreview = null;
    let finalReplyTo = reply_to ?? null;

    try {
      if (finalReplyTo) {
        const built = await buildReplyPreviewFromDb(finalReplyTo);
        if (built) {
          finalReplyPreview = built;
        } else {
          finalReplyPreview = reply_preview && typeof reply_preview === "object" ? reply_preview : null;
          if (!finalReplyPreview) finalReplyTo = null;
        }
      }
    } catch {
      finalReplyPreview = reply_preview && typeof reply_preview === "object" ? reply_preview : null;
      if (!finalReplyPreview) finalReplyTo = null;
    }

    const body = {
      name,
      content: content || "🖼 Imagem",
      to,
      reply_to: finalReplyTo,
      reply_preview: finalReplyPreview,
    };

    if (image_url) body.image_url = image_url;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(500).json({ error: errText });
      }

      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
