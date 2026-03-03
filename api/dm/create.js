import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const DM_TTL_MINUTES = Number(process.env.DM_TTL_MINUTES || 360); // 6h por padrão

function isValidName(name) {
  return typeof name === "string" && /^[A-Za-z0-9_]{2,24}$/.test(name);
}

function isValidRoom(room) {
  // sala sem espaços (pra bater com /entrar NOME)
  return typeof room === "string" && /^[A-Za-z0-9_-]{3,32}$/.test(room);
}

async function cleanupExpired() {
  // apaga canais sem atividade antiga (e mensagens caem por cascade)
  const { data: expired, error } = await supabase
    .from("private_channels")
    .select("id")
    .lt("last_activity", new Date(Date.now() - DM_TTL_MINUTES * 60_000).toISOString());

  if (error || !expired?.length) return;

  const ids = expired.map((x) => x.id);

  // se não tiver FK cascade, garante limpando msgs antes
  await supabase.from("private_messages").delete().in("channel_id", ids);
  await supabase.from("private_channels").delete().in("id", ids);
}

async function sendSystemWhisper(toUser, text) {
  // usa tabela pública "messages" com whisper (to)
  await supabase.from("messages").insert([
    {
      name: "Sistema",
      content: text,
      to: toUser,
    },
  ]);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const { creator, target, room } = req.body || {};

  if (!isValidName(creator) || !isValidName(target) || !isValidRoom(room)) {
    return res.status(400).json({ success: false, error: "Invalid fields" });
  }

  if (creator === target) {
    return res.status(400).json({ success: false, error: "Same user" });
  }

  try {
    await cleanupExpired();

    // Já existe sala?
    const { data: existing, error: existErr } = await supabase
      .from("private_channels")
      .select("id, user1, user2, room")
      .eq("room", room)
      .maybeSingle();

    if (existErr) {
      return res.status(500).json({ success: false, error: "DB error" });
    }

    if (existing) {
      return res.status(409).json({ success: false, error: "Room already exists" });
    }

    // Cria canal
    const { data: created, error: createErr } = await supabase
      .from("private_channels")
      .insert([
        {
          room,
          user1: creator,
          user2: target,
          last_activity: new Date().toISOString(),
        },
      ])
      .select("id, room, user1, user2")
      .single();

    if (createErr || !created) {
      return res.status(500).json({ success: false, error: "Failed to create channel" });
    }

    // Notifica pessoaB e creator via sussurro (Sistema)
    await sendSystemWhisper(
      target,
      `📩 ${creator} criou a sala privada "${room}". Use: /entrar ${room}`
    );

    await sendSystemWhisper(
      creator,
      `✅ Sala privada "${room}" criada com @${target}. Use: /entrar ${room} (ou você já pode entrar agora).`
    );

    return res.status(200).json({ success: true, channel: created });
  } catch (e) {
    return res.status(500).json({ success: false, error: "Internal error" });
  }
}