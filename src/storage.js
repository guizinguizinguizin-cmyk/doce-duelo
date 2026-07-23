// Perfil, estatisticas e preferencias, em localStorage.
//
// Tudo passa por try/catch: em aba anonima do Safari o localStorage existe mas
// lanca excecao ao escrever, e um jogo nao pode morrer porque nao conseguiu
// salvar o volume da musica.

const KEY = 'doceduelo:v2';

const DEFAULTS = {
  name: '',
  stats: {
    games: 0,
    wins: 0,
    losses: 0,
    bestScore: 0,
    bestCombo: 0,
    bestCascade: 0,
    totalScore: 0,
    soloBest: 0,
  },
  settings: {
    muted: false,
    music: 0.35,
    sfx: 0.7,
    reducedMotion: null, // null = seguir a preferencia do sistema
    hints: true,
    debug: false,
  },
  tutorialSeen: false,
};

function deepMerge(base, extra) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const key in extra) {
    const value = extra[key];
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof out[key] === 'object' && out[key]) {
      out[key] = deepMerge(out[key], value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return deepMerge(DEFAULTS, {});
    return deepMerge(DEFAULTS, JSON.parse(raw));
  } catch {
    return deepMerge(DEFAULTS, {});
  }
}

let cache = read();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Sem espaco ou modo restrito: o jogo continua, so nao lembra na proxima.
  }
}

export const storage = {
  get data() {
    return cache;
  },

  get name() {
    return cache.name;
  },

  setName(name) {
    cache.name = String(name || '').slice(0, 14).trim();
    persist();
  },

  get settings() {
    return cache.settings;
  },

  updateSettings(patch) {
    cache.settings = { ...cache.settings, ...patch };
    persist();
    return cache.settings;
  },

  get stats() {
    return cache.stats;
  },

  /** Registra o fim de uma partida e devolve quais recordes foram batidos. */
  recordMatch({ won, score, bestCombo, bestCascade, solo }) {
    const s = cache.stats;
    const records = [];

    s.games += 1;
    if (won) s.wins += 1;
    else s.losses += 1;
    s.totalScore += score;

    if (score > s.bestScore) {
      s.bestScore = score;
      records.push('pontuação');
    }
    if (bestCombo > s.bestCombo) {
      s.bestCombo = bestCombo;
      records.push('combo');
    }
    if (bestCascade > s.bestCascade) {
      s.bestCascade = bestCascade;
      records.push('cascata');
    }
    if (solo && score > s.soloBest) s.soloBest = score;

    persist();
    return records;
  },

  markTutorialSeen() {
    cache.tutorialSeen = true;
    persist();
  },

  get tutorialSeen() {
    return cache.tutorialSeen;
  },

  reset() {
    cache = deepMerge(DEFAULTS, {});
    persist();
  },
};

/** Nome sugerido quando o jogador ainda nao escolheu um. */
export function suggestName() {
  const adjetivos = ['Doce', 'Turbo', 'Mega', 'Ultra', 'Rapido', 'Astuto', 'Feroz', 'Bravo'];
  const nomes = ['Morango', 'Limao', 'Kiwi', 'Uva', 'Mirtilo', 'Cacau', 'Menta', 'Caramelo'];
  const a = adjetivos[Math.floor(Math.random() * adjetivos.length)];
  const n = nomes[Math.floor(Math.random() * nomes.length)];
  return `${a}${n}`;
}
