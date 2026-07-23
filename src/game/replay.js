// Replay deterministico.
//
// Nao guarda video nem estado quadro a quadro. Guarda apenas o que NAO da para
// derivar:
//
//   semente     -> reconstroi o tabuleiro inicial e toda a sequencia de pecas
//   jogadas     -> as trocas que cada jogador fez, com o instante de cada uma
//   eliminacoes -> so as que vem de fora do jogo (desconexao); colapso e
//                  consequencia e se recalcula sozinho
//
// Tudo o mais — cascatas, especiais, ataque, cancelamento, pressao, vencedor —
// e reexecutado pelas mesmas regras da partida original. Uma partida de tres
// minutos cabe em alguns kilobytes.
//
// Isso e o que destrava, com um arquivo so: assistir de novo, espectador,
// depuracao de bug ("me manda a partida"), analise, e a base do anti-cheat
// (o servidor reexecuta e confere se o resultado declarado bate).

import { createMatchRandom } from '../core/rng.js';
import { createGrid, trySwap, findMove, shuffleGrid, COLS } from '../core/board.js';
import { createMatch } from './match.js';

export const REPLAY_VERSION = 1;

// ---------------------------------------------------------------------------
// Gravacao
// ---------------------------------------------------------------------------

/**
 * IMPORTANTE: os instantes gravados sao arredondados para milissegundo
 * inteiro, para o arquivo ficar pequeno. Isso so e seguro porque o jogo marca
 * o tempo com Date.now(), que ja e inteiro.
 *
 * Se algum dia o relogio da partida passar a usar performance.now() (que tem
 * casas decimais), o replay vai divergir da partida original de forma
 * silenciosa — os eventos saem certos mas em instantes levemente diferentes,
 * e o resultado pode mudar numa disputa apertada. Nesse caso: ou quantize o
 * tempo na origem, ou pare de arredondar aqui.
 */
export function createRecorder({ seed, players, startedAt = 0 }) {
  const jogadas = [];
  const eliminacoes = [];
  let duracao = 0;
  let vencedor = null;

  return {
    /** Uma troca feita por um jogador. `t` e relativo ao inicio da partida. */
    registrarJogada(jogadorId, a, b, t) {
      const rel = Math.max(0, Math.round(t - startedAt));
      jogadas.push({ t: rel, j: jogadorId, a, b });
      if (rel > duracao) duracao = rel;
    },

    /**
     * Eliminacao que NAO vem da regra do jogo (queda de conexao, desistencia).
     * Colapso por pressao nao entra: ele e derivado na reexecucao.
     */
    registrarSaida(jogadorId, t, motivo = 'saiu') {
      const rel = Math.max(0, Math.round(t - startedAt));
      eliminacoes.push({ t: rel, j: jogadorId, motivo });
      if (rel > duracao) duracao = rel;
    },

    finalizar(vencedorId, t) {
      vencedor = vencedorId;
      duracao = Math.max(duracao, Math.round(t - startedAt));
    },

    toJSON() {
      return {
        versao: REPLAY_VERSION,
        seed: seed >>> 0,
        criadoEm: new Date().toISOString(),
        jogadores: players.map((p) => ({
          id: p.id,
          name: p.name,
          isBot: !!p.isBot,
          difficulty: p.difficulty || null,
        })),
        jogadas,
        eliminacoes,
        duracao,
        vencedor,
      };
    },

    get totalJogadas() {
      return jogadas.length;
    },
  };
}

// ---------------------------------------------------------------------------
// Reexecucao
// ---------------------------------------------------------------------------

/**
 * Reexecuta uma partida gravada.
 *
 * Cada jogador recebe um tabuleiro reconstruido da MESMA semente — e por isso
 * que a semente compartilhada por coluna nao e so uma questao de justica, e
 * tambem o que torna o replay possivel com poucos bytes.
 *
 * `aoPassar` (opcional) e chamado a cada jogada com o estado da partida, para
 * um visualizador desenhar a reexecucao passo a passo.
 */
export function playback(replay, { aoPassar = null } = {}) {
  if (!replay || replay.versao !== REPLAY_VERSION) {
    throw new Error(`replay incompativel (versao ${replay && replay.versao})`);
  }

  const seed = replay.seed >>> 0;
  const partida = createMatch({ seed, players: replay.jogadores, startedAt: 0 });

  // Um tabuleiro e um gerador por jogador, ambos derivados da mesma semente.
  // O gerador PRECISA ser o mesmo usado para criar o tabuleiro, senao o
  // reabastecimento sai de um ponto diferente do fluxo.
  const tabuleiros = new Map();
  for (const jogador of replay.jogadores) {
    const rng = createMatchRandom(seed, COLS);
    tabuleiros.set(jogador.id, { grid: createGrid(rng), rng });
  }

  // Jogadas e saidas numa unica linha do tempo. Saidas primeiro no empate: se
  // alguem caiu no mesmo instante, ele nao deveria ter jogado.
  const linhaDoTempo = [
    ...replay.eliminacoes.map((e) => ({ t: e.t, ordem: 0, tipo: 'saida', ...e })),
    ...replay.jogadas.map((m) => ({ t: m.t, ordem: 1, tipo: 'jogada', ...m })),
  ].sort((x, y) => x.t - y.t || x.ordem - y.ordem);

  const resultados = [];

  for (const entrada of linhaDoTempo) {
    partida.avancarPara(entrada.t);
    if (partida.finished) break;

    if (entrada.tipo === 'saida') {
      partida.eliminar(entrada.j, entrada.t, entrada.motivo);
      continue;
    }

    const mesa = tabuleiros.get(entrada.j);
    if (!mesa) continue;

    // O embaralhamento por falta de jogada tambem e deterministico: ele
    // consome do mesmo gerador, na mesma ordem que consumiu ao vivo.
    if (!findMove(mesa.grid)) shuffleGrid(mesa.grid, mesa.rng);

    const resultado = trySwap(mesa.grid, entrada.a, entrada.b, mesa.rng);
    const aplicado = partida.aplicarJogada(entrada.j, resultado, entrada.t);
    if (aplicado) resultados.push({ t: entrada.t, ...aplicado });

    if (aoPassar) {
      aoPassar({
        t: entrada.t,
        jogador: entrada.j,
        jogada: { a: entrada.a, b: entrada.b },
        resultado,
        aplicado,
        jogadores: partida.todos(),
      });
    }
  }

  partida.avancarPara(replay.duracao);

  return {
    vencedor: partida.winnerId,
    finalizada: partida.finished,
    assinatura: partida.assinatura(),
    jogadores: partida.todos(),
    eventos: partida.eventos,
    resultados,
    estatisticas: Object.fromEntries(
      replay.jogadores.map((p) => [p.id, partida.estatisticas(p.id, replay.duracao)])
    ),
  };
}

/**
 * Confere se um replay reproduz o resultado que ele mesmo declara.
 *
 * E a peca que torna o replay confiavel em vez de decorativo: se a reexecucao
 * chega a outro vencedor, ou o arquivo esta corrompido, ou alguma regra deixou
 * de ser deterministica, ou o resultado foi adulterado. E tambem o esqueleto
 * da validacao de partida do lado do servidor, quando existir.
 */
export function verificar(replay) {
  try {
    const saida = playback(replay);
    const bate = saida.vencedor === replay.vencedor;
    return {
      valido: bate,
      esperado: replay.vencedor,
      obtido: saida.vencedor,
      assinatura: saida.assinatura,
      motivo: bate ? null : 'o vencedor reexecutado difere do gravado',
    };
  } catch (erro) {
    return { valido: false, motivo: erro.message, esperado: replay.vencedor, obtido: null };
  }
}

/** Texto compacto para o jogador copiar e mandar para alguem. */
export function serializar(replay) {
  return JSON.stringify(replay);
}

export function desserializar(texto) {
  const dados = JSON.parse(texto);
  if (!dados || dados.versao !== REPLAY_VERSION) {
    throw new Error('arquivo de replay invalido ou de outra versao');
  }
  return dados;
}
