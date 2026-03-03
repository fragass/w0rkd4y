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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const { name, room } = req.body || {};

  if (!isValidName(name) || !isValidRoom(room)) {
    return res.status(400).json({ success: false, error: "Invalid fields" });
  }

  try {
    await cleanupExpired();

    const { data: channel, error } = await supabase
      .from("private_channels")
      .select("id, room, user1, user2, last_activity")
      .eq("room", room)
      .maybeSingle();

    if (error || !channel) {
      return res.status(404).json({ success: false, error: "Room not found" });
    }

    const allowed = channel.user1 === name || channel.user2 === name;
    if (!allowed) {
      return res.status(403).json({ success: false, error: "Not allowed" });
    }

    // Atualiza atividade ao entrar
    await supabase
      .from("private_channels")
      .update({ last_activity: new Date().toISOString() })
      .eq("id", channel.id);

    const other = channel.user1 === name ? channel.user2 : channel.user1;

    return res.status(200).json({
      success: true,
      channel: {
        id: channel.id,
        room: channel.room,
        other,
      },
    });
  } catch {
    return res.status(500).json({ success: false, error: "Internal error" });
  }
}