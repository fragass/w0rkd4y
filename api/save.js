import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).end();
  }

  const body = req.body;

  const { error } = await supabase
    .from("minecraft_worlds")
    .insert([{
      player_name: body.player,

      use_seed: !!body.seed,
      seed: body.seed,

      classic: body.classic,
      map: body.map,
      bonus: body.bonus,
      coords: body.coords,
      days: body.days,

      recipes: body.recipes,
      fire: body.fire,
      tnt: body.tnt,
      mobloot: body.mobloot,
      regen: body.regen,
      blockdrop: body.blockdrop,
      sleep: body.sleep,

      sleep_percent: body.sleepPercent,

      instant_respawn: body.instantRespawn,
      respawn_explode: body.respawnExplode,
      respawn_radius: body.respawnRadius,

      simulation: body.simulation,

      cheats: body.cheats,

      daycycle: body.daycycle,
      keepinv: body.keepinv,
      mobspawn: body.mobspawn,
      grief: body.grief,
      entitydrop: body.entitydrop,
      weather: body.weather,
      command: body.command,
      edu: body.edu,
      tick: body.tick,

      difficulty: body.difficulty,
      hardcore: body.hardcore
    }]);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json({ success: true });
}