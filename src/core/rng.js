// Gerador de numeros pseudo-aleatorios deterministico (mulberry32).
//
// Math.random() nao pode ser semeado, e o jogo precisa disso em dois lugares:
// o bot simula jogadas sem contaminar o sorteio da partida real, e um bug de
// tabuleiro so e reproduzivel se a semente que o gerou puder ser reaplicada.

export function createRng(seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0) {
  let state = seed >>> 0;

  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    /** Float em [0, 1). */
    next,
    /** Inteiro em [0, n). */
    int: (n) => Math.floor(next() * n),
    /** Elemento aleatorio de um array (undefined se vazio). */
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    /** Semente atual, para logar/reproduzir uma partida. */
    get seed() {
      return seed >>> 0;
    },
    /** Copia independente no estado atual: usada pelo bot para simular. */
    fork: () => createRng(state),
  };
}

/** Mistura duas sementes em uma terceira, bem distribuida. */
function mixSeed(seed, salt) {
  let h = (seed ^ (salt * 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Aleatoriedade de uma partida competitiva: um gerador por COLUNA.
 *
 * O motivo e justica. Se os dois jogadores compartilhassem um unico gerador
 * com a mesma semente, eles teriam o mesmo tabuleiro inicial e o mesmo fluxo
 * de pecas — mas consumiriam esse fluxo em ritmos diferentes. Quem faz uma
 * cascata de 5 puxa 30 pecas enquanto o outro puxa 12, e a partir dai os
 * tabuleiros divergem: a "mesma oportunidade" dura uns 20 segundos e acaba.
 *
 * Com um gerador por coluna, a coluna 3 entrega exatamente a mesma sequencia
 * de doces para os dois jogadores, nao importa QUANDO cada um consome. A
 * justica vale a partida inteira, que e o que um jogo competitivo precisa.
 */
export function createMatchRandom(seed, columnCount) {
  const main = createRng(seed);
  const columns = [];
  for (let c = 0; c < columnCount; c++) columns.push(createRng(mixSeed(seed, c + 1)));

  return {
    seed: seed >>> 0,
    next: main.next,
    int: main.int,
    pick: main.pick,
    fork: main.fork,
    /** Gerador dedicado ao reabastecimento de uma coluna. */
    column: (c) => columns[c] || main,
  };
}
