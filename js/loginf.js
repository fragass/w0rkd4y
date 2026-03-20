const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const errorMsg = document.getElementById("errorMsg");
const keyMsg = document.getElementById("keyMsg");
const keyPanel = document.getElementById("keyPanel");
const toggleKeyBtn = document.getElementById("toggleKeyBtn");
const validateKeyBtn = document.getElementById("validateKeyBtn");
const keyInput = document.getElementById("keyInput");

let validatedInvite = null;

function setError(message = "") {
  errorMsg.textContent = message;
}

function setKeyMessage(message = "", type = "") {
  keyMsg.textContent = message;
  keyMsg.className = "helper-text";
  if (type) keyMsg.classList.add(type);
}

function openKeyPanel() {
  keyPanel.hidden = false;
  toggleKeyBtn.setAttribute("aria-expanded", "true");
}

function closeKeyPanel() {
  keyPanel.hidden = true;
  registerForm.hidden = true;
  validatedInvite = null;
  keyInput.value = "";
  setKeyMessage("");
  toggleKeyBtn.setAttribute("aria-expanded", "false");
}

async function handleLogin(event) {
  event.preventDefault();
  setError("");

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
      sessionStorage.setItem("token", result.token);
      sessionStorage.setItem("loggedUser", result.user);
      sessionStorage.setItem("isAdmin", result.isAdmin ? "true" : "false");
      window.location.href = "8617a543f74d88b440f5ba33e1713f063665240f.html";
      return;
    }

    setError(result.message || "Usuário ou senha inválidos!");
  } catch (err) {
    console.error("Erro no login:", err);
    setError("Erro ao conectar com o servidor.");
  }
}

async function handleValidateKey() {
  const code = keyInput.value.trim();
  setError("");
  setKeyMessage("");

  if (!code) {
    setKeyMessage("Digite uma key primeiro.", "error");
    return;
  }

  validateKeyBtn.disabled = true;

  try {
    const response = await fetch("/api/invite/validate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ code })
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      validatedInvite = null;
      registerForm.hidden = true;
      setKeyMessage(result.message || "Key inválida.", "error");
      return;
    }

    validatedInvite = result.invite;
    registerForm.hidden = false;
    setKeyMessage("Key válida. Agora você pode criar a conta.", "success");
    document.getElementById("registerUsername").focus();
  } catch (error) {
    console.error("Erro ao validar key:", error);
    validatedInvite = null;
    registerForm.hidden = true;
    setKeyMessage("Erro ao validar a key.", "error");
  } finally {
    validateKeyBtn.disabled = false;
  }
}

async function handleRegister(event) {
  event.preventDefault();
  setError("");

  if (!validatedInvite?.code) {
    setKeyMessage("Valide uma key antes de criar a conta.", "error");
    registerForm.hidden = true;
    return;
  }

  const username = document.getElementById("registerUsername").value.trim();
  const password = document.getElementById("registerPassword").value.trim();

  try {
    const response = await fetch("/api/invite/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        code: validatedInvite.code,
        username,
        password
      })
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      setKeyMessage(result.message || "Não foi possível criar a conta.", "error");
      return;
    }

    sessionStorage.setItem("token", result.token);
    sessionStorage.setItem("loggedUser", result.user);
    sessionStorage.setItem("isAdmin", result.isAdmin ? "true" : "false");
    window.location.href = "8617a543f74d88b440f5ba33e1713f063665240f.html";
  } catch (error) {
    console.error("Erro ao criar conta por key:", error);
    setKeyMessage("Erro ao criar conta.", "error");
  }
}

toggleKeyBtn.addEventListener("click", () => {
  if (keyPanel.hidden) openKeyPanel();
  else closeKeyPanel();
});

validateKeyBtn.addEventListener("click", handleValidateKey);
keyInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    handleValidateKey();
  }
});

loginForm.addEventListener("submit", handleLogin);
registerForm.addEventListener("submit", handleRegister);
