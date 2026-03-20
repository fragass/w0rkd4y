const ADMIN_USER = sessionStorage.getItem("loggedUser") || "";
const feedbackToast = document.getElementById("feedbackToast");

function showToast(message, type = "info") {
  if (!feedbackToast) return;
  feedbackToast.textContent = message;
  feedbackToast.className = `feedback-toast ${type} show`;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    feedbackToast.className = "feedback-toast";
  }, 2600);
}

async function apiFetch(path, options = {}, query = null) {
  const url = new URL(`/api/${path}`, window.location.origin);
  if (query && typeof query === "object") {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value);
      }
    });
  }

  const response = await fetch(url.toString(), options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    throw new Error(data?.message || data?.error || "Falha na requisição");
  }
  return data;
}

function formatDate(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString("pt-BR");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function initialsAvatar(name = "?") {
  const letter = String(name || "?").trim().charAt(0).toUpperCase() || "?";
  return `data:image/svg+xml;utf8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
      <rect width="80" height="80" rx="40" fill="#151a21"/>
      <text x="50%" y="54%" text-anchor="middle" fill="#e6edf3" font-size="34" font-family="Segoe UI, Arial" font-weight="700">${letter}</text>
    </svg>
  `)}`;
}

function getKeyStatusPill(invite) {
  if (invite.revoked) return '<span class="pill revoked">Revogada</span>';
  if (invite.used) return '<span class="pill used">Usada</span>';
  if (invite.expired) return '<span class="pill expired">Expirada</span>';
  return '<span class="pill active-key">Ativa</span>';
}

async function loadStats() {
  const data = await apiFetch("admin/stats", {}, { username: ADMIN_USER });
  const stats = data.stats || {};
  document.getElementById("statUsers").textContent = stats.users_total ?? 0;
  document.getElementById("statAdmins").textContent = stats.admins_total ?? 0;
  document.getElementById("statOnline").textContent = stats.online_now ?? 0;
  document.getElementById("statPublic").textContent = stats.public_messages ?? 0;
  document.getElementById("statPrivate").textContent = stats.private_messages ?? 0;
  document.getElementById("statRooms").textContent = stats.private_rooms ?? 0;
  document.getElementById("statImages").textContent = stats.uploaded_images ?? 0;
  document.getElementById("statKeysActive").textContent = stats.invite_keys_active ?? 0;
  document.getElementById("statKeysUsed").textContent = stats.invite_keys_used ?? 0;

  const status = document.getElementById("systemStatusList");
  status.innerHTML = "";
  const rows = [
    ["Sessão atual", ADMIN_USER],
    ["Usuários online agora", stats.online_now ?? 0],
    ["Fila pública", stats.public_messages ?? 0],
    ["Fila privada", stats.private_messages ?? 0],
    ["Keys ativas", stats.invite_keys_active ?? 0],
  ];
  rows.forEach(([label, value]) => {
    const div = document.createElement("div");
    div.className = "status-item";
    div.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    status.appendChild(div);
  });
}

async function loadUsers() {
  const search = document.getElementById("userSearchInput").value.trim();
  const data = await apiFetch("admin/users", {}, { username: ADMIN_USER, search });
  const tbody = document.getElementById("usersTableBody");
  tbody.innerHTML = "";

  if (!data.users?.length) {
    tbody.innerHTML = `<tr><td colspan="5">Nenhum usuário encontrado.</td></tr>`;
    return;
  }

  data.users.forEach((user) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <div class="user-name">
          <img class="user-avatar" src="${user.avatar_url || initialsAvatar(user.display_name || user.username)}" alt="${user.username}">
          <div class="user-meta">
            <strong>${escapeHtml(user.display_name || user.username)}</strong>
            <small>@${escapeHtml(user.username)}</small>
          </div>
        </div>
      </td>
      <td><span class="pill ${user.online ? "online" : "offline"}">${user.online ? "Online" : "Offline"}</span></td>
      <td><span class="pill ${user.is_admin ? "admin" : "user"}">${user.is_admin ? "Admin" : "Usuário"}</span></td>
      <td>${formatDate(user.created_at)}</td>
      <td>
        <div class="row-actions">
          <button class="secondary-btn" data-role-user="${escapeHtml(user.username)}" data-next-admin="${user.is_admin ? "0" : "1"}">${user.is_admin ? "Remover admin" : "Tornar admin"}</button>
          <button class="danger-btn" data-remove-user="${escapeHtml(user.username)}">Remover</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function loadKeys() {
  const search = document.getElementById("keySearchInput").value.trim();
  const status = document.getElementById("keyStatusSelect").value;
  const data = await apiFetch("admin/keys", {}, { username: ADMIN_USER, search, status });
  const tbody = document.getElementById("keysTableBody");
  tbody.innerHTML = "";

  if (!data.keys?.length) {
    tbody.innerHTML = `<tr><td colspan="6">Nenhuma key encontrada.</td></tr>`;
    return;
  }

  data.keys.forEach((invite) => {
    const tr = document.createElement("tr");
    const usage = invite.used
      ? `por <strong>${escapeHtml(invite.used_by || "--")}</strong><br><small>${formatDate(invite.used_at)}</small>`
      : invite.revoked
        ? `revogada<br><small>${formatDate(invite.revoked_at)}</small>`
        : invite.expires_at
          ? `expira em<br><small>${formatDate(invite.expires_at)}</small>`
          : `<small>sem uso ainda</small>`;

    tr.innerHTML = `
      <td><code>${escapeHtml(invite.code)}</code></td>
      <td>${getKeyStatusPill(invite)}</td>
      <td>${escapeHtml(invite.label || "--")}</td>
      <td>${usage}</td>
      <td>${formatDate(invite.created_at)}</td>
      <td>
        <div class="row-actions">
          <button class="secondary-btn" data-copy-key="${escapeHtml(invite.code)}">Copiar</button>
          ${!invite.used && !invite.revoked ? `<button class="danger-btn" data-revoke-key-id="${invite.id}">Revogar</button>` : ""}
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function loadLogs() {
  const type = document.getElementById("logTypeSelect").value;
  const search = document.getElementById("logSearchInput").value.trim();
  const data = await apiFetch("admin/logs", {}, { username: ADMIN_USER, type, search, limit: 100 });
  const list = document.getElementById("logsList");
  list.innerHTML = "";

  if (!data.logs?.length) {
    list.innerHTML = `<div class="log-item"><div class="log-message">Nenhum log encontrado.</div></div>`;
    return;
  }

  data.logs.forEach((log) => {
    const div = document.createElement("div");
    div.className = "log-item";
    div.innerHTML = `
      <div class="log-top">
        <div>
          <div class="log-type">${escapeHtml(log.type)}</div>
          <div class="log-message">${escapeHtml(log.message || "Sem conteúdo")}</div>
        </div>
        <div class="log-meta">${formatDate(log.created_at)}</div>
      </div>
      <div class="log-meta">ator: ${escapeHtml(log.actor || "--")}${log.target ? ` · alvo: ${escapeHtml(String(log.target))}` : ""}${log.has_image ? " · contém imagem" : ""}</div>
    `;
    list.appendChild(div);
  });
}

async function createUser(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);

  await apiFetch("admin/users/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: ADMIN_USER,
      new_username: String(formData.get("new_username") || "").trim(),
      display_name: String(formData.get("display_name") || "").trim(),
      password: String(formData.get("password") || "").trim(),
      is_admin: formData.get("is_admin") === "on",
    }),
  });

  event.currentTarget.reset();
  showToast("Usuário criado com sucesso.", "success");
  await refreshEverything({ logs: true, keys: false });
}

async function createKey(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const data = await apiFetch("admin/keys/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: ADMIN_USER,
      label: String(formData.get("label") || "").trim(),
      expires_in_days: String(formData.get("expires_in_days") || "").trim(),
    }),
  });

  event.currentTarget.reset();
  document.getElementById("generatedKeyValue").textContent = data.key?.code || "--";
  document.getElementById("generatedKeyBox").hidden = false;
  showToast("Key criada com sucesso.", "success");
  await refreshEverything({ logs: true });
}

async function copyText(text) {
  await navigator.clipboard.writeText(String(text || ""));
  showToast("Copiado.", "success");
}

async function revokeKey(keyId) {
  const ok = window.confirm("Revogar essa key? Quem ainda não usou perde o acesso por ela.");
  if (!ok) return;

  await apiFetch("admin/keys/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: ADMIN_USER, key_id: keyId }),
  });

  showToast("Key revogada.", "success");
  await refreshEverything({ logs: true });
}

async function updateUserRole(targetUsername, isAdmin) {
  await apiFetch("admin/users/role", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: ADMIN_USER, target_username: targetUsername, is_admin: isAdmin }),
  });

  if (targetUsername === ADMIN_USER) {
    sessionStorage.setItem("isAdmin", String(!!isAdmin));
  }

  showToast("Permissão atualizada.", "success");
  await refreshEverything({ logs: true, keys: false });
}

async function removeUser(targetUsername) {
  const ok = window.confirm(`Remover ${targetUsername}? Isso também apaga perfil, presença e conteúdo ligado a ele.`);
  if (!ok) return;

  await apiFetch("admin/users/remove", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: ADMIN_USER, target_username: targetUsername }),
  });

  showToast(`Usuário ${targetUsername} removido.`, "success");
  await refreshEverything({ logs: true });
}

async function runClear(scope) {
  const confirmText = {
    all: "apagar tudo",
    public: "apagar mensagens públicas",
    private: "apagar mensagens privadas",
    images: "apagar imagens",
    channels: "apagar salas privadas",
  }[scope] || scope;

  const ok = window.confirm(`Confirma ${confirmText}? Essa ação pode ser irreversível.`);
  if (!ok) return;

  const data = await apiFetch("admin/clear", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: ADMIN_USER, scope }),
  });

  showToast(data.message || "Ação concluída.", "success");
  await refreshEverything({ logs: true, keys: false });
}

async function refreshEverything(options = {}) {
  const wantsLogs = options.logs !== false;
  const wantsKeys = options.keys !== false;
  await Promise.all([
    loadStats(),
    loadUsers(),
    wantsKeys ? loadKeys() : Promise.resolve(),
    wantsLogs ? loadLogs() : Promise.resolve(),
  ]);
}

document.addEventListener("click", async (event) => {
  const navBtn = event.target.closest(".nav-btn");
  if (navBtn) {
    document.querySelectorAll(".nav-btn").forEach((btn) => btn.classList.remove("active"));
    document.querySelectorAll(".page-section").forEach((section) => section.classList.remove("active"));
    navBtn.classList.add("active");
    document.querySelector(`.page-section[data-page="${navBtn.dataset.section}"]`)?.classList.add("active");
    return;
  }

  const roleBtn = event.target.closest("[data-role-user]");
  if (roleBtn) {
    try {
      await updateUserRole(roleBtn.dataset.roleUser, roleBtn.dataset.nextAdmin === "1");
    } catch (error) {
      showToast(error.message, "error");
    }
    return;
  }

  const removeBtn = event.target.closest("[data-remove-user]");
  if (removeBtn) {
    try {
      await removeUser(removeBtn.dataset.removeUser);
    } catch (error) {
      showToast(error.message, "error");
    }
    return;
  }

  const clearBtn = event.target.closest("[data-clear-scope]");
  if (clearBtn) {
    try {
      await runClear(clearBtn.dataset.clearScope);
    } catch (error) {
      showToast(error.message, "error");
    }
    return;
  }

  const copyKeyBtn = event.target.closest("[data-copy-key]");
  if (copyKeyBtn) {
    try {
      await copyText(copyKeyBtn.dataset.copyKey);
    } catch {
      showToast("Não consegui copiar a key.", "error");
    }
    return;
  }

  const revokeKeyBtn = event.target.closest("[data-revoke-key-id]");
  if (revokeKeyBtn) {
    try {
      await revokeKey(revokeKeyBtn.dataset.revokeKeyId);
    } catch (error) {
      showToast(error.message, "error");
    }
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("adminIdentity").textContent = ADMIN_USER || "admin";
  document.getElementById("createUserForm").addEventListener("submit", createUser);
  document.getElementById("createKeyForm").addEventListener("submit", createKey);
  document.getElementById("reloadUsersBtn").addEventListener("click", () => loadUsers().catch((error) => showToast(error.message, "error")));
  document.getElementById("reloadKeysBtn").addEventListener("click", () => loadKeys().catch((error) => showToast(error.message, "error")));
  document.getElementById("reloadLogsBtn").addEventListener("click", () => loadLogs().catch((error) => showToast(error.message, "error")));
  document.getElementById("refreshAllBtn").addEventListener("click", () => refreshEverything({ logs: true }).then(() => showToast("Painel atualizado.", "success")).catch((error) => showToast(error.message, "error")));
  document.getElementById("copyGeneratedKeyBtn").addEventListener("click", () => copyText(document.getElementById("generatedKeyValue").textContent).catch(() => showToast("Não consegui copiar a key.", "error")));
  document.getElementById("userSearchInput").addEventListener("input", debounce(() => loadUsers().catch((error) => showToast(error.message, "error")), 180));
  document.getElementById("keySearchInput").addEventListener("input", debounce(() => loadKeys().catch((error) => showToast(error.message, "error")), 180));
  document.getElementById("keyStatusSelect").addEventListener("change", () => loadKeys().catch((error) => showToast(error.message, "error")));
  document.getElementById("logSearchInput").addEventListener("input", debounce(() => loadLogs().catch((error) => showToast(error.message, "error")), 260));
  document.getElementById("logTypeSelect").addEventListener("change", () => loadLogs().catch((error) => showToast(error.message, "error")));

  try {
    await refreshEverything({ logs: true });
  } catch (error) {
    showToast(error.message || "Erro ao carregar painel.", "error");
  }

  setInterval(() => {
    loadStats().catch(() => {});
  }, 15000);
});

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
