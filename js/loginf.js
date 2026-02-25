document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;

  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });

  const result = await response.json();

  if (result.success) {
    sessionStorage.setItem("token", result.token);
    sessionStorage.setItem("loggedUser", result.user);
    window.location.href = "m3yxe8u27wpoovbz.html";
  } else {
    document.getElementById("errorMsg").textContent = "Usuário ou senha inválidos!";
  }
});


