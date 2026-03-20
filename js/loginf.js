const loginForm = document.getElementById("loginForm");
const errorMsg = document.getElementById("errorMsg");
const successMsg = document.getElementById("successMsg");
const toggleKeyAccessBtn = document.getElementById("toggleKeyAccessBtn");
const keyAccessPanel = document.getElementById("keyAccessPanel");
const keyValidationForm = document.getElementById("keyValidationForm");
const registerWithKeyForm = document.getElementById("registerWithKeyForm");
const inviteKeyInput = document.getElementById("inviteKeyInput");
const validatedKeyText = document.getElementById("validatedKeyText");

let validatedInviteKey = null;

function setError(message = "") {
  errorMsg.textContent = message;
  if (message) successMsg.textContent = "";
}

function setSuccess(message = "") {
  successMsg.textContent = message;
  if (message) errorMsg.textContent = "";
}

function normalizeKey(value) {
  return String(value || "").trim().toUpperCase();
}

function applyLogin(result) {
  sessionStorage.setItem("token", result.token);
  sessionStorage.setItem("loggedUser", result.user);
  sessionStorage.setItem("isAdmin", result.isAdmin ? "true" : "false");
  window.location.href = "8617a543f74d88b440f5ba33e1713f063665240f.html";
}

function resetKeyFlow(keepPanelOpen = true) {
  validatedInviteKey = null;
  keyValidationForm.hidden = false;
  registerWithKeyForm.hidden = true;
  if (!keepPanelOpen) keyAccessPanel.hidden = true;
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  setError("");
  setSuccess("");

  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ username, password })
    });

    const result = await response.json();

    if (response.ok && result.success) {
      applyLogin(result);
    } else {
      setError(result.message || "Usuário ou senha inválidos!");
    }

  } catch (err) {
    console.error("Erro no login:", err);
    setError("Erro ao conectar com o servidor.");
  }
});

toggleKeyAccessBtn.addEventListener("click", () => {
  const shouldOpen = keyAccessPanel.hidden;
  keyAccessPanel.hidden = !shouldOpen;
  toggleKeyAccessBtn.classList.toggle("active", shouldOpen);
  if (!shouldOpen) {
    resetKeyFlow(false);
    setError("");
    setSuccess("");
  }
});

keyValidationForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  setError("");
  setSuccess("");

  const code = normalizeKey(inviteKeyInput.value);
  if (!code) {
    setError("Digite a key para validar.");
    return;
  }

  try {
    const response = await fetch("/api/key/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      setError(result.message || "Key inválida.");
      return;
    }

    validatedInviteKey = code;
    validatedKeyText.textContent = `Key ${result.key?.code || code} validada. Agora crie sua conta.`;
    keyValidationForm.hidden = true;
    registerWithKeyForm.hidden = false;
    setSuccess("Key válida. Cadastro liberado.");
  } catch (error) {
    console.error("Erro ao validar key:", error);
    setError("Erro ao validar key.");
  }
});

registerWithKeyForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  setError("");
  setSuccess("");

  const username = document.getElementById("registerUsername").value.trim();
  const displayName = document.getElementById("registerDisplayName").value.trim();
  const password = document.getElementById("registerPassword").value.trim();

  if (!validatedInviteKey) {
    setError("Valide a key antes de criar a conta.");
    resetKeyFlow(true);
    return;
  }

  try {
    const response = await fetch("/api/key/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: validatedInviteKey,
        username,
        display_name: displayName,
        password,
      }),
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      setError(result.message || "Não foi possível criar a conta com essa key.");
      return;
    }

    setSuccess("Conta criada com sucesso. Entrando...");
    applyLogin(result);
  } catch (error) {
    console.error("Erro ao criar conta por key:", error);
    setError("Erro ao criar conta com key.");
  }
});
