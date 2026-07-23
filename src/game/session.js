// Regras da partida: quem esta vivo, quem ataca quem, quem venceu.
//
// A sacada de arquitetura aqui e que MODO SOLO E MODO ONLINE usam exatamente
// este mesmo codigo. No solo voce simplesmente e o anfitriao e os outros
// jogadores sao bots locais em vez de conexoes. A sessao roteia o ataque para
// "um bot", "uma conexao" ou "eu mesmo" sem que o resto do jogo saiba a
// diferenca.
//
// Autoridade: so o anfitriao decide ataque e eliminacao. Convidado PEDE para
// atacar, nao ataca. Sem isso, dois clientes discordariam sobre quem morreu.
//
// Modelo de pressao (ver pressure.js): ataque nao entra na hora. Ele fica
// pendente por alguns segundos, e uma jogada boa nesse intervalo CANCELA o
// que estava chegando antes de virar dano. Toda a tensao do jogo mora nessa
// janela.

import { createBot } from './bot.js';
import { NET_HOST_ID } from '../net/peer.js';
import { createRng } from '../core/rng.js';
import { createRecorder, verificar } from './replay.js';
import { createPressure } from './pressure.js';
import { unitsForMove } from './attack.js';
import {
  PRESSURE_MAX,
  STREAK_TIMEOUT_MS,
  streakMultiplier,
  escalateUnits,
  garbageForPressure,
  PRESSURE_RELIEF_PER_GARBAGE,
} from './balance.js';

export { PRESSURE_MAX };

/** Frequencia com que a fila de pendentes e verificada. */
const TICK_MS = 100;

export function createSession(hooks = {}) {
  let net = null;
  const bots = new Map();
  let roster = [];
  let localId = NET_HOST_ID;
  let isHost = true;
  let solo = false;
  let active = false;

  const pressure = createPressure();
  let localScore = 0;
  let comboStreak = 0;
  let lastScoringMove = 0;
  let matchStartedAt = 0;
  let tickTimer = null;
  let matchSeed = 0;
  let recorder = null;
  // Sobra de pressao que ainda nao completou um obstaculo.
  let restoDeLixo = 0;
  // Gerador dedicado as DECISOES do duelo (desempate de alvo). Semeado a partir
  // da semente da partida, para o replay reproduzir as mesmas escolhas.
  let duelRng = createRng(0);

  // Estatisticas da partida, para a tela de fim e para o perfil.
  const stats = {
    bestCombo: 0,
    bestCascade: 0,
    moves: 0,
    unitsSent: 0,
    unitsCancelled: 0,
    unitsTaken: 0,
    peakPressure: 0,
  };

  const emit = (name, ...args) => {
    const fn = hooks[name];
    if (fn) fn(...args);
  };

  const findPlayer = (id) => roster.find((p) => p.id === id);
  const elapsed = () => Date.now() - matchStartedAt;

  function syncLocalIntoRoster() {
    const me = findPlayer(localId);
    if (me) {
      me.score = localScore;
      me.pressure = pressure.current;
      me.pending = pressure.pending;
    }
  }

  function notifyRoster() {
    syncLocalIntoRoster();
    emit('onRosterChange', roster.map((p) => ({ ...p })));
  }

  // ---------------------------------------------------------------------------
  // Montagem
  // ---------------------------------------------------------------------------

  const novoJogador = (id, name, extra = {}) => ({
    id,
    name,
    alive: true,
    score: 0,
    pressure: 0,
    pending: 0,
    boardTypes: null,
    isBot: false,
    isLocal: false,
    ...extra,
  });

  function setupSolo({ playerName, opponents = 1, difficulty = 'normal' }) {
    teardownBots();
    net = null;
    solo = true;
    isHost = true;
    localId = NET_HOST_ID;

    roster = [novoJogador(localId, playerName, { isLocal: true })];

    for (let i = 0; i < opponents; i++) {
      const id = 'bot' + (i + 1);
      const bot = createBot({
        id,
        name: nomeDeBot(i, difficulty),
        difficulty,
        brainSeed: (0x9e3779b9 ^ ((i + 1) * 2654435761)) >>> 0,
        hooks: {
          onState: ({ id: botId, score, pressure: press, pending, boardTypes }) => {
            const p = findPlayer(botId);
            if (!p) return;
            p.score = score;
            p.pressure = press;
            p.pending = pending;
            p.boardTypes = boardTypes;
            notifyRoster();
          },
          onMove: (botId, a, b, t) => {
            if (recorder) recorder.registrarJogada(botId, a, b, t);
          },
          onAttack: (fromId, units) => routeAttack(fromId, units),
          onLose: (botId) => markLost(botId),
        },
      });
      bots.set(id, bot);
      roster.push(novoJogador(id, bot.name, { isBot: true }));
    }

    notifyRoster();
  }

  function setupOnline({ network, hostMode, playerName }) {
    teardownBots();
    net = network;
    solo = false;
    isHost = hostMode;

    if (hostMode) {
      localId = NET_HOST_ID;
      roster = [novoJogador(localId, playerName, { isLocal: true })];
      notifyRoster();
    } else {
      roster = [];
    }
  }

  function nomeDeBot(index, difficulty) {
    const nomes = {
      facil: ['Bala Mole', 'Pirulito', 'Marshmallow'],
      normal: ['Caramelo', 'Trufa', 'Nougat'],
      dificil: ['Pimenta', 'Cacau Amargo', 'Alcaçuz'],
      pesadelo: ['Rei Doce', 'Sombra', 'Fim da Linha'],
    };
    const lista = nomes[difficulty] || nomes.normal;
    return lista[index % lista.length];
  }

  function teardownBots() {
    for (const bot of bots.values()) bot.stop();
    bots.clear();
  }

  // ---------------------------------------------------------------------------
  // Anfitriao: entrada e saida de jogadores
  // ---------------------------------------------------------------------------

  function addNetworkPlayer(id, metadata) {
    if (findPlayer(id)) return;
    const name = (metadata && metadata.name) || 'Jogador ' + id.slice(1);
    roster.push(novoJogador(id, name));

    net.sendTo(id, { tipo: 'bemvindo', id, jogadores: rosterPayload() });
    net.broadcast({ tipo: 'roster', jogadores: rosterPayload() }, id);
    notifyRoster();
  }

  function removeNetworkPlayer(id) {
    const player = findPlayer(id);
    if (!player) return;

    if (active && player.alive) {
      // Quem cai no meio da partida conta como eliminado — senao a partida
      // nunca termina, porque o contador de vivos nunca chega a um.
      markLost(id);
    } else {
      roster = roster.filter((p) => p.id !== id);
      if (net) net.broadcast({ tipo: 'roster', jogadores: rosterPayload() });
      notifyRoster();
    }
  }

  const rosterPayload = () =>
    roster.map((p) => ({
      id: p.id,
      name: p.name,
      alive: p.alive,
      score: p.score,
      pressure: p.pressure,
      pending: p.pending,
      isBot: p.isBot,
    }));

  // ---------------------------------------------------------------------------
  // Ataque (autoridade do anfitriao)
  // ---------------------------------------------------------------------------

  /** Escolhe um alvo vivo e envia unidades. So o anfitriao chama isso. */
  function routeAttack(fromId, rawUnits) {
    if (!active || !isHost || rawUnits <= 0) return;
    const candidates = roster.filter((p) => p.alive && p.id !== fromId);
    if (!candidates.length) return;

    // Escalada depois de 75s, para nenhuma partida se arrastar. Aplicada aqui,
    // no unico ponto por onde TODO ataque passa, para nao existir caminho que
    // escape dela.
    const units = escalateUnits(rawUnits, elapsed());

    // Alvo preferencial: quem esta mais perto do colapso, contando o que ja
    // esta a caminho. Da leitura tatica em vez de sorteio no escuro.
    //
    // O desempate usa o gerador SEMEADO, nunca Math.random. Escolha de alvo e
    // regra de jogo: com Math.random, reexecutar a partida atacaria outro
    // jogador e o replay mentiria.
    candidates.sort((a, b) => b.pressure + b.pending - (a.pressure + a.pending));
    const lider = candidates[0];
    const empatados = candidates.filter((p) => p.pressure + p.pending >= lider.pressure + lider.pending - 2);
    const target = empatados[duelRng.int(empatados.length)];

    emit('onAttackSent', fromId, target.id, units);
    deliverAttack(target.id, units, fromId);
  }

  function deliverAttack(targetId, units, fromId) {
    const target = findPlayer(targetId);
    if (!target || !target.alive) return;

    if (targetId === localId) {
      pressure.queueAttack(units, fromId);
      syncLocalIntoRoster();
      emit('onPendingChange', pressure.pending, pressure.current, pressure.alert);
      emit('onIncoming', units, fromId);
      broadcastLocalState();
      return;
    }

    const bot = bots.get(targetId);
    if (bot) {
      bot.receiveAttack(units, fromId);
      return;
    }

    if (net) net.sendTo(targetId, { tipo: 'ataque', unidades: units, de: fromId });
  }

  /** O jogador caiu por pressao propria, ou por algo externo ao jogo? */
  function pressureCollapsed(id) {
    if (id === localId) return pressure.dead;
    const bot = bots.get(id);
    return bot ? bot.pressure >= PRESSURE_MAX : false;
  }

  function markLost(id) {
    if (!isHost) return;
    const player = findPlayer(id);
    if (!player || !player.alive) return;

    player.alive = false;
    const bot = bots.get(id);
    if (bot) bot.stop();
    // Colapso por pressao e derivavel na reexecucao; saida por fora do jogo
    // (desconexao, desistencia) nao e, entao precisa ser gravada.
    if (recorder && !pressureCollapsed(id)) recorder.registrarSaida(id, Date.now(), 'saiu');

    if (net) net.broadcast({ tipo: 'perdeu', id });
    emit('onPlayerEliminated', id);
    if (id === localId) emit('onLocalEliminated');
    notifyRoster();

    const vivos = roster.filter((p) => p.alive);
    if (vivos.length <= 1) finish(vivos[0] ? vivos[0].id : null);
  }

  function finish(winnerId) {
    if (!active) return;
    active = false;
    if (recorder) recorder.finalizar(winnerId, Date.now());
    stopTicking();
    teardownBots();
    if (net && isHost) net.broadcast({ tipo: 'fim', vencedorId: winnerId });
    emit('onGameEnd', winnerId, resumo(winnerId));
  }

  function resumo(winnerId) {
    const duracao = Math.max(1, elapsed());
    return {
      score: localScore,
      bestCombo: stats.bestCombo,
      bestCascade: stats.bestCascade,
      moves: stats.moves,
      unitsSent: stats.unitsSent,
      unitsCancelled: stats.unitsCancelled,
      unitsTaken: stats.unitsTaken,
      peakPressure: stats.peakPressure,
      durationMs: duracao,
      // Ataques por minuto: a metrica que mede o quanto voce pressionou.
      apm: Math.round((stats.unitsSent / duracao) * 60000),
      solo,
      won: winnerId === localId,
    };
  }

  // ---------------------------------------------------------------------------
  // Jogada do jogador local
  // ---------------------------------------------------------------------------

  /**
   * Chamado quando o jogador local resolve uma jogada.
   * Devolve o detalhamento para a UI mostrar ("+3", "cancelou 2", etc).
   */
  function reportLocalMove(result, a, b) {
    if (!active || !result || !result.ok) return null;

    const now = Date.now();
    if (recorder && a !== undefined) recorder.registrarJogada(localId, a, b, now);
    if (now - lastScoringMove > STREAK_TIMEOUT_MS) comboStreak = 0;
    comboStreak += 1;
    lastScoringMove = now;
    stats.moves += 1;
    if (comboStreak > stats.bestCombo) stats.bestCombo = comboStreak;
    if (result.cascades > stats.bestCascade) stats.bestCascade = result.cascades;

    // Pontuacao e so placar/recorde. Quem decide a partida e a unidade de
    // ataque, que tem tabela propria em attack.js.
    const points = Math.round(result.points * streakMultiplier(comboStreak));
    localScore += points;

    const units = unitsForMove(result, comboStreak);
    // Cancelar vem antes de atacar: o que esta caindo na sua cabeca e mais
    // urgente do que o que voce pode fazer na cabeca alheia.
    const { sobra, cancelado } = pressure.spend(units);
    stats.unitsCancelled += cancelado;

    syncLocalIntoRoster();
    broadcastLocalState();
    emit('onLocalMove', {
      points,
      totalScore: localScore,
      units,
      cancelled: cancelado,
      sent: sobra,
      combo: comboStreak,
      cascades: result.cascades,
      alert: pressure.alert,
    });

    if (sobra > 0) {
      stats.unitsSent += sobra;
      if (isHost) routeAttack(localId, sobra);
      else net.sendToHost({ tipo: 'pedidoAtaque', unidades: sobra });
    }

    return { points, units, cancelled: cancelado, sent: sobra };
  }

  function broadcastLocalState() {
    const payload = {
      tipo: 'estado',
      id: localId,
      score: localScore,
      pressure: pressure.current,
      pending: pressure.pending,
      boardTypes: hooks.getLocalBoardTypes ? hooks.getLocalBoardTypes() : null,
    };

    if (!net) {
      notifyRoster();
      return;
    }
    if (isHost) {
      const me = findPlayer(localId);
      if (me) me.boardTypes = payload.boardTypes;
      net.broadcast(payload);
    } else {
      net.sendToHost(payload);
    }
    notifyRoster();
  }

  // ---------------------------------------------------------------------------
  // Relogio: converte pendente em pressao real
  // ---------------------------------------------------------------------------

  function tick() {
    if (!active) return;
    const now = Date.now();

    const entrou = pressure.tick(now);
    if (entrou > 0) {
      stats.unitsTaken += entrou;
      if (pressure.current > stats.peakPressure) stats.peakPressure = pressure.current;
      syncLocalIntoRoster();
      emit('onPressureLanded', entrou, pressure.current, pressure.alert);

      // A pressao que entrou tambem suja o tabuleiro. Quem desenha decide
      // quando aplicar (nao pode ser no meio de uma cascata).
      const { quantidade, resto } = garbageForPressure(entrou, restoDeLixo);
      restoDeLixo = resto;
      if (quantidade > 0) emit('onGarbage', quantidade);

      broadcastLocalState();

      if (pressure.dead) {
        if (isHost) markLost(localId);
        else {
          net.sendToHost({ tipo: 'perdi' });
          emit('onLocalEliminated');
        }
        return;
      }
    }

    for (const bot of bots.values()) bot.tick(now);

    if (comboStreak > 0 && now - lastScoringMove > STREAK_TIMEOUT_MS) {
      comboStreak = 0;
      emit('onComboReset');
    }

    emit('onTick', {
      pressure: pressure.current,
      pending: pressure.pending,
      alert: pressure.alert,
      ratio: pressure.ratio,
      pendingRatio: pressure.pendingRatio,
    });
  }

  function startTicking() {
    stopTicking();
    tickTimer = setInterval(tick, TICK_MS);
  }

  function stopTicking() {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;
  }

  // ---------------------------------------------------------------------------
  // Protocolo
  // ---------------------------------------------------------------------------

  function handleMessage(fromId, msg) {
    switch (msg.tipo) {
      case 'bemvindo':
        localId = msg.id;
        if (net) net.setMyId(msg.id);
        roster = msg.jogadores.map((p) => ({ ...p, isLocal: p.id === msg.id, boardTypes: null }));
        notifyRoster();
        emit('onJoinedRoom', msg.id);
        break;

      case 'roster':
        roster = msg.jogadores.map((p) => ({
          ...p,
          isLocal: p.id === localId,
          boardTypes: (findPlayer(p.id) || {}).boardTypes || null,
        }));
        notifyRoster();
        break;

      case 'recusado':
        emit('onRefused', msg.motivo === 'cheia' ? 'Essa sala já está cheia.' : 'A partida já começou nessa sala.');
        break;

      case 'iniciar':
        roster = msg.jogadores.map((p) => ({
          ...p,
          isLocal: p.id === localId,
          alive: true,
          score: 0,
          pressure: 0,
          pending: 0,
          boardTypes: null,
        }));
        beginLocal(msg.semente);
        emit('onStart', msg.semente);
        break;

      case 'estado': {
        const p = findPlayer(msg.id);
        if (p) {
          p.score = msg.score;
          p.pressure = msg.pressure;
          p.pending = msg.pending;
          p.boardTypes = msg.boardTypes;
        }
        // O anfitriao e o unico que ve todo mundo, entao ele repassa.
        if (isHost && net) net.broadcast(msg, msg.id);
        notifyRoster();
        break;
      }

      case 'pedidoAtaque':
        if (isHost) routeAttack(fromId, msg.unidades);
        break;

      case 'ataque':
        if (active) {
          pressure.queueAttack(msg.unidades, msg.de);
          syncLocalIntoRoster();
          emit('onPendingChange', pressure.pending, pressure.current, pressure.alert);
          emit('onIncoming', msg.unidades, msg.de);
          broadcastLocalState();
        }
        break;

      case 'perdi':
        if (isHost) markLost(fromId);
        break;

      case 'perdeu': {
        const p = findPlayer(msg.id);
        if (p) p.alive = false;
        emit('onPlayerEliminated', msg.id);
        notifyRoster();
        break;
      }

      case 'fim':
        active = false;
        stopTicking();
        emit('onGameEnd', msg.vencedorId, resumo(msg.vencedorId));
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Ciclo da partida
  // ---------------------------------------------------------------------------

  function beginLocal(semente) {
    matchSeed = semente >>> 0;
    // Semente derivada: mexer nas decisoes do duelo nao embaralha o tabuleiro.
    duelRng = createRng((matchSeed ^ 0xa77ac4) >>> 0);
    // Os bots jogam no MESMO tabuleiro que o jogador recebeu.
    for (const bot of bots.values()) bot.reset(matchSeed);

    // So o modo solo e gravavel: no online o anfitriao nao recebe as JOGADAS
    // do convidado (so os pedidos de ataque), entao nao teria como reconstruir
    // o tabuleiro dele. Gravar pela metade daria um replay que mente.
    recorder = solo
      ? createRecorder({
          seed: matchSeed,
          players: roster.map((p) => ({ id: p.id, name: p.name, isBot: p.isBot })),
          startedAt: Date.now(),
        })
      : null;

    active = true;
    pressure.reset();
    localScore = 0;
    comboStreak = 0;
    lastScoringMove = 0;
    matchStartedAt = Date.now();
    restoDeLixo = 0;
    Object.assign(stats, {
      bestCombo: 0,
      bestCascade: 0,
      moves: 0,
      unitsSent: 0,
      unitsCancelled: 0,
      unitsTaken: 0,
      peakPressure: 0,
    });

    for (const p of roster) {
      p.alive = true;
      p.score = 0;
      p.pressure = 0;
      p.pending = 0;
      p.boardTypes = null;
    }
    notifyRoster();
    startTicking();
  }

  /** So o anfitriao (ou o solo) inicia. */
  function start() {
    const semente = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    if (net && isHost) {
      net.closeRoom();
      net.broadcast({ tipo: 'iniciar', jogadores: rosterPayload(), semente });
    }
    beginLocal(semente);
    emit('onStart', semente);
  }

  /**
   * Obstaculos destruidos devolvem pressao. E o caminho de volta: o lixo no
   * seu tabuleiro nao e so estorvo, e pressao removivel.
   */
  function relieveFromGarbage(quantidade) {
    if (!active || quantidade <= 0) return 0;
    const alivio = quantidade * PRESSURE_RELIEF_PER_GARBAGE;
    pressure.relieve(alivio);
    syncLocalIntoRoster();
    broadcastLocalState();
    return alivio;
  }

  /** Chamado quando a contagem regressiva acaba e o tabuleiro fica jogavel. */
  function launchBots() {
    matchStartedAt = Date.now();
    for (const bot of bots.values()) bot.start();
  }

  function abandon() {
    active = false;
    stopTicking();
    teardownBots();
  }

  return {
    setupSolo,
    setupOnline,
    addNetworkPlayer,
    removeNetworkPlayer,
    handleMessage,
    reportLocalMove,
    relieveFromGarbage,
    broadcastLocalState,

    /** Replay da ultima partida solo, ou null. Ja vem conferido. */
    replayDaPartida() {
      if (!recorder) return null;
      const dados = recorder.toJSON();
      return { dados, veredito: verificar(dados) };
    },
    start,
    launchBots,
    abandon,
    finish,

    get roster() {
      return roster;
    },
    get localId() {
      return localId;
    },
    get isHost() {
      return isHost;
    },
    get isSolo() {
      return solo;
    },
    get active() {
      return active;
    },
    get localScore() {
      return localScore;
    },
    get pressure() {
      return pressure.current;
    },
    get pending() {
      return pressure.pending;
    },
    get alert() {
      return pressure.alert;
    },
    get pressureRatio() {
      return pressure.ratio;
    },
    get pendingRatio() {
      return pressure.pendingRatio;
    },
    get comboStreak() {
      return comboStreak;
    },
    get aliveCount() {
      return roster.filter((p) => p.alive).length;
    },
  };
}
