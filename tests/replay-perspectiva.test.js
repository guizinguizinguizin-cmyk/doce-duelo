// O replay de perspectiva promete uma coisa: reproduzir as operacoes gravadas
// (jogada/embaralho/lixo) na mesma ordem, contra a mesma semente, reconstroi o
// tabuleiro do jogador IDENTICO ao que ele jogou. Se isso quebrar, o replay
// mostra uma partida que nao aconteceu. Entao e o que este teste crava.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createMatchRandom } from '../src/core/rng.js';
import { createGrid, findMove, trySwap, shuffleGrid, injectGarbage, COLS } from '../src/core/board.js';
import { createGravador, tabuleiroInicial, ehReplayPessoal } from '../src/game/replay-perspectiva.js';

const est = (n) => ({ pressure: n % 26, pending: 0, alert: 'normal', score: n * 10 });

// Compara o CONTEUDO de jogo de cada celula, ignorando o `id` (um contador
// global de criacao, que difere so por a reproducao criar celulas depois da
// partida original — nao e estado de jogo).
const conteudo = (grid) =>
  JSON.stringify(grid.map((c) => (c ? { type: c.type, special: c.special || 0, blocker: c.blocker || null } : null)));

test('reconstroi o tabuleiro do jogador identico ao que foi jogado', () => {
  const seed = 0x51ce77;

  // ---- "ao vivo": consome o gerador e grava cada operacao logo apos faze-la,
  // exatamente na ordem em que o jogo faz (op -> registrar). ----
  const rng = createMatchRandom(seed, COLS);
  const grid = createGrid(rng);
  const grav = createGravador({
    seed,
    players: [
      { id: 'me', name: 'Eu' },
      { id: 'bot', name: 'Bot', isBot: true },
    ],
    euId: 'me',
    startedAt: 0,
  });

  let t = 0;
  for (let n = 0; n < 50; n++) {
    t += 90;

    // Lixo em alguns momentos (op primeiro, registro depois — mesma ordem).
    if (n === 8 || n === 20 || n === 37) {
      const postos = injectGarbage(grid, 3, n === 20 ? 'gelo' : 'pedra', rng);
      if (postos.length) grav.lixo(n === 20 ? 'gelo' : 'pedra', 3, est(n), t);
    }

    let mv = findMove(grid);
    if (!mv) {
      shuffleGrid(grid, rng);
      grav.shuffle(t);
      mv = findMove(grid);
    }
    const res = trySwap(grid, mv.a, mv.b, rng);
    assert.ok(res.ok, 'jogada escolhida deveria ser valida');
    grav.move(mv.a, mv.b, est(n), res.points || 0, t);

    // Embaralho pos-jogada, igual ao attemptMove do jogo (op -> registro).
    if (!findMove(grid)) {
      shuffleGrid(grid, rng);
      grav.shuffle(t);
    }
  }
  grav.fim('me', true, t);

  const dados = grav.toJSON();
  assert.ok(ehReplayPessoal(dados));
  assert.equal(dados.euId, 'me');

  // ---- reproducao: aplica os eventos na ordem gravada contra a mesma semente.
  const { grid: g2, rng: r2 } = tabuleiroInicial(seed);
  for (const ev of dados.eventos) {
    if (ev.k === 'move') {
      const res = trySwap(g2, ev.a, ev.b, r2);
      assert.ok(res.ok, 'jogada gravada tem de continuar valida na reproducao');
    } else if (ev.k === 'shuffle') {
      shuffleGrid(g2, r2);
    } else if (ev.k === 'lixo') {
      injectGarbage(g2, ev.qtd, ev.tipo, r2);
    }
  }

  assert.equal(
    conteudo(g2),
    conteudo(grid),
    'o tabuleiro reconstruido deve ser identico ao jogado'
  );
});

test('os estados carimbados sobrevivem a serializacao', () => {
  const grav = createGravador({ seed: 1, players: [{ id: 'me', name: 'Eu' }], euId: 'me', startedAt: 0 });
  grav.move(0, 1, { pressure: 5, pending: 2, alert: 'atencao', score: 120 }, 30, 200);
  grav.land(4, { pressure: 9, pending: 0, alert: 'perigo', score: 120 }, 400);
  grav.fim('me', true, 500);

  const dados = JSON.parse(JSON.stringify(grav.toJSON()));
  assert.ok(ehReplayPessoal(dados));
  const move = dados.eventos.find((e) => e.k === 'move');
  assert.equal(move.st.alert, 'atencao');
  assert.equal(move.st.score, 120);
  assert.equal(dados.duracao, 500);
  assert.equal(dados.ganhei, true);
});

test('fotos do adversario sao limitadas no tempo, mas passam na troca de estado', () => {
  const grav = createGravador({ seed: 1, players: [{ id: 'me', name: 'Eu' }, { id: 'bot', name: 'Bot' }], euId: 'me', startedAt: 0 });
  // Rajada de fotos muito juntas: so a primeira entra.
  grav.snap('bot', 10, 1, true, null, 0);
  grav.snap('bot', 11, 1, true, null, 50);
  grav.snap('bot', 12, 1, true, null, 100);
  let fotos = grav.toJSON().eventos.filter((e) => e.k === 'snap');
  assert.equal(fotos.length, 1, 'fotos muito proximas devem ser filtradas');

  // Mudar de vivo para eliminado sempre registra, mesmo dentro do intervalo.
  grav.snap('bot', 12, 26, false, null, 120);
  fotos = grav.toJSON().eventos.filter((e) => e.k === 'snap');
  assert.equal(fotos.length, 2, 'a eliminacao do adversario nunca pode ser descartada');
});
