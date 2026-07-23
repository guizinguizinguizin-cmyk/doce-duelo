// Regras da partida: quem esta vivo, quem ataca quem, quem venceu.
//
// A sacada de arquitetura aqui e que MODO SOLO E MODO ONLINE usam exatamente
// este mesmo codigo. No solo voce simplesmente e o anfitriao e os outros
// jogadores sao bots locais em vez de conexoes. A sessao roteia o ataque para
// "um bot", "uma conexao" ou "eu mesmo" sem que o resto do jogo saiba a
// diferenca.
//
// Autoridade: so o anfitriao decide dano e eliminacao. Convidado PEDE para
// atacar, nao ataca. Sem isso, dois clientes discordariam sobre quem morreu.

import { createBot } from './bot.js';
import { NET_HOST_ID } from '../net/peer.js';
import {
  BAR_MAX,
  BAR_OVERFLOW_CAP,
  STREAK_TIMEOUT_MS,
  streakMultiplier,
  applyPower,
  escalation,
} from './balance.js';

export { BAR_MAX };

export function createSession(hooks = {}) {
  let net = null;
  let bots = new Map();
  let roster = [];
  let localId = NET_HOST_ID;
  let isHost = true;
  let solo = false;
  let active = false;

  let localScore = 0;
  let localBar = 0;
  let comboStreak = 0;
  let lastScoringMove = 0;
  let bestCombo = 0;
  let bestCascade = 0;
  let matchStartedAt = 0;

  const emit = (name, ...args) => {
    const fn = hooks[name];
    if (fn) fn(...args);
  };

  const findPlayer = (id) => roster.find((p) => p.id === id);

  function syncLocalIntoRoster() {
    const me = findPlayer(localId);
    if (me) {
      me.score = localScore;
      me.bar = Math.min(BAR_MAX, localBar);
    }
  }

  function notifyRoster() {
    syncLocalIntoRoster();
    emit('onRosterChange', roster.map((p) => ({ ...p })));
  }

  // ---------------------------------------------------------------------------
  // Montagem
  // ---------------------------------------------------------------------------

  function setupSolo({ playerName, opponents = 1, difficulty = 'normal' }) {
    teardownBots();
    net = null;
    solo = true;
    isHost = true;
    localId = NET_HOST_ID;

    roster = [{ id: localId, name: playerName, alive: true, score: 0, bar: 0, boardTypes: null, isBot: false, isLocal: true }];

    for (let i = 0; i < opponents; i++) {
      const id = 'bot' + (i + 1);
      const bot = createBot({
        id,
        name: nomeDeBot(i, difficulty),
        difficulty,
        seed: (Date.now() + i * 7919) >>> 0,
        hooks: {
          onState: ({ id: botId, score, bar, boardTypes }) => {
            const p = findPlayer(botId);
            if (!p) return;
            p.score = score;
            p.bar = bar;
            p.boardTypes = boardTypes;
            notifyRoster();
          },
          onAttack: (fromId, amount) => routeAttack(fromId, amount),
          onLose: (botId) => markLost(botId),
        },
      });
      bots.set(id, bot);
      roster.push({ id, name: bot.name, alive: true, score: 0, bar: 0, boardTypes: null, isBot: true, isLocal: false });
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
      roster = [{ id: localId, name: playerName, alive: true, score: 0, bar: 0, boardTypes: null, isBot: false, isLocal: true }];
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
    roster.push({ id, name, alive: true, score: 0, bar: 0, boardTypes: null, isBot: false, isLocal: false });

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
    roster.map((p) => ({ id: p.id, name: p.name, alive: p.alive, score: p.score, bar: p.bar, isBot: p.isBot }));

  // ---------------------------------------------------------------------------
  // Ataques (autoridade do anfitriao)
  // ---------------------------------------------------------------------------

  /** Escolhe um alvo vivo e entrega o dano. So o anfitriao chama isso. */
  function routeAttack(fromId, rawAmount) {
    if (!active || !isHost) return;
    const candidates = roster.filter((p) => p.alive && p.id !== fromId);
    if (!candidates.length) return;

    // Escalada: depois de 75s o dano cresce, para nenhuma partida se arrastar.
    // Aplicada aqui, no unico ponto por onde TODO ataque passa — jogador, bot
    // e rede — para nao existir caminho que escape dela.
    const amount = rawAmount * escalation(Date.now() - matchStartedAt);

    // Alvo preferencial: quem esta com a barra mais cheia (mais perto de
    // perder). Da uma leitura tatica ao jogo em vez de sortear no escuro.
    candidates.sort((a, b) => b.bar - a.bar);
    const top = candidates.filter((p) => p.bar >= candidates[0].bar - 12);
    const target = top[Math.floor(Math.random() * top.length)];

    emit('onAttackSent', fromId, target.id, amount);
    deliverDamage(target.id, amount, fromId);
  }

  function deliverDamage(targetId, amount, fromId) {
    const target = findPlayer(targetId);
    if (!target || !target.alive) return;

    if (targetId === localId) {
      applyLocalDamage(amount, fromId);
      return;
    }

    const bot = bots.get(targetId);
    if (bot) {
      bot.takeDamage(amount);
      return;
    }

    if (net) net.sendTo(targetId, { tipo: 'ataque', quantidade: amount, de: fromId });
  }

  function applyLocalDamage(amount, fromId) {
    localBar = Math.min(BAR_OVERFLOW_CAP, localBar + amount);
    syncLocalIntoRoster();
    emit('onLocalDamage', amount, fromId, localBar);
    broadcastLocalState();

    if (localBar >= BAR_MAX) {
      if (isHost) markLost(localId);
      else {
        net.sendToHost({ tipo: 'perdi' });
        emit('onLocalEliminated');
      }
    }
  }

  function markLost(id) {
    if (!isHost) return;
    const player = findPlayer(id);
    if (!player || !player.alive) return;

    player.alive = false;
    const bot = bots.get(id);
    if (bot) bot.stop();

    if (net) net.broadcast({ tipo: 'perdeu', id });
    emit('onPlayerEliminated', id);
    if (id === localId) emit('onLocalEliminated');
    notifyRoster();

    const vivos = roster.filter((p) => p.alive);
    if (vivos.length <= 1) {
      const vencedor = vivos[0] || null;
      finish(vencedor ? vencedor.id : null);
    }
  }

  function finish(winnerId) {
    if (!active) return;
    active = false;
    teardownBots();
    if (net && isHost) net.broadcast({ tipo: 'fim', vencedorId: winnerId });
    emit('onGameEnd', winnerId, {
      score: localScore,
      bestCombo,
      bestCascade,
      solo,
      won: winnerId === localId,
    });
  }

  // ---------------------------------------------------------------------------
  // Pontuacao do jogador local
  // ---------------------------------------------------------------------------

  /**
   * Chamado quando o jogador local resolve uma jogada.
   * Devolve os pontos finais (ja com multiplicador de sequencia) para a UI
   * mostrar no popup.
   */
  function reportLocalPoints(rawPoints, cascades = 1) {
    if (!active || rawPoints <= 0) return 0;

    const now = Date.now();
    if (now - lastScoringMove > STREAK_TIMEOUT_MS) comboStreak = 0;
    comboStreak += 1;
    lastScoringMove = now;
    if (comboStreak > bestCombo) bestCombo = comboStreak;
    if (cascades > bestCascade) bestCascade = cascades;

    const multiplier = streakMultiplier(comboStreak);
    const points = Math.round(rawPoints * multiplier);
    localScore += points;

    const { newBar, overflow } = applyPower(points, localBar);
    localBar = newBar;

    syncLocalIntoRoster();
    broadcastLocalState();
    emit('onLocalScore', points, localScore, comboStreak, multiplier);

    if (overflow > 0) {
      if (isHost) routeAttack(localId, overflow);
      else net.sendToHost({ tipo: 'pedidoAtaque', quantidade: overflow });
    }

    return points;
  }

  function broadcastLocalState() {
    const payload = {
      tipo: 'estado',
      id: localId,
      score: localScore,
      bar: Math.min(BAR_MAX, localBar),
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
        roster = msg.jogadores.map((p) => ({ ...p, isLocal: p.id === localId, alive: true, score: 0, bar: 0, boardTypes: null }));
        beginLocal();
        emit('onStart', msg.semente);
        break;

      case 'estado': {
        const p = findPlayer(msg.id);
        if (p) {
          p.score = msg.score;
          p.bar = msg.bar;
          p.boardTypes = msg.boardTypes;
        }
        // O anfitriao e o unico que ve todo mundo, entao ele repassa.
        if (isHost && net) net.broadcast(msg, msg.id);
        notifyRoster();
        break;
      }

      case 'pedidoAtaque':
        if (isHost) routeAttack(fromId, msg.quantidade);
        break;

      case 'ataque':
        if (active) applyLocalDamage(msg.quantidade, msg.de);
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
        emit('onGameEnd', msg.vencedorId, {
          score: localScore,
          bestCombo,
          bestCascade,
          solo: false,
          won: msg.vencedorId === localId,
        });
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Ciclo da partida
  // ---------------------------------------------------------------------------

  function beginLocal() {
    active = true;
    localScore = 0;
    localBar = 0;
    comboStreak = 0;
    bestCombo = 0;
    bestCascade = 0;
    lastScoringMove = 0;
    matchStartedAt = Date.now();
    for (const p of roster) {
      p.alive = true;
      p.score = 0;
      p.bar = 0;
      p.boardTypes = null;
    }
    notifyRoster();
  }

  /** So o anfitriao (ou o solo) inicia. */
  function start() {
    const semente = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    if (net && isHost) {
      net.closeRoom();
      net.broadcast({ tipo: 'iniciar', jogadores: rosterPayload(), semente });
    }
    beginLocal();
    emit('onStart', semente);
  }

  /** Chamado quando a contagem regressiva acaba e o tabuleiro fica jogavel. */
  function launchBots() {
    for (const bot of bots.values()) bot.start();
  }

  function abandon() {
    active = false;
    teardownBots();
  }

  function decayCombo() {
    if (comboStreak > 0 && Date.now() - lastScoringMove > STREAK_TIMEOUT_MS) {
      comboStreak = 0;
      emit('onComboReset');
      return true;
    }
    return false;
  }

  return {
    setupSolo,
    setupOnline,
    addNetworkPlayer,
    removeNetworkPlayer,
    handleMessage,
    reportLocalPoints,
    broadcastLocalState,
    start,
    launchBots,
    abandon,
    decayCombo,
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
    get localBar() {
      return localBar;
    },
    get comboStreak() {
      return comboStreak;
    },
    get playerCount() {
      return roster.length;
    },
    get aliveCount() {
      return roster.filter((p) => p.alive).length;
    },
  };
}
