import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

function isValidName(name) {
  return typeof name === "string" && /^[A-Za-z0-9_]{2,24}$/.test(name);
}
function isValidRoom(room) {
  return typeof room === "string" && /^[A-Za-z0-9_-]{3,32}$/.test(room);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const { name, room } = req.body || {};
  if (!isValidName(name) || !isValidRoom(room)) {
    return res.status(400).json({ success: false, error: "Invalid fields" });
  }

  // “Sair” é mais estado do frontend, mas a gente registra atividade
  await supabase
    .from("private_channels")
    .update({ last_activity: new Date().toISOString() })
    .eq("room", room);

  return res.status(200).json({ success: true });
}