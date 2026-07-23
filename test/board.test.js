import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/core/rng.js';
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
  idx,
} from '../src/core/board.js';

// Monta um tabuleiro a partir de 8 linhas de 8 digitos, onde cada digito e o
// tipo da peca. Deixa os testes legiveis: da para ver a combinacao no texto.
function gridFrom(rows, specials = {}) {
  assert.equal(rows.length, ROWS, 'o tabuleiro de teste precisa de 8 linhas');
  const grid = new Array(CELL_COUNT);
  let id = 1;
  for (let r = 0; r < ROWS; r++) {
    assert.equal(rows[r].length, COLS, `linha ${r} precisa de 8 colunas`);
    for (let c = 0; c < COLS; c++) {
      const i = idx(r, c);
      grid[i] = { id: id++, type: Number(rows[r][c]), special: specials[i] ?? SPECIAL.NONE };
    }
  }
  return grid;
}

function countNulls(grid) {
  return grid.filter((c) => c === null || c === undefined).length;
}

test('createGrid nao comeca com combinacao pronta e sempre tem jogada', () => {
  for (let seed = 0; seed < 200; seed++) {
    const grid = createGrid(createRng(seed));
    assert.equal(grid.length, CELL_COUNT);
    assert.equal(countNulls(grid), 0, `semente ${seed} gerou buraco no tabuleiro`);
    assert.equal(hasAnyRun(grid), false, `semente ${seed} comecou com combinacao pronta`);
    assert.equal(hasValidMove(grid), true, `semente ${seed} comecou travado`);
  }
});

test('findRuns acha sequencias horizontais e verticais', () => {
  const grid = gridFrom([
    '00012345',
    '12345012',
    '23450123',
    '34501234',
    '45012345',
    '50123450',
    '01234501',
    '12345012',
  ]);
  const { hRuns, vRuns } = findRuns(grid);
  assert.equal(hRuns.length, 1);
  assert.deepEqual(hRuns[0].cells, [0, 1, 2]);
  assert.equal(hRuns[0].type, 0);
  assert.equal(vRuns.length, 0);
});

test('sequencia de 4 cria peca listrada', () => {
  const grid = gridFrom([
    '11110234',
    '23401230',
    '34012340',
    '40123404',
    '01234012',
    '12340123',
    '23401234',
    '34012340',
  ]);
  const { phases } = resolve(grid, createRng(1));
  const created = phases[0].created;
  assert.equal(created.length, 1);
  assert.equal(created[0].special, SPECIAL.STRIPED_H);
  assert.equal(created[0].type, 1);
});

test('sequencia de 5 cria bomba colorida sem cor', () => {
  const grid = gridFrom([
    '11111234',
    '23401230',
    '34012340',
    '40123404',
    '01234012',
    '12340123',
    '23401234',
    '34012340',
  ]);
  const { phases } = resolve(grid, createRng(2));
  const created = phases[0].created;
  assert.equal(created.length, 1);
  assert.equal(created[0].special, SPECIAL.COLOR_BOMB);
  assert.equal(created[0].type, COLORLESS);
});

test('cruzamento em L cria peca embrulhada', () => {
  const grid = gridFrom([
    '11102340',
    '12340123',
    '10234012',
    '23401234',
    '34012340',
    '40123401',
    '01234012',
    '12340123',
  ]);
  // coluna 0 tem 1 nas linhas 0,1,2 e linha 0 tem 1 nas colunas 0,1,2
  const { phases } = resolve(grid, createRng(3));
  const created = phases[0].created;
  assert.equal(created.length, 1);
  assert.equal(created[0].special, SPECIAL.WRAPPED);
  assert.equal(created[0].index, 0, 'o embrulhado nasce no cruzamento');
});

test('peca listrada horizontal limpa a linha inteira ao ser atingida', () => {
  // Listrada em (3,0). A trinca vertical de tipo 2 na coluna 0 a atinge.
  const grid = gridFrom([
    '01340134',
    '13401340',
    '20134013',
    '20134013',
    '20134013',
    '34013401',
    '40134013',
    '01340134',
  ], { [idx(3, 0)]: SPECIAL.STRIPED_H });

  const { phases } = resolve(grid, createRng(4));
  const first = phases[0];
  const activation = first.activations.find((a) => a.index === idx(3, 0));
  assert.ok(activation, 'a listrada deveria ter estourado');
  assert.equal(activation.special, SPECIAL.STRIPED_H);
  for (let c = 0; c < COLS; c++) {
    assert.ok(first.cleared.includes(idx(3, c)), `coluna ${c} da linha 3 deveria sumir`);
  }
});

test('trySwap desfaz a troca quando nao forma nada', () => {
  const grid = gridFrom([
    '01234501',
    '12345012',
    '23450123',
    '34501234',
    '45012345',
    '50123450',
    '01234501',
    '12345012',
  ]);
  const before = cloneGrid(grid);
  const result = trySwap(grid, idx(0, 0), idx(0, 1), createRng(5));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'sem-combinacao');
  for (let i = 0; i < CELL_COUNT; i++) {
    assert.equal(grid[i].type, before[i].type, `celula ${i} nao voltou ao lugar`);
    assert.equal(grid[i].id, before[i].id, `id da celula ${i} mudou`);
  }
});

test('trySwap aceita troca que forma trinca e pontua', () => {
  const grid = gridFrom([
    '10234501',
    '12345012',
    '13450123',
    '34501234',
    '45012345',
    '50123450',
    '01234501',
    '12345012',
  ]);
  // trocar (0,0)=1 com (0,1)=0 poe 0 na coluna 0? Nao. Vamos usar a coluna 0:
  // linhas 0,1,2 = 1,1,1 ja e trinca. Entao montamos outro caso abaixo.
  const g2 = gridFrom([
    '01234501',
    '10345012',
    '11450123',
    '34501234',
    '45012345',
    '50123450',
    '01234501',
    '12345012',
  ]);
  // coluna 0: 0,1,1 — trocar (0,0) com (0,1) poe 1 no topo da coluna 0 -> trinca
  const result = trySwap(g2, idx(0, 0), idx(0, 1), createRng(6));
  assert.equal(result.ok, true);
  assert.ok(result.points > 0, 'uma trinca deveria pontuar');
  assert.ok(result.phases.length >= 1);
  assert.equal(countNulls(g2), 0, 'o tabuleiro deve estar cheio no fim');
  void grid;
});

test('bomba colorida trocada com peca normal remove todas daquela cor', () => {
  const grid = gridFrom([
    '01234501',
    '30345012',
    '23450123',
    '34501234',
    '45012345',
    '50123450',
    '01234501',
    '12345012',
  ], { [idx(1, 0)]: SPECIAL.COLOR_BOMB });
  grid[idx(1, 0)].type = COLORLESS;

  const targetType = grid[idx(1, 1)].type;
  const expected = grid.filter((c) => c.type === targetType).length;
  assert.ok(expected > 0);

  const result = trySwap(grid, idx(1, 0), idx(1, 1), createRng(7));
  assert.equal(result.ok, true);
  assert.equal(result.comboKind, 'bomb+color');

  const first = result.phases[0];
  assert.ok(first.cleared.includes(idx(1, 0)), 'a propria bomba some');
  assert.ok(
    first.cleared.length >= expected,
    `deveria limpar ao menos as ${expected} pecas da cor alvo`
  );
  assert.equal(countNulls(grid), 0);
});

test('duas bombas coloridas trocadas limpam o tabuleiro inteiro', () => {
  const grid = gridFrom([
    '01234501',
    '12345012',
    '23450123',
    '34501234',
    '45012345',
    '50123450',
    '01234501',
    '12345012',
  ], { [idx(0, 0)]: SPECIAL.COLOR_BOMB, [idx(0, 1)]: SPECIAL.COLOR_BOMB });
  grid[idx(0, 0)].type = COLORLESS;
  grid[idx(0, 1)].type = COLORLESS;

  const result = trySwap(grid, idx(0, 0), idx(0, 1), createRng(8));
  assert.equal(result.ok, true);
  assert.equal(result.comboKind, 'bomb+bomb');
  assert.equal(result.phases[0].cleared.length, CELL_COUNT, 'tudo deveria sumir');
  assert.equal(countNulls(grid), 0, 'e o tabuleiro deveria ser reabastecido');
});

test('dois listrados trocados formam cruz (linha + coluna)', () => {
  const grid = gridFrom([
    '01234501',
    '12345012',
    '23450123',
    '34501234',
    '45012345',
    '50123450',
    '01234501',
    '12345012',
  ], { [idx(4, 4)]: SPECIAL.STRIPED_H, [idx(4, 5)]: SPECIAL.STRIPED_H });

  const result = trySwap(grid, idx(4, 4), idx(4, 5), createRng(9));
  assert.equal(result.ok, true);
  assert.equal(result.comboKind, 'striped+striped');

  const cleared = new Set(result.phases[0].cleared);
  for (let c = 0; c < COLS; c++) assert.ok(cleared.has(idx(4, c)), `linha 4 col ${c}`);
  for (let r = 0; r < ROWS; r++) assert.ok(cleared.has(idx(r, 5)), `coluna 5 linha ${r}`);
});

test('resolve sempre devolve tabuleiro cheio e termina', () => {
  for (let seed = 0; seed < 120; seed++) {
    const rng = createRng(seed);
    const grid = createGrid(rng);
    const move = findMove(grid);
    assert.ok(move, `semente ${seed} sem jogada`);

    const result = trySwap(grid, move.a, move.b, rng);
    assert.equal(result.ok, true, `semente ${seed}: a jogada sugerida deveria valer`);
    assert.equal(countNulls(grid), 0, `semente ${seed} deixou buraco`);
    assert.ok(result.cascades < 60, `semente ${seed} estourou o limite de cascatas`);
    assert.equal(hasAnyRun(grid), false, `semente ${seed} parou com combinacao pendente`);
  }
});

test('shuffleGrid mantem as mesmas pecas e destrava o tabuleiro', () => {
  const rng = createRng(42);
  const grid = createGrid(rng);
  const idsBefore = grid.map((c) => c.id).sort((a, b) => a - b);

  shuffleGrid(grid, rng);

  const idsAfter = grid.map((c) => c.id).sort((a, b) => a - b);
  assert.deepEqual(idsAfter, idsBefore, 'embaralhar nao pode criar nem perder pecas');
  assert.equal(hasAnyRun(grid), false);
  assert.equal(hasValidMove(grid), true);
});

test('allMoves so devolve jogadas que realmente funcionam', () => {
  const rng = createRng(77);
  const grid = createGrid(rng);
  const moves = allMoves(grid);
  assert.ok(moves.length > 0);

  for (const move of moves) {
    const copy = cloneGrid(grid);
    const result = trySwap(copy, move.a, move.b, createRng(1));
    assert.equal(result.ok, true, `a jogada ${move.a}->${move.b} foi listada mas nao vale`);
  }
});

test('mesma semente produz exatamente a mesma partida', () => {
  const run = () => {
    const rng = createRng(2024);
    const grid = createGrid(rng);
    const move = findMove(grid);
    const result = trySwap(grid, move.a, move.b, rng);
    return { types: grid.map((c) => c.type).join(''), points: result.points };
  };
  const a = run();
  const b = run();
  assert.equal(a.types, b.types);
  assert.equal(a.points, b.points);
});
