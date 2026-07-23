// Motor puro do duelo: pressao, ataque, cancelamento, eliminacao.
//
// Nao conhece rede, DOM, audio nem relogio do sistema. O TEMPO ENTRA COMO
// PARAMETRO em toda operacao — nunca Date.now(). Essa e a diferenca entre um
// jogo que pode ter replay e um que nao pode.
//
// Tres consumidores usam este mesmo motor, e e por isso que ele existe:
//
//   session.js        partida ao vivo (adiciona rede e interface)
//   replay.js         reexecuta uma partida gravada
//   scripts/balance   simula milhares de partidas para calibrar
//
// Se cada um tivesse a propria copia das regras, eles divergiriam — e um
// replay que diverge da partida real e pior do que nao ter replay, porque
// mente. Este projeto ja foi mordido duas vezes por regra duplicada.

import { createRng } from '../core/rng.js';
import { createPressure } from './pressure.js';
import { unitsForMove } from './attack.js';
import { STREAK_TIMEOUT_MS, streakMultiplier, escalateUnits } from './balance.js';

/**
 * Semente dedicada as decisoes do duelo (escolha de alvo), separada da
 * semente do tabuleiro. Assim mexer numa nao embaralha a outra.
 */
function seedDoDuelo(seed) {
  let h = (seed ^ 0xa77ac4) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  return (h ^ (h >>> 13)) >>> 0;
}

export function createMatch({ seed, players, startedAt = 0 }) {
  const rng = createRng(seedDoDuelo(seed >>> 0));
  const ordem = players.map((p) => p.id);
  const estado = new Map();

  for (const p of players) {
    estado.set(p.id, {
      id: p.id,
      name: p.name,
      isBot: !!p.isBot,
      pressure: createPressure(),
      score: 0,
      combo: 0,
      ultimaJogada: -Infinity,
      alive: true,
      // estatisticas
      moves: 0,
      unitsSent: 0,
      unitsCancelled: 0,
      unitsTaken: 0,
      peakPressure: 0,
      bestCombo: 0,
      bestCascade: 0,
    });
  }

  let finished = false;
  let winnerId = null;
  const eventos = [];

  const registrar = (evento) => {
    eventos.push(evento);
    return evento;
  };

  const vivos = () => ordem.map((id) => estado.get(id)).filter((p) => p.alive);

  function verificarFim(t) {
    if (finished) return null;
    const restantes = vivos();
    if (restantes.length > 1) return null;
    finished = true;
    winnerId = restantes[0] ? restantes[0].id : null;
    return registrar({ t, tipo: 'fim', vencedor: winnerId });
  }

  function eliminar(id, t, motivo = 'colapso') {
    const p = estado.get(id);
    if (!p || !p.alive) return [];
    p.alive = false;
    const saida = [registrar({ t, tipo: 'eliminado', jogador: id, motivo })];
    const fim = verificarFim(t);
    if (fim) saida.push(fim);
    return saida;
  }

  /**
   * Escolhe o alvo de um ataque.
   *
   * Preferencia por quem esta mais perto do colapso, contando o que ja esta a
   * caminho — da leitura tatica em vez de sorteio no escuro. O desempate usa o
   * gerador SEMEADO, nao Math.random: com Math.random o replay escolheria um
   * alvo diferente do da partida real numa sala de tres ou mais.
   */
  function escolherAlvo(deId) {
    const candidatos = vivos().filter((p) => p.id !== deId);
    if (!candidatos.length) return null;

    const risco = (p) => p.pressure.projected;
    const maior = Math.max(...candidatos.map(risco));
    const empatados = candidatos.filter((p) => risco(p) >= maior - 2);
    return empatados[rng.int(empatados.length)];
  }

  function entregarAtaque(deId, unidades, t) {
    if (unidades <= 0 || finished) return null;
    const alvo = escolherAlvo(deId);
    if (!alvo) return null;

    alvo.pressure.queueAttack(unidades, deId, t);
    return registrar({ t, tipo: 'ataque', de: deId, para: alvo.id, unidades });
  }

  /**
   * Aplica uma jogada ja resolvida pelo core do tabuleiro.
   * `resultado` e o retorno de trySwap(). Devolve o que aconteceu, para a
   * interface mostrar sem precisar recalcular nada.
   */
  function aplicarJogada(jogadorId, resultado, t) {
    const p = estado.get(jogadorId);
    if (!p || !p.alive || finished || !resultado || !resultado.ok) return null;

    if (t - p.ultimaJogada > STREAK_TIMEOUT_MS) p.combo = 0;
    p.combo += 1;
    p.ultimaJogada = t;
    p.moves += 1;
    if (p.combo > p.bestCombo) p.bestCombo = p.combo;
    if (resultado.cascades > p.bestCascade) p.bestCascade = resultado.cascades;

    // Pontuacao e placar/recorde. Quem decide a partida e a unidade de ataque.
    const pontos = Math.round(resultado.points * streakMultiplier(p.combo, p.isBot));
    p.score += pontos;

    const unidades = unitsForMove(resultado, p.combo);
    // Cancelar vem antes de atacar: o que esta caindo na sua cabeca e mais
    // urgente do que o que voce pode fazer na cabeca alheia.
    const { sobra, cancelado } = p.pressure.spend(unidades);
    p.unitsCancelled += cancelado;

    let enviado = 0;
    let alvoId = null;
    if (sobra > 0) {
      const escalado = escalateUnits(sobra, t - startedAt);
      const evento = entregarAtaque(jogadorId, escalado, t);
      if (evento) {
        enviado = evento.unidades;
        alvoId = evento.para;
        p.unitsSent += enviado;
      }
    }

    return {
      jogador: jogadorId,
      pontos,
      score: p.score,
      unidades,
      cancelado,
      enviado,
      alvo: alvoId,
      combo: p.combo,
      cascatas: resultado.cascades,
    };
  }

  /**
   * Avanca o relogio ate `t`: converte pendentes vencidos em pressao real e
   * elimina quem estourou. Devolve a lista de eventos ocorridos.
   */
  function avancarPara(t) {
    const saida = [];
    if (finished) return saida;

    for (const id of ordem) {
      const p = estado.get(id);
      if (!p.alive) continue;

      const entrou = p.pressure.tick(t);
      if (entrou > 0) {
        p.unitsTaken += entrou;
        if (p.pressure.current > p.peakPressure) p.peakPressure = p.pressure.current;
        saida.push(
          registrar({
            t,
            tipo: 'pressao',
            jogador: id,
            unidades: entrou,
            total: p.pressure.current,
          })
        );
      }

      if (p.pressure.dead) saida.push(...eliminar(id, t, 'colapso'));
      if (finished) break;

      if (p.combo > 0 && t - p.ultimaJogada > STREAK_TIMEOUT_MS) {
        p.combo = 0;
        saida.push(registrar({ t, tipo: 'comboZerado', jogador: id }));
      }
    }

    return saida;
  }

  function instantaneo(id) {
    const p = estado.get(id);
    if (!p) return null;
    return {
      id: p.id,
      name: p.name,
      isBot: p.isBot,
      alive: p.alive,
      score: p.score,
      pressure: p.pressure.current,
      pending: p.pressure.pending,
      alert: p.pressure.alert,
      combo: p.combo,
    };
  }

  function estatisticas(id, t) {
    const p = estado.get(id);
    if (!p) return null;
    const duracao = Math.max(1, t - startedAt);
    return {
      score: p.score,
      moves: p.moves,
      unitsSent: p.unitsSent,
      unitsCancelled: p.unitsCancelled,
      unitsTaken: p.unitsTaken,
      peakPressure: p.peakPressure,
      bestCombo: p.bestCombo,
      bestCascade: p.bestCascade,
      durationMs: duracao,
      apm: Math.round((p.unitsSent / duracao) * 60000),
    };
  }

  return {
    aplicarJogada,
    avancarPara,
    eliminar,
    instantaneo,
    estatisticas,

    /** Estado de todos, na ordem original. Para a interface desenhar. */
    todos: () => ordem.map(instantaneo),
    jogador: (id) => estado.get(id),
    get eventos() {
      return eventos;
    },
    get finished() {
      return finished;
    },
    get winnerId() {
      return winnerId;
    },
    get aliveCount() {
      return vivos().length;
    },
    /**
     * Impressao digital do estado. Duas execucoes deterministicas da mesma
     * partida tem que produzir a mesma string — e assim que o teste de replay
     * prova que a reexecucao bate com a partida original.
     */
    assinatura() {
      return ordem
        .map((id) => {
          const p = estado.get(id);
          return `${id}:${p.score}:${p.pressure.current}:${p.pressure.pending}:${p.alive ? 1 : 0}`;
        })
        .join('|');
    },
  };
}
