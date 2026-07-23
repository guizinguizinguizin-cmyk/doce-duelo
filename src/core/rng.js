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
