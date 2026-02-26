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
    return res.status(405).json({ error: "Method not allowed" });
  }

  const form = new formidable.IncomingForm({
    multiples: false,
  });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error("Erro formidable:", err);
      return res.status(500).json({ error: "Erro ao processar upload" });
    }

    try {
      let file = files.file;

      if (Array.isArray(file)) {
        file = file[0];
      }

      if (!file) {
        return res.status(400).json({ error: "Nenhum arquivo enviado" });
      }

      const fileName =
        fields.fileName || `${Date.now()}-${file.originalFilename}`;

      const fileData = fs.readFileSync(file.filepath);

      const { error } = await supabase.storage
        .from("chat-images")
        .upload(fileName, fileData, {
          contentType: file.mimetype,
          upsert: false,
        });

      if (error) {
        console.error("Erro Supabase:", error);
        return res.status(500).json({ error: error.message });
      }

      const { data } = supabase.storage
        .from("chat-images")
        .getPublicUrl(fileName);

      return res.status(200).json({ url: data.publicUrl });

    } catch (e) {
      console.error("Erro interno:", e);
      return res.status(500).json({ error: "Erro interno no upload" });
    }
  });
};