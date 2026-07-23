// Adversario controlado pelo computador.
//
// O bot joga num tabuleiro proprio, com as MESMAS regras do jogador — ele nao
// ganha pontos de gracinha nem enxerga o tabuleiro alheio. A dificuldade muda
// so duas coisas: quanto ele demora para jogar e quao boa e a jogada que
// escolhe entre as disponiveis.
//
// Isso importa porque um bot que trapaceia e obvio em dez segundos e o jogador
// para de levar o modo solo a serio.

import { createGrid, allMoves, trySwap, cloneGrid, findMove, shuffleGrid, serializeTypes } from '../core/board.js';
import { createRng } from '../core/rng.js';
import { BAR_MAX, BAR_OVERFLOW_CAP, STREAK_TIMEOUT_MS, streakMultiplier, applyPower } from './balance.js';

// Numeros calibrados por simulacao, nao por chute: `npm run balance` roda 400
// partidas de cada combinacao com relogio virtual e reporta a taxa de vitoria.
// A meta de cada nivel esta anotada abaixo — ao mexer, rodar de novo e conferir.
//
// A licao da primeira rodada de calibragem: o intervalo entre jogadas domina
// TUDO. Dano escala com jogadas por segundo, entao um bot 2x mais rapido bate
// 2x mais forte, e nenhuma diferenca de `skill` compensa isso. Por isso os
// tempos abaixo ficam proximos do ritmo humano — a diferenca entre os niveis
// vem principalmente da qualidade da jogada.
export const DIFFICULTIES = {
  facil: {
    label: 'Fácil',
    descricao: 'Joga devagar e erra bastante. Bom para aprender.',
    // Meta: iniciante ganha ~65%
    thinkMin: 3400,
    thinkMax: 4800,
    // Fracao da lista de jogadas (ordenada da pior para a melhor) de onde ele
    // sorteia. 0.15 = escolhe quase em qualquer lugar; 1 = so a melhor.
    skill: 0.1,
    mistakeChance: 0.35,
  },
  normal: {
    label: 'Normal',
    descricao: 'Ritmo de um jogador humano atento. Partida disputada.',
    // Meta: jogador casual ganha ~50%
    thinkMin: 1600,
    thinkMax: 2500,
    skill: 0.58,
    mistakeChance: 0.12,
  },
  dificil: {
    label: 'Difícil',
    descricao: 'Rápido e quase sempre acha a jogada que mais pontua.',
    // Meta: jogador bom ganha ~50%
    thinkMin: 1000,
    thinkMax: 1650,
    skill: 0.88,
    mistakeChance: 0.03,
  },
  pesadelo: {
    label: 'Pesadelo',
    descricao: 'Implacável. Procura combos e não perde tempo.',
    // Meta: jogador bom ganha ~20%
    thinkMin: 850,
    thinkMax: 1300,
    skill: 0.96,
    mistakeChance: 0,
  },
};

export function createBot({ id, name, difficulty = 'normal', seed, hooks = {} }) {
  const config = DIFFICULTIES[difficulty] || DIFFICULTIES.normal;
  const rng = createRng(seed);

  let grid = createGrid(rng);
  let score = 0;
  let bar = 0;
  let alive = true;
  let running = false;
  let timer = null;
  let comboStreak = 0;
  let lastMoveAt = 0;

  /**
   * Avalia uma jogada simulando-a numa copia. Devolve os pontos que ela renderia.
   * Simular e barato (8x8) e e a unica forma honesta de comparar jogadas: uma
   * heuristica de "tamanho da trinca" ignoraria cascatas e combos de especiais,
   * que sao justamente as jogadas que decidem a partida.
   */
  function evaluate(move) {
    const copy = cloneGrid(grid);
    const simRng = rng.fork();
    const result = trySwap(copy, move.a, move.b, simRng);
    if (!result.ok) return -1;
    return result.points + result.cascades * 12;
  }

  function chooseMove() {
    const moves = allMoves(grid);
    if (!moves.length) return null;

    if (rng.next() < config.mistakeChance) {
      return moves[rng.int(moves.length)];
    }

    const scored = moves.map((move) => ({ move, value: evaluate(move) }));
    scored.sort((a, b) => a.value - b.value);

    // `skill` decide de que ponto da lista ordenada ele sorteia: 1 pega so o
    // topo, 0 pega qualquer uma. Sortear dentro de uma faixa (em vez de sempre
    // pegar a melhor) evita que o bot pareca um robo perfeito.
    const from = Math.floor((scored.length - 1) * config.skill);
    const slice = scored.slice(from);
    return slice[rng.int(slice.length)].move;
  }

  function nextDelay() {
    const span = config.thinkMax - config.thinkMin;
    return config.thinkMin + rng.next() * span;
  }

  function emitState() {
    if (hooks.onState) {
      hooks.onState({ id, score, bar, boardTypes: serializeTypes(grid) });
    }
  }

  function playTurn() {
    if (!running || !alive) return;

    if (!findMove(grid)) shuffleGrid(grid, rng);

    const move = chooseMove();
    if (move) {
      const result = trySwap(grid, move.a, move.b, rng);
      if (result.ok && result.points > 0) {
        const now = Date.now();
        if (now - lastMoveAt > STREAK_TIMEOUT_MS) comboStreak = 0;
        comboStreak += 1;
        lastMoveAt = now;

        // `true` = usa o teto de sequencia dos bots. Ver balance.js: um bot
        // joga em intervalo fixo, entao a sequencia dele nunca expira.
        const multiplier = streakMultiplier(comboStreak, true);
        const points = Math.round(result.points * multiplier);
        score += points;

        // Mesma regra do jogador, vinda do mesmo modulo de balanceamento.
        const { newBar, overflow } = applyPower(points, bar);
        bar = newBar;

        emitState();
        if (overflow > 0 && hooks.onAttack) hooks.onAttack(id, overflow);
      }
    }

    if (running && alive) timer = setTimeout(playTurn, nextDelay());
  }

  function stop() {
    running = false;
    if (timer) clearTimeout(timer);
    timer = null;
  }

  return {
    id,
    name,
    difficulty,
    isBot: true,
    stop,

    start() {
      if (running) return;
      running = true;
      alive = true;
      lastMoveAt = Date.now();
      emitState();
      // Primeira jogada com atraso extra: o bot nao pode atacar no instante
      // em que a contagem regressiva termina.
      timer = setTimeout(playTurn, nextDelay() + 600);
    },

    /** Ataque recebido de outro jogador. Devolve true se o bot foi eliminado. */
    takeDamage(amount) {
      if (!alive) return false;
      bar = Math.min(BAR_OVERFLOW_CAP, bar + amount);
      emitState();
      if (bar >= BAR_MAX) {
        alive = false;
        stop();
        if (hooks.onLose) hooks.onLose(id);
        return true;
      }
      return false;
    },

    reset(newSeed) {
      stop();
      grid = createGrid(createRng(newSeed));
      score = 0;
      bar = 0;
      alive = true;
      comboStreak = 0;
      emitState();
    },

    get score() {
      return score;
    },
    get bar() {
      return bar;
    },
    get alive() {
      return alive;
    },
    get boardTypes() {
      return serializeTypes(grid);
    },
  };
}
