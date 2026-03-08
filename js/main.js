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

  chatMode = "public";
  currentRoom = null;
  currentOther = null;
  setHeader();
  clearTypingUI();

  document.getElementById("messages").innerHTML = "";
  document.getElementById("content").value = "";

  await loadMessages({ forceScrollBottom: true });

  closeClearAllModal();
  showOverlay("❗ Chat completamente limpo. Mensagens, imagens e salas privadas foram removidas.", "success");
  return true;
}

window.addEventListener("focus", markAllSeen);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") markAllSeen();
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

function getAdminBadgeHTML(isAdmin) {
  return isAdmin ? `<span class="admin-badge">ADMIN</span>` : "";
}

function getNameWithBadgeHTML(name, isAdmin, color = "#ffffff") {
  return `
    <span class="name-with-badge">
      ${getAdminBadgeHTML(isAdmin)}
      <span style="color:${color}; font-weight:600;">${escapeHTML(name || "")}</span>
    </span>
  `;
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
    if (username === loggedUser) return `<span class="mention-self">@${username}</span>`;
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
      textarea.value += emoji;
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
  if (!contentInput) return;

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
      const textarea = document.getElementById("content");
      const cleanValue = stripImagePlaceholder(textarea.value);
      textarea.value = cleanValue
        ? `${cleanValue}\n${IMAGE_READY_PLACEHOLDER}`
        : IMAGE_READY_PLACEHOLDER;
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

  const room = (chatMode === "dm" && currentRoom) ? currentRoom : null;

  try {
    await apiFetch("online", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: loggedUser,
        typing: !!isTyping,
        room,
        typing_room: room
      })
    });
  } catch {}
}

function onUserTyping() {
  const input = document.getElementById("content");
  const hasText = input && input.value.trim().length > 0;
  const isFocused = document.activeElement === input;

  if (hasText && isFocused) {
    clearTimeout(typingDebounceTimer);
    typingDebounceTimer = setTimeout(() => sendTyping(true), 120);
    return;
  }
  sendTyping(false);
}

function clearTypingUI() {
  const el = document.getElementById("typingStatus");
  if (el) el.textContent = "";
}

function setTypingUI(names) {
  const el = document.getElementById("typingStatus");
  if (!el) return;

  if (!names || !names.length) { el.textContent = ""; return; }
  if (names.length === 1) { el.textContent = `${names[0]} está digitando...`; return; }
  if (names.length === 2) { el.textContent = `${names[0]} e ${names[1]} estão digitando...`; return; }
  el.textContent = `${names.slice(0, 3).join(", ")} estão digitando...`;
}

async function loadTypingStatus() {
  try {
    const res = await apiFetch("online");
    const data = await res.json();
    const users = Array.isArray(data) ? data : [];
    const now = Date.now();

    const typingUsers = users.filter(u => {
      if (!u || !u.name) return false;
      if (u.name === loggedUser) return false;

      const isTyping =
        u.typing === true ||
        u.typing === 1 ||
        u.typing === "1" ||
        String(u.typing).toLowerCase() === "true";

      if (!isTyping) return false;

      const lastTypingRaw =
        u.last_typing ?? u.lastTyping ?? u.updated_at ?? u.updatedAt ?? u.last_seen ?? u.last_seen_at;

      if (!lastTypingRaw) return false;

      const last = new Date(lastTypingRaw).getTime();
      if (!Number.isFinite(last)) return false;

      if (now - last > 7000) return false;

      const tRoom = u.typing_room ?? u.room ?? null;

      if (chatMode === "dm" && currentRoom) return tRoom === currentRoom;
      return !tRoom;
    });

    setTypingUI(typingUsers.map(u => u.name));
  } catch {
    clearTypingUI();
  }
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

  try {
    const res = await apiFetch("messages");
    const data = await res.json();

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

    box.innerHTML = "";
    lastRenderedElements = [];

    visibleMessages.forEach(msg => {
      const isWhisper = msg.to !== null && msg.to !== undefined;

      const div = document.createElement("div");
      div.className = "message" + (isWhisper ? " whisper" : "");

      const date = new Date(msg.created_at).toLocaleString("pt-BR");
      const color = getColorFromName(msg.name);

      const contentHTML = msg.image_url
        ? `<a href="${escapeHTML(msg.image_url)}" target="_blank" style="color:#58a6ff">🖼 Imagem</a>${msg.content && msg.content !== "🖼 Imagem" ? `<div style="margin-top:6px;">${highlightMentions(msg.content)}</div>` : ""}`
        : highlightMentions(msg.content);

      const replyHTML = buildReplyPreviewHTML(msg.reply_preview);

      div.innerHTML = `
        <div class="message-header">
          <span class="username">${getNameWithBadgeHTML(msg.name, msg.is_admin, color)}</span>
          <span class="timestamp">${date}</span>
        </div>
        ${replyHTML}
        <div>${isWhisper ? `<strong>Sussurro:</strong> ${contentHTML}` : contentHTML}</div>
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

  try {
    const res = await apiFetch("dm/messages", {}, {
      room: currentRoom,
      name: loggedUser
    });
    const data = await res.json();
    const msgs = Array.isArray(data) ? data : [];

    bumpBadgeFromMessages(msgs, "dm");

    const box = document.getElementById("messages");
    const previousScrollTop = box.scrollTop;
    const previousScrollHeight = box.scrollHeight;
    const distanceFromBottom = previousScrollHeight - previousScrollTop - box.clientHeight;
    const shouldAutoScroll = forceScrollBottom || distanceFromBottom < 80;

    box.innerHTML = "";
    lastRenderedElements = [];

    msgs.forEach(m => {
      const div = document.createElement("div");
      div.className = "message dm";

      const date = new Date(m.created_at).toLocaleString("pt-BR");
      const color = getColorFromName(m.sender);

      const dmContentHTML = m.image_url
        ? `<a href="${escapeHTML(m.image_url)}" target="_blank" style="color:#58a6ff">🖼 Imagem</a>${
            m.message && m.message !== "🖼 Imagem"
              ? `<div style="margin-top:6px;">${highlightMentions(m.message)}</div>`
              : ""
          }`
        : highlightMentions(m.message || "");

      const replyHTML = buildReplyPreviewHTML(m.reply_preview);

      div.innerHTML = `
        <div class="message-header">
          <span class="username">${getNameWithBadgeHTML(m.sender, m.is_admin, color)}</span>
          <span class="timestamp">${date}</span>
        </div>
        ${replyHTML}
        <div>${dmContentHTML}</div>
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

    setHeader();
    clearTypingUI();
    clearReplySelection();
    await sendTyping(false);
    await loadMessages({ forceScrollBottom: true });
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
  chatMode = "public";
  currentRoom = null;
  currentOther = null;

  setHeader();
  clearTypingUI();
  clearReplySelection();
  await loadMessages({ forceScrollBottom: true });
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
  clearReplySelection();

  await loadMessages({ forceScrollBottom: true });

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
  clearReplySelection();

  await loadMessages({ forceScrollBottom: true });
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
  if (!loggedUser) return;

  const room = (chatMode === "dm" && currentRoom) ? currentRoom : null;

  try {
    await apiFetch("online", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: loggedUser, room, typing_room: room })
    });
  } catch {}
}

async function loadOnlineUsers() {
  try {
    const res = await apiFetch("online");
    const data = await res.json();
    document.getElementById("onlineUsers").textContent =
      Array.isArray(data) && data.length ? data.map(u => u.name).join(", ") : "0";
  } catch {}
}

document.addEventListener("DOMContentLoaded", () => {
  const miniProfile = document.getElementById("mini-profile");
  const dropdownMenu = document.getElementById("dropdown-menu");
  const arrow = document.getElementById("arrow");
  const contentInput = document.getElementById("content");
  const avatarInput = document.getElementById("profile-avatar-input");

  restoreBadgeOnLoad();
  loadProfile();

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
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  contentInput.addEventListener("input", () => onUserTyping());
  contentInput.addEventListener("focus", () => { onUserTyping(); markAllSeen(); });
  contentInput.addEventListener("blur", () => sendTyping(false));

  setHeader();
  renderReplyBar();

  loadMessages();
  setInterval(() => loadMessages(), 3000);

  updateOnlineStatus();
  setInterval(updateOnlineStatus, 5000);

  loadOnlineUsers();
  setInterval(loadOnlineUsers, 5000);

  loadTypingStatus();
  setInterval(loadTypingStatus, 900);
});

window.toggleEmojis = toggleEmojis;
window.sendMessage = sendMessage;
