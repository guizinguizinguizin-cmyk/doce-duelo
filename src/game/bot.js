// Adversario controlado pelo computador.
//
// O bot joga num tabuleiro proprio, com as MESMAS regras do jogador — ele nao
// ganha pontos de gracinha nem enxerga o tabuleiro alheio. A dificuldade muda
// so duas coisas: quanto ele demora para jogar e quao boa e a jogada que
// escolhe entre as disponiveis.
//
// Isso importa porque um bot que trapaceia e obvio em dez segundos e o jogador
// para de levar o modo solo a serio.

import { createGrid, allMoves, trySwap, cloneGrid, findMove, shuffleGrid, serializeTypes, COLS } from '../core/board.js';
import { createRng, createMatchRandom } from '../core/rng.js';
import { STREAK_TIMEOUT_MS, streakMultiplier } from './balance.js';
import { createPressure } from './pressure.js';
import { unitsForMove } from './attack.js';

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
    thinkMin: 3200,
    thinkMax: 4200,
    // Fracao da lista de jogadas (ordenada da pior para a melhor) de onde ele
    // sorteia. 0.15 = escolhe quase em qualquer lugar; 1 = so a melhor.
    skill: 0.25,
    mistakeChance: 0.25,
  },
  normal: {
    label: 'Normal',
    descricao: 'Ritmo de um jogador humano atento. Partida disputada.',
    // Meta: jogador casual ganha ~50%
    thinkMin: 2000,
    thinkMax: 2800,
    skill: 0.51,
    mistakeChance: 0.13,
  },
  dificil: {
    label: 'Difícil',
    descricao: 'Rápido e quase sempre acha a jogada que mais pontua.',
    // Meta: jogador bom ganha ~50%
    thinkMin: 1200,
    thinkMax: 1780,
    skill: 0.81,
    mistakeChance: 0.045,
  },
  pesadelo: {
    label: 'Pesadelo',
    descricao: 'Implacável. Procura combos e não perde tempo.',
    // Meta: jogador bom ganha ~20%
    thinkMin: 1150,
    thinkMax: 1750,
    skill: 0.86,
    mistakeChance: 0.02,
  },
};

/**
 * `brainSeed` decide as JOGADAS do bot (qual troca ele escolhe, quando erra).
 * O TABULEIRO nao vem daqui: ele vem da semente da partida, igual ao do
 * jogador. Antes o bot sorteava o proprio tabuleiro, o que quebrava o pilar
 * de "habilidade vence sorte" — nao adianta os dois receberem as mesmas pecas
 * se o adversario esta jogando noutro tabuleiro.
 */
export function createBot({ id, name, difficulty = 'normal', brainSeed, hooks = {} }) {
  const config = DIFFICULTIES[difficulty] || DIFFICULTIES.normal;
  const rng = createRng(brainSeed);

  let boardRng = createMatchRandom(brainSeed >>> 0, COLS);
  let grid = createGrid(boardRng);
  const pressure = createPressure();
  let score = 0;
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
    const simRng = boardRng.fork();
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
      hooks.onState({
        id,
        score,
        pressure: pressure.current,
        pending: pressure.pending,
        boardTypes: serializeTypes(grid),
      });
    }
  }

  function playTurn() {
    if (!running || !alive) return;

    if (!findMove(grid)) shuffleGrid(grid, boardRng);

    const move = chooseMove();
    if (move) {
      const result = trySwap(grid, move.a, move.b, boardRng);
      if (result.ok && result.points > 0) {
        const now = Date.now();
        if (now - lastMoveAt > STREAK_TIMEOUT_MS) comboStreak = 0;
        comboStreak += 1;
        lastMoveAt = now;

        // `true` = usa o teto de sequencia dos bots. Ver balance.js: um bot
        // joga em intervalo fixo, entao a sequencia dele nunca expira.
        score += Math.round(result.points * streakMultiplier(comboStreak, true));

        // Mesma tabela de ataque do jogador, e o mesmo modulo de pressao:
        // o bot tambem cancela o que esta chegando antes de atacar.
        const units = unitsForMove(result, comboStreak);
        const { sobra } = pressure.spend(units);

        emitState();
        if (sobra > 0 && hooks.onAttack) hooks.onAttack(id, sobra);
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

    /** Ataque recebido: entra na fila de pendentes, igual ao do jogador. */
    receiveAttack(units, from) {
      if (!alive) return;
      pressure.queueAttack(units, from);
      emitState();
    },

    /**
     * Converte pendentes vencidos em pressao real. Chamado pelo relogio da
     * sessao, o mesmo que atende o jogador — assim o bot nao tem vantagem de
     * temporizacao.
     */
    tick(now) {
      if (!alive) return;
      const entrou = pressure.tick(now);
      if (entrou > 0) {
        emitState();
        if (pressure.dead) {
          alive = false;
          stop();
          if (hooks.onLose) hooks.onLose(id);
        }
      }
    },

    /** Recomeca no tabuleiro da PARTIDA — o mesmo que o jogador recebeu. */
    reset(matchSeed) {
      stop();
      boardRng = createMatchRandom(matchSeed >>> 0, COLS);
      grid = createGrid(boardRng);
      pressure.reset();
      score = 0;
      alive = true;
      comboStreak = 0;
      emitState();
    },

    get score() {
      return score;
    },
    get pressure() {
      return pressure.current;
    },
    get pending() {
      return pressure.pending;
    },
    get alive() {
      return alive;
    },
    get boardTypes() {
      return serializeTypes(grid);
    },
  };
}
