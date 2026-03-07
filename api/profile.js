import { createClient } from "@supabase/supabase-js";

const supabaseAnon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const supabaseService = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method === "GET") {
    const { username } = req.query || {};

    if (!username) {
      return res.status(400).json({ success: false, message: "Username obrigatório" });
    }

    try {
      const { data, error } = await supabaseAnon
        .from("user_profiles")
        .select("username, display_name, avatar_url, updated_at")
        .eq("username", username)
        .maybeSingle();

      if (error) {
        return res.status(500).json({ success: false, message: error.message });
      }

      if (!data) {
        return res.status(200).json({
          success: true,
          profile: {
            username,
            display_name: username,
            avatar_url: null
          }
        });
      }

      return res.status(200).json({ success: true, profile: data });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Erro interno" });
    }
  }

  if (req.method === "POST") {
    const { username, display_name, avatar_url } = req.body || {};

    if (!username) {
      return res.status(400).json({ success: false, message: "Username obrigatório" });
    }

    const safeDisplayName =
      String(display_name || username)
        .trim()
        .slice(0, 40) || username;

    const safeAvatarUrl =
      avatar_url && String(avatar_url).trim()
        ? String(avatar_url).trim()
        : null;

    try {
      const { error } = await supabaseService
        .from("user_profiles")
        .upsert(
          {
            username,
            display_name: safeDisplayName,
            avatar_url: safeAvatarUrl
          },
          { onConflict: "username" }
        );

      if (error) {
        return res.status(500).json({ success: false, message: error.message });
      }

      return res.status(200).json({
        success: true,
        profile: {
          username,
          display_name: safeDisplayName,
          avatar_url: safeAvatarUrl
        }
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Erro interno" });
    }
  }

  return res.status(405).json({ success: false, message: "Método não permitido" });
}