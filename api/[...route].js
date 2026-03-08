const crypto = require("crypto");
const fs = require("fs");
const formidable = require("formidable");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DM_TTL_MINUTES = Number(process.env.DM_TTL_MINUTES || 360);

const PUBLIC_MESSAGES_TABLE = "messages";
const PRIVATE_MESSAGES_TABLE = "private_messages";
const PRIVATE_CHANNELS_TABLE = "private_channels";
const CHAT_IMAGES_BUCKET = "chat-images";
const PROFILE_AVATARS_BUCKET = "profile-avatars";

const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabaseService = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/* =========================
   HELPERS
========================= */

function getRouteParts(req) {
  const fromQuery = req.query?.route;

  if (Array.isArray(fromQuery) && fromQuery.length) {
    return fromQuery.filter(Boolean);
  }

  if (typeof fromQuery === "string" && fromQuery.trim()) {
    return fromQuery
      .split("/")
      .map(part => part.trim())
      .filter(Boolean);
  }

  // Fallback real pela URL acessada
  // Ex.: /api/login -> ["login"]
  // Ex.: /api/dm/messages -> ["dm", "messages"]
  const rawUrl = req.url || "";
  const pathname = rawUrl.split("?")[0] || "";
  const withoutApi = pathname.replace(/^\/api\/?/, "");

  if (!withoutApi) return [];

  return withoutApi
    .split("/")
    .map(part => part.trim())
    .filter(Boolean);
}

function getRouteKey(req) {
  return getRouteParts(req).join("/");
}

function sendJson(res, status, payload) {
  return res.status(status).json(payload);
}

function isValidName(name) {
  return typeof name === "string" && /^[A-Za-z0-9_]{2,24}$/.test(name);
}

function isValidRoom(room) {
  return typeof room === "string" && /^[A-Za-z0-9_-]{3,32}$/.test(room);
}

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

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";

    req.on("data", chunk => {
      data += chunk;
    });

    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });

    req.on("error", reject);
  });
}

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = new formidable.IncomingForm({
      multiples: false,
    });

    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}

function normalizeSingleField(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

async function safeCleanupFile(path) {
  if (!path) return;
  try {
    fs.unlinkSync(path);
  } catch {}
}

async function getAdminMapFromUsers(usernames, useService = false) {
  const cleanNames = Array.from(new Set((usernames || []).filter(Boolean)));
  if (!cleanNames.length) return {};

  const client = useService ? supabaseService : supabaseAnon;

  const { data, error } = await client
    .from("users")
    .select("username, is_admin")
    .in("username", cleanNames);

  if (error || !Array.isArray(data)) return {};

  const map = {};
  data.forEach(user => {
    map[user.username] = !!user.is_admin;
  });

  return map;
}

async function isAdminUser(username) {
  const { data, error } = await supabaseService
    .from("users")
    .select("is_admin")
    .eq("username", username)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return !!data?.is_admin;
}

async function getChannelByRoom(room) {
  const { data, error } = await supabaseService
    .from("private_channels")
    .select("id, room, user1, user2, last_activity")
    .eq("room", room)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data || null;
}

async function cleanupExpiredPrivateChannels() {
  const cutoff = new Date(Date.now() - DM_TTL_MINUTES * 60_000).toISOString();

  const { data: expired, error } = await supabaseAnon
    .from("private_channels")
    .select("id")
    .lt("last_activity", cutoff);

  if (error || !expired?.length) return;

  const ids = expired.map(x => x.id);

  await supabaseAnon.from("private_messages").delete().in("channel_id", ids);
  await supabaseAnon.from("private_channels").delete().in("id", ids);
}

/* =========================
   /api/login
========================= */

async function handleLogin(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { success: false, message: "Método não permitido" });
  }

  try {
    const body = await readJsonBody(req);
    const { username, password } = body || {};

    if (!username || !password) {
      return sendJson(res, 400, { success: false, message: "Dados incompletos" });
    }

    const { data, error } = await supabaseAnon
      .from("users")
      .select("username, password, is_admin")
      .eq("username", username)
      .single();

    if (error || !data) {
      return sendJson(res, 401, { success: false });
    }

    if (data.password !== password) {
      return sendJson(res, 401, { success: false });
    }

    const token = crypto.randomBytes(32).toString("hex");

    return sendJson(res, 200, {
      success: true,
      token,
      user: data.username,
      isAdmin: !!data.is_admin,
    });
  } catch {
    return sendJson(res, 500, { success: false, message: "Erro interno" });
  }
}

/* =========================
   /api/messages
========================= */

async function handleMessages(req, res) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return sendJson(res, 500, { error: "Supabase not configured" });
  }

  if (req.method === "GET") {
    try {
      const { data, error } = await supabaseAnon
        .from("messages")
        .select("*")
        .order("created_at", { ascending: true });

      if (error) {
        return sendJson(res, 500, { error: error.message });
      }

      const list = Array.isArray(data) ? data : [];
      const usernames = list.map(msg => msg.name).filter(Boolean);
      const adminMap = await getAdminMapFromUsers(usernames, false);

      const enriched = list.map(msg => ({
        ...msg,
        is_admin: !!adminMap[msg.name],
      }));

      return sendJson(res, 200, enriched);
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const {
        name,
        content,
        image_url,
        to = null,
        reply_to = null,
        reply_preview = null,
      } = body || {};

      if (!name || (!content && !image_url)) {
        return sendJson(res, 400, { error: "Missing fields" });
      }

      async function canReplyToMessage(original) {
        if (!original) return false;
        if (!original.to) return true;
        return original.to === name || original.name === name;
      }

      async function buildReplyPreviewFromDb(id) {
        if (!id) return null;

        const { data, error } = await supabaseAnon
          .from("messages")
          .select("id, name, content, image_url, to, created_at")
          .eq("id", id)
          .limit(1);

        if (error) return null;

        const original = Array.isArray(data) && data.length ? data[0] : null;
        if (!original) return null;

        if (!(await canReplyToMessage(original))) return null;

        const text = (original.content || "").trim();
        const snippet = text
          ? (text.length > 80 ? text.slice(0, 80) + "…" : text)
          : (original.image_url ? "🖼 Imagem" : "");

        return {
          id: original.id,
          name: original.name,
          snippet,
          hasImage: !!original.image_url,
          created_at: original.created_at,
        };
      }

      let finalReplyPreview = null;
      let finalReplyTo = reply_to ?? null;

      try {
        if (finalReplyTo) {
          const built = await buildReplyPreviewFromDb(finalReplyTo);
          if (built) {
            finalReplyPreview = built;
          } else {
            finalReplyPreview = reply_preview && typeof reply_preview === "object" ? reply_preview : null;
            if (!finalReplyPreview) finalReplyTo = null;
          }
        }
      } catch {
        finalReplyPreview = reply_preview && typeof reply_preview === "object" ? reply_preview : null;
        if (!finalReplyPreview) finalReplyTo = null;
      }

      const insertBody = {
        name,
        content: content || "🖼 Imagem",
        to,
        reply_to: finalReplyTo,
        reply_preview: finalReplyPreview,
      };

      if (image_url) insertBody.image_url = image_url;

      const { error } = await supabaseAnon
        .from("messages")
        .insert([insertBody]);

      if (error) {
        return sendJson(res, 500, { error: error.message });
      }

      return sendJson(res, 200, { success: true });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  return sendJson(res, 405, { error: "Method not allowed" });
}

/* =========================
   /api/online
========================= */

async function handleOnline(req, res) {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return sendJson(res, 200, []);
    }

    if (req.method === "GET") {
      const { data, error } = await supabaseAnon
        .from("online_users")
        .select("*");

      if (error) {
        return sendJson(res, 200, []);
      }

      const users = Array.isArray(data) ? data : [];
      const now = Date.now();

      const online = users.filter(user => {
        const last = new Date(user.last_seen).getTime();
        return Number.isFinite(last) && now - last < 15000;
      });

      return sendJson(res, 200, online);
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      const {
        name,
        typing,
        typing_room = null,
        room = null,
      } = body || {};

      if (!name) {
        return sendJson(res, 200, { success: false });
      }

      const nowIso = new Date().toISOString();
      const isTyping =
        typing === true ||
        typing === 1 ||
        typing === "1" ||
        String(typing).toLowerCase() === "true";

      const activeRoom = typing_room ?? room ?? null;

      const payload = {
        name,
        last_seen: nowIso,
        typing: isTyping,
        typing_room: isTyping ? activeRoom : null,
        last_typing: nowIso,
      };

      let { error } = await supabaseAnon
        .from("online_users")
        .upsert(payload, { onConflict: "name" });

      if (error) {
        const fallbackPayload = {
          name,
          last_seen: nowIso,
          typing: isTyping,
          typing_room: isTyping ? activeRoom : null,
        };

        const fallback = await supabaseAnon
          .from("online_users")
          .upsert(fallbackPayload, { onConflict: "name" });

        error = fallback.error;
      }

      return sendJson(res, 200, { success: !error });
    }

    return sendJson(res, 200, { success: false });
  } catch {
    return sendJson(res, 200, []);
  }
}

/* =========================
   /api/profile
========================= */

async function handleProfile(req, res) {
  if (req.method === "GET") {
    const username = req.query?.username;

    if (!username) {
      return sendJson(res, 400, { success: false, message: "Username obrigatório" });
    }

    try {
      const { data, error } = await supabaseAnon
        .from("user_profiles")
        .select("username, display_name, avatar_url, updated_at")
        .eq("username", username)
        .maybeSingle();

      if (error) {
        return sendJson(res, 500, { success: false, message: error.message });
      }

      if (!data) {
        return sendJson(res, 200, {
          success: true,
          profile: {
            username,
            display_name: username,
            avatar_url: null,
          },
        });
      }

      return sendJson(res, 200, { success: true, profile: data });
    } catch {
      return sendJson(res, 500, { success: false, message: "Erro interno" });
    }
  }

  if (req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const { username, display_name, avatar_url } = body || {};

      if (!username) {
        return sendJson(res, 400, { success: false, message: "Username obrigatório" });
      }

      const safeDisplayName =
        String(display_name || username).trim().slice(0, 40) || username;

      const safeAvatarUrl =
        avatar_url && String(avatar_url).trim()
          ? String(avatar_url).trim()
          : null;

      const { error } = await supabaseService
        .from("user_profiles")
        .upsert(
          {
            username,
            display_name: safeDisplayName,
            avatar_url: safeAvatarUrl,
          },
          { onConflict: "username" }
        );

      if (error) {
        return sendJson(res, 500, { success: false, message: error.message });
      }

      return sendJson(res, 200, {
        success: true,
        profile: {
          username,
          display_name: safeDisplayName,
          avatar_url: safeAvatarUrl,
        },
      });
    } catch {
      return sendJson(res, 500, { success: false, message: "Erro interno" });
    }
  }

  return sendJson(res, 405, { success: false, message: "Método não permitido" });
}

/* =========================
   /api/profile-upload
========================= */

async function handleProfileUpload(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, {
      success: false,
      message: "Método não permitido",
    });
  }

  let tempFilePath = null;

  try {
    const { fields, files } = await parseForm(req);

    let file = normalizeSingleField(files.file);
    let username = normalizeSingleField(fields.username);

    if (!file) {
      return sendJson(res, 400, {
        success: false,
        message: "Nenhum arquivo enviado",
      });
    }

    if (!username) {
      return sendJson(res, 400, {
        success: false,
        message: "Username obrigatório",
      });
    }

    tempFilePath = file.filepath;

    const allowed = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
    if (!allowed.includes(file.mimetype)) {
      return sendJson(res, 400, {
        success: false,
        message: "Formato inválido",
      });
    }

    const maxSize = 3 * 1024 * 1024;
    if (file.size > maxSize) {
      return sendJson(res, 400, {
        success: false,
        message: "Imagem muito grande (máx. 3MB)",
      });
    }

    const safeUsername = String(username).trim().replace(/[^\w.-]/g, "_");

    const ext =
      file.originalFilename?.split(".").pop()?.toLowerCase() ||
      file.mimetype.split("/")[1] ||
      "png";

    const normalizedExt = ext === "jpg" ? "jpg" : ext;
    const filePath = `${safeUsername}/avatar-${Date.now()}.${normalizedExt}`;

    const { data: oldProfile, error: oldProfileError } = await supabaseService
      .from("user_profiles")
      .select("display_name, avatar_url")
      .eq("username", username)
      .maybeSingle();

    if (oldProfileError) {
      return sendJson(res, 500, {
        success: false,
        message: oldProfileError.message,
      });
    }

    const oldAvatarUrl = oldProfile?.avatar_url || null;
    const oldStoragePath = extractStoragePathFromPublicUrl(oldAvatarUrl, PROFILE_AVATARS_BUCKET);
    const displayName = oldProfile?.display_name || username;
    const fileData = fs.readFileSync(file.filepath);

    const { error: uploadError } = await supabaseService.storage
      .from(PROFILE_AVATARS_BUCKET)
      .upload(filePath, fileData, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (uploadError) {
      return sendJson(res, 500, {
        success: false,
        message: uploadError.message,
      });
    }

    const { data: publicData } = supabaseService.storage
      .from(PROFILE_AVATARS_BUCKET)
      .getPublicUrl(filePath);

    const avatarUrl = `${publicData.publicUrl}?v=${Date.now()}`;

    const { error: profileError } = await supabaseService
      .from("user_profiles")
      .upsert(
        {
          username,
          display_name: displayName,
          avatar_url: avatarUrl,
        },
        { onConflict: "username" }
      );

    if (profileError) {
      await supabaseService.storage.from(PROFILE_AVATARS_BUCKET).remove([filePath]);

      return sendJson(res, 500, {
        success: false,
        message: profileError.message,
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
      `${safeUsername}/avatar.webp`,
    ];

    legacyPaths.forEach((legacyPath) => {
      if (legacyPath !== filePath && !pathsToRemove.includes(legacyPath)) {
        pathsToRemove.push(legacyPath);
      }
    });

    if (pathsToRemove.length) {
      await supabaseService.storage.from(PROFILE_AVATARS_BUCKET).remove(pathsToRemove);
    }

    return sendJson(res, 200, {
      success: true,
      url: avatarUrl,
    });
  } catch {
    return sendJson(res, 500, {
      success: false,
      message: "Erro interno no upload",
    });
  } finally {
    await safeCleanupFile(tempFilePath);
  }
}

/* =========================
   /api/upload
========================= */

async function handleChatUpload(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  let tempFilePath = null;

  try {
    const { fields, files } = await parseForm(req);

    let file = normalizeSingleField(files.file);
    let fileName = normalizeSingleField(fields.fileName);

    if (!file) {
      return sendJson(res, 400, { error: "Nenhum arquivo enviado" });
    }

    tempFilePath = file.filepath;

    if (!fileName) {
      fileName = `${Date.now()}-${file.originalFilename}`;
    }

    const fileData = fs.readFileSync(file.filepath);

    const { error } = await supabaseService.storage
      .from(CHAT_IMAGES_BUCKET)
      .upload(fileName, fileData, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (error) {
      return sendJson(res, 500, { error: error.message });
    }

    const { data } = supabaseService.storage
      .from(CHAT_IMAGES_BUCKET)
      .getPublicUrl(fileName);

    return sendJson(res, 200, { url: data.publicUrl });
  } catch {
    return sendJson(res, 500, { error: "Erro interno no upload" });
  } finally {
    await safeCleanupFile(tempFilePath);
  }
}

/* =========================
   /api/admin/clear
========================= */

async function handleAdminClear(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, {
      success: false,
      message: "Método não permitido",
    });
  }

  try {
    const body = await readJsonBody(req);
    const { username, scope } = body || {};

    if (!username) {
      return sendJson(res, 400, {
        success: false,
        message: "Username obrigatório",
      });
    }

    if (scope !== "all") {
      return sendJson(res, 400, {
        success: false,
        message: 'Scope inválido. Use "all".',
      });
    }

    const admin = await isAdminUser(username);

    if (!admin) {
      return sendJson(res, 403, {
        success: false,
        message: "Você não tem permissão para executar este comando",
      });
    }

    const [publicRes, privateRes] = await Promise.all([
      supabaseService.from(PUBLIC_MESSAGES_TABLE).select("image_url"),
      supabaseService.from(PRIVATE_MESSAGES_TABLE).select("image_url"),
    ]);

    if (publicRes.error) {
      throw new Error(`Erro ao buscar mensagens públicas: ${publicRes.error.message}`);
    }

    if (privateRes.error) {
      throw new Error(`Erro ao buscar mensagens privadas: ${privateRes.error.message}`);
    }

    const allRows = [
      ...(publicRes.data || []),
      ...(privateRes.data || []),
    ];

    const imagePaths = Array.from(
      new Set(
        allRows
          .map(row => extractStoragePathFromPublicUrl(row.image_url, CHAT_IMAGES_BUCKET))
          .filter(Boolean)
      )
    );

    if (imagePaths.length) {
      const chunkSize = 100;

      for (let i = 0; i < imagePaths.length; i += chunkSize) {
        const chunk = imagePaths.slice(i, i + chunkSize);

        const { error } = await supabaseService.storage
          .from(CHAT_IMAGES_BUCKET)
          .remove(chunk);

        if (error) {
          throw new Error(`Erro ao apagar imagens do storage: ${error.message}`);
        }
      }
    }

    const tables = [
      PRIVATE_MESSAGES_TABLE,
      PUBLIC_MESSAGES_TABLE,
      PRIVATE_CHANNELS_TABLE,
    ];

    for (const tableName of tables) {
      const { error } = await supabaseService
        .from(tableName)
        .delete()
        .not("id", "is", null);

      if (error) {
        throw new Error(`Erro ao limpar tabela ${tableName}: ${error.message}`);
      }
    }

    return sendJson(res, 200, {
      success: true,
      message: "❗ Chat completamente limpo. Mensagens, imagens e salas privadas foram removidas.",
      deleted_images: imagePaths.length,
    });
  } catch (error) {
    return sendJson(res, 500, {
      success: false,
      message: error.message || "Erro interno ao executar clear all",
    });
  }
}

/* =========================
   /api/dm/create
========================= */

async function handleDmCreate(req, res) {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return sendJson(res, 500, { success: false, error: "Supabase not configured" });
    }

    if (req.method !== "POST") {
      return sendJson(res, 405, { success: false, error: "Method not allowed" });
    }

    const body = await readJsonBody(req);

    const creator = body.creator || body.name || body.user1;
    const target = body.target || body.to || body.user2;
    const roomWanted = body.room;

    if (!creator || !target || !roomWanted) {
      return sendJson(res, 400, {
        success: false,
        error: "Dados incompletos. Use: /c @usuario NOME_DA_SALA",
      });
    }

    if (creator === target) {
      return sendJson(res, 400, {
        success: false,
        error: "Você precisa marcar OUTRO usuário para criar uma sala. Ex: /c @fulano sala123",
      });
    }

    if (!/^[A-Za-z0-9_-]{3,32}$/.test(roomWanted)) {
      return sendJson(res, 400, {
        success: false,
        error: 'Nome de sala inválido. Use 3 a 32 caracteres: letras, números, "_" ou "-".',
      });
    }

    const { data: existingByPair, error: pairError } = await supabaseService
      .from("private_channels")
      .select("id, room, user1, user2")
      .or(`and(user1.eq.${creator},user2.eq.${target}),and(user1.eq.${target},user2.eq.${creator})`)
      .limit(1);

    if (pairError) {
      return sendJson(res, 500, {
        success: false,
        error: pairError.message,
      });
    }

    const existing = Array.isArray(existingByPair) && existingByPair.length ? existingByPair[0] : null;

    if (existing) {
      return sendJson(res, 200, {
        success: true,
        reused: true,
        room: existing.room,
        message: `Você já tem uma sala privada com @${target}. Vou abrir a existente: ${existing.room}`,
        channel: existing,
      });
    }

    const { data: createdRows, error: insertError } = await supabaseService
      .from("private_channels")
      .insert([
        {
          room: roomWanted,
          user1: creator,
          user2: target,
          last_activity: new Date().toISOString(),
        },
      ])
      .select();

    if (insertError) {
      return sendJson(res, 500, {
        success: false,
        error: "Falha ao criar a sala.",
        details: insertError.message,
      });
    }

    const createdRow = Array.isArray(createdRows) ? createdRows[0] : createdRows;

    try {
      await supabaseService.from("messages").insert([
        {
          name: "Sistema",
          to: target,
          content: `@${creator} criou a sala "${roomWanted}". Use /entrar ${roomWanted}`,
        },
      ]);
    } catch {}

    return sendJson(res, 200, {
      success: true,
      reused: false,
      room: createdRow?.room || roomWanted,
      message: `Sala "${roomWanted}" criada com @${target}.`,
      channel: createdRow,
    });
  } catch (e) {
    return sendJson(res, 500, {
      success: false,
      error: "Erro interno no create.",
      details: String(e?.message || e),
    });
  }
}

/* =========================
   /api/dm/enter
========================= */

async function handleDmEnter(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { success: false, error: "Method not allowed" });
  }

  try {
    const body = await readJsonBody(req);
    const { name, room } = body || {};

    if (!isValidName(name) || !isValidRoom(room)) {
      return sendJson(res, 400, { success: false, error: "Invalid fields" });
    }

    await cleanupExpiredPrivateChannels();

    const channel = await getChannelByRoom(room);

    if (!channel) {
      return sendJson(res, 404, { success: false, error: "Room not found" });
    }

    const allowed = channel.user1 === name || channel.user2 === name;
    if (!allowed) {
      return sendJson(res, 403, { success: false, error: "Not allowed" });
    }

    await supabaseAnon
      .from("private_channels")
      .update({ last_activity: new Date().toISOString() })
      .eq("id", channel.id);

    const other = channel.user1 === name ? channel.user2 : channel.user1;

    return sendJson(res, 200, {
      success: true,
      channel: {
        id: channel.id,
        room: channel.room,
        other,
      },
    });
  } catch {
    return sendJson(res, 500, { success: false, error: "Internal error" });
  }
}

/* =========================
   /api/dm/leave
========================= */

async function handleDmLeave(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { success: false, error: "Method not allowed" });
  }

  try {
    const body = await readJsonBody(req);
    const { name, room } = body || {};

    if (!isValidName(name) || !isValidRoom(room)) {
      return sendJson(res, 400, { success: false, error: "Invalid fields" });
    }

    await supabaseAnon
      .from("private_channels")
      .update({ last_activity: new Date().toISOString() })
      .eq("room", room);

    return sendJson(res, 200, { success: true });
  } catch {
    return sendJson(res, 500, { success: false, error: "Internal error" });
  }
}

/* =========================
   /api/dm/messages
========================= */

async function handleDmMessages(req, res) {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return sendJson(res, 500, { success: false, error: "Supabase not configured" });
    }

    if (req.method === "GET") {
      const room = String(req.query?.room || "");
      const name = String(req.query?.name || "");

      if (!room || !name) {
        return sendJson(res, 400, { success: false, error: "Missing room/name" });
      }

      const channel = await getChannelByRoom(room);
      if (!channel) return sendJson(res, 404, []);

      const allowed = channel.user1 === name || channel.user2 === name;
      if (!allowed) return sendJson(res, 403, []);

      const { data, error } = await supabaseService
        .from("private_messages")
        .select("*")
        .eq("channel_id", channel.id)
        .order("created_at", { ascending: true });

      if (error) {
        return sendJson(res, 500, { success: false, error: error.message });
      }

      const list = Array.isArray(data) ? data : [];
      const usernames = list.map(msg => msg.sender).filter(Boolean);
      const adminMap = await getAdminMapFromUsers(usernames, true);

      const enriched = list.map(msg => ({
        ...msg,
        is_admin: !!adminMap[msg.sender],
      }));

      return sendJson(res, 200, enriched);
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);

      const room = body.room;
      const sender = body.sender;
      const message = body.message || "";
      const image_url = body.image_url || null;
      const reply_to = body.reply_to ?? null;
      const reply_preview = body.reply_preview ?? null;

      if (!room || !sender || (!message.trim() && !image_url)) {
        return sendJson(res, 400, { success: false, error: "Missing fields" });
      }

      const channel = await getChannelByRoom(room);
      if (!channel) {
        return sendJson(res, 404, { success: false, error: "Room not found" });
      }

      const allowed = channel.user1 === sender || channel.user2 === sender;
      if (!allowed) {
        return sendJson(res, 403, { success: false, error: "Not allowed" });
      }

      async function buildReplyPreviewFromDb(id) {
        if (!id) return null;

        const { data, error } = await supabaseService
          .from("private_messages")
          .select("id, sender, message, image_url, created_at, channel_id")
          .eq("id", id)
          .limit(1);

        if (error) return null;

        const original = Array.isArray(data) && data.length ? data[0] : null;
        if (!original) return null;
        if (String(original.channel_id) !== String(channel.id)) return null;

        const text = (original.message || "").trim();
        const snippet = text
          ? (text.length > 80 ? text.slice(0, 80) + "…" : text)
          : (original.image_url ? "🖼 Imagem" : "");

        return {
          id: original.id,
          name: original.sender,
          snippet,
          hasImage: !!original.image_url,
          created_at: original.created_at,
        };
      }

      let finalReplyTo = reply_to;
      let finalReplyPreview = null;

      try {
        if (finalReplyTo) {
          const built = await buildReplyPreviewFromDb(finalReplyTo);
          if (built) finalReplyPreview = built;
          else {
            finalReplyPreview = reply_preview && typeof reply_preview === "object" ? reply_preview : null;
            if (!finalReplyPreview) finalReplyTo = null;
          }
        }
      } catch {
        finalReplyPreview = reply_preview && typeof reply_preview === "object" ? reply_preview : null;
        if (!finalReplyPreview) finalReplyTo = null;
      }

      const insertBody = {
        channel_id: channel.id,
        sender,
        message: message.trim() ? message : "🖼 Imagem",
        image_url,
        reply_to: finalReplyTo,
        reply_preview: finalReplyPreview,
      };

      const { error: insertError } = await supabaseService
        .from("private_messages")
        .insert([insertBody]);

      if (insertError) {
        return sendJson(res, 500, { success: false, error: insertError.message });
      }

      try {
        await supabaseService
          .from("private_channels")
          .update({ last_activity: new Date().toISOString() })
          .eq("room", room);
      } catch {}

      return sendJson(res, 200, { success: true });
    }

    return sendJson(res, 405, { success: false, error: "Method not allowed" });
  } catch (e) {
    return sendJson(res, 500, {
      success: false,
      error: "Internal error",
      details: String(e?.message || e),
    });
  }
}

/* =========================
   MAIN ROUTER
========================= */

async function handler(req, res) {
  const routeKey = getRouteKey(req);

  if (!SUPABASE_URL) {
    return sendJson(res, 500, {
      success: false,
      message: "SUPABASE_URL não configurada",
    });
  }

  if (routeKey === "login") return handleLogin(req, res);
  if (routeKey === "messages") return handleMessages(req, res);
  if (routeKey === "online") return handleOnline(req, res);
  if (routeKey === "profile") return handleProfile(req, res);
  if (routeKey === "profile-upload") return handleProfileUpload(req, res);
  if (routeKey === "upload") return handleChatUpload(req, res);
  if (routeKey === "admin/clear") return handleAdminClear(req, res);
  if (routeKey === "dm/create") return handleDmCreate(req, res);
  if (routeKey === "dm/enter") return handleDmEnter(req, res);
  if (routeKey === "dm/leave") return handleDmLeave(req, res);
  if (routeKey === "dm/messages") return handleDmMessages(req, res);

  return sendJson(res, 404, {
    success: false,
    message: `Rota não encontrada: ${routeKey}`,
  });
}

module.exports = handler;
module.exports.config = {
  api: {
    bodyParser: false,
  },
};
