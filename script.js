document.querySelectorAll(".mc-toggle").forEach(toggle => {
  toggle.addEventListener("click", () => {
    toggle.classList.toggle("active");
  });
});

const seedBtn = document.getElementById("seedToggle");
const seedInput = document.getElementById("seed");
let useSeed = false;

seedBtn.addEventListener("click", () => {
  useSeed = !useSeed;
  seedInput.disabled = !useSeed;
  seedBtn.textContent = useSeed ? "Seed personalizada" : "Seed aleatória";
  seedBtn.classList.toggle("green", useSeed);
  seedBtn.classList.toggle("gray", !useSeed);

  if (!useSeed) {
    seedInput.value = "";
  }
});

seedInput.addEventListener("input", () => {
  seedInput.value = seedInput.value.replace(/[A-Za-z]/g, "");
});

const sleepPercent = document.getElementById("sleepPercent");
const sleepLabel = document.getElementById("sleepLabel");

sleepPercent.addEventListener("input", () => {
  sleepLabel.textContent = `${sleepPercent.value}%`;
});

let difficulty = "Normal";
document.querySelectorAll(".diff-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".diff-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    difficulty = btn.dataset.difficulty;
  });
});

function showError(message) {
  const box = document.getElementById("errorBox");
  const ok = document.getElementById("successBox");
  ok.classList.remove("show");
  box.textContent = message;
  box.classList.add("show");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showSuccess(message) {
  const box = document.getElementById("successBox");
  const err = document.getElementById("errorBox");
  err.classList.remove("show");
  box.textContent = message;
  box.classList.add("show");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function isActive(id) {
  return document.getElementById(id).classList.contains("active");
}

async function send() {
  const playerName = document.getElementById("playerName").value.trim();
  const respawnRadius = Number(document.getElementById("respawnRadius").value);
  const tick = Number(document.getElementById("tick").value);
  const simulation = Number(document.getElementById("simulation").value);

  if (!playerName) {
    showError("Digite o nome de quem está preenchendo.");
    return;
  }

  if (useSeed && !seedInput.value.trim()) {
    showError("Você ativou seed personalizada, mas não preencheu a seed.");
    return;
  }

  if (respawnRadius < 0 || respawnRadius > 128) {
    showError("O raio de renascimento deve ficar entre 0 e 128.");
    return;
  }

  if (tick < 1 || tick > 4096) {
    showError("A velocidade de tick deve ficar entre 1 e 4096.");
    return;
  }

  const payload = {
    player_name: playerName,
    use_seed: useSeed,
    seed: useSeed ? seedInput.value.trim() : null,

    classic: isActive("classic"),
    map: isActive("map"),
    bonus: isActive("bonus"),
    coords: isActive("coords"),
    days: isActive("days"),

    recipes: isActive("recipes"),
    fire: isActive("fire"),
    tnt: isActive("tnt"),
    mobloot: isActive("mobloot"),
    regen: isActive("regen"),
    blockdrop: isActive("blockdrop"),
    sleep: isActive("sleep"),

    sleep_percent: Number(sleepPercent.value),

    instant_respawn: isActive("instantRespawn"),
    respawn_explode: isActive("respawnExplode"),
    respawn_radius: respawnRadius,

    simulation,
    cheats: isActive("cheats"),

    daycycle: document.getElementById("daycycle").value,
    keepinv: isActive("keepinv"),
    mobspawn: isActive("mobspawn"),
    grief: isActive("grief"),
    entitydrop: isActive("entitydrop"),
    weather: isActive("weather"),
    command: isActive("command"),
    edu: isActive("edu"),
    tick,

    difficulty,
    hardcore: isActive("hardcore")
  };

  try {
    const response = await fetch("/api/save", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!response.ok) {
      showError(result.error || "Não foi possível enviar a configuração.");
      return;
    }

    showSuccess("Configuração enviada com sucesso.");
  } catch (error) {
    showError("Erro de conexão ao enviar a configuração.");
  }
}
