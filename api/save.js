import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;

    if (!body?.player_name || !String(body.player_name).trim()) {
      return res.status(400).json({
        error: "O campo player_name é obrigatório."
      });
    }

    const payload = {
      player_name: String(body.player_name).trim(),
      use_seed: !!body.use_seed,
      seed: body.use_seed ? String(body.seed ?? "").trim() || null : null,

      classic: !!body.classic,
      map: !!body.map,
      bonus: !!body.bonus,
      coords: !!body.coords,
      days: !!body.days,

      recipes: !!body.recipes,
      fire: !!body.fire,
      tnt: !!body.tnt,
      mobloot: !!body.mobloot,
      regen: !!body.regen,
      blockdrop: !!body.blockdrop,
      sleep: !!body.sleep,

      sleep_percent: Number(body.sleep_percent ?? 100),

      instant_respawn: !!body.instant_respawn,
      respawn_explode: !!body.respawn_explode,
      respawn_radius: Number(body.respawn_radius ?? 10),

      simulation: Number(body.simulation ?? 4),
      cheats: !!body.cheats,

      daycycle: body.daycycle ? String(body.daycycle) : "Normal",
      keepinv: !!body.keepinv,
      mobspawn: !!body.mobspawn,
      grief: !!body.grief,
      entitydrop: !!body.entitydrop,
      weather: !!body.weather,
      command: !!body.command,
      edu: !!body.edu,
      tick: Number(body.tick ?? 1),

      difficulty: body.difficulty ? String(body.difficulty) : "Normal",
      hardcore: !!body.hardcore
    };

    const { error } = await supabase
      .from("minecraft_worlds")
      .insert([payload]);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Erro interno no servidor"
    });
  }
}
