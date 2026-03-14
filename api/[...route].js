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

async function getProfileMap(usernames, useService = false) {
  const cleanNames = Array.from(new Set((usernames || []).filter(Boolean)));
  if (!cleanNames.length) return {};

  const client = useService ? supabaseService : supabaseAnon;

  const { data, error } = await client
    .from("user_profiles")
    .select("username, display_name, avatar_url")
    .in("username", cleanNames);

  if (error || !Array.isArray(data)) return {};

  const map = {};
  data.forEach(profile => {
    map[profile.username] = {
      display_name: profile.display_name || profile.username,
      avatar_url: profile.avatar_url || null,
    };
  });

  return map;
}

async function userExists(username, useService = false) {
  const cleanUsername = String(username || "").trim();
  if (!cleanUsername) return false;

  const client = useService ? supabaseService : supabaseAnon;

  const { data, error } = await client
    .from("users")
    .select("username")
    .eq("username", cleanUsername)
    .maybeSingle();

  if (error) return false;
  return !!data?.username;
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

async function requireAdminAccess(username) {
  if (!username) {
    throw new Error("Username obrigatório");
  }

  const admin = await isAdminUser(username);
  if (!admin) {
    const err = new Error("Você não tem permissão para executar esta ação");
    err.statusCode = 403;
    throw err;
  }
}

async function getProfileByUsername(username) {
  const { data, error } = await supabaseService
    .from("user_profiles")
    .select("username, display_name, avatar_url")
    .eq("username", username)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data || null;
}

async function appendAdminLog(actor, action, details = {}) {
  try {
    await supabaseService.from("admin_logs").insert([
      {
        actor,
        action,
        details,
      },
    ]);
  } catch {}
}

function normalizeSearchTerm(value) {
  return String(value || "").trim().toLowerCase();
}

function includesSearch(value, term) {
  if (!term) return true;
  return String(value || "").toLowerCase().includes(term);
}

async function getChannelByRoom(room) {
  const { data, error } = await supabaseService
    .from(PRIVATE_CHANNELS_TABLE)
    .select("id, room, user1, user2, last_activity")
    .eq("room", room)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data || null;
}

async function cleanupExpiredPrivateChannels() {
  const cutoff = new Date(Date.now() - DM_TTL_MINUTES * 60_000).toISOString();

  const { data: expired, error } = await supabaseAnon
    .from(PRIVATE_CHANNELS_TABLE)
    .select("id")
    .lt("last_activity", cutoff);

  if (error || !expired?.length) return;

  const ids = expired.map(x => x.id);

  await supabaseAnon.from(PRIVATE_MESSAGES_TABLE).delete().in("channel_id", ids);
  await supabaseAnon.from(PRIVATE_CHANNELS_TABLE).delete().in("id", ids);
}

/* =========================
   /api/realtime/config
========================= */

async function handleRealtimeConfig(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, {
      success: false,
      message: "Método não permitido",
    });
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return sendJson(res, 500, {
      success: false,
      message: "Realtime não configurado",
    });
  }

  return sendJson(res, 200, {
    success: true,
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
  });
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
        .from(PUBLIC_MESSAGES_TABLE)
        .select("*")
        .order("created_at", { ascending: true });

      if (error) {
        return sendJson(res, 500, { error: error.message });
      }

      const list = Array.isArray(data) ? data : [];
      const usernames = list.map(msg => msg.name).filter(Boolean);
      const adminMap = await getAdminMapFromUsers(usernames, false);
      const profileMap = await getProfileMap(usernames, false);

      const enriched = list.map(msg => ({
        ...msg,
        is_admin: !!adminMap[msg.name],
        display_name: profileMap[msg.name]?.display_name || msg.name,
        avatar_url: profileMap[msg.name]?.avatar_url || null,
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

      if (to) {
        const whisperTargetExists = await userExists(to, false);
        if (!whisperTargetExists) {
          return sendJson(res, 400, {
            success: false,
            error: "Usuário do sussurro não existe",
          });
        }
      }

      async function canReplyToMessage(original) {
        if (!original) return false;
        if (!original.to) return true;
        return original.to === name || original.name === name;
      }

      async function buildReplyPreviewFromDb(id) {
        if (!id) return null;

        const { data, error } = await supabaseAnon
          .from(PUBLIC_MESSAGES_TABLE)
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
        .from(PUBLIC_MESSAGES_TABLE)
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
   Compatibilidade: mantido
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
        .select("username, display_name, avatar_url")
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

async function handleUsersList(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { success: false, error: "Method not allowed" });
  }

  try {
    const { data, error } = await supabaseAnon
      .from("users")
      .select("username")
      .order("username", { ascending: true });

    if (error) {
      return sendJson(res, 500, { success: false, error: error.message });
    }

    return sendJson(res, 200, {
      success: true,
      users: Array.isArray(data) ? data : [],
    });
  } catch (error) {
    return sendJson(res, 500, {
      success: false,
      error: error.message || "Erro interno",
    });
  }
}

/* =========================
   /api/admin/*
========================= */

async function getReferencedImagePaths(options = {}) {
  const includePublic = options.includePublic !== false;
  const includePrivate = options.includePrivate !== false;
  const paths = new Set();

  if (includePublic) {
    const { data, error } = await supabaseService
      .from(PUBLIC_MESSAGES_TABLE)
      .select("image_url");

    if (error) throw new Error(`Erro ao buscar imagens públicas: ${error.message}`);

    (data || []).forEach(row => {
      const path = extractStoragePathFromPublicUrl(row.image_url, CHAT_IMAGES_BUCKET);
      if (path) paths.add(path);
    });
  }

  if (includePrivate) {
    const { data, error } = await supabaseService
      .from(PRIVATE_MESSAGES_TABLE)
      .select("image_url");

    if (error) throw new Error(`Erro ao buscar imagens privadas: ${error.message}`);

    (data || []).forEach(row => {
      const path = extractStoragePathFromPublicUrl(row.image_url, CHAT_IMAGES_BUCKET);
      if (path) paths.add(path);
    });
  }

  return Array.from(paths);
}

async function removeStoragePaths(bucket, paths) {
  const unique = Array.from(new Set((paths || []).filter(Boolean)));
  if (!unique.length) return 0;

  const chunkSize = 100;

  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const { error } = await supabaseService.storage.from(bucket).remove(chunk);
    if (error) throw new Error(`Erro ao remover arquivos do bucket ${bucket}: ${error.message}`);
  }

  return unique.length;
}

async function handleAdminStats(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { success: false, message: "Método não permitido" });
  }

  try {
    const username = String(req.query?.username || "").trim();
    await requireAdminAccess(username);

    const now = Date.now();

    const [
      usersRes,
      publicRes,
      privateRes,
      channelsRes,
      onlineRes,
      recentPublicRes,
      recentPrivateRes,
    ] = await Promise.all([
      supabaseService.from("users").select("username, is_admin"),
      supabaseService.from(PUBLIC_MESSAGES_TABLE).select("id, image_url"),
      supabaseService.from(PRIVATE_MESSAGES_TABLE).select("id, image_url"),
      supabaseService.from(PRIVATE_CHANNELS_TABLE).select("id, last_activity"),
      supabaseService.from("online_users").select("name, last_seen"),
      supabaseService.from(PUBLIC_MESSAGES_TABLE).select("id").order("created_at", { ascending: false }).limit(1),
      supabaseService.from(PRIVATE_MESSAGES_TABLE).select("id").order("created_at", { ascending: false }).limit(1),
    ]);

    const responses = [usersRes, publicRes, privateRes, channelsRes, onlineRes, recentPublicRes, recentPrivateRes];
    const failed = responses.find(item => item.error);
    if (failed?.error) throw new Error(failed.error.message);

    const users = usersRes.data || [];
    const onlineUsers = (onlineRes.data || []).filter((user) => {
      const last = new Date(user.last_seen).getTime();
      return Number.isFinite(last) && now - last < 15000;
    });

    const publicMessages = publicRes.data || [];
    const privateMessages = privateRes.data || [];
    const channels = channelsRes.data || [];

    return sendJson(res, 200, {
      success: true,
      stats: {
        users_total: users.length,
        admins_total: users.filter(user => !!user.is_admin).length,
        online_now: onlineUsers.length,
        public_messages: publicMessages.length,
        private_messages: privateMessages.length,
        private_rooms: channels.length,
        uploaded_images: publicMessages.filter(row => !!row.image_url).length + privateMessages.filter(row => !!row.image_url).length,
        newest_public_message: recentPublicRes.data?.[0]?.id || null,
        newest_private_message: recentPrivateRes.data?.[0]?.id || null,
      },
    });
  } catch (error) {
    return sendJson(res, error.statusCode || 500, {
      success: false,
      message: error.message || "Erro ao carregar estatísticas",
    });
  }
}

async function handleAdminUsers(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { success: false, message: "Método não permitido" });
  }

  try {
    const username = String(req.query?.username || "").trim();
    const search = normalizeSearchTerm(req.query?.search);
    await requireAdminAccess(username);

    const [usersRes, profilesRes, onlineRes] = await Promise.all([
      supabaseService.from("users").select("username, is_admin, created_at").order("created_at", { ascending: true }),
      supabaseService.from("user_profiles").select("username, display_name, avatar_url"),
      supabaseService.from("online_users").select("name, last_seen"),
    ]);

    const failed = [usersRes, profilesRes, onlineRes].find(item => item.error);
    if (failed?.error) throw new Error(failed.error.message);

    const profileMap = {};
    (profilesRes.data || []).forEach(profile => {
      profileMap[profile.username] = profile;
    });

    const now = Date.now();
    const onlineMap = {};
    (onlineRes.data || []).forEach(item => {
      const last = new Date(item.last_seen).getTime();
      onlineMap[item.name] = Number.isFinite(last) && now - last < 15000;
    });

    const rows = (usersRes.data || []).map((user) => {
      const profile = profileMap[user.username] || {};
      return {
        username: user.username,
        display_name: profile.display_name || user.username,
        avatar_url: profile.avatar_url || null,
        is_admin: !!user.is_admin,
        created_at: user.created_at || null,
        online: !!onlineMap[user.username],
      };
    }).filter((row) => {
      if (!search) return true;
      return includesSearch(row.username, search) || includesSearch(row.display_name, search);
    });

    return sendJson(res, 200, { success: true, users: rows });
  } catch (error) {
    return sendJson(res, error.statusCode || 500, {
      success: false,
      message: error.message || "Erro ao listar usuários",
    });
  }
}

async function handleAdminUserCreate(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { success: false, message: "Método não permitido" });
  }

  try {
    const body = await readJsonBody(req);
    const actor = String(body?.username || "").trim();
    await requireAdminAccess(actor);

    const newUsername = String(body?.new_username || "").trim();
    const password = String(body?.password || "").trim();
    const displayName = String(body?.display_name || newUsername).trim();
    const isAdmin = !!body?.is_admin;

    if (!isValidName(newUsername)) {
      return sendJson(res, 400, {
        success: false,
        message: "Username inválido. Use de 2 a 24 caracteres: letras, números ou _",
      });
    }

    if (password.length < 3 || password.length > 80) {
      return sendJson(res, 400, {
        success: false,
        message: "A senha precisa ter entre 3 e 80 caracteres",
      });
    }

    const { data: existingUser, error: existingError } = await supabaseService
      .from("users")
      .select("username")
      .eq("username", newUsername)
      .maybeSingle();

    if (existingError) throw new Error(existingError.message);
    if (existingUser) {
      return sendJson(res, 409, {
        success: false,
        message: "Esse username já existe",
      });
    }

    const safeDisplayName = displayName.slice(0, 40) || newUsername;

    const { error: insertUserError } = await supabaseService
      .from("users")
      .insert([
        {
          username: newUsername,
          password,
          is_admin: isAdmin,
        },
      ]);

    if (insertUserError) throw new Error(insertUserError.message);

    const { error: insertProfileError } = await supabaseService
      .from("user_profiles")
      .upsert(
        [
          {
            username: newUsername,
            display_name: safeDisplayName,
            avatar_url: null,
          },
        ],
        { onConflict: "username" }
      );

    if (insertProfileError) throw new Error(insertProfileError.message);

    await appendAdminLog(actor, "user_create", {
      target: newUsername,
      is_admin: isAdmin,
    });

    return sendJson(res, 200, {
      success: true,
      message: `Usuário ${newUsername} criado com sucesso`,
    });
  } catch (error) {
    return sendJson(res, error.statusCode || 500, {
      success: false,
      message: error.message || "Erro ao criar usuário",
    });
  }
}

async function handleAdminUserRole(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { success: false, message: "Método não permitido" });
  }

  try {
    const body = await readJsonBody(req);
    const actor = String(body?.username || "").trim();
    await requireAdminAccess(actor);

    const target = String(body?.target_username || "").trim();
    const makeAdmin = !!body?.is_admin;

    if (!target) {
      return sendJson(res, 400, { success: false, message: "Usuário alvo obrigatório" });
    }

    const { data: targetUser, error: targetError } = await supabaseService
      .from("users")
      .select("username")
      .eq("username", target)
      .maybeSingle();

    if (targetError) throw new Error(targetError.message);
    if (!targetUser) {
      return sendJson(res, 404, { success: false, message: "Usuário não encontrado" });
    }

    const { error: updateError } = await supabaseService
      .from("users")
      .update({ is_admin: makeAdmin })
      .eq("username", target);

    if (updateError) throw new Error(updateError.message);

    await appendAdminLog(actor, makeAdmin ? "user_promote" : "user_demote", {
      target,
      is_admin: makeAdmin,
    });

    return sendJson(res, 200, {
      success: true,
      message: makeAdmin ? `${target} agora é admin` : `${target} deixou de ser admin`,
    });
  } catch (error) {
    return sendJson(res, error.statusCode || 500, {
      success: false,
      message: error.message || "Erro ao atualizar permissão",
    });
  }
}

async function handleAdminUserRemove(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { success: false, message: "Método não permitido" });
  }

  try {
    const body = await readJsonBody(req);
    const actor = String(body?.username || "").trim();
    await requireAdminAccess(actor);

    const target = String(body?.target_username || "").trim();
    if (!target) {
      return sendJson(res, 400, { success: false, message: "Usuário alvo obrigatório" });
    }

    if (target === actor) {
      return sendJson(res, 400, { success: false, message: "Você não pode remover a própria conta por aqui" });
    }

    const profile = await getProfileByUsername(target);
    const avatarPath = extractStoragePathFromPublicUrl(profile?.avatar_url, PROFILE_AVATARS_BUCKET);

    const [publicMsgsRes, channelsRes, privateMsgsRes] = await Promise.all([
      supabaseService.from(PUBLIC_MESSAGES_TABLE).select("id, image_url").eq("name", target),
      supabaseService.from(PRIVATE_CHANNELS_TABLE).select("id").or(`user1.eq.${target},user2.eq.${target}`),
      supabaseService.from(PRIVATE_MESSAGES_TABLE).select("id, image_url").eq("sender", target),
    ]);

    const failed = [publicMsgsRes, channelsRes, privateMsgsRes].find(item => item.error);
    if (failed?.error) throw new Error(failed.error.message);

    const channelIds = (channelsRes.data || []).map(item => item.id);
    let channelMessages = [];
    if (channelIds.length) {
      const channelMessagesRes = await supabaseService
        .from(PRIVATE_MESSAGES_TABLE)
        .select("id, image_url")
        .in("channel_id", channelIds);
      if (channelMessagesRes.error) throw new Error(channelMessagesRes.error.message);
      channelMessages = channelMessagesRes.data || [];
    }

    const imagePaths = [
      ...((publicMsgsRes.data || []).map(row => extractStoragePathFromPublicUrl(row.image_url, CHAT_IMAGES_BUCKET)).filter(Boolean)),
      ...((privateMsgsRes.data || []).map(row => extractStoragePathFromPublicUrl(row.image_url, CHAT_IMAGES_BUCKET)).filter(Boolean)),
      ...((channelMessages || []).map(row => extractStoragePathFromPublicUrl(row.image_url, CHAT_IMAGES_BUCKET)).filter(Boolean)),
    ];

    await removeStoragePaths(CHAT_IMAGES_BUCKET, imagePaths);
    if (avatarPath) {
      await removeStoragePaths(PROFILE_AVATARS_BUCKET, [avatarPath]);
    }

    if (channelIds.length) {
      await supabaseService.from(PRIVATE_MESSAGES_TABLE).delete().in("channel_id", channelIds);
      await supabaseService.from(PRIVATE_CHANNELS_TABLE).delete().in("id", channelIds);
    }

    await supabaseService.from(PRIVATE_MESSAGES_TABLE).delete().eq("sender", target);
    await supabaseService.from(PUBLIC_MESSAGES_TABLE).delete().eq("name", target);
    await supabaseService.from("online_users").delete().eq("name", target);
    await supabaseService.from("user_profiles").delete().eq("username", target);
    await supabaseService.from("users").delete().eq("username", target);

    await appendAdminLog(actor, "user_remove", {
      target,
      deleted_images: imagePaths.length,
      removed_channels: channelIds.length,
    });

    return sendJson(res, 200, {
      success: true,
      message: `Usuário ${target} removido com sucesso`,
    });
  } catch (error) {
    return sendJson(res, error.statusCode || 500, {
      success: false,
      message: error.message || "Erro ao remover usuário",
    });
  }
}

async function handleAdminLogs(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { success: false, message: "Método não permitido" });
  }

  try {
    const username = String(req.query?.username || "").trim();
    const type = String(req.query?.type || "all").trim();
    const search = normalizeSearchTerm(req.query?.search);
    const limit = Math.min(Math.max(Number(req.query?.limit || 80), 10), 200);
    await requireAdminAccess(username);

    const [publicRes, privateRes, adminRes] = await Promise.all([
      supabaseService.from(PUBLIC_MESSAGES_TABLE).select("id, name, content, image_url, to, created_at").order("created_at", { ascending: false }).limit(limit),
      supabaseService.from(PRIVATE_MESSAGES_TABLE).select("id, sender, message, image_url, created_at, channel_id").order("created_at", { ascending: false }).limit(limit),
      supabaseService.from("admin_logs").select("id, actor, action, details, created_at").order("created_at", { ascending: false }).limit(limit),
    ]);

    const publicItems = (publicRes.error ? [] : (publicRes.data || [])).map(item => ({
      id: `public-${item.id}`,
      type: "public",
      actor: item.name,
      target: item.to || null,
      message: item.content || (item.image_url ? "🖼 Imagem" : ""),
      has_image: !!item.image_url,
      created_at: item.created_at,
      raw: item,
    }));

    const privateItems = (privateRes.error ? [] : (privateRes.data || [])).map(item => ({
      id: `private-${item.id}`,
      type: "private",
      actor: item.sender,
      target: item.channel_id,
      message: item.message || (item.image_url ? "🖼 Imagem" : ""),
      has_image: !!item.image_url,
      created_at: item.created_at,
      raw: item,
    }));

    const adminItems = (adminRes.error ? [] : (adminRes.data || [])).map(item => ({
      id: `admin-${item.id}`,
      type: "admin",
      actor: item.actor,
      target: item.details?.target || null,
      message: item.action,
      has_image: false,
      created_at: item.created_at,
      raw: item,
    }));

    const merged = [...publicItems, ...privateItems, ...adminItems]
      .filter(item => {
        if (type !== "all" && item.type !== type) return false;
        if (!search) return true;
        return [item.actor, item.target, item.message, JSON.stringify(item.raw || {})].some(value => includesSearch(value, search));
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);

    return sendJson(res, 200, { success: true, logs: merged });
  } catch (error) {
    return sendJson(res, error.statusCode || 500, {
      success: false,
      message: error.message || "Erro ao carregar logs",
    });
  }
}

async function handleAdminClear(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, {
      success: false,
      message: "Método não permitido",
    });
  }

  try {
    const body = await readJsonBody(req);
    const { username } = body || {};
    const scope = String(body?.scope || "all").trim();

    await requireAdminAccess(username);

    const validScopes = ["all", "public", "private", "images", "channels"];
    if (!validScopes.includes(scope)) {
      return sendJson(res, 400, {
        success: false,
        message: `Scope inválido. Use um destes: ${validScopes.join(", ")}`,
      });
    }

    let deletedImages = 0;
    let deletedPublic = 0;
    let deletedPrivate = 0;
    let deletedChannels = 0;

    if (scope === "all" || scope === "public") {
      const { data, error } = await supabaseService.from(PUBLIC_MESSAGES_TABLE).select("id, image_url");
      if (error) throw new Error(`Erro ao buscar mensagens públicas: ${error.message}`);
      const rows = data || [];
      deletedPublic = rows.length;
      deletedImages += await removeStoragePaths(
        CHAT_IMAGES_BUCKET,
        rows.map(row => extractStoragePathFromPublicUrl(row.image_url, CHAT_IMAGES_BUCKET)).filter(Boolean)
      );
      if (rows.length) {
        const { error: deleteError } = await supabaseService.from(PUBLIC_MESSAGES_TABLE).delete().not("id", "is", null);
        if (deleteError) throw new Error(`Erro ao limpar mensagens públicas: ${deleteError.message}`);
      }
    }

    if (scope === "all" || scope === "private") {
      const { data, error } = await supabaseService.from(PRIVATE_MESSAGES_TABLE).select("id, image_url");
      if (error) throw new Error(`Erro ao buscar mensagens privadas: ${error.message}`);
      const rows = data || [];
      deletedPrivate = rows.length;
      deletedImages += await removeStoragePaths(
        CHAT_IMAGES_BUCKET,
        rows.map(row => extractStoragePathFromPublicUrl(row.image_url, CHAT_IMAGES_BUCKET)).filter(Boolean)
      );
      if (rows.length) {
        const { error: deleteError } = await supabaseService.from(PRIVATE_MESSAGES_TABLE).delete().not("id", "is", null);
        if (deleteError) throw new Error(`Erro ao limpar mensagens privadas: ${deleteError.message}`);
      }
      if (scope === "all") {
        const channelsRes = await supabaseService.from(PRIVATE_CHANNELS_TABLE).select("id");
        if (channelsRes.error) throw new Error(`Erro ao buscar salas privadas: ${channelsRes.error.message}`);
        deletedChannels = (channelsRes.data || []).length;
        if (deletedChannels) {
          const { error: deleteChannelsError } = await supabaseService.from(PRIVATE_CHANNELS_TABLE).delete().not("id", "is", null);
          if (deleteChannelsError) throw new Error(`Erro ao limpar salas privadas: ${deleteChannelsError.message}`);
        }
      }
    }

    if (scope === "channels") {
      const channelsRes = await supabaseService.from(PRIVATE_CHANNELS_TABLE).select("id");
      if (channelsRes.error) throw new Error(`Erro ao buscar salas privadas: ${channelsRes.error.message}`);
      const channelIds = (channelsRes.data || []).map(item => item.id);
      deletedChannels = channelIds.length;

      if (channelIds.length) {
        const messageRes = await supabaseService.from(PRIVATE_MESSAGES_TABLE).select("id, image_url").in("channel_id", channelIds);
        if (messageRes.error) throw new Error(`Erro ao buscar mensagens das salas: ${messageRes.error.message}`);
        const rows = messageRes.data || [];
        deletedPrivate = rows.length;
        deletedImages += await removeStoragePaths(
          CHAT_IMAGES_BUCKET,
          rows.map(row => extractStoragePathFromPublicUrl(row.image_url, CHAT_IMAGES_BUCKET)).filter(Boolean)
        );
        await supabaseService.from(PRIVATE_MESSAGES_TABLE).delete().in("channel_id", channelIds);
        await supabaseService.from(PRIVATE_CHANNELS_TABLE).delete().in("id", channelIds);
      }
    }

    if (scope === "images") {
      const imagePaths = await getReferencedImagePaths({ includePublic: true, includePrivate: true });
      deletedImages = await removeStoragePaths(CHAT_IMAGES_BUCKET, imagePaths);

      const publicWithImages = await supabaseService
        .from(PUBLIC_MESSAGES_TABLE)
        .update({ image_url: null, content: "Imagem removida pelo admin" })
        .not("image_url", "is", null);
      if (publicWithImages.error) throw new Error(`Erro ao limpar imagens públicas: ${publicWithImages.error.message}`);

      const privateWithImages = await supabaseService
        .from(PRIVATE_MESSAGES_TABLE)
        .update({ image_url: null, message: "Imagem removida pelo admin" })
        .not("image_url", "is", null);
      if (privateWithImages.error) throw new Error(`Erro ao limpar imagens privadas: ${privateWithImages.error.message}`);
    }

    await appendAdminLog(username, `clear_${scope}`, {
      scope,
      deleted_images: deletedImages,
      deleted_public: deletedPublic,
      deleted_private: deletedPrivate,
      deleted_channels: deletedChannels,
    });

    const messages = {
      all: "Chat completamente limpo. Mensagens, imagens e salas privadas foram removidas.",
      public: "Mensagens públicas removidas com sucesso.",
      private: "Mensagens privadas removidas com sucesso.",
      images: "Todas as imagens do chat foram removidas e os registros foram neutralizados.",
      channels: "Salas privadas e suas mensagens foram removidas com sucesso.",
    };

    return sendJson(res, 200, {
      success: true,
      message: messages[scope],
      deleted_images: deletedImages,
      deleted_public: deletedPublic,
      deleted_private: deletedPrivate,
      deleted_channels: deletedChannels,
    });
  } catch (error) {
    return sendJson(res, error.statusCode || 500, {
      success: false,
      message: error.message || "Erro interno ao executar ação admin",
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

    if (!(await userExists(creator, true))) {
      return sendJson(res, 400, {
        success: false,
        error: "Usuário criador não existe",
      });
    }

    if (!(await userExists(target, true))) {
      return sendJson(res, 400, {
        success: false,
        error: "Usuário marcado não existe",
      });
    }

    if (!/^[A-Za-z0-9_-]{3,32}$/.test(roomWanted)) {
      return sendJson(res, 400, {
        success: false,
        error: 'Nome de sala inválido. Use 3 a 32 caracteres: letras, números, "_" ou "-".',
      });
    }

    const { data: existingByPair, error: pairError } = await supabaseService
      .from(PRIVATE_CHANNELS_TABLE)
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
      .from(PRIVATE_CHANNELS_TABLE)
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
      await supabaseService.from(PUBLIC_MESSAGES_TABLE).insert([
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
      .from(PRIVATE_CHANNELS_TABLE)
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
      .from(PRIVATE_CHANNELS_TABLE)
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
        .from(PRIVATE_MESSAGES_TABLE)
        .select("*")
        .eq("channel_id", channel.id)
        .order("created_at", { ascending: true });

      if (error) {
        return sendJson(res, 500, { success: false, error: error.message });
      }

      const list = Array.isArray(data) ? data : [];
      const usernames = list.map(msg => msg.sender).filter(Boolean);
      const adminMap = await getAdminMapFromUsers(usernames, true);
      const profileMap = await getProfileMap(usernames, true);

      const enriched = list.map(msg => ({
        ...msg,
        is_admin: !!adminMap[msg.sender],
        display_name: profileMap[msg.sender]?.display_name || msg.sender,
        avatar_url: profileMap[msg.sender]?.avatar_url || null,
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
          .from(PRIVATE_MESSAGES_TABLE)
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
        .from(PRIVATE_MESSAGES_TABLE)
        .insert([insertBody]);

      if (insertError) {
        return sendJson(res, 500, { success: false, error: insertError.message });
      }

      try {
        await supabaseService
          .from(PRIVATE_CHANNELS_TABLE)
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

  if (routeKey === "realtime/config") return handleRealtimeConfig(req, res);
  if (routeKey === "login") return handleLogin(req, res);
  if (routeKey === "messages") return handleMessages(req, res);
  if (routeKey === "online") return handleOnline(req, res);
  if (routeKey === "profile") return handleProfile(req, res);
  if (routeKey === "profile-upload") return handleProfileUpload(req, res);
  if (routeKey === "upload") return handleChatUpload(req, res);
  if (routeKey === "users/list") return handleUsersList(req, res);
  if (routeKey === "admin/stats") return handleAdminStats(req, res);
  if (routeKey === "admin/users") return handleAdminUsers(req, res);
  if (routeKey === "admin/users/create") return handleAdminUserCreate(req, res);
  if (routeKey === "admin/users/role") return handleAdminUserRole(req, res);
  if (routeKey === "admin/users/remove") return handleAdminUserRemove(req, res);
  if (routeKey === "admin/logs") return handleAdminLogs(req, res);
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
