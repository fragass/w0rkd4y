
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Método não permitido" });
  }

  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ success: false, message: "Dados incompletos" });
  }

  try {
    const { data, error } = await supabase
      .from("users")
      .select("username, password, is_admin")
      .eq("username", username)
      .single();

    if (error || !data) {
      return res.status(401).json({ success: false });
    }

    if (data.password !== password) {
      return res.status(401).json({ success: false });
    }

    const token = crypto.randomBytes(32).toString("hex");

    return res.status(200).json({
      success: true,
      token,
      user: data.username,
      isAdmin: !!data.is_admin
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Erro interno" });
  }
}
