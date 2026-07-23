// Simulador de balanceamento.
//
// Afinar duracao de partida jogando manualmente e lento e pouco confiavel: uma
// partida boa e uma ruim nao dizem nada sobre a mediana. Este script roda
// milhares de partidas com relogio VIRTUAL (sem setTimeout, sem esperar tempo
// real) usando exatamente as mesmas regras do jogo, e reporta a distribuicao.
//
// Serve para responder: "quanto tempo dura uma partida?" e "um jogador mediano
// consegue ganhar do bot no normal?" — antes de publicar, nao depois.
//
//   npm run balance

import { createRng } from '../src/core/rng.js';
import { createGrid, allMoves, trySwap, cloneGrid, findMove, shuffleGrid } from '../src/core/board.js';
import { BAR_MAX, STREAK_TIMEOUT_MS, streakMultiplier, applyPower, BAR_DIVISOR, escalation } from '../src/game/balance.js';
import { DIFFICULTIES } from '../src/game/bot.js';

const TEMPO_MAXIMO_MS = 6 * 60 * 1000; // partida que passa disso conta como arrastada

/**
 * Um agente e "um jogador" — humano ou bot, o modelo e o mesmo.
 * `skill` 0..1 = de que ponto da lista de jogadas ordenadas ele escolhe.
 * `thinkMs` = intervalo medio entre jogadas.
 */
function criarAgente({ nome, thinkMs, skill, seed, isBot, mistakeChance = 0 }) {
  const rng = createRng(seed);
  return {
    nome,
    thinkMs,
    skill,
    isBot,
    mistakeChance,
    rng,
    grid: createGrid(rng),
    score: 0,
    bar: 0,
    streak: 0,
    ultimaJogada: -Infinity,
    proximaJogada: 0,
    vivo: true,
    jogadas: 0,
    danoEnviado: 0,
  };
}

function escolherJogada(agente) {
  const jogadas = allMoves(agente.grid);
  if (!jogadas.length) return null;

  // Mesmo "erro bobo" que o bot real comete (ver chooseMove em bot.js).
  if (agente.rng.next() < agente.mistakeChance) {
    return jogadas[agente.rng.int(jogadas.length)];
  }

  const avaliadas = jogadas.map((jogada) => {
    const copia = cloneGrid(agente.grid);
    const r = agente.rng.fork();
    const resultado = trySwap(copia, jogada.a, jogada.b, r);
    return { jogada, valor: resultado.ok ? resultado.points + resultado.cascades * 12 : -1 };
  });
  avaliadas.sort((a, b) => a.valor - b.valor);

  const inicio = Math.floor((avaliadas.length - 1) * agente.skill);
  const faixa = avaliadas.slice(inicio);
  return faixa[agente.rng.int(faixa.length)].jogada;
}

function simularPartida(configA, configB, seed) {
  const a = criarAgente({ ...configA, seed: seed ^ 0x9e3779b9 });
  const b = criarAgente({ ...configB, seed: seed ^ 0x85ebca6b });
  const agentes = [a, b];

  let t = 0;
  while (a.vivo && b.vivo && t < TEMPO_MAXIMO_MS) {
    // Avanca o relogio direto para quem joga primeiro.
    const atual = agentes.reduce((x, y) => (x.proximaJogada <= y.proximaJogada ? x : y));
    t = atual.proximaJogada;
    const alvo = atual === a ? b : a;

    if (!findMove(atual.grid)) shuffleGrid(atual.grid, atual.rng);

    const jogada = escolherJogada(atual);
    if (jogada) {
      const resultado = trySwap(atual.grid, jogada.a, jogada.b, atual.rng);
      if (resultado.ok && resultado.points > 0) {
        if (t - atual.ultimaJogada > STREAK_TIMEOUT_MS) atual.streak = 0;
        atual.streak += 1;
        atual.ultimaJogada = t;
        atual.jogadas += 1;

        const pontos = Math.round(resultado.points * streakMultiplier(atual.streak, atual.isBot));
        atual.score += pontos;

        const { newBar, overflow } = applyPower(pontos, atual.bar);
        atual.bar = newBar;

        if (overflow > 0) {
          const dano = overflow * escalation(t);
          alvo.bar = Math.min(BAR_MAX * 1.5, alvo.bar + dano);
          atual.danoEnviado += dano;
          if (alvo.bar >= BAR_MAX) alvo.vivo = false;
        }
      }
    }

    const variacao = 0.75 + atual.rng.next() * 0.5;
    atual.proximaJogada = t + atual.thinkMs * variacao;
  }

  const vencedor = a.vivo && !b.vivo ? 'a' : b.vivo && !a.vivo ? 'b' : 'empate';
  return { vencedor, duracao: t, a, b };
}

function percentil(valores, p) {
  const ordenado = [...valores].sort((x, y) => x - y);
  return ordenado[Math.floor((ordenado.length - 1) * p)];
}

function rodar(rotulo, configA, configB, partidas = 400) {
  const duracoes = [];
  let vitoriasA = 0;
  let empates = 0;
  const jogadasA = [];

  for (let i = 0; i < partidas; i++) {
    const { vencedor, duracao, a } = simularPartida(configA, configB, (i * 2654435761) >>> 0);
    duracoes.push(duracao);
    jogadasA.push(a.jogadas);
    if (vencedor === 'a') vitoriasA += 1;
    if (vencedor === 'empate') empates += 1;
  }

  const seg = (ms) => (ms / 1000).toFixed(0) + 's';
  const taxa = ((vitoriasA / partidas) * 100).toFixed(0);

  console.log(
    `  ${rotulo.padEnd(26)} ` +
      `vitoria ${String(taxa).padStart(3)}%  ` +
      `mediana ${seg(percentil(duracoes, 0.5)).padStart(5)}  ` +
      `p10 ${seg(percentil(duracoes, 0.1)).padStart(5)}  ` +
      `p90 ${seg(percentil(duracoes, 0.9)).padStart(5)}` +
      (empates ? `  arrastadas ${empates}` : '')
  );
}

// Perfis de jogador humano, do iniciante ao bom.
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

console.log(`\n  Balanceamento — BAR_DIVISOR = ${BAR_DIVISOR}, barra = ${BAR_MAX}`);
console.log(`  (taxa de vitoria e sempre do HUMANO)\n`);

for (const [nomeHumano, humano] of Object.entries(HUMANO)) {
  console.log(`  Jogador ${nomeHumano}:`);
  for (const [nomeBot, bot] of Object.entries(BOT)) {
    rodar(`  vs bot ${nomeBot}`, humano, bot);
  }
  console.log('');
}

console.log('  Espelho (mesmo perfil dos dois lados) — deve dar ~50%:');
rodar('  casual vs casual', HUMANO.casual, { ...HUMANO.casual, nome: 'humano2' });
console.log('');
