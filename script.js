// TOGGLES
document.querySelectorAll(".toggle").forEach(t => {
  t.addEventListener("click", () => {
    t.classList.toggle("active");
  });
});

// SEED
const seedBtn = document.getElementById("seedToggle");
const seedInput = document.getElementById("seed");

seedBtn.onclick = () => {
  const active = seedBtn.classList.toggle("active");
  seedInput.disabled = !active;
  seedBtn.innerText = active ? "ON" : "OFF";
};

// BLOQUEAR LETRAS
seedInput.addEventListener("input", () => {
  seedInput.value = seedInput.value.replace(/[a-zA-Z]/g, "");
});

// SLIDER
const sleep = document.getElementById("sleepPercent");
const label = document.getElementById("sleepLabel");

sleep.oninput = () => {
  label.innerText = sleep.value + "%";
};

// DIFICULDADE
let difficulty = "Normal";
document.querySelectorAll(".diff").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll(".diff").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    difficulty = btn.getAttribute("data");
  };
});

// SEND
async function send() {

  const player = document.getElementById("playerName").value;

  if (!player) {
    alert("Digite seu nome!");
    return;
  }

  const get = id => document.getElementById(id)?.classList?.contains("active");

  const data = {
    player,

    seed: seedInput.value,

    classic: get("classic"),
    map: get("map"),
    bonus: get("bonus"),
    coords: get("coords"),
    days: get("days"),

    recipes: get("recipes"),
    fire: get("fire"),
    tnt: get("tnt"),
    mobloot: get("mobloot"),
    regen: get("regen"),
    blockdrop: get("blockdrop"),
    sleep: get("sleep"),

    sleepPercent: sleep.value,

    instantRespawn: get("instantRespawn"),
    respawnExplode: get("respawnExplode"),
    respawnRadius: respawnRadius.value,

    simulation: simulation.value,

    cheats: get("cheats"),

    daycycle: daycycle.value,
    keepinv: get("keepinv"),
    mobspawn: get("mobspawn"),
    grief: get("grief"),
    entitydrop: get("entitydrop"),
    weather: get("weather"),
    command: get("command"),
    edu: get("edu"),
    tick: tick.value,

    difficulty,
    hardcore: get("hardcore")
  };

  try {
    const res = await fetch("/api/save", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data)
    });

    const json = await res.json();

    if (json.error) {
      alert("Erro: " + json.error);
      return;
    }

    alert("Configuração enviada com sucesso!");
  } catch (err) {
    alert("Erro ao enviar.");
  }
}