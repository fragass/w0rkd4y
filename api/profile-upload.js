const { createClient } = require("@supabase/supabase-js");
const formidable = require("formidable");
const fs = require("fs");

module.exports.config = {
  api: {
    bodyParser: false,
  },
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Método não permitido" });
  }

  const form = new formidable.IncomingForm({
    multiples: false,
  });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      return res.status(500).json({ success: false, message: "Erro ao processar upload" });
    }

    try {
      let file = files.file;
      let username = fields.username;

      if (Array.isArray(file)) file = file[0];
      if (Array.isArray(username)) username = username[0];

      if (!file) {
        return res.status(400).json({ success: false, message: "Nenhum arquivo enviado" });
      }

      if (!username) {
        return res.status(400).json({ success: false, message: "Username obrigatório" });
      }

      const allowed = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
      if (!allowed.includes(file.mimetype)) {
        return res.status(400).json({ success: false, message: "Formato inválido" });
      }

      const maxSize = 3 * 1024 * 1024;
      if (file.size > maxSize) {
        return res.status(400).json({ success: false, message: "Imagem muito grande (máx. 3MB)" });
      }

      const ext =
        file.originalFilename?.split(".").pop()?.toLowerCase() ||
        file.mimetype.split("/")[1] ||
        "png";

      const safeUsername = String(username).replace(/[^\w.-]/g, "_");
      const fileName = `${safeUsername}/avatar-${Date.now()}.${ext}`;

      const fileData = fs.readFileSync(file.filepath);

      const { error: uploadError } = await supabase.storage
        .from("profile-avatars")
        .upload(fileName, fileData, {
          contentType: file.mimetype,
          upsert: true,
        });

      if (uploadError) {
        return res.status(500).json({ success: false, message: uploadError.message });
      }

      const { data } = supabase.storage
        .from("profile-avatars")
        .getPublicUrl(fileName);

      return res.status(200).json({
        success: true,
        url: data.publicUrl
      });
    } catch (e) {
      return res.status(500).json({ success: false, message: "Erro interno no upload" });
    }
  });
};