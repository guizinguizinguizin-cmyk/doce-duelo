import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/core/rng.js';
import { createMatchRandom } from '../src/core/rng.js';
import { COLS, ROWS, CELL_COUNT, SPECIAL, idx, resolve, trySwap, createGrid } from '../src/core/board.js';
import { createPressure } from '../src/game/pressure.js';
import { unitsForMove, comboBonus, cascadeMultiplier, COMBO_BONUS_CAP, ATTACK_TABLE } from '../src/game/attack.js';
import { PRESSURE_MAX, PENDING_DELAY_MS, alertLevel } from '../src/game/balance.js';

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

// ---------------------------------------------------------------------------
// Fila de pressao
// ---------------------------------------------------------------------------

test('ataque recebido entra como PENDENTE, nao como pressao', () => {
  const p = createPressure();
  p.queueAttack(5, 'inimigo', 1000);

  assert.equal(p.current, 0, 'nao pode doer ainda');
  assert.equal(p.pending, 5);
  assert.equal(p.projected, 5);
});

test('pendente so vira pressao depois da janela', () => {
  const p = createPressure();
  p.queueAttack(4, 'inimigo', 1000);

  assert.equal(p.tick(1000 + PENDING_DELAY_MS - 1), 0, 'cedo demais');
  assert.equal(p.current, 0);

  assert.equal(p.tick(1000 + PENDING_DELAY_MS), 4, 'agora sim');
  assert.equal(p.current, 4);
  assert.equal(p.pending, 0);
});

test('cancelar remove o pendente mais antigo primeiro', () => {
  const p = createPressure();
  p.queueAttack(3, 'a', 1000); // este esta prestes a cair
  p.queueAttack(5, 'b', 2000);

  const { sobra, cancelado } = p.spend(3);

  assert.equal(cancelado, 3);
  assert.equal(sobra, 0);
  assert.equal(p.pending, 5, 'so o mais novo sobrou');
  assert.equal(p.queue[0].from, 'b');
});

test('cancelamento parcial diminui o ataque em vez de remover', () => {
  const p = createPressure();
  p.queueAttack(6, 'a', 1000);

  const { sobra, cancelado } = p.spend(2);

  assert.equal(cancelado, 2);
  assert.equal(sobra, 0);
  assert.equal(p.pending, 4, 'sobraram 4 chegando');
});

test('o que sobra depois de cancelar vira ataque', () => {
  const p = createPressure();
  p.queueAttack(2, 'a', 1000);

  const { sobra, cancelado } = p.spend(7);

  assert.equal(cancelado, 2);
  assert.equal(sobra, 5, 'as 5 restantes atacam o adversario');
  assert.equal(p.pending, 0);
});

test('gastar sem nada pendente ataca tudo', () => {
  const p = createPressure();
  const { sobra, cancelado } = p.spend(4);
  assert.equal(cancelado, 0);
  assert.equal(sobra, 4);
});

test('colapso ao atingir a pressao maxima', () => {
  const p = createPressure();
  p.queueAttack(PRESSURE_MAX, 'a', 0);
  assert.equal(p.dead, false, 'pendente nao mata');

  p.tick(PENDING_DELAY_MS);
  assert.equal(p.dead, true);
  assert.equal(p.current, PRESSURE_MAX, 'nao passa do teto');
});

test('cancelar a tempo evita a morte', () => {
  const p = createPressure();
  p.queueAttack(PRESSURE_MAX, 'a', 0);
  p.spend(PRESSURE_MAX); // combo salvador dentro da janela
  p.tick(PENDING_DELAY_MS * 2);

  assert.equal(p.current, 0);
  assert.equal(p.dead, false);
});

// ---------------------------------------------------------------------------
// Alerta
// ---------------------------------------------------------------------------

test('o alerta considera pressao ATUAL + PENDENTE', () => {
  // Sozinha, esta pressao seria tranquila.
  const atual = Math.floor(PRESSURE_MAX * 0.5);
  assert.equal(alertLevel(atual, 0), 'normal');

  // Com o que esta chegando, o jogador ja esta morto se nao reagir.
  const chegando = Math.ceil(PRESSURE_MAX * 0.5);
  assert.equal(alertLevel(atual, chegando), 'critico');
});

test('os niveis de alerta sobem na ordem', () => {
  assert.equal(alertLevel(0, 0), 'normal');
  assert.equal(alertLevel(Math.ceil(PRESSURE_MAX * 0.65), 0), 'atencao');
  assert.equal(alertLevel(Math.ceil(PRESSURE_MAX * 0.85), 0), 'perigo');
  assert.equal(alertLevel(Math.ceil(PRESSURE_MAX * 0.97), 0), 'critico');
});

// ---------------------------------------------------------------------------
// Tabela de ataque
// ---------------------------------------------------------------------------

test('sequencia de 3 nao gera ataque nenhum', () => {
  const grid = gridFrom([
    '11034501',
    '12345012',
    '13450123',
    '34501234',
    '45012345',
    '50123450',
    '01234501',
    '12345012',
  ]);
  // coluna 0: 1,1,1 -> trinca simples, nenhum especial nasce
  const resultado = resolve(grid, createRng(1));
  const primeira = resultado.phases[0];
  assert.equal(primeira.created.length, 0);
  assert.equal(primeira.activations.length, 0);

  const units = unitsForMove({ ok: true, phases: [primeira] }, 1);
  assert.equal(units, ATTACK_TABLE.match3, 'match 3 vale 0');
});

test('sequencia de 4 gera 1 unidade', () => {
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
  const { phases } = resolve(grid, createRng(2));
  assert.equal(phases[0].created[0].special, SPECIAL.STRIPED_H);

  const units = unitsForMove({ ok: true, phases: [phases[0]] }, 1);
  assert.equal(units, ATTACK_TABLE.match4);
});

test('formato em L gera mais que sequencia de 4', () => {
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
  const { phases } = resolve(grid, createRng(3));
  assert.equal(phases[0].created[0].special, SPECIAL.WRAPPED);

  const units = unitsForMove({ ok: true, phases: [phases[0]] }, 1);
  assert.equal(units, ATTACK_TABLE.formaLT);
  assert.ok(ATTACK_TABLE.formaLT > ATTACK_TABLE.match4, 'L precisa valer mais que 4 em linha');
});

test('bonus de combo segue a tabela e respeita o teto', () => {
  assert.equal(comboBonus(1), 0);
  assert.equal(comboBonus(2), 1);
  assert.equal(comboBonus(3), 2);
  assert.equal(comboBonus(4), 3);
  // Sem teto, quem joga rapido acumulava combo infinito e a partida virava
  // binaria — foi o que a simulacao pegou.
  assert.equal(comboBonus(50), COMBO_BONUS_CAP);
});

test('cascata multiplica o ataque', () => {
  assert.equal(cascadeMultiplier(1), 1);
  assert.ok(cascadeMultiplier(2) > cascadeMultiplier(1));
  assert.ok(cascadeMultiplier(5) > cascadeMultiplier(2));
});

test('o ataque total e sempre inteiro e nunca negativo', () => {
  for (let seed = 0; seed < 60; seed++) {
    const rng = createRng(seed);
    const grid = createGrid(rng);
    for (let tentativa = 0; tentativa < 6; tentativa++) {
      const resultado = trySwap(grid, 0, 1, rng);
      const units = unitsForMove(resultado, (seed % 8) + 1);
      assert.ok(Number.isInteger(units), `semente ${seed} deu ataque fracionario: ${units}`);
      assert.ok(units >= 0);
    }
  }
});

// ---------------------------------------------------------------------------
// Justica competitiva: mesma semente, mesmas oportunidades
// ---------------------------------------------------------------------------

test('a mesma semente da o mesmo tabuleiro inicial para os dois jogadores', () => {
  const semente = 12345;
  const a = createGrid(createRng(semente));
  const b = createGrid(createRng(semente));
  assert.deepEqual(a.map((c) => c.type), b.map((c) => c.type));
});

test('cada coluna entrega a mesma sequencia de pecas independentemente do ritmo', () => {
  const semente = 999;
  const colunaA = createMatchRandom(semente, COLS).column(3);
  const colunaB = createMatchRandom(semente, COLS).column(3);

  // O jogador B "gasta" outras colunas antes — isso nao pode afetar a coluna 3.
  const outra = createMatchRandom(semente, COLS);
  for (let i = 0; i < 50; i++) outra.column(0).int(6);

  const sequenciaA = Array.from({ length: 24 }, () => colunaA.int(6));
  const sequenciaB = Array.from({ length: 24 }, () => colunaB.int(6));
  assert.deepEqual(sequenciaA, sequenciaB);
});

test('colunas diferentes tem sequencias diferentes', () => {
  const r = createMatchRandom(777, COLS);
  const c0 = Array.from({ length: 30 }, () => r.column(0).int(6)).join('');
  const c5 = Array.from({ length: 30 }, () => r.column(5).int(6)).join('');
  assert.notEqual(c0, c5, 'todas as colunas iguais indicaria semente mal distribuida');
});
