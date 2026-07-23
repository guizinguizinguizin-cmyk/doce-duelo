// Obstaculos: pedra, gelo e cadeado.
//
// Os tres precisam ter papeis DISTINTOS, senao um deles e so o outro com um
// numero diferente. O que os separa:
//
//   pedra    espaco morto, quebra com um match ao lado
//   gelo     igual a pedra, mas teimoso (dois toques)
//   cadeado  mantem a cor e COMBINA no lugar; so nao pode ser movido

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, createMatchRandom } from '../src/core/rng.js';
import {
  COLS,
  ROWS,
  CELL_COUNT,
  SPECIAL,
  BLOCKED,
  BLOCKER,
  BLOCKER_HP,
  isBlocked,
  createGrid,
  findRuns,
  findMove,
  allMoves,
  hasValidMove,
  shuffleGrid,
  resolve,
  trySwap,
  cloneGrid,
  serializeTypes,
  injectGarbage,
  idx,
  rowOf,
} from '../src/core/board.js';

let proximoId = 5000;

function comObstaculo(grid, i, tipo) {
  const hp = BLOCKER_HP[tipo];
  if (tipo === BLOCKER.CADEADO) {
    grid[i] = { ...grid[i], blocker: { tipo, hp } };
  } else {
    grid[i] = { id: proximoId++, type: BLOCKED, special: SPECIAL.NONE, blocker: { tipo, hp } };
  }
  return grid;
}

function gridFrom(rows) {
  const grid = new Array(CELL_COUNT);
  let id = 1;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      grid[idx(r, c)] = { id: id++, type: Number(rows[r][c]), special: SPECIAL.NONE };
    }
  }
  return grid;
}

const NEUTRO = [
  '01234501',
  '12345012',
  '23450123',
  '34501234',
  '45012345',
  '50123450',
  '01234501',
  '12345012',
];

// ---------------------------------------------------------------------------
// Nao se move
// ---------------------------------------------------------------------------

test('nenhum obstaculo pode ser arrastado', () => {
  for (const tipo of [BLOCKER.PEDRA, BLOCKER.GELO, BLOCKER.CADEADO]) {
    const grid = gridFrom(NEUTRO);
    comObstaculo(grid, idx(4, 4), tipo);

    const resultado = trySwap(grid, idx(4, 4), idx(4, 5), createRng(1));
    assert.equal(resultado.ok, false, `${tipo} deixou ser arrastado`);
    assert.equal(resultado.reason, 'bloqueada');

    // Nem puxando o vizinho para cima dele.
    const inverso = trySwap(grid, idx(4, 5), idx(4, 4), createRng(1));
    assert.equal(inverso.ok, false, `${tipo} deixou ser arrastado pelo vizinho`);
  }
});

test('nenhuma jogada sugerida envolve casa bloqueada', () => {
  for (let semente = 0; semente < 25; semente++) {
    const rng = createMatchRandom(semente, COLS);
    const grid = createGrid(rng);
    injectGarbage(grid, 8, BLOCKER.PEDRA, rng);
    injectGarbage(grid, 4, BLOCKER.CADEADO, rng);

    for (const move of allMoves(grid)) {
      assert.equal(isBlocked(grid[move.a]), false, `semente ${semente}: allMoves sugeriu casa bloqueada`);
      assert.equal(isBlocked(grid[move.b]), false, `semente ${semente}: allMoves sugeriu casa bloqueada`);
    }

    const uma = findMove(grid);
    if (uma) {
      assert.equal(isBlocked(grid[uma.a]), false, `semente ${semente}: findMove sugeriu casa bloqueada`);
      assert.equal(isBlocked(grid[uma.b]), false, `semente ${semente}: findMove sugeriu casa bloqueada`);
    }
  }
});

// ---------------------------------------------------------------------------
// Pedra
// ---------------------------------------------------------------------------

test('pedra nao entra em combinacao nenhuma', () => {
  const grid = gridFrom(NEUTRO);
  // Tres pedras em linha nao podem formar sequencia.
  comObstaculo(grid, idx(2, 2), BLOCKER.PEDRA);
  comObstaculo(grid, idx(2, 3), BLOCKER.PEDRA);
  comObstaculo(grid, idx(2, 4), BLOCKER.PEDRA);

  const { hRuns, vRuns } = findRuns(grid);
  const tocaPedra = [...hRuns, ...vRuns].some((run) => run.cells.some((i) => isBlocked(grid[i])));
  assert.equal(tocaPedra, false, 'pedra nao pode formar sequencia');
});

/**
 * Cenario controlado: trinca VERTICAL de tipo 1 na coluna 2 (linhas 2 a 4), e
 * o obstaculo encostado nela em (3,1).
 *
 * A primeira versao deste teste usava um tabuleiro cuja coluna 0 era toda de
 * zeros — uma sequencia de sete. O obstaculo estava sendo COMBINADO, nao
 * atingido por vizinhanca, e o teste passava medindo outra coisa.
 */
function cenarioVizinhanca(tipo) {
  const grid = gridFrom(NEUTRO);
  grid[idx(2, 2)].type = 1;
  grid[idx(3, 2)].type = 1;
  grid[idx(4, 2)].type = 1;
  comObstaculo(grid, idx(3, 1), tipo);

  // Garante que o obstaculo nao entrou em sequencia nenhuma por acaso.
  const { hRuns, vRuns } = findRuns(grid);
  const combinado = [...hRuns, ...vRuns].some((run) => run.cells.includes(idx(3, 1)));
  assert.equal(combinado, false, 'o cenario nao pode combinar o proprio obstaculo');

  return grid;
}

const contarPorTipo = (grid, tipo) =>
  grid.filter((c) => isBlocked(c) && c.blocker.tipo === tipo).length;

test('pedra quebra com um match ao lado', () => {
  const grid = cenarioVizinhanca(BLOCKER.PEDRA);

  const { phases } = resolve(grid, createRng(2));
  const dano = phases[0].danos.find((d) => d.index === idx(3, 1));

  assert.ok(dano, 'a pedra ao lado da combinacao deveria levar dano');
  assert.equal(dano.tipo, BLOCKER.PEDRA);
  assert.equal(dano.destruido, true, 'pedra some com um toque');
  assert.equal(contarPorTipo(grid, BLOCKER.PEDRA), 0, 'nao deveria sobrar pedra no tabuleiro');
});

test('pedra longe da combinacao continua intacta', () => {
  const grid = gridFrom(NEUTRO);
  grid[idx(2, 2)].type = 1;
  grid[idx(3, 2)].type = 1;
  grid[idx(4, 2)].type = 1;
  comObstaculo(grid, idx(7, 7), BLOCKER.PEDRA);

  resolve(grid, createRng(3));
  assert.equal(contarPorTipo(grid, BLOCKER.PEDRA), 1, 'pedra no canto oposto nao deveria ser atingida');
});

// ---------------------------------------------------------------------------
// Gelo
// ---------------------------------------------------------------------------

test('gelo aguenta dois toques', () => {
  const grid = cenarioVizinhanca(BLOCKER.GELO);

  const { phases } = resolve(grid, createRng(4));
  const dano = phases[0].danos.find((d) => d.index === idx(3, 1));

  assert.ok(dano, 'o gelo deveria levar o primeiro toque');
  assert.equal(dano.destruido, false, 'gelo nao pode sumir no primeiro toque');
  assert.equal(dano.hp, 1, 'deveria restar uma camada');

  // Procurado por tipo, nao por posicao: a cascata pode ter feito o gelo cair.
  assert.equal(contarPorTipo(grid, BLOCKER.GELO), 1, 'o gelo continua no tabuleiro');
});

test('o segundo toque destroi o gelo', () => {
  const grid = cenarioVizinhanca(BLOCKER.GELO);
  grid[idx(3, 1)].blocker.hp = 1; // ja levou um toque antes

  const { phases } = resolve(grid, createRng(41));
  const dano = phases[0].danos.find((d) => d.index === idx(3, 1));

  assert.ok(dano, 'o gelo deveria levar o toque final');
  assert.equal(dano.destruido, true, 'com uma camada restante, o toque destroi');
  assert.equal(contarPorTipo(grid, BLOCKER.GELO), 0, 'nao deveria sobrar gelo');
});

test('um golpe por fase, mesmo com explosao grande em volta', () => {
  // Uma explosao enorme nao pode vaporizar o gelo de uma vez: o jogador tem de
  // conseguir contar quantas jogadas faltam.
  const grid = gridFrom(NEUTRO);
  comObstaculo(grid, idx(4, 4), BLOCKER.GELO);
  grid[idx(4, 3)] = { id: 9001, type: 0, special: SPECIAL.WRAPPED };
  grid[idx(4, 2)] = { id: 9002, type: 0, special: SPECIAL.WRAPPED };

  const resultado = trySwap(grid, idx(4, 2), idx(4, 3), createRng(5));
  assert.equal(resultado.ok, true);

  const danos = resultado.phases[0].danos.filter((d) => d.index === idx(4, 4));
  assert.equal(danos.length, 1, 'o gelo so pode levar um golpe nesta fase');
});

// ---------------------------------------------------------------------------
// Cadeado
// ---------------------------------------------------------------------------

test('cadeado mantem a cor e combina no lugar', () => {
  const grid = gridFrom(NEUTRO);
  // Linha 2 recebe tres pecas do tipo 4, a do meio trancada.
  grid[idx(2, 1)].type = 4;
  grid[idx(2, 2)].type = 4;
  grid[idx(2, 3)].type = 4;
  comObstaculo(grid, idx(2, 2), BLOCKER.CADEADO);

  assert.equal(grid[idx(2, 2)].type, 4, 'o cadeado nao apaga a cor da peca');

  const { hRuns } = findRuns(grid);
  const naSequencia = hRuns.some((run) => run.cells.includes(idx(2, 2)));
  assert.equal(naSequencia, true, 'peca trancada ainda combina');

  const { phases } = resolve(grid, createRng(6));
  const dano = phases[0].danos.find((d) => d.index === idx(2, 2));
  assert.ok(dano, 'a combinacao deveria quebrar o cadeado');
  assert.equal(dano.destruido, true);
});

test('cadeado nao quebra so por vizinhanca', () => {
  // Combinacao AO LADO do cadeado, sem inclui-lo: ele tem de continuar preso.
  // E isso que separa o cadeado da pedra.
  const grid = cenarioVizinhanca(BLOCKER.CADEADO);

  resolve(grid, createRng(7));
  assert.equal(
    contarPorTipo(grid, BLOCKER.CADEADO),
    1,
    'cadeado nao pode quebrar por vizinhanca — so sendo combinado'
  );
});

// ---------------------------------------------------------------------------
// Interacao com especiais
// ---------------------------------------------------------------------------

test('explosao de especial danifica o obstaculo que alcanca', () => {
  const grid = gridFrom(NEUTRO);
  comObstaculo(grid, idx(4, 0), BLOCKER.PEDRA);
  grid[idx(4, 4)] = { id: 9100, type: 0, special: SPECIAL.STRIPED_H };
  grid[idx(4, 5)] = { id: 9101, type: 0, special: SPECIAL.STRIPED_H };

  const resultado = trySwap(grid, idx(4, 4), idx(4, 5), createRng(8));
  assert.equal(resultado.ok, true);

  const dano = resultado.phases[0].danos.find((d) => d.index === idx(4, 0));
  assert.ok(dano, 'a listrada varre a linha e deveria atingir a pedra');
});

test('a explosao nao atravessa o obstaculo para encadear', () => {
  // A pedra absorve: ela nao propaga a explosao adiante.
  const grid = gridFrom(NEUTRO);
  comObstaculo(grid, idx(4, 4), BLOCKER.PEDRA);

  const { phases } = resolve(grid, createRng(9));
  for (const fase of phases || []) {
    for (const ativacao of fase.activations) {
      assert.notEqual(ativacao.index, idx(4, 4), 'obstaculo nao pode disparar explosao');
    }
  }
});

// ---------------------------------------------------------------------------
// Embaralhamento
// ---------------------------------------------------------------------------

test('embaralhar nunca move um obstaculo de lugar', () => {
  for (let semente = 0; semente < 20; semente++) {
    const rng = createMatchRandom(semente + 40, COLS);
    const grid = createGrid(rng);
    injectGarbage(grid, 6, BLOCKER.PEDRA, rng);

    const posicoes = [];
    for (let i = 0; i < CELL_COUNT; i++) if (isBlocked(grid[i])) posicoes.push(i);
    assert.ok(posicoes.length > 0);

    shuffleGrid(grid, rng);

    for (const i of posicoes) {
      assert.equal(
        isBlocked(grid[i]),
        true,
        `semente ${semente}: o obstaculo saiu da posicao ${i} ao embaralhar`
      );
    }
    const depois = grid.filter(isBlocked).length;
    assert.equal(depois, posicoes.length, `semente ${semente}: mudou a quantidade de obstaculos`);
  }
});

// ---------------------------------------------------------------------------
// Injecao de lixo
// ---------------------------------------------------------------------------

test('o lixo entra na quantidade pedida, sem empilhar', () => {
  const rng = createMatchRandom(123, COLS);
  const grid = createGrid(rng);

  const colocados = injectGarbage(grid, 7, BLOCKER.PEDRA, rng);
  assert.equal(colocados.length, 7);

  const indices = new Set(colocados.map((c) => c.index));
  assert.equal(indices.size, 7, 'nao pode colocar dois obstaculos na mesma casa');
  assert.equal(grid.filter(isBlocked).length, 7);
});

test('o lixo nunca cai na ultima linha', () => {
  // Obstaculo no chao trava a coluna inteira e e quase inalcancavel.
  for (let semente = 0; semente < 20; semente++) {
    const rng = createMatchRandom(semente + 700, COLS);
    const grid = createGrid(rng);
    injectGarbage(grid, 12, BLOCKER.PEDRA, rng);

    for (let c = 0; c < COLS; c++) {
      assert.equal(
        isBlocked(grid[idx(ROWS - 1, c)]),
        false,
        `semente ${semente}: obstaculo na ultima linha, coluna ${c}`
      );
    }
  }
});

test('o tabuleiro continua jogavel depois de receber lixo', () => {
  for (let semente = 0; semente < 30; semente++) {
    const rng = createMatchRandom(semente + 200, COLS);
    const grid = createGrid(rng);

    injectGarbage(grid, 10, BLOCKER.PEDRA, rng);
    assert.equal(hasValidMove(grid), true, `semente ${semente}: o lixo travou a partida`);

    injectGarbage(grid, 6, BLOCKER.CADEADO, rng);
    assert.equal(hasValidMove(grid), true, `semente ${semente}: o cadeado travou a partida`);
  }
});

test('injetar mais lixo do que cabe nao quebra nada', () => {
  const rng = createMatchRandom(4242, COLS);
  const grid = createGrid(rng);

  const colocados = injectGarbage(grid, 999, BLOCKER.PEDRA, rng);
  assert.ok(colocados.length <= CELL_COUNT);
  assert.equal(grid.filter(Boolean).length, CELL_COUNT, 'nao pode sobrar buraco');
});

// ---------------------------------------------------------------------------
// Integridade com obstaculos em jogo
// ---------------------------------------------------------------------------

test('clonar o tabuleiro preserva os obstaculos', () => {
  // O bot avalia jogadas em copias: se o clone perder os obstaculos, ele
  // planeja num tabuleiro que nao existe.
  const rng = createMatchRandom(31, COLS);
  const grid = createGrid(rng);
  injectGarbage(grid, 5, BLOCKER.GELO, rng);

  const copia = cloneGrid(grid);
  for (let i = 0; i < CELL_COUNT; i++) {
    assert.equal(isBlocked(copia[i]), isBlocked(grid[i]), `posicao ${i} perdeu o obstaculo no clone`);
    if (isBlocked(grid[i])) {
      assert.equal(copia[i].blocker.tipo, grid[i].blocker.tipo);
      assert.equal(copia[i].blocker.hp, grid[i].blocker.hp);
    }
  }

  // E o clone tem de ser independente.
  copia[0] = null;
  assert.ok(grid[0], 'mexer no clone nao pode afetar o original');
});

test('a miniatura do adversario sabe pintar obstaculo', () => {
  const rng = createMatchRandom(55, COLS);
  const grid = createGrid(rng);
  injectGarbage(grid, 9, BLOCKER.PEDRA, rng);

  const tipos = serializeTypes(grid);
  assert.equal(tipos.length, CELL_COUNT);
  for (const t of tipos) {
    assert.ok(Number.isInteger(t) && t >= 0, `codigo impintavel: ${t}`);
  }
  assert.ok(tipos.some((t) => t === 6), 'obstaculo precisa de um codigo proprio na miniatura');
});

test('jogar com o tabuleiro sujo nunca quebra os invariantes', () => {
  for (let semente = 0; semente < 25; semente++) {
    const rng = createMatchRandom(semente + 3000, COLS);
    const grid = createGrid(rng);
    injectGarbage(grid, 8, BLOCKER.PEDRA, rng);
    injectGarbage(grid, 4, BLOCKER.GELO, rng);
    injectGarbage(grid, 4, BLOCKER.CADEADO, rng);

    for (let jogada = 0; jogada < 20; jogada++) {
      const move = findMove(grid);
      if (!move) {
        shuffleGrid(grid, rng);
        continue;
      }

      const resultado = trySwap(grid, move.a, move.b, rng);
      assert.equal(resultado.ok, true, `semente ${semente}: jogada sugerida foi recusada`);

      const ids = new Set();
      for (let i = 0; i < CELL_COUNT; i++) {
        assert.ok(grid[i], `semente ${semente} jogada ${jogada}: buraco em ${i}`);
        assert.equal(ids.has(grid[i].id), false, `semente ${semente}: id repetido em ${i}`);
        ids.add(grid[i].id);

        // Peca sem cor so pode ser bomba colorida ou obstaculo.
        if (grid[i].type < 0) {
          const permitido = grid[i].special === SPECIAL.COLOR_BOMB || isBlocked(grid[i]);
          assert.ok(permitido, `semente ${semente}: peca sem cor invalida em ${i}`);
        }
      }

      // Injeta mais lixo no meio da partida, como um ataque faria.
      if (jogada % 7 === 6) injectGarbage(grid, 2, BLOCKER.PEDRA, rng);
    }
  }
});
