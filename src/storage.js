// Perfil, estatisticas e preferencias, em localStorage.
//
// Tudo passa por try/catch: em aba anonima do Safari o localStorage existe mas
// lanca excecao ao escrever, e um jogo nao pode morrer porque nao conseguiu
// salvar o volume da musica.

import { novoJogador, atualizar, afastamento, notaExibida } from './game/rating.js';

const KEY = 'doceduelo:v2';

/** Quantas partidas o historico guarda, para o perfil nao crescer sem fim. */
const HISTORICO_MAXIMO = 50;

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
    modoLeve: null, // null = decidir pelo aparelho; true/false = escolha do jogador
    hints: true,
    debug: false,
  },
  tutorialSeen: false,
  /** Ja aprendeu o cancelamento na pratica? Para de mostrar a dica. */
  cancelamentoVisto: false,
  /** Nota competitiva (Glicko-2). Ver src/game/rating.js. */
  rating: null,
  /** Ultimas partidas, para o historico e para medir afastamento. */
  historico: [],
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

  /** Grava chaves de topo do perfil (flags simples). */
  updateData(patch) {
    Object.assign(cache, patch);
    persist();
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

  /** Nota atual. Criada na primeira leitura, para perfis antigos migrarem sozinhos. */
  get rating() {
    if (!cache.rating) {
      cache.rating = novoJogador();
      persist();
    }
    return cache.rating;
  },

  get historico() {
    return cache.historico || [];
  },

  /**
   * Registra o resultado de uma partida na nota.
   * `adversario` = { rating, desvio }: bot com nota fixa, ou humano desconhecido.
   */
  registrarResultado({ venceu, adversario, modo, nomeAdversario, contaParaNota = true }) {
    const antes = this.rating;
    // Vitoria esvaziada (adversario fraco demais, ou teto do solo) nao mexe na
    // nota, mas ainda entra no historico — a partida aconteceu.
    const depois = contaParaNota
      ? atualizar(antes, [
          { rating: adversario.rating, desvio: adversario.desvio, pontos: venceu ? 1 : 0 },
        ])
      : antes;

    cache.rating = depois;
    cache.historico = [
      {
        quando: Date.now(),
        venceu,
        modo,
        adversario: nomeAdversario || null,
        notaAntes: notaExibida(antes),
        notaDepois: notaExibida(depois),
      },
      ...(cache.historico || []),
    ].slice(0, HISTORICO_MAXIMO);

    persist();
    return { antes, depois };
  },

  /**
   * Devolve incerteza a quem ficou um tempo sem jogar.
   *
   * Chamado ao abrir o jogo. Sem isso, quem sumiu por semanas volta com a nota
   * antiga tratada como verdade e desequilibra as primeiras partidas de volta.
   */
  aplicarAfastamento() {
    const ultima = (cache.historico || [])[0];
    if (!ultima) return;
    const semanas = Math.floor((Date.now() - ultima.quando) / (7 * 86400000));
    if (semanas < 1) return;
    cache.rating = afastamento(this.rating, semanas);
    persist();
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
