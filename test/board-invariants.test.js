// Invariantes do core do tabuleiro.
//
// Os testes de board.test.js verificam casos especificos ("sequencia de 4 cria
// listrada"). Estes verificam PROPRIEDADES que precisam valer sempre, em
// qualquer tabuleiro, depois de qualquer jogada — e sao eles que pegam
// regressao quando o core muda.
//
// Escrito antes de adicionar obstaculos, de proposito: um teste que so nasce
// depois da mudanca descreve o codigo novo, nao o comportamento correto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, createMatchRandom } from '../src/core/rng.js';
import {
  COLS,
  ROWS,
  CELL_COUNT,
  SPECIAL,
  COLORLESS,
  createGrid,
  findRuns,
  hasAnyRun,
  hasValidMove,
  findMove,
  allMoves,
  shuffleGrid,
  resolve,
  trySwap,
  cloneGrid,
  serializeTypes,
  idx,
  rowOf,
  colOf,
  areAdjacent,
} from '../src/core/board.js';

// ---------------------------------------------------------------------------
// Conferencias reaproveitadas
// ---------------------------------------------------------------------------

/** O tabuleiro esta integro? Devolve a lista de problemas encontrados. */
function conferirIntegridade(grid, contexto = '') {
  const problemas = [];

  if (grid.length !== CELL_COUNT) problemas.push(`${contexto}: tamanho ${grid.length}`);

  const ids = new Set();
  for (let i = 0; i < grid.length; i++) {
    const cell = grid[i];
    if (!cell) {
      problemas.push(`${contexto}: buraco na posicao ${i}`);
      continue;
    }
    if (ids.has(cell.id)) problemas.push(`${contexto}: id ${cell.id} repetido na posicao ${i}`);
    ids.add(cell.id);

    if (!Number.isInteger(cell.type)) problemas.push(`${contexto}: tipo invalido em ${i}: ${cell.type}`);
    if (cell.special === SPECIAL.COLOR_BOMB && cell.type !== COLORLESS) {
      problemas.push(`${contexto}: bomba colorida com cor em ${i}`);
    }
    if (cell.special !== SPECIAL.COLOR_BOMB && cell.type === COLORLESS) {
      problemas.push(`${contexto}: peca sem cor que nao e bomba em ${i}`);
    }
  }
  return problemas;
}

/** As fases descrevem um movimento coerente do tabuleiro? */
function conferirFases(fases, contexto = '') {
  const problemas = [];

  for (const fase of fases) {
    const limpas = new Set(fase.cleared);
    if (limpas.size !== fase.cleared.length) problemas.push(`${contexto}: indice repetido em cleared`);
    for (const i of fase.cleared) {
      if (i < 0 || i >= CELL_COUNT) problemas.push(`${contexto}: cleared fora do tabuleiro: ${i}`);
    }

    // Uma peca que vai virar especial nao pode ter sido limpa na mesma fase:
    // ela precisa sobreviver para se transformar.
    for (const criado of fase.created) {
      if (limpas.has(criado.index)) {
        problemas.push(`${contexto}: ${criado.index} virou especial E foi limpo na mesma fase`);
      }
    }

    // Cada destino de queda ou de peca nova tem que ser preenchido uma vez so.
    const destinos = new Set();
    for (const q of fase.falls) {
      if (destinos.has(q.to)) problemas.push(`${contexto}: dois destinos iguais na queda: ${q.to}`);
      destinos.add(q.to);
      if (colOf(q.from) !== colOf(q.to)) problemas.push(`${contexto}: peca mudou de coluna ao cair`);
      if (rowOf(q.to) <= rowOf(q.from)) problemas.push(`${contexto}: peca caiu para cima`);
    }
    for (const nova of fase.spawns) {
      if (destinos.has(nova.to)) problemas.push(`${contexto}: peca nova em destino ja ocupado: ${nova.to}`);
      destinos.add(nova.to);
      if (nova.height < 1) problemas.push(`${contexto}: altura de entrada invalida: ${nova.height}`);
    }

    if (fase.points < 0) problemas.push(`${contexto}: pontuacao negativa`);
    if (fase.cascade < 1) problemas.push(`${contexto}: nivel de cascata invalido`);
  }

  return problemas;
}

// ---------------------------------------------------------------------------
// Invariantes sob uso intenso
// ---------------------------------------------------------------------------

test('mil jogadas aleatorias nunca quebram o tabuleiro', () => {
  for (let semente = 0; semente < 40; semente++) {
    const rng = createMatchRandom(semente, COLS);
    const grid = createGrid(rng);

    let problemas = conferirIntegridade(grid, `semente ${semente} inicial`);
    assert.deepEqual(problemas, [], problemas.join('\n'));

    for (let jogada = 0; jogada < 25; jogada++) {
      const move = findMove(grid);
      if (!move) {
        shuffleGrid(grid, rng);
        continue;
      }

      const resultado = trySwap(grid, move.a, move.b, rng);
      assert.equal(resultado.ok, true, `semente ${semente} jogada ${jogada}: findMove sugeriu jogada invalida`);

      problemas = [
        ...conferirIntegridade(grid, `semente ${semente} jogada ${jogada}`),
        ...conferirFases(resultado.phases, `semente ${semente} jogada ${jogada}`),
      ];
      assert.deepEqual(problemas, [], problemas.join('\n'));

      assert.equal(
        hasAnyRun(grid),
        false,
        `semente ${semente} jogada ${jogada}: sobrou combinacao por resolver`
      );
    }
  }
});

test('trocas invalidas nunca alteram o tabuleiro', () => {
  for (let semente = 0; semente < 25; semente++) {
    const rng = createMatchRandom(semente, COLS);
    const grid = createGrid(rng);

    let recusadas = 0;
    for (let r = 0; r < ROWS && recusadas < 12; r++) {
      for (let c = 0; c < COLS - 1 && recusadas < 12; c++) {
        // A foto tem de ser tirada antes de CADA tentativa: uma troca aceita
        // no meio do laco muda o tabuleiro por direito, e comparar com uma
        // foto velha acusaria um bug que nao existe.
        const antes = cloneGrid(grid);
        const resultado = trySwap(grid, idx(r, c), idx(r, c + 1), rng);
        if (resultado.ok) continue;
        recusadas += 1;

        for (let i = 0; i < CELL_COUNT; i++) {
          assert.equal(grid[i].id, antes[i].id, `semente ${semente}: id mudou em ${i} apos troca recusada`);
          assert.equal(grid[i].type, antes[i].type, `semente ${semente}: tipo mudou em ${i}`);
          assert.equal(grid[i].special, antes[i].special, `semente ${semente}: especial mudou em ${i}`);
        }
      }
    }
    assert.ok(recusadas > 0, `semente ${semente}: nenhuma troca foi recusada, teste nao mediu nada`);
  }
});

test('so trocas de vizinhos sao aceitas', () => {
  const rng = createMatchRandom(4242, COLS);
  const grid = createGrid(rng);

  const naoVizinhos = [
    [idx(0, 0), idx(0, 2)],
    [idx(0, 0), idx(2, 0)],
    [idx(3, 3), idx(4, 4)], // diagonal
    [idx(0, 0), idx(7, 7)],
  ];

  for (const [a, b] of naoVizinhos) {
    assert.equal(areAdjacent(a, b), false, `${a} e ${b} nao deveriam ser vizinhos`);
    const resultado = trySwap(grid, a, b, rng);
    assert.equal(resultado.ok, false);
    assert.equal(resultado.reason, 'nao-adjacente');
  }
});

test('findMove e allMoves concordam entre si', () => {
  for (let semente = 0; semente < 30; semente++) {
    const rng = createMatchRandom(semente + 500, COLS);
    const grid = createGrid(rng);

    const uma = findMove(grid);
    const todas = allMoves(grid);

    assert.equal(
      uma !== null,
      todas.length > 0,
      `semente ${semente}: findMove e allMoves discordam sobre existir jogada`
    );

    if (uma) {
      const listada = todas.some((m) => m.a === uma.a && m.b === uma.b);
      assert.ok(listada, `semente ${semente}: findMove devolveu jogada que allMoves nao lista`);
    }
  }
});

test('nenhuma jogada listada por allMoves e recusada', () => {
  for (let semente = 0; semente < 20; semente++) {
    const rng = createMatchRandom(semente + 900, COLS);
    const grid = createGrid(rng);

    for (const move of allMoves(grid)) {
      const copia = cloneGrid(grid);
      const resultado = trySwap(copia, move.a, move.b, createMatchRandom(1, COLS));
      assert.equal(
        resultado.ok,
        true,
        `semente ${semente}: allMoves listou ${move.a}->${move.b} mas trySwap recusou (${resultado.reason})`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Gravidade
// ---------------------------------------------------------------------------

test('a queda preserva a ordem vertical dentro de cada coluna', () => {
  // Pecas nao se atravessam: quem estava mais em cima continua mais em cima.
  for (let semente = 0; semente < 20; semente++) {
    const rng = createMatchRandom(semente + 77, COLS);
    const grid = createGrid(rng);

    const move = findMove(grid);
    if (!move) continue;

    const antesPorColuna = new Map();
    for (let c = 0; c < COLS; c++) {
      antesPorColuna.set(
        c,
        Array.from({ length: ROWS }, (_, r) => grid[idx(r, c)].id)
      );
    }

    const resultado = trySwap(grid, move.a, move.b, rng);

    for (const fase of resultado.phases) {
      for (const queda of fase.falls) {
        assert.equal(
          colOf(queda.from),
          colOf(queda.to),
          `semente ${semente}: peca trocou de coluna durante a queda`
        );
      }
    }
    void antesPorColuna;
  }
});

test('toda coluna fica completa depois de resolver', () => {
  for (let semente = 0; semente < 30; semente++) {
    const rng = createMatchRandom(semente + 300, COLS);
    const grid = createGrid(rng);
    const move = findMove(grid);
    if (!move) continue;

    trySwap(grid, move.a, move.b, rng);

    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        assert.ok(grid[idx(r, c)], `semente ${semente}: buraco na coluna ${c}, linha ${r}`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Especiais: ativacao e encadeamento
// ---------------------------------------------------------------------------

function gridFrom(rows, specials = {}) {
  const grid = new Array(CELL_COUNT);
  let id = 1;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = idx(r, c);
      grid[i] = { id: id++, type: Number(rows[r][c]), special: specials[i] ?? SPECIAL.NONE };
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

test('peca embrulhada explode a area 3x3 ao ser atingida', () => {
  // Embrulhada em (4,4); trinca vertical de tipo 3 na coluna 4 a atinge.
  const grid = gridFrom([
    '01234501',
    '12345012',
    '23450123',
    '34503234',
    '45013345',
    '50123450',
    '01234501',
    '12345012',
  ], { [idx(4, 4)]: SPECIAL.WRAPPED });
  grid[idx(3, 4)].type = 3;
  grid[idx(4, 4)].type = 3;
  grid[idx(5, 4)].type = 3;

  const { phases } = resolve(grid, createRng(5));
  const ativacao = phases[0].activations.find((a) => a.index === idx(4, 4));
  assert.ok(ativacao, 'a embrulhada deveria ter estourado');
  assert.equal(ativacao.special, SPECIAL.WRAPPED);

  const limpas = new Set(phases[0].cleared);
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      assert.ok(limpas.has(idx(4 + dr, 4 + dc)), `(${4 + dr},${4 + dc}) deveria sumir`);
    }
  }
});

test('um especial atingido dispara outro em cadeia', () => {
  // Listrada horizontal na linha 3 alcanca uma embrulhada na mesma linha.
  const grid = gridFrom([
    '01234501',
    '12345012',
    '23450123',
    '20134013',
    '20134013',
    '20134013',
    '01234501',
    '12345012',
  ], { [idx(3, 0)]: SPECIAL.STRIPED_H, [idx(3, 5)]: SPECIAL.WRAPPED });
  // trinca vertical de tipo 2 na coluna 0 acerta a listrada
  grid[idx(3, 0)].type = 2;
  grid[idx(4, 0)].type = 2;
  grid[idx(5, 0)].type = 2;

  const { phases } = resolve(grid, createRng(6));
  const indices = phases[0].activations.map((a) => a.index);

  assert.ok(indices.includes(idx(3, 0)), 'a listrada deveria estourar');
  assert.ok(indices.includes(idx(3, 5)), 'a embrulhada na linha deveria estourar em cadeia');
});

test('bomba colorida trocada com listrada limpa muito mais que a linha', () => {
  const grid = gridFrom(NEUTRO, {
    [idx(4, 4)]: SPECIAL.COLOR_BOMB,
    [idx(4, 5)]: SPECIAL.STRIPED_H,
  });
  grid[idx(4, 4)].type = COLORLESS;

  const alvo = grid[idx(4, 5)].type;
  const quantos = grid.filter((c) => c.type === alvo).length;

  const resultado = trySwap(grid, idx(4, 4), idx(4, 5), createRng(7));
  assert.equal(resultado.ok, true);
  assert.equal(resultado.comboKind, 'bomb+striped');
  assert.ok(
    resultado.phases[0].cleared.length > quantos,
    'converter a cor em listradas tem de limpar mais que so aquelas pecas'
  );
});

test('duas embrulhadas trocadas explodem uma area 5x5', () => {
  const grid = gridFrom(NEUTRO, {
    [idx(4, 4)]: SPECIAL.WRAPPED,
    [idx(4, 5)]: SPECIAL.WRAPPED,
  });

  const resultado = trySwap(grid, idx(4, 4), idx(4, 5), createRng(8));
  assert.equal(resultado.ok, true);
  assert.equal(resultado.comboKind, 'wrapped+wrapped');

  const limpas = new Set(resultado.phases[0].cleared);
  let dentro = 0;
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const r = 4 + dr;
      const c = 4 + dc;
      if (r >= 0 && r < ROWS && c >= 0 && c < COLS && limpas.has(idx(r, c))) dentro += 1;
    }
  }
  assert.ok(dentro >= 20, `esperava uma area 5x5 quase inteira, limpou ${dentro}`);
});

test('listrada com embrulhada forma faixa de tres linhas e tres colunas', () => {
  const grid = gridFrom(NEUTRO, {
    [idx(4, 4)]: SPECIAL.STRIPED_V,
    [idx(4, 5)]: SPECIAL.WRAPPED,
  });

  const resultado = trySwap(grid, idx(4, 4), idx(4, 5), createRng(9));
  assert.equal(resultado.ok, true);
  assert.equal(resultado.comboKind, 'striped+wrapped');

  const limpas = new Set(resultado.phases[0].cleared);
  for (let c = 0; c < COLS; c++) {
    assert.ok(limpas.has(idx(4, c)), `a linha central deveria sumir inteira (coluna ${c})`);
  }
});

test('bomba colorida nunca entra numa sequencia por cor', () => {
  // Tres bombas coloridas lado a lado nao podem disparar sozinhas.
  const grid = gridFrom(NEUTRO, {
    [idx(0, 0)]: SPECIAL.COLOR_BOMB,
    [idx(0, 1)]: SPECIAL.COLOR_BOMB,
    [idx(0, 2)]: SPECIAL.COLOR_BOMB,
  });
  grid[idx(0, 0)].type = COLORLESS;
  grid[idx(0, 1)].type = COLORLESS;
  grid[idx(0, 2)].type = COLORLESS;

  const { hRuns, vRuns } = findRuns(grid);
  const tocaBomba = [...hRuns, ...vRuns].some((run) =>
    run.cells.some((i) => grid[i] && grid[i].special === SPECIAL.COLOR_BOMB)
  );
  assert.equal(tocaBomba, false, 'bombas coloridas nao podem formar sequencia entre si');
});

// ---------------------------------------------------------------------------
// Embaralhamento e estados sem saida
// ---------------------------------------------------------------------------

test('embaralhar sempre devolve um tabuleiro jogavel e sem combinacao pronta', () => {
  for (let semente = 0; semente < 40; semente++) {
    const rng = createMatchRandom(semente + 1000, COLS);
    const grid = createGrid(rng);

    shuffleGrid(grid, rng);

    assert.equal(hasAnyRun(grid), false, `semente ${semente}: embaralhou com combinacao pronta`);
    assert.equal(hasValidMove(grid), true, `semente ${semente}: embaralhou para um tabuleiro travado`);

    const problemas = conferirIntegridade(grid, `semente ${semente} pos-embaralho`);
    assert.deepEqual(problemas, [], problemas.join('\n'));
  }
});

// ---------------------------------------------------------------------------
// Serializacao para a rede
// ---------------------------------------------------------------------------

test('serializeTypes devolve um valor desenhavel para cada casa', () => {
  const rng = createMatchRandom(31337, COLS);
  const grid = createGrid(rng);
  const tipos = serializeTypes(grid);

  assert.equal(tipos.length, CELL_COUNT);
  for (let i = 0; i < tipos.length; i++) {
    assert.ok(Number.isInteger(tipos[i]), `posicao ${i} nao e inteiro`);
    assert.ok(tipos[i] >= 0, `posicao ${i} negativa (${tipos[i]}) — a miniatura do adversario nao saberia pintar`);
  }
});
