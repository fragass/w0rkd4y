document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();

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
    } else {
      document.getElementById("errorMsg").textContent =
        result.message || "Usuário ou senha inválidos!";
    }

  } catch (err) {
    console.error("Erro no login:", err);
    document.getElementById("errorMsg").textContent =
      "Erro ao conectar com o servidor.";
  }
});


