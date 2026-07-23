// Camada de rede (WebRTC via PeerJS).
//
// Este modulo cuida SO de transporte: abrir sala, aceitar conexoes, entregar
// mensagens, detectar queda. Ele nao sabe o que e pontuacao, barra ou ataque.
// Na versao antiga as duas coisas estavam no mesmo lugar, e por isso o modo
// solo era impossivel: nao dava para ter partida sem ter conexao.
//
// Topologia: estrela com o anfitriao no centro, e o anfitriao e a autoridade.
// Convidado nunca fala com convidado. Isso custa um salto de latencia a mais,
// mas garante que so exista uma versao da verdade sobre quem levou dano.

const ROOM_PREFIX = 'doceduelo-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem I, O, 0, 1
const CODE_LENGTH = 5;
const HEARTBEAT_MS = 2500;
const TIMEOUT_MS = 9000;
const HOST_ID = 'p1';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

function generateCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

const ERROS = {
  'peer-unavailable': 'Sala não encontrada. Confira o código.',
  'unavailable-id': 'Esse código já está em uso.',
  'browser-incompatible': 'Este navegador não suporta conexão direta.',
  'network': 'Sem conexão com o servidor de salas.',
  'server-error': 'O servidor de salas está fora do ar. Tente mais tarde.',
  'socket-error': 'A conexão caiu. Verifique sua internet.',
  'ssl-unavailable': 'Conexão insegura bloqueada pelo navegador.',
  'webrtc': 'Seu navegador bloqueou a conexão direta.',
};

function mensagemDeErro(type) {
  return ERROS[type] || `Erro de conexão (${type}).`;
}

export const NET_HOST_ID = HOST_ID;

export function createNetwork(hooks = {}) {
  let peer = null;
  let isHost = false;
  let myId = null;
  let roomCode = null;
  let maxPlayers = 2;
  let acceptingPlayers = true;

  const connections = new Map(); // id -> DataConnection (so no anfitriao)
  const lastSeen = new Map(); // id -> timestamp
  let hostConn = null; // conexao com o anfitriao (so no convidado)
  let lastHostMessage = 0;
  let nextGuestNumber = 2;

  let heartbeatTimer = null;
  let watchdogTimer = null;
  let latency = 0;

  const emit = (name, ...args) => {
    const fn = hooks[name];
    if (fn) fn(...args);
  };

  function peerOptions() {
    return { config: { iceServers: ICE_SERVERS } };
  }

  // ---------------------------------------------------------------------------
  // Envio
  // ---------------------------------------------------------------------------

  function rawSend(conn, msg) {
    if (!conn || !conn.open) return false;
    try {
      conn.send(msg);
      return true;
    } catch {
      return false;
    }
  }

  function sendTo(id, msg) {
    if (isHost) return rawSend(connections.get(id), msg);
    return rawSend(hostConn, msg);
  }

  function sendToHost(msg) {
    if (isHost) {
      // O anfitriao "manda para si mesmo" entregando direto ao jogo.
      emit('onMessage', HOST_ID, msg);
      return true;
    }
    return rawSend(hostConn, msg);
  }

  function broadcast(msg, exceptId) {
    if (!isHost) return;
    for (const [id, conn] of connections) {
      if (id === exceptId) continue;
      rawSend(conn, msg);
    }
  }

  // ---------------------------------------------------------------------------
  // Batimentos
  // ---------------------------------------------------------------------------

  function startHeartbeat() {
    stopHeartbeat();
    const now = Date.now();
    lastHostMessage = now;
    for (const id of connections.keys()) lastSeen.set(id, now);

    heartbeatTimer = setInterval(() => {
      const stamp = Date.now();
      if (isHost) broadcast({ __net: 'ping', stamp });
      else rawSend(hostConn, { __net: 'ping', stamp });
    }, HEARTBEAT_MS);

    watchdogTimer = setInterval(() => {
      const now2 = Date.now();
      if (isHost) {
        for (const id of [...connections.keys()]) {
          if (now2 - (lastSeen.get(id) || now2) > TIMEOUT_MS) dropGuest(id, 'tempo esgotado');
        }
      } else if (hostConn && now2 - lastHostMessage > TIMEOUT_MS) {
        emit('onDisconnected', 'A conexão com o anfitrião caiu.');
        stopHeartbeat();
      }
    }, 1500);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (watchdogTimer) clearInterval(watchdogTimer);
    heartbeatTimer = null;
    watchdogTimer = null;
  }

  /** Mensagens internas de rede nao chegam ao jogo. */
  function handleIncoming(fromId, msg) {
    if (!msg || typeof msg !== 'object') return;

    if (msg.__net === 'ping') {
      const reply = { __net: 'pong', stamp: msg.stamp };
      if (isHost) rawSend(connections.get(fromId), reply);
      else rawSend(hostConn, reply);
      return;
    }
    if (msg.__net === 'pong') {
      if (typeof msg.stamp === 'number') latency = Date.now() - msg.stamp;
      return;
    }

    emit('onMessage', fromId, msg);
  }

  function trackActivity(fromId) {
    if (isHost) lastSeen.set(fromId, Date.now());
    else lastHostMessage = Date.now();
  }

  function dropGuest(id, motivo) {
    const conn = connections.get(id);
    if (conn) {
      try {
        conn.close();
      } catch {
        /* ja estava fechada */
      }
    }
    connections.delete(id);
    lastSeen.delete(id);
    emit('onPlayerLeft', id, motivo);
  }

  // ---------------------------------------------------------------------------
  // Abrir sala
  // ---------------------------------------------------------------------------

  function host(playerLimit, attempt = 0) {
    destroy();
    isHost = true;
    myId = HOST_ID;
    maxPlayers = playerLimit;
    acceptingPlayers = true;
    nextGuestNumber = 2;
    roomCode = generateCode();

    peer = new Peer(ROOM_PREFIX + roomCode, peerOptions());

    peer.on('open', () => {
      emit('onHosting', roomCode);
      startHeartbeat();
    });

    peer.on('connection', (conn) => {
      const cheia = connections.size >= maxPlayers - 1;
      if (cheia || !acceptingPlayers) {
        conn.on('open', () => {
          rawSend(conn, { tipo: 'recusado', motivo: cheia ? 'cheia' : 'em-partida' });
          setTimeout(() => {
            try {
              conn.close();
            } catch {
              /* ja fechou */
            }
          }, 250);
        });
        return;
      }

      const id = 'p' + nextGuestNumber++;
      connections.set(id, conn);
      lastSeen.set(id, Date.now());

      conn.on('open', () => emit('onPlayerJoined', id, conn.metadata || {}));
      conn.on('data', (msg) => {
        trackActivity(id);
        handleIncoming(id, msg);
      });
      conn.on('close', () => dropGuest(id, 'saiu'));
      conn.on('error', () => dropGuest(id, 'erro'));
    });

    peer.on('error', (err) => {
      // Colisao de codigo: sorteia outro e tenta de novo, mas com limite —
      // se o servidor de salas estiver fora, isso viraria recursao infinita.
      if (err.type === 'unavailable-id' && attempt < 5) {
        host(playerLimit, attempt + 1);
        return;
      }
      emit('onError', mensagemDeErro(err.type), err.type);
    });

    peer.on('disconnected', () => {
      try {
        peer.reconnect();
      } catch {
        /* ja destruido */
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Entrar numa sala
  // ---------------------------------------------------------------------------

  function join(code, metadata = {}) {
    destroy();
    isHost = false;
    roomCode = String(code || '').trim().toUpperCase();

    if (roomCode.length < 4) {
      emit('onError', 'Código muito curto.', 'codigo-invalido');
      return;
    }

    peer = new Peer(peerOptions());

    peer.on('open', () => {
      hostConn = peer.connect(ROOM_PREFIX + roomCode, { reliable: true, metadata });

      // Se o anfitriao existe mas nao responde, `open` nunca dispara e o
      // jogador fica olhando "Conectando..." para sempre.
      const timeout = setTimeout(() => {
        if (!hostConn || !hostConn.open) {
          emit('onError', 'A sala não respondeu. Confira o código.', 'timeout');
          destroy();
        }
      }, 12000);

      hostConn.on('open', () => {
        clearTimeout(timeout);
        lastHostMessage = Date.now();
        startHeartbeat();
        emit('onConnected');
      });

      hostConn.on('data', (msg) => {
        trackActivity(HOST_ID);
        handleIncoming(HOST_ID, msg);
      });

      hostConn.on('close', () => {
        clearTimeout(timeout);
        stopHeartbeat();
        emit('onDisconnected', 'O anfitrião encerrou a sala.');
      });

      hostConn.on('error', () => {
        clearTimeout(timeout);
        emit('onError', 'Não foi possível conectar à sala.', 'conexao');
      });
    });

    peer.on('error', (err) => {
      emit('onError', mensagemDeErro(err.type), err.type);
    });
  }

  function destroy() {
    stopHeartbeat();
    for (const conn of connections.values()) {
      try {
        conn.close();
      } catch {
        /* ja fechou */
      }
    }
    connections.clear();
    lastSeen.clear();
    if (hostConn) {
      try {
        hostConn.close();
      } catch {
        /* ja fechou */
      }
      hostConn = null;
    }
    if (peer) {
      try {
        peer.destroy();
      } catch {
        /* ja destruido */
      }
      peer = null;
    }
    roomCode = null;
    latency = 0;
  }

  return {
    host,
    join,
    destroy,
    sendTo,
    sendToHost,
    broadcast,
    setMyId(id) {
      myId = id;
    },
    /** Trava a sala quando a partida comeca. */
    closeRoom() {
      acceptingPlayers = false;
    },
    openRoom() {
      acceptingPlayers = true;
    },
    get isHost() {
      return isHost;
    },
    get myId() {
      return myId;
    },
    get code() {
      return roomCode;
    },
    get playerCount() {
      return connections.size + 1;
    },
    get connectedIds() {
      return [...connections.keys()];
    },
    get latency() {
      return latency;
    },
    get online() {
      return isHost ? peer !== null : !!(hostConn && hostConn.open);
    },
  };
}
