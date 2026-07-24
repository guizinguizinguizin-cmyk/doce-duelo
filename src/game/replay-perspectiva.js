// Replay de PERSPECTIVA: cada jogador grava a PROPRIA partida.
//
// O replay determinista (replay.js) reexecuta a partida inteira dos dois lados
// a partir das jogadas de todos. Ele e elegante para anti-cheat, mas so grava
// SOLO: no online o anfitriao nao recebe as jogadas do convidado, entao nao ha
// como reconstruir o tabuleiro do outro. Por isso as partidas com amigos nunca
// gravavam.
//
// Este outro formato resolve isso virando o problema do avesso: em vez de
// reconstruir os DOIS lados, cada cliente grava so o que ELE viveu —
//
//   semente   -> reconstroi o proprio tabuleiro inicial
//   jogadas   -> as trocas que ELE fez (as unicas que ele conhece)
//   embaralho -> quando o tabuleiro dele ficou sem jogada e foi remexido
//   lixo      -> os obstaculos que cairam nele
//   estados   -> a pressao/placar dele a cada evento (nada e re-simulado)
//   fotos     -> instantaneos do adversario, para as miniaturas
//
// Reproduzindo essas operacoes NA MESMA ORDEM contra o MESMO gerador, o
// tabuleiro do jogador sai identico ao que ele jogou — sem depender do outro.
// Funciona igual em solo e em online, e cada um assiste a propria partida sem
// precisar trocar codigo nenhum.
//
// Fidelidade: os unicos consumidores do gerador do tabuleiro sao createGrid (no
// inicio), trySwap (jogada valida), shuffleGrid (embaralho) e injectGarbage
// (lixo). Jogada invalida nao consome nada. Gravando move/shuffle/lixo em ordem
// e reproduzindo-os na mesma ordem, todo o consumo do gerador se repete.

import { createMatchRandom } from '../core/rng.js';
import { createGrid, COLS } from '../core/board.js';

export const REPLAY_PESSOAL_VERSAO = 2;

/** Intervalo minimo entre fotos do mesmo adversario, para o arquivo nao inchar. */
const THROTTLE_OP_MS = 450;

export function createGravador({ seed, players, euId, startedAt = 0 }) {
  const eventos = [];
  const ultimoOp = new Map();
  let duracao = 0;
  let vencedorId = null;
  let ganhei = false;

  const rel = (t) => Math.max(0, Math.round(t - startedAt));
  const marcar = (t) => {
    const r = rel(t);
    if (r > duracao) duracao = r;
    return r;
  };

  return {
    /** Jogada valida do jogador (consome o gerador via trySwap na reproducao). */
    move(a, b, st, pts, t) {
      eventos.push({ t: marcar(t), k: 'move', a, b, st, pts });
    },
    /** Tabuleiro remexido por falta de jogada. */
    shuffle(t) {
      eventos.push({ t: marcar(t), k: 'shuffle' });
    },
    /** Obstaculos que cairam. Grava a quantidade PEDIDA, para o gerador bater. */
    lixo(tipo, quantidade, st, t) {
      if (quantidade > 0) eventos.push({ t: marcar(t), k: 'lixo', tipo, qtd: quantidade, st });
    },
    /** Ataque que chegou e entrou na fila de pendentes. */
    incoming(units, st, t) {
      eventos.push({ t: marcar(t), k: 'in', units, st });
    },
    /** Pendente que virou pressao de verdade. */
    land(units, st, t) {
      eventos.push({ t: marcar(t), k: 'land', units, st });
    },
    /** Foto do estado de um adversario (para a miniatura). Limitada no tempo. */
    opponent(id, score, pressure, alive, tipos, t) {
      const agora = rel(t);
      const anterior = ultimoOp.get(id);
      if (anterior && agora - anterior.t < THROTTLE_OP_MS && anterior.alive === alive) return;
      ultimoOp.set(id, { t: agora, alive });
      eventos.push({ t: marcar(t), k: 'op', id, score, pressure, alive, tipos: tipos || null });
    },
    fim(vId, ganhou, t) {
      vencedorId = vId;
      ganhei = !!ganhou;
      duracao = Math.max(duracao, rel(t));
    },

    get totalEventos() {
      return eventos.length;
    },

    toJSON() {
      return {
        v: REPLAY_PESSOAL_VERSAO,
        seed: seed >>> 0,
        criadoEm: new Date().toISOString(),
        euId,
        jogadores: players.map((p) => ({ id: p.id, name: p.name, isBot: !!p.isBot })),
        eventos,
        duracao,
        vencedorId,
        ganhei,
      };
    },
  };
}

/** Tabuleiro inicial do jogador em foco, reconstruido da semente. */
export function tabuleiroInicial(seed) {
  const rng = createMatchRandom(seed >>> 0, COLS);
  return { grid: createGrid(rng), rng };
}

export function ehReplayPessoal(dados) {
  return !!dados && dados.v === REPLAY_PESSOAL_VERSAO && Array.isArray(dados.eventos);
}
