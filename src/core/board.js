// Regras do match-3. Modulo puro: nao toca em DOM, canvas, audio nem rede.
//
// A diferenca principal para a versao antiga e que resolver o tabuleiro nao
// anima nada. `resolve()` devolve uma lista de FASES descrevendo o que
// aconteceu (o que sumiu, o que explodiu, o que caiu, quantos pontos). Quem
// desenha decide como animar, e o bot consegue rodar as mesmas regras
// instantaneamente para avaliar jogadas. Enquanto a regra e a animacao
// estiverem no mesmo lugar, nenhum dos dois e possivel.

export const COLS = 8;
export const ROWS = 8;
export const CELL_COUNT = COLS * ROWS;
export const TYPE_COUNT = 6;

/** Tipo das pecas sem cor (bomba colorida casa com qualquer cor). */
export const COLORLESS = -1;

export const SPECIAL = {
  NONE: 0,
  STRIPED_H: 1, // limpa a linha inteira
  STRIPED_V: 2, // limpa a coluna inteira
  WRAPPED: 3, // explode 3x3
  COLOR_BOMB: 4, // remove todas as pecas de uma cor
};

// ---------------------------------------------------------------------------
// Obstaculos (lixo enviado pelo adversario)
// ---------------------------------------------------------------------------

/** Tipo das casas ocupadas por pedra ou gelo: nao tem cor, nao combina. */
export const BLOCKED = -2;

export const BLOCKER = {
  /** Espaco morto. Nao troca, nao combina. Quebra com um match AO LADO. */
  PEDRA: 'pedra',
  /** Pedra teimosa: mesma regra, dois toques. */
  GELO: 'gelo',
  /** A peca continua com cor e COMBINA no lugar — so nao pode ser movida. */
  CADEADO: 'cadeado',
};

export const BLOCKER_HP = {
  [BLOCKER.PEDRA]: 1,
  [BLOCKER.GELO]: 2,
  [BLOCKER.CADEADO]: 1,
};

/** Pontos por camada de obstaculo removida. Limpar lixo tem de compensar. */
const BLOCKER_POINTS = 30;

/** Codigo usado na miniatura do adversario, fora da faixa das cores normais. */
const BLOCKED_MINI = TYPE_COUNT;

export const isBlocked = (cell) => !!(cell && cell.blocker);

/**
 * So pedra e gelo quebram por vizinhanca. O cadeado exige ser combinado —
 * e essa a diferenca entre "ocupa espaco" e "restringe sua jogada".
 */
const quebraPorVizinhanca = (cell) =>
  isBlocked(cell) && cell.blocker.tipo !== BLOCKER.CADEADO;

// Formatos de explosao que so existem quando dois especiais sao combinados.
// Ficam fora de SPECIAL porque nenhuma peca no tabuleiro guarda esses valores:
// eles vivem apenas dentro de uma unica resolucao.
const COMBO = {
  CROSS3: 101, // faixa de 3 linhas + 3 colunas
  MEGA: 102, // explosao 5x5
  EVERYTHING: 103, // tabuleiro inteiro
};

const POINTS_PER_CELL = 10;
const CASCADE_STEP = 0.5;
const ACTIVATION_BONUS = 25;
const CREATE_BONUS = {
  [SPECIAL.STRIPED_H]: 20,
  [SPECIAL.STRIPED_V]: 20,
  [SPECIAL.WRAPPED]: 40,
  [SPECIAL.COLOR_BOMB]: 90,
};

// Limite de seguranca: uma cascata real nunca chega perto disso, entao passar
// daqui significa bug de regra, e travar o jogo em loop infinito e pior do que
// cortar a cascata.
const MAX_CASCADES = 60;

let nextCellId = 1;

export function idx(r, c) {
  return r * COLS + c;
}
export function rowOf(i) {
  return (i / COLS) | 0;
}
export function colOf(i) {
  return i % COLS;
}
export function inBounds(r, c) {
  return r >= 0 && r < ROWS && c >= 0 && c < COLS;
}

export function areAdjacent(a, b) {
  const dr = Math.abs(rowOf(a) - rowOf(b));
  const dc = Math.abs(colOf(a) - colOf(b));
  return dr + dc === 1;
}

function makeCell(type, special = SPECIAL.NONE) {
  return { id: nextCellId++, type, special };
}

export function cloneGrid(grid) {
  const out = new Array(grid.length);
  for (let i = 0; i < grid.length; i++) {
    const c = grid[i];
    out[i] = c
      ? {
          id: c.id,
          type: c.type,
          special: c.special,
          ...(c.blocker ? { blocker: { ...c.blocker } } : {}),
        }
      : null;
  }
  return out;
}

function swapInPlace(grid, a, b) {
  const t = grid[a];
  grid[a] = grid[b];
  grid[b] = t;
}

// ---------------------------------------------------------------------------
// Deteccao de sequencias
// ---------------------------------------------------------------------------

/**
 * Sequencias de 3+ pecas iguais. Bombas coloridas (COLORLESS) nunca entram numa
 * sequencia — senao um tabuleiro com duas bombas vizinhas dispararia sozinho.
 */
export function findRuns(grid) {
  const hRuns = [];
  const vRuns = [];

  for (let r = 0; r < ROWS; r++) {
    let start = 0;
    for (let c = 1; c <= COLS; c++) {
      const head = grid[idx(r, start)];
      const cur = c < COLS ? grid[idx(r, c)] : null;
      const same = cur && head && head.type >= 0 && cur.type === head.type;
      if (!same) {
        if (c - start >= 3 && head && head.type >= 0) {
          const cells = [];
          for (let k = start; k < c; k++) cells.push(idx(r, k));
          hRuns.push({ orientation: 'h', cells, type: head.type });
        }
        start = c;
      }
    }
  }

  for (let c = 0; c < COLS; c++) {
    let start = 0;
    for (let r = 1; r <= ROWS; r++) {
      const head = grid[idx(start, c)];
      const cur = r < ROWS ? grid[idx(r, c)] : null;
      const same = cur && head && head.type >= 0 && cur.type === head.type;
      if (!same) {
        if (r - start >= 3 && head && head.type >= 0) {
          const cells = [];
          for (let k = start; k < r; k++) cells.push(idx(k, c));
          vRuns.push({ orientation: 'v', cells, type: head.type });
        }
        start = r;
      }
    }
  }

  return { hRuns, vRuns };
}

export function hasAnyRun(grid) {
  const { hRuns, vRuns } = findRuns(grid);
  return hRuns.length > 0 || vRuns.length > 0;
}

// ---------------------------------------------------------------------------
// Jogadas possiveis
// ---------------------------------------------------------------------------

/**
 * Primeira jogada valida encontrada, ou null se o tabuleiro travou.
 * Serve tanto para detectar embaralhamento quanto para o botao de dica.
 */
export function findMove(grid) {
  // Uma bomba colorida sempre pode ser trocada com qualquer vizinho.
  for (let i = 0; i < CELL_COUNT; i++) {
    if (grid[i] && grid[i].special === SPECIAL.COLOR_BOMB && !isBlocked(grid[i])) {
      const r = rowOf(i);
      const c = colOf(i);
      const livre = (rr, cc) => inBounds(rr, cc) && !isBlocked(grid[idx(rr, cc)]);
      if (livre(r, c + 1)) return { a: i, b: idx(r, c + 1) };
      if (livre(r, c - 1)) return { a: i, b: idx(r, c - 1) };
      if (livre(r + 1, c)) return { a: i, b: idx(r + 1, c) };
      if (livre(r - 1, c)) return { a: i, b: idx(r - 1, c) };
    }
  }

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = idx(r, c);
      if (isBlocked(grid[i])) continue;
      if (c < COLS - 1 && isPlayableSwap(grid, i, idx(r, c + 1))) return { a: i, b: idx(r, c + 1) };
      if (r < ROWS - 1 && isPlayableSwap(grid, i, idx(r + 1, c))) return { a: i, b: idx(r + 1, c) };
    }
  }
  return null;
}

export function hasValidMove(grid) {
  return findMove(grid) !== null;
}

/** Todas as jogadas validas — usado pelo bot para escolher a melhor. */
export function allMoves(grid) {
  const moves = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = idx(r, c);
      if (c < COLS - 1) {
        const j = idx(r, c + 1);
        if (isPlayableSwap(grid, i, j)) moves.push({ a: i, b: j });
      }
      if (r < ROWS - 1) {
        const j = idx(r + 1, c);
        if (isPlayableSwap(grid, i, j)) moves.push({ a: i, b: j });
      }
    }
  }
  return moves;
}

function isPlayableSwap(grid, a, b) {
  if (!grid[a] || !grid[b]) return false;
  // Nenhum obstaculo pode ser arrastado — e essa a razao de ele atrapalhar.
  if (isBlocked(grid[a]) || isBlocked(grid[b])) return false;
  if (comboKind(grid[a], grid[b])) return true;
  swapInPlace(grid, a, b);
  const ok = hasAnyRun(grid);
  swapInPlace(grid, a, b);
  return ok;
}

// ---------------------------------------------------------------------------
// Criacao e embaralhamento
// ---------------------------------------------------------------------------

/**
 * Tabuleiro inicial sem combinacoes prontas. Em vez de sortear tudo e torcer
 * para nao sair combinacao (o que a versao antiga fazia, ate 50 vezes), cada
 * peca e sorteada ja excluindo os tipos que fechariam trinca com os vizinhos
 * de cima e da esquerda. Sai certo de primeira.
 */
export function createGrid(rng) {
  const grid = new Array(CELL_COUNT).fill(null);

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const banned = new Set();
      if (c >= 2 && grid[idx(r, c - 1)].type === grid[idx(r, c - 2)].type) {
        banned.add(grid[idx(r, c - 1)].type);
      }
      if (r >= 2 && grid[idx(r - 1, c)].type === grid[idx(r - 2, c)].type) {
        banned.add(grid[idx(r - 1, c)].type);
      }
      const options = [];
      for (let t = 0; t < TYPE_COUNT; t++) if (!banned.has(t)) options.push(t);
      grid[idx(r, c)] = makeCell(options[rng.int(options.length)]);
    }
  }

  if (!hasValidMove(grid)) shuffleGrid(grid, rng);
  return grid;
}

/**
 * Reembaralha as pecas existentes quando nao ha jogada possivel. Diferente da
 * versao antiga, que gerava um tabuleiro totalmente novo e apagava qualquer
 * especial que o jogador tinha construido.
 */
export function shuffleGrid(grid, rng) {
  // Obstaculo fica onde esta. Embaralhar teleportando pedras seria uma segunda
  // punicao aleatoria, e o jogador nao teria como planejar em volta delas.
  const livres = [];
  const soltas = [];
  for (let i = 0; i < CELL_COUNT; i++) {
    if (grid[i] && isBlocked(grid[i])) continue;
    livres.push(i);
    soltas.push(grid[i]);
  }

  for (let attempt = 0; attempt < 200; attempt++) {
    for (let i = soltas.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      const t = soltas[i];
      soltas[i] = soltas[j];
      soltas[j] = t;
    }
    for (let k = 0; k < livres.length; k++) grid[livres[k]] = soltas[k];
    if (!hasAnyRun(grid) && hasValidMove(grid)) return grid;
  }

  // Embaralhar nao resolveu (acontece com poucos tipos distintos restando):
  // gerar pecas novas nas casas livres e melhor do que devolver um tabuleiro
  // travado. Os obstaculos continuam intactos.
  for (let attempt = 0; attempt < 60; attempt++) {
    for (const i of livres) grid[i] = makeCell(rng.int(TYPE_COUNT));
    if (!hasAnyRun(grid) && hasValidMove(grid)) return grid;
  }
  return grid;
}

// ---------------------------------------------------------------------------
// Combinacao de especiais (troca de dois especiais entre si)
// ---------------------------------------------------------------------------

function isStriped(cell) {
  return cell && (cell.special === SPECIAL.STRIPED_H || cell.special === SPECIAL.STRIPED_V);
}

/** Que tipo de combo duas pecas formam ao serem trocadas, ou null. */
function comboKind(x, y) {
  if (!x || !y) return null;
  const bombX = x.special === SPECIAL.COLOR_BOMB;
  const bombY = y.special === SPECIAL.COLOR_BOMB;

  if (bombX && bombY) return 'bomb+bomb';
  if (bombX || bombY) {
    const other = bombX ? y : x;
    if (isStriped(other)) return 'bomb+striped';
    if (other.special === SPECIAL.WRAPPED) return 'bomb+wrapped';
    return 'bomb+color';
  }
  if (isStriped(x) && isStriped(y)) return 'striped+striped';
  if (x.special === SPECIAL.WRAPPED && y.special === SPECIAL.WRAPPED) return 'wrapped+wrapped';
  if ((isStriped(x) && y.special === SPECIAL.WRAPPED) || (x.special === SPECIAL.WRAPPED && isStriped(y))) {
    return 'striped+wrapped';
  }
  return null;
}

/**
 * Monta a "detonacao inicial" de um combo: quais celulas ja entram na explosao
 * e com qual formato cada especial deve estourar (sobrescrevendo o formato
 * natural dele).
 */
function buildComboBlast(grid, a, b) {
  const kind = comboKind(grid[a], grid[b]);
  if (!kind) return null;

  const seeds = [a, b];
  const overrides = new Map();
  const cellA = grid[a];
  const cellB = grid[b];

  switch (kind) {
    case 'bomb+bomb':
      overrides.set(a, { special: COMBO.EVERYTHING });
      overrides.set(b, { special: SPECIAL.NONE });
      break;

    case 'bomb+color': {
      const bombAt = cellA.special === SPECIAL.COLOR_BOMB ? a : b;
      const other = bombAt === a ? cellB : cellA;
      overrides.set(bombAt, { special: SPECIAL.COLOR_BOMB, target: other.type });
      break;
    }

    // A bomba converte todas as pecas da cor alvo em especiais e detona todas.
    case 'bomb+striped':
    case 'bomb+wrapped': {
      const bombAt = cellA.special === SPECIAL.COLOR_BOMB ? a : b;
      const otherAt = bombAt === a ? b : a;
      const targetType = grid[otherAt].type;
      const asWrapped = kind === 'bomb+wrapped';
      let flip = 0;
      for (let i = 0; i < CELL_COUNT; i++) {
        const cell = grid[i];
        if (!cell || cell.type !== targetType) continue;
        overrides.set(i, {
          special: asWrapped ? SPECIAL.WRAPPED : flip++ % 2 === 0 ? SPECIAL.STRIPED_H : SPECIAL.STRIPED_V,
        });
        seeds.push(i);
      }
      overrides.set(bombAt, { special: SPECIAL.NONE });
      break;
    }

    // Dois listrados na mesma direcao limpariam a mesma linha duas vezes:
    // forcar um horizontal e um vertical para virar uma cruz de verdade.
    case 'striped+striped':
      overrides.set(a, { special: SPECIAL.STRIPED_H });
      overrides.set(b, { special: SPECIAL.STRIPED_V });
      break;

    case 'striped+wrapped':
      overrides.set(a, { special: COMBO.CROSS3 });
      overrides.set(b, { special: SPECIAL.NONE });
      break;

    case 'wrapped+wrapped':
      overrides.set(a, { special: COMBO.MEGA });
      overrides.set(b, { special: SPECIAL.NONE });
      break;
  }

  return { seeds, overrides, kind };
}

// ---------------------------------------------------------------------------
// Explosao e encadeamento
// ---------------------------------------------------------------------------

function mostCommonType(grid) {
  const counts = new Array(TYPE_COUNT).fill(0);
  for (const cell of grid) if (cell && cell.type >= 0) counts[cell.type]++;
  let best = 0;
  for (let t = 1; t < TYPE_COUNT; t++) if (counts[t] > counts[best]) best = t;
  return best;
}

/** Celulas atingidas quando o especial na posicao `i` estoura. */
function activationCells(grid, i, special, target) {
  const r = rowOf(i);
  const c = colOf(i);
  const out = [];

  switch (special) {
    case SPECIAL.STRIPED_H:
      for (let cc = 0; cc < COLS; cc++) out.push(idx(r, cc));
      break;
    case SPECIAL.STRIPED_V:
      for (let rr = 0; rr < ROWS; rr++) out.push(idx(rr, c));
      break;
    case SPECIAL.WRAPPED:
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) if (inBounds(r + dr, c + dc)) out.push(idx(r + dr, c + dc));
      break;
    case SPECIAL.COLOR_BOMB: {
      const t = target ?? mostCommonType(grid);
      for (let k = 0; k < CELL_COUNT; k++) if (grid[k] && grid[k].type === t) out.push(k);
      break;
    }
    case COMBO.CROSS3:
      for (let dr = -1; dr <= 1; dr++)
        if (inBounds(r + dr, 0)) for (let cc = 0; cc < COLS; cc++) out.push(idx(r + dr, cc));
      for (let dc = -1; dc <= 1; dc++)
        if (inBounds(0, c + dc)) for (let rr = 0; rr < ROWS; rr++) out.push(idx(rr, c + dc));
      break;
    case COMBO.MEGA:
      for (let dr = -2; dr <= 2; dr++)
        for (let dc = -2; dc <= 2; dc++) if (inBounds(r + dr, c + dc)) out.push(idx(r + dr, c + dc));
      break;
    case COMBO.EVERYTHING:
      for (let k = 0; k < CELL_COUNT; k++) out.push(k);
      break;
  }
  return out;
}

/**
 * Expande um conjunto inicial de celulas seguindo a reacao em cadeia: cada
 * especial atingido estoura tambem, e o que ele atinge pode estourar de novo.
 * `protectedIdx` sao celulas que vao virar um especial novo — elas sobrevivem
 * a fase e nao disparam (senao o especial se destruiria no instante em que
 * nasce).
 */
function expandBlast(grid, seeds, protectedIdx, overrides) {
  const cleared = new Set();
  const activations = [];
  const atingidos = new Set(); // obstaculos que levaram golpe direto
  const queue = [...seeds];

  while (queue.length) {
    const i = queue.pop();
    if (i == null || cleared.has(i)) continue;
    if (protectedIdx.has(i)) continue;
    const cell = grid[i];
    if (!cell) continue;

    // Obstaculo absorve: leva dano, nao some nesta passagem e nao propaga a
    // explosao adiante. E o que faz o lixo custar jogadas de verdade.
    if (isBlocked(cell)) {
      atingidos.add(i);
      continue;
    }

    cleared.add(i);

    const override = overrides.get(i);
    const special = override ? override.special : cell.special;
    if (!special || special === SPECIAL.NONE) continue;

    const target = override ? override.target : undefined;
    const cells = activationCells(grid, i, special, target);
    activations.push({ index: i, special, cells });
    for (const t of cells) queue.push(t);
  }

  return { cleared, activations, atingidos };
}

/**
 * Pedra e gelo nao entram em combinacao nenhuma, entao a unica forma de
 * quebra-los e um match ACONTECER AO LADO. Cadeado fica de fora: ele quebra
 * sendo combinado, nao por vizinhanca.
 */
function atingirVizinhos(grid, cleared, jaAtingidos) {
  const alvos = new Set(jaAtingidos);
  for (const i of cleared) {
    const r = rowOf(i);
    const c = colOf(i);
    const vizinhos = [
      [r - 1, c],
      [r + 1, c],
      [r, c - 1],
      [r, c + 1],
    ];
    for (const [rr, cc] of vizinhos) {
      if (!inBounds(rr, cc)) continue;
      const j = idx(rr, cc);
      if (quebraPorVizinhanca(grid[j])) alvos.add(j);
    }
  }
  return alvos;
}

/**
 * Aplica um golpe em cada obstaculo atingido nesta fase.
 *
 * No maximo UM golpe por fase por obstaculo, mesmo que dez pecas ao redor
 * sumam de uma vez. O jogador precisa conseguir prever quantas jogadas falta
 * para limpar aquilo; dano proporcional ao tamanho da explosao tornaria o
 * gelo imprevisivel.
 */
function aplicarDano(grid, alvos) {
  const danos = [];
  for (const i of alvos) {
    const cell = grid[i];
    if (!isBlocked(cell)) continue;

    cell.blocker.hp -= 1;
    const destruido = cell.blocker.hp <= 0;
    danos.push({ index: i, tipo: cell.blocker.tipo, hp: Math.max(0, cell.blocker.hp), destruido });

    if (!destruido) continue;
    if (cell.type === BLOCKED) {
      // Pedra e gelo nao tem peca por baixo: a casa fica vazia e a gravidade
      // reabastece.
      grid[i] = null;
    } else {
      // Cadeado liberta a peca, que continua no tabuleiro.
      delete cell.blocker;
    }
  }
  return danos;
}

// ---------------------------------------------------------------------------
// Fase de combinacao normal
// ---------------------------------------------------------------------------

function middleOf(cells) {
  return cells[(cells.length / 2) | 0];
}

function computeMatchPhase(grid) {
  const { hRuns, vRuns } = findRuns(grid);
  if (!hRuns.length && !vRuns.length) return null;

  const base = new Set();
  const created = [];
  const usedV = new Set();
  const taken = new Set();

  const addCreated = (index, special, type) => {
    if (taken.has(index)) return;
    taken.add(index);
    created.push({ index, special, type });
  };

  for (const h of hRuns) {
    for (const i of h.cells) base.add(i);

    // Cruzamento com uma vertical da mesma cor vira embrulhado (formato L / T).
    let cross = null;
    for (const v of vRuns) {
      if (usedV.has(v) || v.type !== h.type) continue;
      const shared = h.cells.find((i) => v.cells.includes(i));
      if (shared !== undefined) {
        cross = { run: v, at: shared };
        break;
      }
    }

    if (cross) {
      for (const i of cross.run.cells) base.add(i);
      usedV.add(cross.run);
      addCreated(cross.at, SPECIAL.WRAPPED, h.type);
    } else if (h.cells.length >= 5) {
      addCreated(middleOf(h.cells), SPECIAL.COLOR_BOMB, COLORLESS);
    } else if (h.cells.length === 4) {
      addCreated(middleOf(h.cells), SPECIAL.STRIPED_H, h.type);
    }
  }

  for (const v of vRuns) {
    if (usedV.has(v)) continue;
    for (const i of v.cells) base.add(i);
    if (v.cells.length >= 5) {
      addCreated(middleOf(v.cells), SPECIAL.COLOR_BOMB, COLORLESS);
    } else if (v.cells.length === 4) {
      addCreated(middleOf(v.cells), SPECIAL.STRIPED_V, v.type);
    }
  }

  return { base, created };
}

// ---------------------------------------------------------------------------
// Gravidade
// ---------------------------------------------------------------------------

/**
 * Gerador do reabastecimento desta coluna.
 *
 * Numa partida competitiva `rng` traz um gerador por coluna (ver
 * createMatchRandom), para os dois jogadores receberem a mesma sequencia de
 * pecas em cada coluna independentemente do ritmo de cada um. Fora dai — bot
 * simulando, teste — cai no gerador unico.
 */
function refillRng(rng, col) {
  return rng.column ? rng.column(col) : rng;
}

function applyGravity(grid, rng) {
  const falls = [];
  const spawns = [];

  for (let c = 0; c < COLS; c++) {
    let write = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      const i = idx(r, c);
      if (!grid[i]) continue;
      if (write !== r) {
        const to = idx(write, c);
        grid[to] = grid[i];
        grid[i] = null;
        falls.push({ from: i, to, id: grid[to].id });
      }
      write--;
    }
    // `height` diz de quantas casas acima do topo a peca nova cai, para o
    // renderer escalonar a queda em vez de todas surgirem juntas.
    const columnRng = refillRng(rng, c);
    let height = 1;
    for (let r = write; r >= 0; r--) {
      const cell = makeCell(columnRng.int(TYPE_COUNT));
      grid[idx(r, c)] = cell;
      spawns.push({ to: idx(r, c), id: cell.id, type: cell.type, height: height++ });
    }
  }

  return { falls, spawns };
}

// ---------------------------------------------------------------------------
// Resolucao completa
// ---------------------------------------------------------------------------

function scorePhase(clearedCount, activationCount, created, cascade) {
  let points = Math.round(clearedCount * POINTS_PER_CELL * (1 + (cascade - 1) * CASCADE_STEP));
  points += activationCount * ACTIVATION_BONUS;
  for (const c of created) points += CREATE_BONUS[c.special] || 0;
  return points;
}

/**
 * Resolve o tabuleiro ate estabilizar.
 * Devolve `{ phases, points, cascades }`, onde cada fase descreve uma rodada de
 * explosao + queda, na ordem em que devem ser animadas.
 */
export function resolve(grid, rng, options = {}) {
  const phases = [];
  let cascade = 0;
  let points = 0;
  let blast = options.initialBlast || null;

  while (cascade < MAX_CASCADES) {
    let base;
    let created;
    let overrides;

    if (blast) {
      base = new Set(blast.seeds);
      created = [];
      overrides = blast.overrides;
      blast = null;
    } else {
      const match = computeMatchPhase(grid);
      if (!match) break;
      base = match.base;
      created = match.created;
      overrides = new Map();
    }

    cascade++;
    const protectedIdx = new Set(created.map((c) => c.index));
    const { cleared, activations, atingidos } = expandBlast(grid, base, protectedIdx, overrides);

    const alvos = atingirVizinhos(grid, cleared, atingidos);
    const danos = aplicarDano(grid, alvos);

    const phasePoints =
      scorePhase(cleared.size, activations.length, created, cascade) + danos.length * BLOCKER_POINTS;
    points += phasePoints;

    for (const i of cleared) grid[i] = null;
    // O especial novo herda o id da peca que estava ali, para o renderer poder
    // animar a transformacao no lugar em vez de trocar de sprite.
    for (const c of created) {
      const existing = grid[c.index];
      grid[c.index] = {
        id: existing ? existing.id : nextCellId++,
        type: c.type,
        special: c.special,
      };
    }

    const { falls, spawns } = applyGravity(grid, rng);

    phases.push({
      cascade,
      cleared: [...cleared],
      activations,
      created,
      danos,
      points: phasePoints,
      falls,
      spawns,
    });
  }

  return { phases, points, cascades: cascade };
}

/**
 * Tenta trocar duas pecas. Se a troca nao gerar nada, o tabuleiro volta ao
 * estado anterior e `ok` vem false — quem chamou anima o "vai e volta".
 */
export function trySwap(grid, a, b, rng) {
  if (!areAdjacent(a, b)) return { ok: false, reason: 'nao-adjacente' };
  if (!grid[a] || !grid[b]) return { ok: false, reason: 'celula-vazia' };
  if (isBlocked(grid[a]) || isBlocked(grid[b])) return { ok: false, reason: 'bloqueada' };

  swapInPlace(grid, a, b);

  const blast = buildComboBlast(grid, a, b);
  if (blast) {
    const result = resolve(grid, rng, { initialBlast: blast });
    return { ok: true, comboKind: blast.kind, ...result };
  }

  if (!hasAnyRun(grid)) {
    swapInPlace(grid, a, b);
    return { ok: false, reason: 'sem-combinacao' };
  }

  const result = resolve(grid, rng);
  return { ok: true, comboKind: null, ...result };
}

/**
 * Estado do tabuleiro em forma compacta, para a miniatura do adversario.
 * Obstaculo vira um codigo proprio, fora da faixa das cores: quem assiste
 * precisa ver o lixo acumulando no tabuleiro alheio, e nunca pode receber um
 * valor negativo, que a miniatura nao saberia pintar.
 */
export function serializeTypes(grid) {
  return grid.map((c) => {
    if (!c) return 0;
    if (isBlocked(c)) return BLOCKED_MINI;
    return c.type >= 0 ? c.type : 0;
  });
}

// ---------------------------------------------------------------------------
// Lixo
// ---------------------------------------------------------------------------

/**
 * Coloca obstaculos no tabuleiro (o lixo que o ataque do adversario vira).
 *
 * Evita a linha de baixo: obstaculo la embaixo trava a coluna inteira e e
 * quase impossivel de alcancar. Nunca empilha obstaculo sobre obstaculo, e no
 * fim garante que ainda exista jogada — receber lixo tem de doer, nao tem de
 * travar a partida.
 *
 * Devolve as posicoes ocupadas, para o renderer animar a chegada.
 */
export function injectGarbage(grid, quantidade, tipo, rng) {
  if (quantidade <= 0) return [];

  const candidatas = [];
  for (let r = 0; r < ROWS - 1; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = idx(r, c);
      if (grid[i] && !isBlocked(grid[i])) candidatas.push(i);
    }
  }
  if (!candidatas.length) return [];

  // Fisher-Yates parcial com o gerador semeado: precisa ser reproduzivel no
  // replay como qualquer outra decisao de regra.
  const total = Math.min(quantidade, candidatas.length);
  for (let k = 0; k < total; k++) {
    const j = k + rng.int(candidatas.length - k);
    const t = candidatas[k];
    candidatas[k] = candidatas[j];
    candidatas[j] = t;
  }

  const colocados = [];
  for (let k = 0; k < total; k++) {
    const i = candidatas[k];
    const hp = BLOCKER_HP[tipo] || 1;
    if (tipo === BLOCKER.CADEADO) {
      // Cadeado mantem a peca e a cor; so prende no lugar.
      grid[i] = { ...grid[i], blocker: { tipo, hp } };
    } else {
      grid[i] = { id: nextCellId++, type: BLOCKED, special: SPECIAL.NONE, blocker: { tipo, hp } };
    }
    colocados.push({ index: i, tipo, hp });
  }

  // O lixo pode ter tapado a ultima jogada possivel.
  if (!hasValidMove(grid)) shuffleGrid(grid, rng);
  return colocados;
}
