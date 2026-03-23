const cardsContainer = document.getElementById("cardsContainer");
const summaryText = document.getElementById("summaryText");
const statusBox = document.getElementById("statusBox");
const overlay = document.getElementById("overlay");
const idealConfigCard = document.getElementById("idealConfigCard");

const refreshBtn = document.getElementById("refreshBtn");
const idealBtn = document.getElementById("idealBtn");
const closeOverlay = document.getElementById("closeOverlay");

let submissions = [];

const FIELD_LABELS = {
  player_name: "Nome",
  difficulty: "Dificuldade",
  hardcore: "Hardcore",
  use_seed: "Usar seed personalizada",
  seed: "Seed",
  classic: "Mundo clássico",
  map: "Mapa de início",
  bonus: "Baú bônus",
  coords: "Mostrar coordenadas",
  days: "Mostrar dias jogados",
  recipes: "Desbloqueio de receitas",
  fire: "Fogo se espalha",
  tnt: "Dinamite explode",
  mobloot: "Itens de criaturas",
  regen: "Regeneração natural",
  blockdrop: "Itens largados de blocos",
  sleep: "Avançar a noite dormindo",
  sleep_percent: "Jogadores para dormir",
  instant_respawn: "Renascimento imediato",
  respawn_explode: "Blocos de renascimento explodem",
  respawn_radius: "Raio de renascimento",
  simulation: "Distância de simulação",
  cheats: "Ativar cheats",
  daycycle: "Ciclo da luz do dia",
  keepinv: "Manter inventário",
  mobspawn: "Geração de criaturas",
  grief: "Vandalismo de criaturas",
  entitydrop: "Entidades largam itens",
  weather: "Ciclo climático",
  command: "Blocos de comando",
  edu: "Recursos Education",
  tick: "Velocidade de tick aleatória",
  created_at: "Enviado em"
};

const CARD_FIELDS = [
  "difficulty",
  "hardcore",
  "use_seed",
  "seed",
  "classic",
  "map",
  "bonus",
  "coords",
  "days",
  "recipes",
  "fire",
  "tnt",
  "mobloot",
  "regen",
  "blockdrop",
  "sleep",
  "sleep_percent",
  "instant_respawn",
  "respawn_explode",
  "respawn_radius",
  "simulation",
  "cheats",
  "daycycle",
  "keepinv",
  "mobspawn",
  "grief",
  "entitydrop",
  "weather",
  "command",
  "edu",
  "tick"
];

const IDEAL_FIELDS = [
  "difficulty",
  "hardcore",
  "use_seed",
  "seed",
  "classic",
  "map",
  "bonus",
  "coords",
  "days",
  "recipes",
  "fire",
  "tnt",
  "mobloot",
  "regen",
  "blockdrop",
  "sleep",
  "sleep_percent",
  "instant_respawn",
  "respawn_explode",
  "respawn_radius",
  "simulation",
  "cheats",
  "daycycle",
  "keepinv",
  "mobspawn",
  "grief",
  "entitydrop",
  "weather",
  "command",
  "edu",
  "tick"
];

const DEFAULTS = {
  difficulty: "Normal",
  hardcore: false,
  use_seed: false,
  seed: null,
  classic: false,
  map: false,
  bonus: false,
  coords: false,
  days: false,
  recipes: true,
  fire: true,
  tnt: true,
  mobloot: true,
  regen: true,
  blockdrop: true,
  sleep: true,
  sleep_percent: 100,
  instant_respawn: false,
  respawn_explode: true,
  respawn_radius: 10,
  simulation: 4,
  cheats: false,
  daycycle: "Normal",
  keepinv: false,
  mobspawn: true,
  grief: true,
  entitydrop: true,
  weather: true,
  command: true,
  edu: false,
  tick: 1
};

function showStatus(message, isError = false) {
  statusBox.textContent = message;
  statusBox.classList.add("show");
  statusBox.style.background = isError
    ? "linear-gradient(180deg, #b94d4d 0%, #973d3d 100%)"
    : "linear-gradient(180deg, #60b93d 0%, #4a9530 100%)";
  statusBox.style.borderTopColor = isError ? "#df8a8a" : "#a6e18d";
  statusBox.style.borderLeftColor = isError ? "#df8a8a" : "#a6e18d";
  statusBox.style.borderRightColor = isError ? "#6f2c2c" : "#2f6720";
  statusBox.style.borderBottomColor = isError ? "#6f2c2c" : "#2f6720";
}

function hideStatus() {
  statusBox.classList.remove("show");
}

function formatBoolean(value) {
  return value ? "Sim" : "Não";
}

function formatDate(value) {
  if (!value) return "Sem data";
  return new Date(value).toLocaleString("pt-BR");
}

function formatValue(field, value) {
  if (field === "created_at") return formatDate(value);
  if (field === "sleep_percent") return `${Number(value)}%`;
  if (field === "simulation") return `${value} pedaços`;
  if (typeof value === "boolean") return formatBoolean(value);
  if (value === null || value === undefined || value === "") return "Não definido";
  return String(value);
}

function createCard(submission) {
  const card = document.createElement("article");
  card.className = "submission-card";

  const rows = CARD_FIELDS.map(field => {
    return `
      <div class="card-row">
        <div class="card-label">${FIELD_LABELS[field] || field}</div>
        <div class="card-value">${formatValue(field, submission[field])}</div>
      </div>
    `;
  }).join("");

  card.innerHTML = `
    <div class="card-head">
      <div class="player-name">${submission.player_name || "Sem nome"}</div>
      <div class="card-date">${formatDate(submission.created_at)}</div>
    </div>
    <div class="card-list">${rows}</div>
  `;

  return card;
}

function renderCards(items) {
  cardsContainer.innerHTML = "";

  if (!items.length) {
    summaryText.textContent = "Nenhuma solicitação enviada ainda.";
    cardsContainer.innerHTML = `
      <article class="submission-card">
        <div class="player-name">Nenhuma solicitação encontrada</div>
        <div class="summary-text" style="margin-top: 10px;">
          Assim que alguém enviar um formulário, ele vai aparecer aqui.
        </div>
      </article>
    `;
    return;
  }

  summaryText.textContent = `${items.length} solicitação(ões) carregada(s). Clique em "Gerar config ideal" para calcular a configuração mais votada.`;

  items.forEach(item => {
    cardsContainer.appendChild(createCard(item));
  });
}

function countValues(items, field) {
  const counts = new Map();

  for (const item of items) {
    let value = item[field];

    if (value === null || value === undefined || value === "") {
      continue;
    }

    const key = String(value);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return counts;
}

function getMode(items, field, fallback) {
  const counts = countValues(items, field);

  if (!counts.size) return fallback;

  let winner = fallback;
  let highest = -1;

  for (const [key, total] of counts.entries()) {
    if (total > highest) {
      highest = total;
      winner = key;
    }
  }

  if (typeof fallback === "number") return Number(winner);
  if (typeof fallback === "boolean") return winner === "true";
  return winner;
}

function getBooleanMajority(items, field, fallback = false) {
  let yes = 0;
  let no = 0;

  for (const item of items) {
    if (item[field] === true) yes++;
    else if (item[field] === false) no++;
  }

  if (yes === no) return fallback;
  return yes > no;
}

function buildIdealConfig(items) {
  if (!items.length) return null;

  const useSeed = getBooleanMajority(items, "use_seed", DEFAULTS.use_seed);

  return {
    difficulty: getMode(items, "difficulty", DEFAULTS.difficulty),
    hardcore: getBooleanMajority(items, "hardcore", DEFAULTS.hardcore),
    use_seed: useSeed,
    seed: useSeed ? getMode(items.filter(i => i.use_seed && i.seed), "seed", DEFAULTS.seed) : null,
    classic: getBooleanMajority(items, "classic", DEFAULTS.classic),
    map: getBooleanMajority(items, "map", DEFAULTS.map),
    bonus: getBooleanMajority(items, "bonus", DEFAULTS.bonus),
    coords: getBooleanMajority(items, "coords", DEFAULTS.coords),
    days: getBooleanMajority(items, "days", DEFAULTS.days),
    recipes: getBooleanMajority(items, "recipes", DEFAULTS.recipes),
    fire: getBooleanMajority(items, "fire", DEFAULTS.fire),
    tnt: getBooleanMajority(items, "tnt", DEFAULTS.tnt),
    mobloot: getBooleanMajority(items, "mobloot", DEFAULTS.mobloot),
    regen: getBooleanMajority(items, "regen", DEFAULTS.regen),
    blockdrop: getBooleanMajority(items, "blockdrop", DEFAULTS.blockdrop),
    sleep: getBooleanMajority(items, "sleep", DEFAULTS.sleep),
    sleep_percent: getMode(items, "sleep_percent", DEFAULTS.sleep_percent),
    instant_respawn: getBooleanMajority(items, "instant_respawn", DEFAULTS.instant_respawn),
    respawn_explode: getBooleanMajority(items, "respawn_explode", DEFAULTS.respawn_explode),
    respawn_radius: getMode(items, "respawn_radius", DEFAULTS.respawn_radius),
    simulation: getMode(items, "simulation", DEFAULTS.simulation),
    cheats: getBooleanMajority(items, "cheats", DEFAULTS.cheats),
    daycycle: getMode(items, "daycycle", DEFAULTS.daycycle),
    keepinv: getBooleanMajority(items, "keepinv", DEFAULTS.keepinv),
    mobspawn: getBooleanMajority(items, "mobspawn", DEFAULTS.mobspawn),
    grief: getBooleanMajority(items, "grief", DEFAULTS.grief),
    entitydrop: getBooleanMajority(items, "entitydrop", DEFAULTS.entitydrop),
    weather: getBooleanMajority(items, "weather", DEFAULTS.weather),
    command: getBooleanMajority(items, "command", DEFAULTS.command),
    edu: getBooleanMajority(items, "edu", DEFAULTS.edu),
    tick: getMode(items, "tick", DEFAULTS.tick)
  };
}

function renderIdealConfig(config) {
  if (!config) {
    idealConfigCard.innerHTML = `
      <div class="summary-text">Não há dados suficientes para gerar a configuração ideal.</div>
    `;
    return;
  }

  const items = IDEAL_FIELDS.map(field => {
    return `
      <div class="ideal-item">
        <div class="ideal-label">${FIELD_LABELS[field] || field}</div>
        <div class="ideal-value">${formatValue(field, config[field])}</div>
      </div>
    `;
  }).join("");

  idealConfigCard.innerHTML = `<div class="ideal-grid">${items}</div>`;
}

async function loadSubmissions() {
  hideStatus();
  summaryText.textContent = "Carregando solicitações...";

  try {
    const response = await fetch("/api/submissions");
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Erro ao buscar solicitações.");
    }

    submissions = Array.isArray(result.submissions) ? result.submissions : [];
    renderCards(submissions);
  } catch (error) {
    summaryText.textContent = "Falha ao carregar as solicitações.";
    showStatus(error.message || "Erro ao buscar dados.", true);
    cardsContainer.innerHTML = "";
  }
}

refreshBtn.addEventListener("click", loadSubmissions);

idealBtn.addEventListener("click", () => {
  if (!submissions.length) {
    showStatus("Ainda não há solicitações para calcular a configuração ideal.", true);
    return;
  }

  const ideal = buildIdealConfig(submissions);
  renderIdealConfig(ideal);
  overlay.classList.remove("hidden");
});

closeOverlay.addEventListener("click", () => {
  overlay.classList.add("hidden");
});

overlay.addEventListener("click", (event) => {
  if (event.target === overlay) {
    overlay.classList.add("hidden");
  }
});

loadSubmissions();