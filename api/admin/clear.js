const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PUBLIC_MESSAGES_TABLE = "messages";
const PRIVATE_MESSAGES_TABLE = "private_messages";
const PRIVATE_CHANNELS_TABLE = "private_channels";
const CHAT_IMAGES_BUCKET = "chat-images";

function extractStoragePathFromPublicUrl(publicUrl, bucketName) {
  if (!publicUrl || typeof publicUrl !== "string") return null;

  try {
    const cleanUrl = publicUrl.split("?")[0];
    const marker = `/storage/v1/object/public/${bucketName}/`;
    const index = cleanUrl.indexOf(marker);

    if (index === -1) return null;

    return decodeURIComponent(cleanUrl.slice(index + marker.length));
  } catch {
    return null;
  }
}

async function isAdminUser(username) {
  const { data, error } = await supabase
    .from("users")
    .select("is_admin")
    .eq("username", username)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return !!data?.is_admin;
}

async function getAllImagePaths() {
  const [publicRes, privateRes] = await Promise.all([
    supabase.from(PUBLIC_MESSAGES_TABLE).select("image_url"),
    supabase.from(PRIVATE_MESSAGES_TABLE).select("image_url")
  ]);

  if (publicRes.error)
    throw new Error(`Erro ao buscar mensagens públicas: ${publicRes.error.message}`);

  if (privateRes.error)
    throw new Error(`Erro ao buscar mensagens privadas: ${privateRes.error.message}`);

  const allRows = [
    ...(publicRes.data || []),
    ...(privateRes.data || [])
  ];

  const paths = allRows
    .map(row => extractStoragePathFromPublicUrl(row.image_url, CHAT_IMAGES_BUCKET))
    .filter(Boolean);

  return Array.from(new Set(paths));
}

async function removeStorageFiles(paths) {
  if (!paths.length) return;

  const chunkSize = 100;

  for (let i = 0; i < paths.length; i += chunkSize) {
    const chunk = paths.slice(i, i + chunkSize);

    const { error } = await supabase
      .storage
      .from(CHAT_IMAGES_BUCKET)
      .remove(chunk);

    if (error)
      throw new Error(`Erro ao apagar imagens do storage: ${error.message}`);
  }
}

async function deleteAllRowsFromTable(tableName) {
  const { error } = await supabase
    .from(tableName)
    .delete()
    .not("id", "is", null);

  if (error)
    throw new Error(`Erro ao limpar tabela ${tableName}: ${error.message}`);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Método não permitido"
    });
  }

  try {
    const { username, scope } = req.body || {};

    if (!username) {
      return res.status(400).json({
        success: false,
        message: "Username obrigatório"
      });
    }

    if (scope !== "all") {
      return res.status(400).json({
        success: false,
        message: 'Scope inválido. Use "all".'
      });
    }

    const admin = await isAdminUser(username);

    if (!admin) {
      return res.status(403).json({
        success: false,
        message: "Você não tem permissão para executar este comando"
      });
    }

    /* =========================
       1. COLETAR IMAGENS
    ========================== */

    const imagePaths = await getAllImagePaths();

    /* =========================
       2. APAGAR STORAGE
    ========================== */

    await removeStorageFiles(imagePaths);

    /* =========================
       3. LIMPAR TABELAS
    ========================== */

    await deleteAllRowsFromTable(PRIVATE_MESSAGES_TABLE);
    await deleteAllRowsFromTable(PUBLIC_MESSAGES_TABLE);
    await deleteAllRowsFromTable(PRIVATE_CHANNELS_TABLE);

    /* ========================= */

return res.status(200).json({
  success: true,
  message: "❗ Chat completamente limpo. Mensagens, imagens e salas privadas foram removidas.",
  deleted_images: imagePaths.length
});

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Erro interno ao executar clear all"
    });
  }

};
