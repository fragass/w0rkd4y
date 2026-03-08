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

function extractStoragePathFromPublicUrl(publicUrl) {
  if (!publicUrl || typeof publicUrl !== "string") return null;

  try {
    const cleanUrl = publicUrl.split("?")[0];
    const marker = "/storage/v1/object/public/profile-avatars/";
    const index = cleanUrl.indexOf(marker);

    if (index === -1) return null;

    return decodeURIComponent(cleanUrl.slice(index + marker.length));
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Método não permitido"
    });
  }

  const form = new formidable.IncomingForm({
    multiples: false,
  });

  form.parse(req, async (err, fields, files) => {
    let tempFilePath = null;

    try {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "Erro ao processar upload"
        });
      }

      let file = files.file;
      let username = fields.username;

      if (Array.isArray(file)) file = file[0];
      if (Array.isArray(username)) username = username[0];

      if (!file) {
        return res.status(400).json({
          success: false,
          message: "Nenhum arquivo enviado"
        });
      }

      if (!username) {
        return res.status(400).json({
          success: false,
          message: "Username obrigatório"
        });
      }

      tempFilePath = file.filepath;

      const allowed = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
      if (!allowed.includes(file.mimetype)) {
        return res.status(400).json({
          success: false,
          message: "Formato inválido"
        });
      }

      const maxSize = 3 * 1024 * 1024;
      if (file.size > maxSize) {
        return res.status(400).json({
          success: false,
          message: "Imagem muito grande (máx. 3MB)"
        });
      }

      const safeUsername = String(username).trim().replace(/[^\w.-]/g, "_");

      const ext =
        file.originalFilename?.split(".").pop()?.toLowerCase() ||
        file.mimetype.split("/")[1] ||
        "png";

      const normalizedExt = ext === "jpg" ? "jpg" : ext;
      const filePath = `${safeUsername}/avatar-${Date.now()}.${normalizedExt}`;

      const { data: oldProfile, error: oldProfileError } = await supabase
        .from("user_profiles")
        .select("display_name, avatar_url")
        .eq("username", username)
        .maybeSingle();

      if (oldProfileError) {
        return res.status(500).json({
          success: false,
          message: oldProfileError.message
        });
      }

      const oldAvatarUrl = oldProfile?.avatar_url || null;
      const oldStoragePath = extractStoragePathFromPublicUrl(oldAvatarUrl);
      const displayName = oldProfile?.display_name || username;

      const fileData = fs.readFileSync(file.filepath);

      const { error: uploadError } = await supabase.storage
        .from("profile-avatars")
        .upload(filePath, fileData, {
          contentType: file.mimetype,
          upsert: false,
        });

      if (uploadError) {
        return res.status(500).json({
          success: false,
          message: uploadError.message
        });
      }

      const { data: publicData } = supabase.storage
        .from("profile-avatars")
        .getPublicUrl(filePath);

      const avatarUrl = `${publicData.publicUrl}?v=${Date.now()}`;

      const { error: profileError } = await supabase
        .from("user_profiles")
        .upsert(
          {
            username,
            display_name: displayName,
            avatar_url: avatarUrl
          },
          { onConflict: "username" }
        );

      if (profileError) {
        await supabase.storage.from("profile-avatars").remove([filePath]);

        return res.status(500).json({
          success: false,
          message: profileError.message
        });
      }

      const pathsToRemove = [];

      if (oldStoragePath && oldStoragePath !== filePath) {
        pathsToRemove.push(oldStoragePath);
      }

      const legacyPaths = [
        `${safeUsername}/avatar.png`,
        `${safeUsername}/avatar.jpg`,
        `${safeUsername}/avatar.jpeg`,
        `${safeUsername}/avatar.webp`
      ];

      legacyPaths.forEach((legacyPath) => {
        if (legacyPath !== filePath && !pathsToRemove.includes(legacyPath)) {
          pathsToRemove.push(legacyPath);
        }
      });

      if (pathsToRemove.length) {
        await supabase.storage
          .from("profile-avatars")
          .remove(pathsToRemove);
      }

      return res.status(200).json({
        success: true,
        url: avatarUrl
      });
    } catch (e) {
      return res.status(500).json({
        success: false,
        message: "Erro interno no upload"
      });
    } finally {
      if (tempFilePath) {
        try {
          fs.unlinkSync(tempFilePath);
        } catch {}
      }
    }
  });
};
