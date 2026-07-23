// Simulador de balanceamento.
//
// Afinar duracao de partida jogando manualmente e lento e pouco confiavel: uma
// partida boa e uma ruim nao dizem nada sobre a mediana. Este script roda
// centenas de partidas com relogio VIRTUAL (sem setTimeout, sem esperar tempo
// real) usando exatamente os mesmos modulos do jogo — mesmo tabuleiro, mesma
// tabela de ataque, mesma fila de pressao.
//
// Responde antes de publicar: "quanto dura uma partida?", "o casual ganha do
// bot normal?", "o cancelamento esta fazendo diferenca ou e enfeite?"
//
//   npm run balance

import { createRng, createMatchRandom } from '../src/core/rng.js';
import {
  createGrid,
  allMoves,
  trySwap,
  cloneGrid,
  findMove,
  shuffleGrid,
  injectGarbage,
  BLOCKER,
  COLS,
} from '../src/core/board.js';
import { createPressure } from '../src/game/pressure.js';
import { unitsForMove } from '../src/game/attack.js';
import {
  PRESSURE_MAX,
  PENDING_DELAY_MS,
  STREAK_TIMEOUT_MS,
  streakMultiplier,
  escalateUnits,
  garbageForAttack,
  PRESSURE_RELIEF_PER_GARBAGE,
} from '../src/game/balance.js';
import { DIFFICULTIES } from '../src/game/bot.js';

const TEMPO_MAXIMO_MS = 6 * 60 * 1000;

function criarAgente({ nome, thinkMs, skill, isBot, mistakeChance = 0 }, seed, matchSeed) {
  const rng = createRng(seed);
  return {
    nome,
    thinkMs,
    skill,
    isBot,
    mistakeChance,
    rng,
    // Aleatoriedade por coluna a partir da MESMA semente de partida para os
    // dois agentes: e assim que o jogo garante oportunidades iguais.
    boardRng: createMatchRandom(matchSeed, COLS),
    grid: createGrid(createRng(matchSeed)),
    pressure: createPressure(),
    score: 0,
    streak: 0,
    ultimaJogada: -Infinity,
    proximaJogada: 0,
    vivo: true,
    jogadas: 0,
    enviado: 0,
    cancelado: 0,
    recebido: 0,
    lixoRecebido: 0,
    lixoPorTipo: { pedra: 0, gelo: 0, cadeado: 0 },
  };
}

function escolherJogada(agente) {
  const jogadas = allMoves(agente.grid);
  if (!jogadas.length) return null;

  if (agente.rng.next() < agente.mistakeChance) {
    return jogadas[agente.rng.int(jogadas.length)];
  }

  const avaliadas = jogadas.map((jogada) => {
    const copia = cloneGrid(agente.grid);
    const resultado = trySwap(copia, jogada.a, jogada.b, agente.rng.fork());
    return { jogada, valor: resultado.ok ? resultado.points + resultado.cascades * 12 : -1 };
  });
  avaliadas.sort((a, b) => a.valor - b.valor);

  const inicio = Math.floor((avaliadas.length - 1) * agente.skill);
  const faixa = avaliadas.slice(inicio);
  return faixa[agente.rng.int(faixa.length)].jogada;
}

function simularPartida(configA, configB, seed) {
  const matchSeed = seed >>> 0;
  const a = criarAgente(configA, (seed ^ 0x9e3779b9) >>> 0, matchSeed);
  const b = criarAgente(configB, (seed ^ 0x85ebca6b) >>> 0, matchSeed);
  const agentes = [a, b];

  let t = 0;
  while (a.vivo && b.vivo && t < TEMPO_MAXIMO_MS) {
    const atual = agentes.reduce((x, y) => (x.proximaJogada <= y.proximaJogada ? x : y));
    t = atual.proximaJogada;
    const alvo = atual === a ? b : a;

    // Converte pendentes vencidos em pressao real, nos dois lados.
    for (const agente of agentes) {
      const { total: entrou, caidos } = agente.pressure.tick(t);
      if (entrou > 0) {
        agente.recebido += entrou;
        // Cada ataque caido gera o SEU lixo, pelo proprio tamanho e natureza.
        for (const ataque of caidos) {
          const lixo = garbageForAttack(ataque);
          if (lixo.quantidade <= 0) continue;
          injectGarbage(agente.grid, lixo.quantidade, lixo.tipo, agente.boardRng);
          agente.lixoRecebido += lixo.quantidade;
          agente.lixoPorTipo[lixo.tipo] += lixo.quantidade;
        }
        if (agente.pressure.dead) agente.vivo = false;
      }
    }
    if (!a.vivo || !b.vivo) break;

    if (!findMove(atual.grid)) shuffleGrid(atual.grid, atual.boardRng);

    const jogada = escolherJogada(atual);
    if (jogada) {
      const resultado = trySwap(atual.grid, jogada.a, jogada.b, atual.boardRng);
      if (resultado.ok && resultado.points > 0) {
        // Obstaculo destruido devolve pressao: o caminho de volta.
        const destruidos = resultado.phases.reduce(
          (soma, fase) => soma + (fase.danos || []).filter((d) => d.destruido).length,
          0
        );
        if (destruidos > 0) atual.pressure.relieve(destruidos * PRESSURE_RELIEF_PER_GARBAGE);

        if (t - atual.ultimaJogada > STREAK_TIMEOUT_MS) atual.streak = 0;
        atual.streak += 1;
        atual.ultimaJogada = t;
        atual.jogadas += 1;
        atual.score += Math.round(resultado.points * streakMultiplier(atual.streak, atual.isBot));

        const units = unitsForMove(resultado, atual.streak);
        const { sobra, cancelado } = atual.pressure.spend(units);
        atual.cancelado += cancelado;

        if (sobra > 0) {
          const enviado = escalateUnits(sobra, t);
          atual.enviado += enviado;
          alvo.pressure.queueAttack(enviado, atual.nome, t, !!resultado.comboKind);
        }
      }
    }

    const variacao = 0.75 + atual.rng.next() * 0.5;
    atual.proximaJogada = t + atual.thinkMs * variacao;
  }

  const vencedor = a.vivo && !b.vivo ? 'a' : b.vivo && !a.vivo ? 'b' : 'empate';
  return { vencedor, duracao: t, a, b };
}

const percentil = (valores, p) => {
  const ordenado = [...valores].sort((x, y) => x - y);
  return ordenado[Math.floor((ordenado.length - 1) * p)];
};
const media = (valores) => valores.reduce((s, v) => s + v, 0) / (valores.length || 1);

function rodar(rotulo, configA, configB, partidas = 300) {
  const duracoes = [];
  const enviados = [];
  const cancelados = [];
  const lixos = [];
  const porTipo = { pedra: 0, gelo: 0, cadeado: 0 };
  let vitoriasA = 0;
  let empates = 0;

  for (let i = 0; i < partidas; i++) {
    const { vencedor, duracao, a } = simularPartida(configA, configB, (i * 2654435761) >>> 0);
    duracoes.push(duracao);
    enviados.push(a.enviado);
    cancelados.push(a.cancelado);
    lixos.push(a.lixoRecebido);
    for (const k of Object.keys(porTipo)) porTipo[k] += a.lixoPorTipo[k];
    if (vencedor === 'a') vitoriasA += 1;
    if (vencedor === 'empate') empates += 1;
  }

  const seg = (ms) => (ms / 1000).toFixed(0) + 's';
  const enviadoMedio = media(enviados);
  const canceladoMedio = media(cancelados);
  // Quanto do ataque recebido foi anulado antes de virar dano. E a metrica que
  // diz se o cancelamento e uma mecanica de verdade ou so enfeite.
  const taxaCancel = enviadoMedio + canceladoMedio > 0
    ? (canceladoMedio / (canceladoMedio + enviadoMedio)) * 100
    : 0;

  console.log(
    `  ${rotulo.padEnd(24)} ` +
      `vit ${String(((vitoriasA / partidas) * 100).toFixed(0)).padStart(3)}%  ` +
      `mediana ${seg(percentil(duracoes, 0.5)).padStart(5)}  ` +
      `p90 ${seg(percentil(duracoes, 0.9)).padStart(5)}  ` +
      `enviou ${enviadoMedio.toFixed(0).padStart(3)}u  ` +
      `cancelou ${taxaCancel.toFixed(0).padStart(2)}%  ` +
      `lixo ${media(lixos).toFixed(0).padStart(2)}  ` +
      `(pedra ${(porTipo.pedra / partidas).toFixed(1)} gelo ${(porTipo.gelo / partidas).toFixed(1)} cad ${(porTipo.cadeado / partidas).toFixed(1)})` +
      (empates ? `  ARRASTADAS ${empates}` : '')
  );
}

const HUMANO = {
  iniciante: { nome: 'humano', thinkMs: 3600, skill: 0.25, isBot: false },
  casual: { nome: 'humano', thinkMs: 2400, skill: 0.5, isBot: false },
  bom: { nome: 'humano', thinkMs: 1500, skill: 0.8, isBot: false },
};

// Importado do jogo, nao copiado: se estes numeros fossem duplicados aqui,
// a simulacao mediria um bot que nao existe.
const BOT = Object.fromEntries(
  Object.entries(DIFFICULTIES).map(([chave, config]) => [
    chave,
    {
      nome: 'bot',
      thinkMs: (config.thinkMin + config.thinkMax) / 2,
      skill: config.skill,
      mistakeChance: config.mistakeChance,
      isBot: true,
    },
  ])
);

console.log(`\n  Pressao maxima ${PRESSURE_MAX}u · janela de pendencia ${PENDING_DELAY_MS}ms`);
console.log(`  (taxa de vitoria e sempre do HUMANO)\n`);

for (const [nomeHumano, humano] of Object.entries(HUMANO)) {
  console.log(`  Jogador ${nomeHumano}:`);
  for (const [nomeBot, bot] of Object.entries(BOT)) {
    rodar(`vs ${nomeBot}`, humano, bot);
  }
  console.log('');
}

console.log('  Espelho (deve dar ~50%):');
rodar('casual vs casual', HUMANO.casual, { ...HUMANO.casual, nome: 'humano2' });
rodar('bom vs bom', HUMANO.bom, { ...HUMANO.bom, nome: 'humano2' });
console.log('');
