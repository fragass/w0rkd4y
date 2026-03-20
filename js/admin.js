const ADMIN_USER = sessionStorage.getItem("loggedUser") || "";

async function apiFetch(route, options = {}, fallbackPayload = null) {
  const method = options.method || "GET";
  const config = {
    method,
    headers: {
      ...(options.headers || {}),
    },
  };

  if (method === "GET" && fallbackPayload) {
    const params = new URLSearchParams();
    Object.entries(fallbackPayload).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") params.set(key, value);
    });
    const response = await fetch(`/api/${route}?${params.toString()}`, config);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) throw new Error(data.message || data.error || "Erro inesperado");
    return data;
  }

  if (options.body) config.body = options.body;
  else if (fallbackPayload) {
    config.headers["Content-Type"] = config.headers["Content-Type"] || "application/json";
    config.body = JSON.stringify(fallbackPayload);
  }

  const response = await fetch(`/api/${route}`, config);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) throw new Error(data.message || data.error || "Erro inesperado");
  return data;
}

function showToast(message, type = "info") {
  const existing = document.querySelector(".feedback-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = `feedback-toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 220);
  }, 2600);
}

function formatDate(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString("pt-BR");
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

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function keyStatusBadge(key) {
  if (key.revoked) return '<span class="pill revoked">Revogada</span>';
  if (key.used) return '<span class="pill used">Usada</span>';
  return '<span class="pill active">Ativa</span>';
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
  document.getElementById("statKeysActive").textContent = stats.keys_active ?? 0;
  document.getElementById("statKeysUsed").textContent = stats.keys_used ?? 0;

  const status = document.getElementById("systemStatusList");
  status.innerHTML = "";
  const rows = [
    ["Sessão atual", ADMIN_USER],
    ["Usuários online agora", stats.online_now ?? 0],
    ["Fila pública", stats.public_messages ?? 0],
    ["Fila privada", stats.private_messages ?? 0],
    ["Salas privadas", stats.private_rooms ?? 0],
    ["Keys ativas", stats.keys_active ?? 0],
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
            <strong>${user.display_name || user.username}</strong>
            <small>@${user.username}</small>
          </div>
        </div>
      </td>
      <td><span class="pill ${user.online ? "online" : "offline"}">${user.online ? "Online" : "Offline"}</span></td>
      <td><span class="pill ${user.is_admin ? "admin" : "user"}">${user.is_admin ? "Admin" : "Usuário"}</span></td>
      <td>${formatDate(user.created_at)}</td>
      <td>
        <div class="row-actions">
          <button class="secondary-btn" data-role-user="${user.username}" data-next-admin="${user.is_admin ? "0" : "1"}">${user.is_admin ? "Remover admin" : "Tornar admin"}</button>
          <button class="danger-btn" data-remove-user="${user.username}">Remover</button>
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
    tbody.innerHTML = `<tr><td colspan="5">Nenhuma key encontrada.</td></tr>`;
    return;
  }

  data.keys.forEach((key) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <div class="key-code-block">
          <strong>${escapeHtml(key.code)}</strong>
          <small>${key.used_by ? `usada por @${escapeHtml(key.used_by)}` : (key.created_by ? `criada por @${escapeHtml(key.created_by)}` : "sem histórico")}</small>
        </div>
      </td>
      <td>${keyStatusBadge(key)}</td>
      <td>${formatDate(key.created_at)}</td>
      <td>${formatDate(key.used_at)}</td>
      <td>
        <div class="row-actions">
          <button class="secondary-btn" data-copy-key="${escapeHtml(key.code)}">Copiar</button>
          ${!key.used && !key.revoked ? `<button class="danger-btn" data-revoke-key="${escapeHtml(key.code)}">Revogar</button>` : ""}
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
          <div class="log-type">${log.type}</div>
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
  const form = event.currentTarget;
  const formData = new FormData(form);

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

  form.reset();
  showToast("Usuário criado com sucesso.", "success");
  await refreshEverything({ logs: true });
}

async function createKey(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const data = await apiFetch("admin/keys/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: ADMIN_USER,
      prefix: String(formData.get("prefix") || "").trim(),
    }),
  });

  document.getElementById("generatedKeyValue").textContent = data.key?.code || "--";
  document.getElementById("keyCreateResult").hidden = false;
  form.reset();
  showToast("Key gerada com sucesso.", "success");
  await refreshEverything({ logs: true });
}

async function copyText(value) {
  await navigator.clipboard.writeText(value);
  showToast("Copiado.", "success");
}

async function revokeKey(code) {
  const ok = window.confirm(`Revogar a key ${code}?`);
  if (!ok) return;

  await apiFetch("admin/keys/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: ADMIN_USER, code }),
  });

  showToast("Key revogada.", "success");
  await refreshEverything({ logs: true });
}

async function updateUserRole(targetUsername, isAdmin) {
  await apiFetch("admin/users/role", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: ADMIN_USER,
      target_username: targetUsername,
      is_admin: isAdmin,
    }),
  });

  if (targetUsername === ADMIN_USER) {
    sessionStorage.setItem("isAdmin", String(!!isAdmin));
  }

  showToast("Permissão atualizada.", "success");
  await refreshEverything({ logs: true });
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
  await refreshEverything({ logs: true });
}

async function refreshEverything(options = {}) {
  const wantsLogs = options.logs !== false;
  await Promise.all([
    loadStats(),
    loadUsers(),
    loadKeys(),
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

  const revokeBtn = event.target.closest("[data-revoke-key]");
  if (revokeBtn) {
    try {
      await revokeKey(revokeBtn.dataset.revokeKey);
    } catch (error) {
      showToast(error.message, "error");
    }
    return;
  }

  const copyBtn = event.target.closest("[data-copy-key]");
  if (copyBtn) {
    try {
      await copyText(copyBtn.dataset.copyKey);
    } catch (error) {
      showToast("Não foi possível copiar.", "error");
    }
    return;
  }

  if (event.target.id === "copyGeneratedKeyBtn") {
    try {
      await copyText(document.getElementById("generatedKeyValue").textContent.trim());
    } catch (error) {
      showToast("Não foi possível copiar.", "error");
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
  document.getElementById("userSearchInput").addEventListener("input", () => loadUsers().catch((error) => showToast(error.message, "error")));
  document.getElementById("keySearchInput").addEventListener("input", debounce(() => loadKeys().catch((error) => showToast(error.message, "error")), 260));
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
