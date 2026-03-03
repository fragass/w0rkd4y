import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const DM_TTL_MINUTES = Number(process.env.DM_TTL_MINUTES || 360);

function isValidName(name) {
  return typeof name === "string" && /^[A-Za-z0-9_]{2,24}$/.test(name);
}
function isValidRoom(room) {
  return typeof room === "string" && /^[A-Za-z0-9_-]{3,32}$/.test(room);
}

async function cleanupExpired() {
  const { data: expired } = await supabase
    .from("private_channels")
    .select("id")
    .lt("last_activity", new Date(Date.now() - DM_TTL_MINUTES * 60_000).toISOString());

  if (!expired?.length) return;

  const ids = expired.map((x) => x.id);
  await supabase.from("private_messages").delete().in("channel_id", ids);
  await supabase.from("private_channels").delete().in("id", ids);
}

async function getChannelByRoom(room) {
  const { data, error } = await supabase
    .from("private_channels")
    .select("id, room, user1, user2")
    .eq("room", room)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

export default async function handler(req, res) {
  try {
    await cleanupExpired();

    if (req.method === "GET") {
      const room = String(req.query.room || "");
      const name = String(req.query.name || "");

      if (!isValidRoom(room) || !isValidName(name)) {
        return res.status(400).json({ error: "Invalid fields" });
      }

      const channel = await getChannelByRoom(room);
      if (!channel) return res.status(404).json({ error: "Room not found" });

      const allowed = channel.user1 === name || channel.user2 === name;
      if (!allowed) return res.status(403).json({ error: "Not allowed" });

      const { data: msgs, error } = await supabase
        .from("private_messages")
        .select("*")
        .eq("channel_id", channel.id)
        .order("created_at", { ascending: true });

      if (error) return res.status(500).json({ error: "DB error" });

      return res.status(200).json(msgs || []);
    }

    if (req.method === "POST") {
      const { room, sender, message, image_url } = req.body || {};

      if (!isValidRoom(room) || !isValidName(sender)) {
        return res.status(400).json({ success: false, error: "Invalid fields" });
      }

      const msgText = typeof message === "string" ? message.trim() : "";
      const imgUrl = typeof image_url === "string" && image_url.trim() ? image_url.trim() : null;

      // Agora permite: mensagem OU imagem (ou ambos)
      if (!msgText && !imgUrl) {
        return res.status(400).json({ success: false, error: "Empty message" });
      }

      const channel = await getChannelByRoom(room);
      if (!channel) return res.status(404).json({ success: false, error: "Room not found" });

      const allowed = channel.user1 === sender || channel.user2 === sender;
      if (!allowed) return res.status(403).json({ success: false, error: "Not allowed" });

      const payload = {
        channel_id: channel.id,
        sender,
        message: msgText || (imgUrl ? "🖼 Imagem" : ""),
      };
      if (imgUrl) payload.image_url = imgUrl;

      const { error: insErr } = await supabase.from("private_messages").insert([payload]);
      if (insErr) return res.status(500).json({ success: false, error: "Insert failed" });

      await supabase
        .from("private_channels")
        .update({ last_activity: new Date().toISOString() })
        .eq("id", channel.id);

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch {
    return res.status(500).json({ error: "Internal error" });
  }
}
