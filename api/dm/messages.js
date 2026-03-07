export default async function handler(req, res) {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ success: false, error: "Supabase not configured" });
    }

    const channelsEndpoint = `${SUPABASE_URL}/rest/v1/private_channels`;
    const dmEndpoint = `${SUPABASE_URL}/rest/v1/private_messages`;
    const usersEndpoint = `${SUPABASE_URL}/rest/v1/users`;

    function buildInFilter(values) {
      return values
        .map(v => `"${String(v).replace(/"/g, '\\"')}"`)
        .join(",");
    }

    async function getAdminMap(usernames) {
      const cleanNames = Array.from(new Set((usernames || []).filter(Boolean)));
      if (!cleanNames.length) return {};

      const r = await fetch(
        `${usersEndpoint}?select=username,is_admin&username=in.(${encodeURIComponent(buildInFilter(cleanNames))})`,
        {
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
        }
      );

      const users = await r.json();
      const map = {};

      if (Array.isArray(users)) {
        users.forEach(user => {
          map[user.username] = !!user.is_admin;
        });
      }

      return map;
    }

    async function getChannelByRoom(room) {
      const r = await fetch(
        `${channelsEndpoint}?select=id,room,user1,user2&room=eq.${encodeURIComponent(room)}&limit=1`,
        {
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
        }
      );
      const j = await r.json();
      return Array.isArray(j) && j.length ? j[0] : null;
    }

    if (req.method === "GET") {
      const room = String(req.query.room || "");
      const name = String(req.query.name || "");

      if (!room || !name) {
        return res.status(400).json({ success: false, error: "Missing room/name" });
      }

      const channel = await getChannelByRoom(room);
      if (!channel) return res.status(404).json([]);

      const allowed = channel.user1 === name || channel.user2 === name;
      if (!allowed) return res.status(403).json([]);

      const r = await fetch(
        `${dmEndpoint}?select=*&channel_id=eq.${encodeURIComponent(channel.id)}&order=created_at.asc`,
        {
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
        }
      );

      const data = await r.json();
      const list = Array.isArray(data) ? data : [];

      const usernames = list.map(msg => msg.sender).filter(Boolean);
      const adminMap = await getAdminMap(usernames);

      const enriched = list.map(msg => ({
        ...msg,
        is_admin: !!adminMap[msg.sender]
      }));

      return res.status(200).json(enriched);
    }

    if (req.method === "POST") {
      const body = req.body || {};
      const room = body.room;
      const sender = body.sender;
      const message = body.message || "";
      const image_url = body.image_url || null;

      const reply_to = body.reply_to ?? null;
      const reply_preview = body.reply_preview ?? null;

      if (!room || !sender || (!message.trim() && !image_url)) {
        return res.status(400).json({ success: false, error: "Missing fields" });
      }

      const channel = await getChannelByRoom(room);
      if (!channel) return res.status(404).json({ success: false, error: "Room not found" });

      const allowed = channel.user1 === sender || channel.user2 === sender;
      if (!allowed) return res.status(403).json({ success: false, error: "Not allowed" });

      async function buildReplyPreviewFromDb(id) {
        if (!id) return null;

        const r = await fetch(
          `${dmEndpoint}?select=id,sender,message,image_url,created_at,channel_id&id=eq.${encodeURIComponent(id)}&limit=1`,
          {
            headers: {
              apikey: SUPABASE_SERVICE_ROLE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
          }
        );
        const arr = await r.json();
        const original = Array.isArray(arr) && arr.length ? arr[0] : null;
        if (!original) return null;

        if (String(original.channel_id) !== String(channel.id)) return null;

        const text = (original.message || "").trim();
        const snippet =
          text
            ? (text.length > 80 ? text.slice(0, 80) + "…" : text)
            : (original.image_url ? "🖼 Imagem" : "");

        return {
          id: original.id,
          name: original.sender,
          snippet,
          hasImage: !!original.image_url,
          created_at: original.created_at,
        };
      }

      let finalReplyTo = reply_to;
      let finalReplyPreview = null;

      try {
        if (finalReplyTo) {
          const built = await buildReplyPreviewFromDb(finalReplyTo);
          if (built) finalReplyPreview = built;
          else {
            finalReplyPreview = reply_preview && typeof reply_preview === "object" ? reply_preview : null;
            if (!finalReplyPreview) finalReplyTo = null;
          }
        }
      } catch {
        finalReplyPreview = reply_preview && typeof reply_preview === "object" ? reply_preview : null;
        if (!finalReplyPreview) finalReplyTo = null;
      }

      const insertBody = {
        channel_id: channel.id,
        sender,
        message: message.trim() ? message : "🖼 Imagem",
        image_url,
        reply_to: finalReplyTo,
        reply_preview: finalReplyPreview,
      };

      const r = await fetch(dmEndpoint, {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(insertBody),
      });

      if (!r.ok) {
        const t = await r.text();
        return res.status(500).json({ success: false, error: t });
      }

      try {
        await fetch(`${channelsEndpoint}?room=eq.${encodeURIComponent(room)}`, {
          method: "PATCH",
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ last_activity: new Date().toISOString() }),
        });
      } catch {}

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
  } catch (e) {
    return res.status(500).json({ success: false, error: "Internal error", details: String(e?.message || e) });
  }
}
