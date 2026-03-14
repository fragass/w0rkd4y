const loggedUser = sessionStorage.getItem("loggedUser");
const currentUserIsAdmin = sessionStorage.getItem("isAdmin") === "true";
const IMAGE_READY_PLACEHOLDER = "📎 imagem anexada";

const API_BASE = "/api/[...route]";

function buildApiUrl(route, query = {}) {
  const cleanRoute = String(route || "").replace(/^\/+|\/+$/g, "");
  const params = new URLSearchParams();

  params.set("route", cleanRoute);

  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, value);
    }
  });

  return `${API_BASE}?${params.toString()}`;
}

function apiFetch(route, options = {}, query = {}) {
  return fetch(buildApiUrl(route, query), options);
}

let lastMessageId = null;
let pendingImageUrl = null;
let isSending = false;

let chatMode = "public";
let currentRoom = null;
let currentOther = null;

let replyState = null;
let lastRenderedElements = [];

let typingDebounceTimer = null;
let typingStopTimer = null;
let lastTypingSentAt = 0;

let currentProfile = {
  username: loggedUser,
  display_name: loggedUser,
  avatar_url: null
};

const BASE_TITLE = "Página Inicial - Workday";
const SEEN_KEY = "wd_lastSeenAt";
const BADGE_KEY = "wd_badgeCount";

/* =========================
   CONTROLE DE RENDER
========================= */

let publicRenderVersion = 0;
let dmRenderVersion = 0;

/* =========================
   REALTIME
========================= */

let supabaseClient = null;
let realtimeReady = false;
let publicRealtimeChannel = null;
let dmRealtimeChannel = null;
let registeredUsers = new Set();
let registeredUsersList = [];
let registeredUsersMap = new Map();
let globalPresenceChannel = null;

let mentionSuggestions = [];
let mentionActiveIndex = -1;
let mentionQueryState = null;

/* typing separado por ambiente */
const typingStateByRoom = new Map();

function getActiveTypingRoomKey() {
  return chatMode === "dm" && currentRoom ? `dm:${currentRoom}` : "public";
}

function getActiveTypingChannel() {
  return chatMode === "dm" && currentRoom ? dmRealtimeChannel : publicRealtimeChannel;
}

function getTypingMapForRoom(roomKey) {
  const key = String(roomKey || "public");
  if (!typingStateByRoom.has(key)) {
    typingStateByRoom.set(key, new Map());
  }
  return typingStateByRoom.get(key);
}

async function initRealtimeClient() {
  if (supabaseClient || !window.supabase) return !!supabaseClient;

  try {
    const res = await apiFetch("realtime/config");
    const cfg = await res.json();

    if (!res.ok || !cfg?.url || !cfg?.anonKey) {
      console.warn("Realtime config ausente ou inválida.");
      return false;
    }

    supabaseClient = window.supabase.createClient(cfg.url, cfg.anonKey, {
      realtime: {
        params: {
          eventsPerSecond: 10
        }
      }
    });

    realtimeReady = true;
    return true;
  } catch (err) {
    console.warn("Falha ao inicializar realtime:", err);
    realtimeReady = false;
    return false;
  }
}

function clearTypingUI() {
  const el = document.getElementById("typingStatus");
  if (el) el.textContent = "";
}

function pruneTypingMaps() {
  const now = Date.now();

  for (const [, roomMap] of typingStateByRoom.entries()) {
    for (const [name, expiresAt] of roomMap.entries()) {
      if (expiresAt <= now) {
        roomMap.delete(name);
      }
    }
  }
}

function setTypingUIFromMap() {
  const el = document.getElementById("typingStatus");
  if (!el) return;

  pruneTypingMaps();

  const activeRoomKey = getActiveTypingRoomKey();
  const roomMap = getTypingMapForRoom(activeRoomKey);
  const names = [];

  for (const [name, expiresAt] of roomMap.entries()) {
    if (expiresAt > Date.now() && name !== loggedUser) {
      names.push(name);
    }
  }

  if (!names.length) {
    el.textContent = "";
    return;
  }

  if (names.length === 1) {
    el.textContent = `${names[0]} está digitando...`;
    return;
  }

  if (names.length === 2) {
    el.textContent = `${names[0]} e ${names[1]} estão digitando...`;
    return;
  }

  el.textContent = `${names.slice(0, 3).join(", ")} estão digitando...`;
}

function setTypingUI(names) {
  const el = document.getElementById("typingStatus");
  if (!el) return;

  if (!names || !names.length) { el.textContent = ""; return; }
  if (names.length === 1) { el.textContent = `${names[0]} está digitando...`; return; }
  if (names.length === 2) { el.textContent = `${names[0]} e ${names[1]} estão digitando...`; return; }
  el.textContent = `${names.slice(0, 3).join(", ")} estão digitando...`;
}

function bindTypingBroadcast(channel, roomKey) {
  if (!channel) return;

  channel.on("broadcast", { event: "typing" }, ({ payload }) => {
    if (!payload || !payload.name) return;
    if (payload.name === loggedUser) return;

    const payloadRoom = String(payload.room || "public");
    const currentPayloadMap = getTypingMapForRoom(payloadRoom);

    if (payload.typing) {
      currentPayloadMap.set(payload.name, Date.now() + 2200);
    } else {
      currentPayloadMap.delete(payload.name);
    }

    if (payloadRoom === getActiveTypingRoomKey()) {
      setTypingUIFromMap();
    }
  });
}

function renderOnlineUsersFromPresence() {
  const el = document.getElementById("onlineUsers");
  if (!el) return;

  if (!globalPresenceChannel) {
    el.textContent = "0";
    return;
  }

  try {
    const state = globalPresenceChannel.presenceState();
    const names = Object.keys(state || {});
    el.textContent = names.length ? names.join(", ") : "0";
  } catch {
    el.textContent = "0";
  }
}

async function setupGlobalPresenceChannel() {
  if (!realtimeReady || !supabaseClient || globalPresenceChannel) return;

  globalPresenceChannel = supabaseClient.channel("presence:workday:global", {
    config: {
      presence: { key: loggedUser }
    }
  });

  globalPresenceChannel
    .on("presence", { event: "sync" }, () => {
      renderOnlineUsersFromPresence();
    })
    .on("presence", { event: "join" }, () => {
      renderOnlineUsersFromPresence();
    })
    .on("presence", { event: "leave" }, () => {
      renderOnlineUsersFromPresence();
    });

  await new Promise((resolve) => {
    globalPresenceChannel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        try {
          await globalPresenceChannel.track({
            name: loggedUser,
            online_at: new Date().toISOString()
          });
        } catch {}
        renderOnlineUsersFromPresence();
        resolve();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        renderOnlineUsersFromPresence();
        resolve();
      }
    });
  });
}

async function setupPublicRealtimeChannel() {
  if (!realtimeReady || !supabaseClient) return;

  if (publicRealtimeChannel) {
    try { await supabaseClient.removeChannel(publicRealtimeChannel); } catch {}
    publicRealtimeChannel = null;
  }

  publicRealtimeChannel = supabaseClient.channel("room:public", {
    config: {
      broadcast: { self: false }
    }
  });

  bindTypingBroadcast(publicRealtimeChannel, "public");

  publicRealtimeChannel.on(
    "postgres_changes",
    { event: "*", schema: "public", table: "messages" },
    async () => {
      if (chatMode === "public") {
        await loadPublicMessages({ forceScrollBottom: true });
      }
    }
  );

  await new Promise((resolve) => {
    publicRealtimeChannel.subscribe(() => resolve());
  });
}

async function setupDmRealtimeChannel(room) {
  if (!realtimeReady || !supabaseClient || !room) return;

  if (dmRealtimeChannel) {
    try { await supabaseClient.removeChannel(dmRealtimeChannel); } catch {}
    dmRealtimeChannel = null;
  }

  dmRealtimeChannel = supabaseClient.channel(`room:dm:${room}`, {
    config: {
      broadcast: { self: false }
    }
  });

  bindTypingBroadcast(dmRealtimeChannel, `dm:${room}`);

  dmRealtimeChannel.on(
    "postgres_changes",
    { event: "*", schema: "public", table: "private_messages" },
    async () => {
      if (chatMode === "dm" && currentRoom) {
        await loadDmMessages({ forceScrollBottom: true });
      }
    }
  );

  await new Promise((resolve) => {
    dmRealtimeChannel.subscribe(() => resolve());
  });
}

async function teardownDmRealtimeChannel() {
  if (!supabaseClient || !dmRealtimeChannel) return;
  try {
    await supabaseClient.removeChannel(dmRealtimeChannel);
  } catch {}
  dmRealtimeChannel = null;
}

async function setupRealtime() {
  const ok = await initRealtimeClient();
  if (!ok) return false;

  await setupGlobalPresenceChannel();
  await setupPublicRealtimeChannel();
  renderOnlineUsersFromPresence();
  return true;
}

function refreshOwnPresence() {
  if (!globalPresenceChannel) return;
  globalPresenceChannel.track({
    name: loggedUser,
    online_at: new Date().toISOString()
  }).catch(() => {});
}

/* =========================
   MODAIS
========================= */

let logoutBtn = null;
let logoutModal = null;
let cancelLogoutBtn = null;
let confirmLogoutBtn = null;

let clearAllModal = null;
let clearAllCancelBtn = null;
let clearAllConfirmBtn = null;
let clearAllPendingResolver = null;

function openLogoutModal() {
  if (!logoutModal) return false;
  logoutModal.classList.add("show");
  logoutModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  return true;
}

function closeLogoutModal() {
  if (!logoutModal) return;
  logoutModal.classList.remove("show");
  logoutModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function openClearAllModal() {
  if (!clearAllModal) return false;

  clearAllConfirmBtn.disabled = false;
  clearAllCancelBtn.disabled = false;
  clearAllConfirmBtn.textContent = "Limpar tudo";

  clearAllModal.classList.add("show");
  clearAllModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("clearall-open");
  return true;
}

function closeClearAllModal() {
  if (!clearAllModal) return;

  clearAllModal.classList.remove("show");
  clearAllModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("clearall-open");
}

function askClearAllConfirmation() {
  return new Promise((resolve) => {
    if (!clearAllModal || !clearAllCancelBtn || !clearAllConfirmBtn) {
      const confirmed = prompt(
        '⚠️ Isso vai apagar TODO o chat público, DMs, salas privadas e imagens.\n\nDigite CLEAR ALL para confirmar:'
      );
      resolve(confirmed === "CLEAR ALL");
      return;
    }

    clearAllPendingResolver = resolve;
    openClearAllModal();
  });
}

function resolveClearAllModal(value) {
  if (typeof clearAllPendingResolver === "function") {
    clearAllPendingResolver(value);
  }
  clearAllPendingResolver = null;
}

function setBadgeTitle(count) {
  const n = Math.max(0, parseInt(count || 0, 10) || 0);
  document.title = n > 0 ? `(${n}) ${BASE_TITLE}` : BASE_TITLE;
  sessionStorage.setItem(BADGE_KEY, String(n));
}

function getSeenAt() {
  const raw = sessionStorage.getItem(SEEN_KEY);
  const t = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
}

function setSeenAt(dateLike) {
  const d = dateLike ? new Date(dateLike) : new Date();
  if (!Number.isFinite(d.getTime())) return;
  sessionStorage.setItem(SEEN_KEY, d.toISOString());
}

function markAllSeen() {
  setBadgeTitle(0);
  setSeenAt(new Date());
}

function isDocActive() {
  return document.visibilityState === "visible" && document.hasFocus();
}

function restoreBadgeOnLoad() {
  const saved = parseInt(sessionStorage.getItem(BADGE_KEY) || "0", 10) || 0;
  setBadgeTitle(saved);
}

function bumpBadgeFromMessages(messages, mode) {
  if (isDocActive()) {
    const newest = getNewestCreatedAt(messages);
    if (newest) setSeenAt(newest);
    setBadgeTitle(0);
    return;
  }

  const seenAt = getSeenAt();
  const unseen = (Array.isArray(messages) ? messages : []).filter(m => {
    const createdAt = new Date(m?.created_at || m?.createdAt || 0).getTime();
    if (!Number.isFinite(createdAt) || createdAt <= seenAt) return false;

    const author = m?.name || m?.sender || "";
    if (author === loggedUser) return false;

    if (mode === "public") {
      if (!canUserSeeMessage(m)) return false;
    }

    return true;
  }).length;

  const current = parseInt(sessionStorage.getItem(BADGE_KEY) || "0", 10) || 0;
  setBadgeTitle(unseen > 0 ? unseen : current);
}

function getNewestCreatedAt(messages) {
  let max = 0;
  (Array.isArray(messages) ? messages : []).forEach(m => {
    const t = new Date(m?.created_at || m?.createdAt || 0).getTime();
    if (Number.isFinite(t) && t > max) max = t;
  });
  return max ? new Date(max).toISOString() : null;
}

function stripImagePlaceholder(text) {
  return String(text || "")
    .replace(IMAGE_READY_PLACEHOLDER, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function updateImageAttachmentUI() {
  const textarea = document.getElementById("content");
  const cancelImageBtn = document.getElementById("cancelImageBtn");
  if (!textarea || !cancelImageBtn) return;

  if (pendingImageUrl) {
    const cleanValue = stripImagePlaceholder(textarea.value);
    textarea.value = cleanValue
      ? `${cleanValue}\n${IMAGE_READY_PLACEHOLDER}`
      : IMAGE_READY_PLACEHOLDER;
    cancelImageBtn.style.display = "inline-flex";
  } else {
    textarea.value = stripImagePlaceholder(textarea.value);
    cancelImageBtn.style.display = "none";
  }
}

function cancelPendingImage(showMessage = true) {
  pendingImageUrl = null;
  updateImageAttachmentUI();
  if (showMessage) {
    showOverlay("Imagem removida.", "info");
  }
}

async function runAdminClearAll() {
  if (!currentUserIsAdmin) {
    showOverlay("Apenas admins podem usar /clear all", "error");
    return false;
  }

  const confirmed = await askClearAllConfirmation();
  if (!confirmed) {
    showOverlay("Clear cancelado.", "info");
    return false;
  }

  if (clearAllConfirmBtn && clearAllCancelBtn) {
    clearAllConfirmBtn.disabled = true;
    clearAllCancelBtn.disabled = true;
    clearAllConfirmBtn.textContent = "Limpando...";
  }

  const res = await apiFetch("admin/clear", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      username: loggedUser,
      scope: "all"
    })
  });

  const data = await safeReadJson(res);

  if (!res.ok || !data?.success) {
    closeClearAllModal();
    throw new Error(data?.message || "Falha ao executar /clear all");
  }

  replyState = null;
  pendingImageUrl = null;
  clearReplySelection();

  if (chatMode === "dm") {
    await teardownDmRealtimeChannel();
  }

  publicRenderVersion++;
  dmRenderVersion++;

  chatMode = "public";
  currentRoom = null;
  currentOther = null;
  setHeader();
  clearTypingUI();

  document.getElementById("messages").innerHTML = "";
  document.getElementById("content").value = "";
  updateImageAttachmentUI();

  await loadMessages({ forceScrollBottom: true });

  closeClearAllModal();
  showOverlay("❗ Chat completamente limpo. Mensagens, imagens e salas privadas foram removidas.", "success");
  return true;
}

window.addEventListener("focus", () => {
  markAllSeen();
  refreshOwnPresence();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    markAllSeen();
    refreshOwnPresence();
  }
});

window.addEventListener("beforeunload", () => {
  if (globalPresenceChannel) {
    globalPresenceChannel.untrack().catch(() => {});
  }
});

const userColors = ["#58a6ff","#2ea043","#f0883e","#a371f7","#ff7b72","#1f6feb","#3fb950","#d29922","#bc8cff","#ffa657"];

function getColorFromName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return userColors[Math.abs(hash) % userColors.length];
}

function escapeHTML(str) {
  return String(str || "").replace(/[&<>"']/g, match => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
  }[match]));
}

function svgToDataUrl(svg) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function getDefaultAvatar(name) {
  const initial = String(name || "?").trim().charAt(0).toUpperCase() || "?";
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
      <rect width="120" height="120" rx="60" fill="#10151c"/>
      <circle cx="60" cy="60" r="59" fill="none" stroke="rgba(255,255,255,0.12)"/>
      <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle"
            font-family="Segoe UI, Arial, sans-serif" font-size="44" font-weight="700" fill="#e6edf3">${initial}</text>
    </svg>
  `;
  return svgToDataUrl(svg);
}

function getMessageAvatarSrc(msg) {
  const displayName =
    msg?.display_name ||
    msg?.name ||
    msg?.sender ||
    "Usuário";

  return msg?.avatar_url || getDefaultAvatar(displayName);
}

function getAdminBadgeHTML(isAdmin) {
  return isAdmin ? `<span class="admin-badge">dev</span>` : "";
}

function getNameWithBadgeHTML(name, isAdmin, color = "#ffffff") {
  return `
    <span class="name-with-badge">
      ${getAdminBadgeHTML(isAdmin)}
      <span style="color:${color}; font-weight:600;">${escapeHTML(name || "")}</span>
    </span>
  `;
}

async function loadRegisteredUsers() {
  try {
    const res = await apiFetch("users/list");
    const data = await res.json();

    if (res.ok && data?.success && Array.isArray(data.users)) {
      const cleanedUsers = data.users
        .map(user => String(user?.username || "").trim())
        .filter(Boolean);

      registeredUsersList = cleanedUsers;
      registeredUsersMap = new Map(
        cleanedUsers.map(username => [username.toLowerCase(), username])
      );
      registeredUsers = new Set(registeredUsersMap.keys());
    } else {
      registeredUsers = new Set();
      registeredUsersList = [];
      registeredUsersMap = new Map();
    }
  } catch (err) {
    console.error("Erro carregando usuários cadastrados:", err);
    registeredUsers = new Set();
    registeredUsersList = [];
    registeredUsersMap = new Map();
  }
}

function getMentionDropdown() {
  return document.getElementById("mentionAutocomplete");
}

function hideMentionAutocomplete() {
  const dropdown = getMentionDropdown();
  mentionSuggestions = [];
  mentionActiveIndex = -1;
  mentionQueryState = null;
  if (dropdown) {
    dropdown.innerHTML = "";
    dropdown.style.display = "none";
  }
}

function getMentionQueryAtCursor(text, cursorPos) {
  const beforeCursor = String(text || "").slice(0, Math.max(0, cursorPos));
  const match = beforeCursor.match(/(^|\s)@([A-Za-z0-9_]*)$/);
  if (!match) return null;

  return {
    query: String(match[2] || ""),
    start: beforeCursor.length - match[2].length - 1,
    end: beforeCursor.length,
  };
}

function renderMentionAutocomplete() {
  const dropdown = getMentionDropdown();
  if (!dropdown) return;

  if (!mentionSuggestions.length || !mentionQueryState) {
    hideMentionAutocomplete();
    return;
  }

  dropdown.innerHTML = mentionSuggestions.map((username, index) => {
    const safeName = escapeHTML(username);
    const selectedClass = index === mentionActiveIndex ? " active" : "";
    return `
      <button type="button" class="mention-item${selectedClass}" data-mention-username="${safeName}" data-mention-index="${index}">
        <span class="mention-item-at">@</span>
        <span class="mention-item-name">${safeName}</span>
      </button>
    `;
  }).join("");

  dropdown.style.display = "flex";
}

function applyMentionSuggestion(username) {
  const contentInput = document.getElementById("content");
  if (!contentInput || !mentionQueryState || !username) return;

  const original = contentInput.value;
  const before = original.slice(0, mentionQueryState.start);
  const after = original.slice(mentionQueryState.end);
  const insertion = `@${username} `;

  contentInput.value = `${before}${insertion}${after}`;

  const nextCursor = before.length + insertion.length;
  contentInput.focus();
  contentInput.setSelectionRange(nextCursor, nextCursor);

  hideMentionAutocomplete();
  onUserTyping();
}

function moveMentionSelection(direction) {
  if (!mentionSuggestions.length) return;

  if (mentionActiveIndex < 0) {
    mentionActiveIndex = direction > 0 ? 0 : mentionSuggestions.length - 1;
  } else {
    mentionActiveIndex = (mentionActiveIndex + direction + mentionSuggestions.length) % mentionSuggestions.length;
  }

  renderMentionAutocomplete();
}

function updateMentionAutocomplete() {
  const contentInput = document.getElementById("content");
  const dropdown = getMentionDropdown();
  if (!contentInput || !dropdown) return;

  const queryState = getMentionQueryAtCursor(contentInput.value, contentInput.selectionStart || 0);
  if (!queryState) {
    hideMentionAutocomplete();
    return;
  }

  const normalizedQuery = queryState.query.toLowerCase();
  const suggestions = registeredUsersList
    .filter(username => username.toLowerCase().startsWith(normalizedQuery))
    .slice(0, 8);

  if (!suggestions.length) {
    hideMentionAutocomplete();
    return;
  }

  mentionQueryState = queryState;
  mentionSuggestions = suggestions;

  if (mentionActiveIndex < 0 || mentionActiveIndex >= suggestions.length) {
    mentionActiveIndex = 0;
  }

  renderMentionAutocomplete();
}

function showWelcomeScreen(profile) {
  const screen = document.getElementById("welcome-screen");
  const avatar = document.getElementById("welcome-avatar");
  const title = document.getElementById("welcome-title");
  const subtitle = document.getElementById("welcome-subtitle");

  const finalName = profile?.display_name || profile?.username || loggedUser || "usuário";
  const finalAvatar = profile?.avatar_url || getDefaultAvatar(finalName);

  avatar.src = finalAvatar;
  title.textContent = `Olá, ${finalName}`;
  subtitle.textContent = `Bem-vindo de volta!`;

  setTimeout(() => {
    screen.classList.add("hidden");
  }, 1800);
}

function highlightMentions(text) {
  const escaped = escapeHTML(text);
  return escaped.replace(/@(\w+)/g, (match, username) => {
    const normalizedUsername = String(username || "").toLowerCase();
    const normalizedLoggedUser = String(loggedUser || "").toLowerCase();

    if (!registeredUsers.has(normalizedUsername)) return match;
    if (normalizedUsername === normalizedLoggedUser) return `<span class="mention-self">@${username}</span>`;
    return `<span class="mention">@${username}</span>`;
  });
}

function canUserSeeMessage(msg) {
  if (!msg.to) return true;
  return msg.to === loggedUser || msg.name === loggedUser;
}

function showOverlay(msg, type = "info") {
  const overlay = document.createElement("div");
  overlay.className = `overlay ${type}`;
  overlay.textContent = msg;
  document.body.appendChild(overlay);

  setTimeout(() => {
    overlay.style.opacity = "0";
    setTimeout(() => overlay.remove(), 400);
  }, 2200);
}

function setHeader() {
  const el = document.getElementById("headerTitle");
  if (chatMode === "dm" && currentRoom) {
    el.textContent = `🔐 Sala privada: ${currentRoom} (com @${currentOther}) — use /sair para voltar ao público`;
  } else {
    el.textContent = "";
  }
}

function toggleEmojis() {
  const panel = document.getElementById("emojiPanel");
  panel.style.display = panel.style.display === "flex" ? "none" : "flex";
}

const emojis = ["😀","😁","😂","🤣","😃","😄","😅","😆","😉","😊","😍","🥰","😘","😎","🤔","😢","😭","😡","🔥","👍","👎","👏","🙌","💪","🎉","❤️","💔","💯","✔️","⚡"];

function loadEmojis() {
  const panel = document.getElementById("emojiPanel");
  panel.innerHTML = "";
  emojis.forEach(emoji => {
    const span = document.createElement("span");
    span.textContent = emoji;
    span.onclick = () => {
      const textarea = document.getElementById("content");
      const currentText = stripImagePlaceholder(textarea.value);
      textarea.value = currentText + emoji;
      updateImageAttachmentUI();
      textarea.focus();
      onUserTyping();
    };
    panel.appendChild(span);
  });
}
loadEmojis();

function applyProfileToUI(profile) {
  const finalProfile = {
    username: profile?.username || loggedUser,
    display_name: profile?.display_name || loggedUser,
    avatar_url: profile?.avatar_url || null
  };

  currentProfile = finalProfile;

  const avatar = finalProfile.avatar_url || getDefaultAvatar(finalProfile.display_name);
  const isAdmin = currentUserIsAdmin;

  document.getElementById("user-display-name").innerHTML = `
    <span class="profile-name-inline">
      ${getAdminBadgeHTML(isAdmin)}
      <span>${escapeHTML(finalProfile.display_name)}</span>
    </span>
  `;

  document.getElementById("user-phone").textContent = `@${finalProfile.username}`;

  document.getElementById("dropdown-display-name").innerHTML = `
    <span class="profile-name-inline">
      ${getAdminBadgeHTML(isAdmin)}
      <span>${escapeHTML(finalProfile.display_name)}</span>
    </span>
  `;

  document.getElementById("dropdown-username").textContent = `@${finalProfile.username}`;

  document.getElementById("mini-profile-avatar").src = avatar;
  document.getElementById("dropdown-avatar").src = avatar;
}

async function loadProfile() {
  try {
    const res = await apiFetch("profile", {}, {
      username: loggedUser
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      const fallbackProfile = {
        username: loggedUser,
        display_name: loggedUser,
        avatar_url: null
      };
      applyProfileToUI(fallbackProfile);
      showWelcomeScreen(fallbackProfile);
      return;
    }

    applyProfileToUI(data.profile);
    showWelcomeScreen(data.profile);
  } catch {
    const fallbackProfile = {
      username: loggedUser,
      display_name: loggedUser,
      avatar_url: null
    };
    applyProfileToUI(fallbackProfile);
    showWelcomeScreen(fallbackProfile);
  }
}

async function saveProfile(profilePatch) {
  const payload = {
    username: loggedUser,
    display_name: profilePatch?.display_name || currentProfile.display_name || loggedUser,
    avatar_url: typeof profilePatch?.avatar_url === "undefined"
      ? currentProfile.avatar_url
      : profilePatch.avatar_url
  };

  const res = await apiFetch("profile", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();

  if (!res.ok || !data.success) {
    throw new Error(data.message || "Erro ao salvar perfil");
  }

  applyProfileToUI(data.profile);
}

async function uploadProfileAvatar(file) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("username", loggedUser);

  const res = await apiFetch("profile-upload", {
    method: "POST",
    body: formData
  });

  const contentType = res.headers.get("content-type") || "";
  let data = null;

  if (contentType.includes("application/json")) {
    data = await res.json();
  } else {
    const text = await res.text();
    throw new Error(text.includes("NOT_FOUND")
      ? "A rota de upload de avatar não foi encontrada no Vercel."
      : "Resposta inválida do servidor no upload do avatar.");
  }

  if (!res.ok || !data.success) {
    throw new Error(data.message || "Erro ao enviar avatar");
  }

  return data.url;
}

function renderReplyBar() {
  const bar = document.getElementById("replyBar");
  const txt = document.getElementById("replyBarText");

  if (!replyState || !replyState.preview) {
    bar.style.display = "none";
    txt.textContent = "";
    return;
  }

  const p = replyState.preview;
  const when = p.created_at ? new Date(p.created_at).toLocaleString("pt-BR") : "";
  txt.innerHTML = `<strong>Respondendo a @${escapeHTML(p.name || "")}</strong> — ${escapeHTML(p.snippet || "")}${when ? ` <span style="opacity:.75">(${when})</span>` : ""}`;
  bar.style.display = "flex";
}

function clearReplySelection() {
  replyState = null;
  renderReplyBar();
  lastRenderedElements.forEach(el => el.classList.remove("selected-reply"));
}

function setReplyFromMessage(msg, element) {
  if (!msg || !msg.id) return;

  const text = (msg.content || msg.message || "").trim();
  const hasImage = !!msg.image_url;
  const snippet = text
    ? (text.length > 80 ? text.slice(0, 80) + "…" : text)
    : (hasImage ? "🖼 Imagem" : "");

  const author = msg.name || msg.sender || "Desconhecido";
  const createdAt = msg.created_at || null;

  let whisperTo = null;
  if (msg.to !== null && msg.to !== undefined) {
    if (msg.to === loggedUser) whisperTo = msg.name || null;
    else whisperTo = msg.to || null;
  }

  replyState = {
    id: msg.id,
    preview: {
      id: msg.id,
      name: author,
      snippet,
      hasImage,
      created_at: createdAt,
    },
    whisper_to: whisperTo
  };

  lastRenderedElements.forEach(el => el.classList.remove("selected-reply"));
  if (element) element.classList.add("selected-reply");

  renderReplyBar();

  if (replyState.whisper_to) showOverlay(`Reply em sussurro para @${replyState.whisper_to}`, "info");
  else showOverlay(`Respondendo @${author}`, "info");

  const textarea = document.getElementById("content");
  textarea.focus();
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("cancelReplyBtn").addEventListener("click", () => {
    clearReplySelection();
    showOverlay("Reply cancelado.", "info");
  });

  const contentInput = document.getElementById("content");
  const cancelImageBtn = document.getElementById("cancelImageBtn");
  if (!contentInput) return;

  if (cancelImageBtn) {
    cancelImageBtn.addEventListener("click", () => {
      cancelPendingImage(true);
      contentInput.focus();
      onUserTyping();
    });
  }

  contentInput.addEventListener("paste", async (event) => {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (let item of items) {
      if (item.type && item.type.includes("image")) {
        const file = item.getAsFile();
        if (file) {
          event.preventDefault();
          await uploadImage(file);
        }
      }
    }
  });

  contentInput.addEventListener("beforeinput", (event) => {
    if (!pendingImageUrl) return;

    const inputType = event.inputType || "";
    const blockedTypes = [
      "deleteContentBackward",
      "deleteContentForward",
      "deleteByCut",
      "deleteByDrag"
    ];

    if (blockedTypes.includes(inputType)) {
      event.preventDefault();
      return;
    }

    if (inputType.startsWith("insert") && typeof event.data === "string" && event.data) {
      const currentText = stripImagePlaceholder(contentInput.value);
      contentInput.value = currentText + event.data;
      updateImageAttachmentUI();
      event.preventDefault();
      onUserTyping();
    }
  });

  contentInput.addEventListener("input", () => {
    if (!pendingImageUrl) return;
    updateImageAttachmentUI();
  });
});

async function uploadImage(file) {
  const fileName = `${Date.now()}-${file.name}`;
  const formData = new FormData();
  formData.append("file", file);
  formData.append("fileName", fileName);

  try {
    const res = await apiFetch("upload", {
      method: "POST",
      body: formData
    });
    const data = await res.json();

    if (data.url) {
      pendingImageUrl = data.url;
      updateImageAttachmentUI();
      const textarea = document.getElementById("content");
      textarea.focus();
      showOverlay("Imagem anexada com sucesso ✅", "success");
      onUserTyping();
    } else {
      showOverlay("Falha no upload da imagem ❌", "error");
    }
  } catch {
    showOverlay("Falha no upload da imagem ❌", "error");
  }
}

function parseWhisper(text) {
  if (text.startsWith("/s ")) {
    const match = text.match(/^\/s\s+@(\w+)\s+(.+)$/);
    if (match) return { to: match[1], content: match[2] };
  }
  return { to: null, content: text };
}

function normalizeRoomName(roomRaw) {
  let room = (roomRaw || "").trim();
  room = room.replace(/\s+/g, "-");
  room = room.replace(/[^A-Za-z0-9_-]/g, "");
  room = room.slice(0, 32);
  return room;
}

function parseCreateRoom(text) {
  const match = text.match(/^\/c\s+@(\w+)\s+(.+)$/);
  if (!match) return null;

  const target = match[1];
  const roomRaw = match[2];
  const room = normalizeRoomName(roomRaw);

  if (!room || room.length < 3) return { target, room: null, roomRaw };
  return { target, room, roomRaw };
}

function parseEnterRoom(text) {
  const match = text.match(/^\/entrar\s+(.+)$/);
  if (!match) return null;

  const roomRaw = match[1];
  const room = normalizeRoomName(roomRaw);

  if (!room || room.length < 3) return { room: null, roomRaw };
  return { room, roomRaw };
}

function isLeaveCommand(text) {
  return /^\/sair\s*$/.test(text);
}

function isClearAllCommand(text) {
  return /^\/clear\s+all\s*$/i.test(String(text || "").trim());
}

async function sendTyping(isTyping) {
  if (!loggedUser) return;

  const now = Date.now();
  if (isTyping && now - lastTypingSentAt < 800) return;
  lastTypingSentAt = now;

  const channel = getActiveTypingChannel();
  const roomKey = getActiveTypingRoomKey();

  if (!channel || !realtimeReady) return;

  try {
    await channel.send({
      type: "broadcast",
      event: "typing",
      payload: {
        name: loggedUser,
        room: roomKey,
        typing: !!isTyping,
        at: now
      }
    });
  } catch {}
}

function onUserTyping() {
  const input = document.getElementById("content");
  const hasText = input && stripImagePlaceholder(input.value).trim().length > 0;
  const hasPendingOnlyImage = !!pendingImageUrl;
  const isFocused = document.activeElement === input;

  clearTimeout(typingDebounceTimer);
  clearTimeout(typingStopTimer);

  if ((hasText || hasPendingOnlyImage) && isFocused) {
    typingDebounceTimer = setTimeout(() => sendTyping(true), 120);
    typingStopTimer = setTimeout(() => {
      sendTyping(false);
    }, 1400);
    return;
  }

  sendTyping(false);
}

async function loadTypingStatus() {
  setTypingUIFromMap();
}

function buildReplyPreviewHTML(preview) {
  if (!preview || typeof preview !== "object") return "";
  const name = preview.name || "";
  const snippet = preview.snippet || "";
  return `
    <div class="reply-preview">
      <div class="rp-top">↩️ Respondendo a @${escapeHTML(name)}</div>
      <div class="rp-snippet">${highlightMentions(snippet)}</div>
    </div>
  `;
}

async function loadPublicMessages(options = {}) {
  const { forceScrollBottom = false } = options;
  const renderVersion = ++publicRenderVersion;

  try {
    const res = await apiFetch("messages");
    const data = await res.json();

    if (chatMode !== "public" || renderVersion !== publicRenderVersion) return;

    const visibleMessages = Array.isArray(data) ? data.filter(msg => canUserSeeMessage(msg)) : [];

    bumpBadgeFromMessages(visibleMessages, "public");

    if (visibleMessages.length) {
      const lastVisible = visibleMessages[visibleMessages.length - 1];

      if (lastMessageId && lastVisible.id !== lastMessageId) {
        const mentioned = lastVisible.content?.includes("@" + loggedUser);
        if (lastVisible.name !== loggedUser || mentioned) {
          document.getElementById("messageSound").play().catch(() => {});
        }
      }
      lastMessageId = lastVisible.id;
    }

    const box = document.getElementById("messages");
    const previousScrollTop = box.scrollTop;
    const previousScrollHeight = box.scrollHeight;
    const distanceFromBottom = previousScrollHeight - previousScrollTop - box.clientHeight;
    const shouldAutoScroll = forceScrollBottom || distanceFromBottom < 80;

    if (chatMode !== "public" || renderVersion !== publicRenderVersion) return;

    box.innerHTML = "";
    lastRenderedElements = [];

    visibleMessages.forEach(msg => {
      const isWhisper = msg.to !== null && msg.to !== undefined;

      const div = document.createElement("div");
      div.className = "message" + (isWhisper ? " whisper" : "");

      const date = new Date(msg.created_at).toLocaleString("pt-BR");
      const color = getColorFromName(msg.name);
      const avatarSrc = getMessageAvatarSrc(msg);
      const avatarAlt = escapeHTML(msg.display_name || msg.name || "Usuário");

      const contentHTML = msg.image_url
        ? `<a href="${escapeHTML(msg.image_url)}" target="_blank" style="color:#58a6ff">🖼 Imagem</a>${msg.content && msg.content !== "🖼 Imagem" ? `<div style="margin-top:6px;">${highlightMentions(msg.content)}</div>` : ""}`
        : highlightMentions(msg.content);

      const replyHTML = buildReplyPreviewHTML(msg.reply_preview);

      div.innerHTML = `
        <div class="message-row">
          <img class="message-avatar" src="${avatarSrc}" alt="${avatarAlt}">
          <div class="message-main">
            <div class="message-header">
              <div class="message-user-block">
                <span class="username">${getNameWithBadgeHTML(msg.name, msg.is_admin, color)}</span>
              </div>
              <span class="timestamp">${date}</span>
            </div>
            ${replyHTML}
            <div>${isWhisper ? `<strong>Sussurro:</strong> ${contentHTML}` : contentHTML}</div>
          </div>
        </div>
      `;

      div.addEventListener("click", () => setReplyFromMessage(msg, div));

      box.appendChild(div);
      lastRenderedElements.push(div);
    });

    if (shouldAutoScroll) {
      box.scrollTop = box.scrollHeight;
    } else {
      const heightDiff = box.scrollHeight - previousScrollHeight;
      box.scrollTop = previousScrollTop + heightDiff;
    }

    if (isDocActive() && (distanceFromBottom < 80 || forceScrollBottom)) {
      const newest = getNewestCreatedAt(visibleMessages);
      if (newest) setSeenAt(newest);
      setBadgeTitle(0);
    }
  } catch (e) {
    console.error("Erro ao carregar mensagens:", e);
  }
}

async function loadDmMessages(options = {}) {
  const { forceScrollBottom = false } = options;
  if (!currentRoom) return;

  const roomSnapshot = currentRoom;
  const renderVersion = ++dmRenderVersion;

  try {
    const res = await apiFetch("dm/messages", {}, {
      room: roomSnapshot,
      name: loggedUser
    });
    const data = await res.json();

    if (chatMode !== "dm" || currentRoom !== roomSnapshot || renderVersion !== dmRenderVersion) return;

    const msgs = Array.isArray(data) ? data : [];

    bumpBadgeFromMessages(msgs, "dm");

    const box = document.getElementById("messages");
    const previousScrollTop = box.scrollTop;
    const previousScrollHeight = box.scrollHeight;
    const distanceFromBottom = previousScrollHeight - previousScrollTop - box.clientHeight;
    const shouldAutoScroll = forceScrollBottom || distanceFromBottom < 80;

    if (chatMode !== "dm" || currentRoom !== roomSnapshot || renderVersion !== dmRenderVersion) return;

    box.innerHTML = "";
    lastRenderedElements = [];

    msgs.forEach(m => {
      const div = document.createElement("div");
      div.className = "message dm";

      const date = new Date(m.created_at).toLocaleString("pt-BR");
      const color = getColorFromName(m.sender);
      const avatarSrc = getMessageAvatarSrc(m);
      const avatarAlt = escapeHTML(m.display_name || m.sender || "Usuário");

      const dmContentHTML = m.image_url
        ? `<a href="${escapeHTML(m.image_url)}" target="_blank" style="color:#58a6ff">🖼 Imagem</a>${
            m.message && m.message !== "🖼 Imagem"
              ? `<div style="margin-top:6px;">${highlightMentions(m.message)}</div>`
              : ""
          }`
        : highlightMentions(m.message || "");

      const replyHTML = buildReplyPreviewHTML(m.reply_preview);

      div.innerHTML = `
        <div class="message-row">
          <img class="message-avatar" src="${avatarSrc}" alt="${avatarAlt}">
          <div class="message-main">
            <div class="message-header">
              <div class="message-user-block">
                <span class="username">${getNameWithBadgeHTML(m.sender, m.is_admin, color)}</span>
              </div>
              <span class="timestamp">${date}</span>
            </div>
            ${replyHTML}
            <div>${dmContentHTML}</div>
          </div>
        </div>
      `;

      div.addEventListener("click", () => setReplyFromMessage(m, div));

      box.appendChild(div);
      lastRenderedElements.push(div);
    });

    if (shouldAutoScroll) {
      box.scrollTop = box.scrollHeight;
    } else {
      const heightDiff = box.scrollHeight - previousScrollHeight;
      box.scrollTop = previousScrollTop + heightDiff;
    }

    if (isDocActive() && (distanceFromBottom < 80 || forceScrollBottom)) {
      const newest = getNewestCreatedAt(msgs);
      if (newest) setSeenAt(newest);
      setBadgeTitle(0);
    }
  } catch (e) {
    console.error("Erro ao carregar DM:", e);
  }
}

async function loadMessages(options = {}) {
  if (chatMode === "dm") return loadDmMessages(options);
  return loadPublicMessages(options);
}

async function createRoom(target, room) {
  if (target === loggedUser) {
    showOverlay("Você precisa marcar OUTRO usuário para criar uma sala. Ex: /c @fulano sala123", "error");
    return;
  }

  try {
    const res = await apiFetch("dm/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creator: loggedUser,
        target,
        room,
        name: loggedUser,
        user1: loggedUser,
        user2: target,
        to: target
      })
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data) {
      showOverlay("Erro ao criar/abrir sala ❌", "error");
      return;
    }

    if (!data.success) {
      showOverlay(data.error || "Erro ao criar/abrir sala ❌", "error");
      return;
    }

    if (data.message) showOverlay(data.message, data.reused ? "info" : "success");

    const roomToEnter = data.room || room;
    await enterRoom(roomToEnter);
  } catch (e) {
    console.error("Erro ao criar sala:", e);
    showOverlay("Erro ao criar/abrir sala ❌", "error");
  }
}

async function enterRoom(room) {
  try {
    publicRenderVersion++;
    dmRenderVersion++;

    const res = await apiFetch("dm/enter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: loggedUser, room })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      showOverlay(`Erro ao entrar em "${room}" ❌`, "error");
      return;
    }

    chatMode = "dm";
    currentRoom = data.channel.room;
    currentOther = data.channel.other;

    const messagesBox = document.getElementById("messages");
    if (messagesBox) messagesBox.innerHTML = "";

    lastMessageId = null;
    clearTypingUI();
    clearReplySelection();
    setHeader();

    await sendTyping(false);
    await loadDmMessages({ forceScrollBottom: true });
    await setupDmRealtimeChannel(currentRoom);

    setTypingUIFromMap();
    showOverlay(`Entrou na sala "${currentRoom}" ✅`, "success");

    if (isDocActive()) markAllSeen();
  } catch {
    showOverlay("Erro ao entrar na sala ❌", "error");
  }
}

async function leaveRoom() {
  if (!currentRoom) {
    showOverlay("Você não está em uma sala privada.", "info");
    return;
  }

  await sendTyping(false);

  try {
    await apiFetch("dm/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: loggedUser, room: currentRoom })
    });
  } catch {}

  const left = currentRoom;

  await teardownDmRealtimeChannel();

  publicRenderVersion++;
  dmRenderVersion++;

  chatMode = "public";
  currentRoom = null;
  currentOther = null;

  const messagesBox = document.getElementById("messages");
  if (messagesBox) messagesBox.innerHTML = "";

  lastMessageId = null;
  setHeader();
  clearTypingUI();
  clearReplySelection();

  await loadPublicMessages({ forceScrollBottom: true });
  setTypingUIFromMap();
  showOverlay(`Saiu da sala "${left}" ✅`, "success");

  if (isDocActive()) markAllSeen();
}

async function safeReadJson(res) {
  try { return await res.json(); } catch { return null; }
}

async function sendPublicMessage(text) {
  const contentInput = document.getElementById("content");

  let { to, content } = parseWhisper(text);

  content = stripImagePlaceholder(content);

  if (!to && replyState?.whisper_to) {
    to = replyState.whisper_to;
  }

  const res = await apiFetch("messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: loggedUser,
      content: content || "🖼 Imagem",
      image_url: pendingImageUrl,
      to,
      reply_to: replyState?.id ?? null,
      reply_preview: replyState?.preview ?? null,
    })
  });

  if (!res.ok) {
    const err = await safeReadJson(res);
    throw new Error(err?.message || err?.error || "Falha ao enviar mensagem");
  }

  contentInput.value = "";
  pendingImageUrl = null;
  updateImageAttachmentUI();
  clearReplySelection();

  if (to) showOverlay(`Sussurro enviado para @${to}`, "success");
}

async function sendDmMessage(text) {
  const contentInput = document.getElementById("content");
  text = stripImagePlaceholder(text);

  const basePayload = {
    room: currentRoom,
    sender: loggedUser,
    message: text || "🖼 Imagem",
    image_url: pendingImageUrl
  };

  const withReplyPayload = {
    ...basePayload,
    reply_to: replyState?.id ?? null,
    reply_preview: replyState?.preview ?? null,
  };

  let res = await apiFetch("dm/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withReplyPayload)
  });

  if (!res.ok) {
    const errData = await safeReadJson(res);
    const errMsg = errData?.message || errData?.error || "";

    if (replyState?.id || replyState?.preview) {
      res = await apiFetch("dm/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(basePayload)
      });

      if (!res.ok) {
        const err2 = await safeReadJson(res);
        showOverlay(`Falha ao enviar no privado ❌ ${err2?.message || err2?.error || ""}`, "error");
        return;
      }

      showOverlay(
        "Seu servidor não aceitou reply no privado. Enviei a mensagem sem reply. (Precisa adicionar colunas no DM pra suportar.)",
        "info"
      );
    } else {
      showOverlay(`Falha ao enviar no privado ❌ ${errMsg}`, "error");
      return;
    }
  }

  contentInput.value = "";
  pendingImageUrl = null;
  updateImageAttachmentUI();
  clearReplySelection();
}

async function sendMessage() {
  if (isSending) return;

  const contentInput = document.getElementById("content");
  const sendButton = document.querySelector(".send-btn");
  const text = contentInput.value.trim();

  const create = parseCreateRoom(text);
  const enter = parseEnterRoom(text);

  if (create) {
    contentInput.value = "";

    if (!create.room) {
      showOverlay('Nome da sala inválido. Use letras/números e pelo menos 3 caracteres.', "error");
      onUserTyping();
      return;
    }

    if (create.roomRaw && create.roomRaw.trim() !== create.room) {
      showOverlay(`Nome da sala ajustado para: "${create.room}"`, "info");
    }

    showOverlay(`Abrindo sala com @${create.target}...`, "info");
    await createRoom(create.target, create.room);
    onUserTyping();
    return;
  }

  if (enter) {
    contentInput.value = "";

    if (!enter.room) {
      showOverlay('Nome da sala inválido. Use letras/números e pelo menos 3 caracteres.', "error");
      onUserTyping();
      return;
    }

    if (enter.roomRaw && enter.roomRaw.trim() !== enter.room) {
      showOverlay(`Entrando em: "${enter.room}"`, "info");
    } else {
      showOverlay(`Entrando em "${enter.room}"...`, "info");
    }

    await enterRoom(enter.room);
    onUserTyping();
    return;
  }

  if (isLeaveCommand(text)) {
    contentInput.value = "";
    await leaveRoom();
    onUserTyping();
    return;
  }

  if (isClearAllCommand(text)) {
    contentInput.value = "";
    onUserTyping();

    try {
      await sendTyping(false);
      await runAdminClearAll();
    } catch (e) {
      console.error("Erro no /clear all:", e);
      showOverlay(e.message || "Falha ao executar /clear all", "error");
    }
    return;
  }

  if (!text && !pendingImageUrl) return;

  isSending = true;
  sendButton.disabled = true;
  sendButton.style.opacity = "0.6";
  sendButton.style.cursor = "not-allowed";

  try {
    await sendTyping(false);

    if (chatMode === "dm") await sendDmMessage(text);
    else await sendPublicMessage(text);
  } catch (e) {
    console.error("Erro ao enviar:", e);
    showOverlay("Falha ao enviar mensagem ❌", "error");
  } finally {
    isSending = false;
    sendButton.disabled = false;
    sendButton.style.opacity = "1";
    sendButton.style.cursor = "pointer";
    onUserTyping();
  }
}

async function updateOnlineStatus() {
  refreshOwnPresence();
}

async function loadOnlineUsers() {
  renderOnlineUsersFromPresence();
}

document.addEventListener("DOMContentLoaded", async () => {
  const miniProfile = document.getElementById("mini-profile");
  const dropdownMenu = document.getElementById("dropdown-menu");
  const arrow = document.getElementById("arrow");
  const contentInput = document.getElementById("content");
  const avatarInput = document.getElementById("profile-avatar-input");
  const adminPanelLink = document.getElementById("adminPanelLink");

  if (contentInput && !document.getElementById("mentionAutocomplete")) {
    const mentionDropdown = document.createElement("div");
    mentionDropdown.id = "mentionAutocomplete";
    mentionDropdown.className = "mention-autocomplete";
    contentInput.insertAdjacentElement("afterend", mentionDropdown);
  }

  restoreBadgeOnLoad();
  loadProfile();

  if (adminPanelLink) {
    if (currentUserIsAdmin) {
      adminPanelLink.style.display = "inline-flex";
      adminPanelLink.href = "admin.html";
    } else {
      adminPanelLink.style.display = "none";
    }
  }

  await loadRegisteredUsers();
  await setupRealtime();

  miniProfile.onclick = () => {
    const open = dropdownMenu.style.display === "block";
    dropdownMenu.style.display = open ? "none" : "block";
    arrow.style.transform = open ? "rotate(0deg)" : "rotate(180deg)";
  };

  document.addEventListener("click", (e) => {
    if (!miniProfile.contains(e.target) && !dropdownMenu.contains(e.target)) {
      dropdownMenu.style.display = "none";
      arrow.style.transform = "rotate(0deg)";
    }
  });

  avatarInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      showOverlay("Enviando foto de perfil...", "info");
      const url = await uploadProfileAvatar(file);
      await saveProfile({ avatar_url: url });
      applyProfileToUI({ ...currentProfile, avatar_url: url });
      showOverlay("Foto de perfil atualizada com sucesso.", "success");
    } catch (err) {
      showOverlay(err.message || "Erro ao atualizar foto.", "error");
    } finally {
      avatarInput.value = "";
    }
  });

  /* =========================
     LOGOUT MODAL
  ========================= */

  logoutBtn = document.getElementById("logout");
  logoutModal = document.getElementById("logout-modal");
  cancelLogoutBtn = document.getElementById("cancel-logout");
  confirmLogoutBtn = document.getElementById("confirm-logout");

  if (logoutBtn) {
    logoutBtn.onclick = () => {
      const opened = openLogoutModal();
      if (!opened) {
        const confirmed = confirm("Tem certeza que deseja sair da conta?");
        if (!confirmed) return;
        sessionStorage.clear();
        window.location.href = "index.html";
      }
    };
  }

  if (cancelLogoutBtn) {
    cancelLogoutBtn.onclick = () => {
      closeLogoutModal();
    };
  }

  if (logoutModal) {
    logoutModal.addEventListener("click", (e) => {
      if (e.target.classList.contains("confirm-modal-backdrop")) {
        closeLogoutModal();
      }
    });
  }

  if (confirmLogoutBtn) {
    confirmLogoutBtn.onclick = async () => {
      try { await sendTyping(false); } catch {}

      if (logoutBtn) logoutBtn.disabled = true;
      confirmLogoutBtn.disabled = true;

      if (logoutBtn) logoutBtn.innerHTML = "<span>Saindo...</span>";
      confirmLogoutBtn.textContent = "Saindo...";

      sessionStorage.clear();
      window.location.href = "index.html";
    };
  }

  /* =========================
     CLEAR ALL MODAL
  ========================= */

  clearAllModal = document.getElementById("clearall-modal");
  clearAllCancelBtn = document.getElementById("clearall-cancel");
  clearAllConfirmBtn = document.getElementById("clearall-confirm");

  if (clearAllCancelBtn) {
    clearAllCancelBtn.onclick = () => {
      closeClearAllModal();
      resolveClearAllModal(false);
    };
  }

  if (clearAllModal) {
    clearAllModal.addEventListener("click", (e) => {
      if (e.target.classList.contains("clearall-backdrop")) {
        closeClearAllModal();
        resolveClearAllModal(false);
      }
    });
  }

  if (clearAllConfirmBtn) {
    clearAllConfirmBtn.onclick = () => {
      resolveClearAllModal(true);
    };
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;

    if (logoutModal && logoutModal.classList.contains("show")) {
      closeLogoutModal();
      return;
    }

    if (clearAllModal && clearAllModal.classList.contains("show")) {
      closeClearAllModal();
      resolveClearAllModal(false);
    }
  });

  contentInput.addEventListener("keydown", e => {
    const mentionOpen = !!mentionSuggestions.length && !!mentionQueryState;

    if (mentionOpen && e.key === "ArrowDown") {
      e.preventDefault();
      moveMentionSelection(1);
      return;
    }

    if (mentionOpen && e.key === "ArrowUp") {
      e.preventDefault();
      moveMentionSelection(-1);
      return;
    }

    if (mentionOpen && (e.key === "Enter" || e.key === "Tab") && mentionActiveIndex >= 0) {
      e.preventDefault();
      applyMentionSuggestion(mentionSuggestions[mentionActiveIndex]);
      return;
    }

    if (mentionOpen && e.key === "Escape") {
      e.preventDefault();
      hideMentionAutocomplete();
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  contentInput.addEventListener("input", () => {
    onUserTyping();
    updateMentionAutocomplete();
  });
  contentInput.addEventListener("click", () => updateMentionAutocomplete());
  contentInput.addEventListener("keyup", () => updateMentionAutocomplete());
  contentInput.addEventListener("focus", () => {
    onUserTyping();
    updateMentionAutocomplete();
    markAllSeen();
    refreshOwnPresence();
  });
  contentInput.addEventListener("blur", () => {
    setTimeout(() => hideMentionAutocomplete(), 120);
    sendTyping(false);
  });

  document.addEventListener("mousedown", (e) => {
    const dropdown = getMentionDropdown();
    if (!dropdown) return;

    const mentionButton = e.target.closest("[data-mention-username]");
    if (mentionButton) {
      e.preventDefault();
      applyMentionSuggestion(mentionButton.getAttribute("data-mention-username") || "");
      return;
    }

    if (e.target !== contentInput && !dropdown.contains(e.target)) {
      hideMentionAutocomplete();
    }
  });

  setHeader();
  renderReplyBar();
  updateImageAttachmentUI();
  setTypingUIFromMap();

  await loadMessages();
  await loadOnlineUsers();
  await loadTypingStatus();
});

window.toggleEmojis = toggleEmojis;
window.sendMessage = sendMessage;
