// Raiz de composicao: amarra core, renderer, audio, sessao e rede.
//
// Este arquivo e o unico que conhece o DOM da interface. Toda regra de jogo
// mora em src/core e src/game; todo desenho do tabuleiro mora em src/render.
// Se algo aqui comecar a parecer "regra", esta no lugar errado.

import { createRng, createMatchRandom } from './core/rng.js';
import {
  createGrid,
  trySwap,
  hasValidMove,
  findMove,
  shuffleGrid,
  serializeTypes,
  injectGarbage,
  isBlocked,
  BLOCKER,
  areAdjacent,
  rowOf,
  colOf,
  idx,
  COLS,
  ROWS,
  CELL_COUNT,
} from './core/board.js';
import { createRenderer } from './render/renderer.js';
import { createBackdrop } from './render/backdrop.js';
import { GEM_COLORS, drawGem, drawBlocker } from './render/gems.js';
import { ICONES, aplicarIcones } from './render/icons.js';
import { createAudio } from './audio/audio.js';
import { createSession } from './game/session.js';
import { createGravador, tabuleiroInicial, ehReplayPessoal } from './game/replay-perspectiva.js';
import { PRESSURE_MAX, streakMultiplier } from './game/balance.js';
import { DIFFICULTIES } from './game/bot.js';
import { createNetwork } from './net/peer.js';
import { storage, suggestName } from './storage.js';
import { enviarPontuacao, topJogadores, leaderboardAtivo } from './net/leaderboard.js';
import { notaExibida, estaCalibrando, chanceDeVitoria } from './game/rating.js';
import {
  RANKS,
  TETO_DO_SOLO,
  rankDe,
  seloDoRank,
  explicarVariacao,
  resultadoConta,
  NOTA_DOS_BOTS,
} from './game/ranks.js';

// ---------------------------------------------------------------------------
// Referencias de DOM
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

const screens = {
  Menu: $('screenMenu'),
  Solo: $('screenSolo'),
  Online: $('screenOnline'),
  Waiting: $('screenWaiting'),
  Countdown: $('screenCountdown'),
  Battle: $('screenBattle'),
  GameOver: $('screenGameOver'),
};

const el = {
  soundBtn: $('btnSound'),
  soundIcon: $('soundIcon'),
  heroGems: $('heroGems'),
  menuPlayerName: $('menuPlayerName'),

  difficultySelect: $('difficultySelect'),
  difficultyHint: $('difficultyHint'),
  botCountSelect: $('botCountSelect'),
  soloRecord: $('soloRecord'),

  playersSelect: $('playersSelect'),
  joinCodeInput: $('joinCodeInput'),
  lobbyStatus: $('lobbyStatus'),

  hostCodeBox: $('hostCodeBox'),
  hostCodeDisplay: $('hostCodeDisplay'),
  shareCodeBtn: $('shareCodeBtn'),
  waitingSub: $('waitingSub'),
  rosterList: $('rosterList'),
  btnStartGame: $('btnStartGame'),

  countdownNum: $('countdownNum'),

  opponentsRow: $('opponentsRow'),
  canvas: $('boardCanvas'),
  myNameLabel: $('myNameLabel'),
  myScore: $('myScore'),
  comboBadge: $('comboBadge'),
  myBarTrack: $('myBarTrack'),
  myBarFill: $('myBarFill'),
  myPendingFill: $('myPendingFill'),
  myBarCaption: $('myBarCaption'),
  incomingBadge: $('incomingBadge'),
  battleHint: $('battleHint'),
  srAnnounce: $('srAnnounce'),
  btnHint: $('btnHint'),

  resultEmoji: $('resultEmoji'),
  resultTitle: $('resultTitle'),
  resultSub: $('resultSub'),
  resultStats: $('resultStats'),
  recordBanner: $('recordBanner'),
  rankSelo: $('rankSelo'),
  rankNome: $('rankNome'),
  rankDetalhe: $('rankDetalhe'),
  rankProgresso: $('rankProgresso'),
  rankAtual: $('rankAtual'),
  rankLadder: $('rankLadder'),
  leaderboardBody: $('leaderboardBody'),
  rankResultado: $('rankResultado'),
  rankResultadoSelo: $('rankResultadoSelo'),
  rankResultadoNome: $('rankResultadoNome'),
  rankResultadoDelta: $('rankResultadoDelta'),
  rankResultadoMotivo: $('rankResultadoMotivo'),
  btnRematch: $('btnRematch'),
  btnWatchReplay: $('btnWatchReplay'),
  replayBar: $('replayBar'),
  replayPause: $('replayPause'),
  replaySpeed: $('replaySpeed'),
  replayExit: $('replayExit'),
  replayProgress: $('replayProgress'),
  debugPanel: $('debugPanel'),
  debugToggle: $('debugToggle'),
  gameOverCard: $('gameOverCard'),

  statsGrid: $('statsGrid'),
  histLista: $('histLista'),
  nameInput: $('nameInput'),
  musicSlider: $('musicSlider'),
  sfxSlider: $('sfxSlider'),
  musicValue: $('musicValue'),
  sfxValue: $('sfxValue'),
  reducedMotionToggle: $('reducedMotionToggle'),
  liteToggle: $('liteToggle'),
  hintsToggle: $('hintsToggle'),
};

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

const audio = createAudio();
const renderer = createRenderer(el.canvas, { reducedMotion: prefersReducedMotion() });
const backdrop = createBackdrop(document.getElementById('backdrop'));
let network = null;
let session = null;

let rng = createRng();
let grid = [];
let busy = false; // uma animacao de jogada esta em andamento
let selected = null;
let drag = null;
let idleTimer = null;
// Lixo que chegou enquanto uma cascata rodava. Aplicar no meio da animacao
// dessincronizaria o espelho visual do renderer com o tabuleiro.
let lixoPendente = [];

let soloConfig = { difficulty: 'normal', opponents: 1 };
let onlineConfig = { maxPlayers: 2 };
let lastMode = 'solo';

const opponentCards = new Map();

const vibrar = (p) => { if (navigator.vibrate) navigator.vibrate(p); };

function prefersReducedMotion() {
  const saved = storage.settings.reducedMotion;
  if (saved !== null && saved !== undefined) return saved;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Aparelho aparenta ser fraco? (so quando o navegador informa a memoria) */
function aparelhoFraco() {
  const mem = navigator.deviceMemory;
  return typeof mem === 'number' ? mem <= 2 : false;
}

/**
 * Modo leve: desliga os efeitos pesados (aurora, desfoques, vidro dos cards,
 * particulas) para celulares que travam. Nada da jogabilidade muda.
 * null = decide pelo aparelho; true/false = o jogador escolheu.
 */
function modoLeveAtivo() {
  const v = storage.settings.modoLeve;
  return v === null || v === undefined ? aparelhoFraco() : !!v;
}

function aplicarModoLeve() {
  const leve = modoLeveAtivo();
  document.body.classList.toggle('modo-leve', leve);
  // O tabuleiro fica mais barato no modo leve (menos particulas, sem tremor).
  renderer.setReducedMotion(leve || prefersReducedMotion());
  if (leve) {
    backdrop.stop();
  } else if (screens.Battle.classList.contains('hidden')) {
    backdrop.start();
  }
}

// ---------------------------------------------------------------------------
// Telas
// ---------------------------------------------------------------------------

function showScreen(name) {
  for (const key in screens) screens[key].classList.toggle('hidden', key !== name);
  document.body.classList.toggle('tela-batalha', name === 'Battle');
  if (name === 'Battle') {
    // Na batalha a cena para: o tabuleiro ja tem o proprio laco pesado, e um
    // fundo animado atras dele so rouba quadros no celular.
    backdrop.stop();
    renderer.resize();
    renderer.start();
  } else {
    renderer.stop();
    if (!modoLeveAtivo()) backdrop.start();
  }
}

function announce(text) {
  el.srAnnounce.textContent = text;
}

// ---------------------------------------------------------------------------
// Audio e preferencias
// ---------------------------------------------------------------------------

function applySettings() {
  const s = storage.settings;
  audio.setMusicVolume(s.music);
  audio.setSfxVolume(s.sfx);
  audio.setMuted(s.muted);
  renderer.setReducedMotion(prefersReducedMotion() || modoLeveAtivo());
  backdrop.setReducedMotion(prefersReducedMotion());

  el.musicSlider.value = Math.round(s.music * 100);
  el.sfxSlider.value = Math.round(s.sfx * 100);
  el.musicValue.textContent = Math.round(s.music * 100) + '%';
  el.sfxValue.textContent = Math.round(s.sfx * 100) + '%';
  el.reducedMotionToggle.checked = prefersReducedMotion();
  el.liteToggle.checked = modoLeveAtivo();
  el.hintsToggle.checked = s.hints;
  aplicarModoLeve();
  if (s.debug !== debugLigado) setDebug(!!s.debug);
  el.btnHint.classList.toggle('hidden', !s.hints);

  el.soundIcon.innerHTML = s.muted ? ICONES.somMudo : ICONES.somLigado;
  el.soundBtn.classList.toggle('muted', s.muted);
  el.soundBtn.setAttribute('aria-pressed', String(!s.muted));
}

// O navegador so libera audio depois de um gesto do usuario.
function unlockAudioOnce() {
  audio.unlock();
  window.removeEventListener('pointerdown', unlockAudioOnce);
  window.removeEventListener('keydown', unlockAudioOnce);
}
window.addEventListener('pointerdown', unlockAudioOnce);
window.addEventListener('keydown', unlockAudioOnce);

// ---------------------------------------------------------------------------
// Placar dos adversarios
// ---------------------------------------------------------------------------

function buildOpponentCard(player) {
  const card = document.createElement('div');
  card.className = 'opponent-card';
  card.dataset.id = player.id;

  const name = document.createElement('div');
  name.className = 'opponent-name';
  name.textContent = player.name;

  // Miniatura em canvas: desenha as PECAS de verdade (as mesmas do tabuleiro),
  // nao quadradinhos de cor. E uma copia fiel e pequena do jogo do adversario.
  const board = document.createElement('canvas');
  board.className = 'mini-board';
  board.width = MINI_RES;
  board.height = MINI_RES;

  const track = document.createElement('div');
  track.className = 'opponent-bar-track';
  const fill = document.createElement('div');
  fill.className = 'opponent-bar-fill';
  track.appendChild(fill);

  const score = document.createElement('div');
  score.className = 'opponent-score';
  score.textContent = '0';

  card.append(name, board, track, score);
  el.opponentsRow.appendChild(card);

  // Clicar num jogador amplia a visao dele — no espectador ao vivo e no replay.
  // Em jogo normal nao faz nada (aoClicarJogador so age nesses modos).
  card.addEventListener('click', () => aoClicarJogador(player.id));

  const refs = { card, name, board, fill, score };
  opponentCards.set(player.id, refs);
  return refs;
}

/** Resolucao interna da miniatura (px do canvas). Pequena e nitida. */
const MINI_RES = 184;

/**
 * Pinta a miniatura do adversario com as PECAS de verdade (drawGem), o que a
 * torna uma copia fiel e minuscula do tabuleiro dele — nao mais quadradinhos.
 * So redesenha quando o tabuleiro muda (na chegada de estado), nao por quadro.
 */
function pintarMiniatura(cv, tipos) {
  const c = cv.getContext('2d');
  c.clearRect(0, 0, cv.width, cv.height);
  if (!tipos) return;
  const cell = cv.width / COLS;
  const r = cell * 0.4;
  for (let i = 0; i < CELL_COUNT; i++) {
    const code = tipos[i];
    if (code == null) continue;
    const x = (i % COLS) * cell + cell / 2;
    const y = ((i / COLS) | 0) * cell + cell / 2;
    if (code >= GEM_COLORS.length) drawBlocker(c, x, y, r, 'pedra', 1);
    else drawGem(c, x, y, r, code, 0, 0);
  }
}

function renderOpponents(roster) {
  const others = roster.filter((p) => p.id !== session.localId);

  // Remove cartoes de quem saiu da sala.
  for (const [id, refs] of opponentCards) {
    if (!others.some((p) => p.id === id)) {
      refs.card.remove();
      opponentCards.delete(id);
    }
  }

  let leaderId = null;
  let leaderScore = -1;
  for (const p of roster) {
    if (p.alive && p.score > leaderScore) {
      leaderScore = p.score;
      leaderId = p.id;
    }
  }

  for (const player of others) {
    const refs = opponentCards.get(player.id) || buildOpponentCard(player);
    refs.name.textContent = player.name;
    refs.score.textContent = String(player.score ?? 0);
    const pressaoPct = ((player.pressure ?? 0) / PRESSURE_MAX) * 100;
    refs.fill.style.width = Math.min(100, pressaoPct) + '%';
    refs.card.classList.toggle('eliminated', !player.alive);
    refs.card.classList.toggle('leader', player.id === leaderId && player.alive);
    refs.card.classList.toggle(
      'danger',
      player.alive && ((player.pressure ?? 0) + (player.pending ?? 0)) / PRESSURE_MAX > 0.75
    );

    if (player.boardTypes) pintarMiniatura(refs.board, player.boardTypes);
  }
}

function strikeOpponent(id) {
  const refs = opponentCards.get(id);
  if (!refs) return;
  refs.card.classList.remove('struck');
  void refs.card.offsetWidth;
  refs.card.classList.add('struck');
}

// ---------------------------------------------------------------------------
// Suco de combate: ensino do cancelamento, bloqueio, projetil de ataque
// ---------------------------------------------------------------------------

let cancelamentoEnsinado = false;

/**
 * Ensina o cancelamento no momento exato em que ele importa: a PRIMEIRA vez que
 * chega pressao para o jogador. Os testes com pessoas de verdade mostraram que
 * ninguem descobria essa mecanica sozinho — e ela e o coracao do jogo. Uma
 * frase, na hora certa, e so nas primeiras partidas.
 */
function ensinarCancelamento() {
  if (cancelamentoEnsinado || storage.data.cancelamentoVisto) return;
  cancelamentoEnsinado = true;

  const dica = document.getElementById('coachTip');
  if (!dica) return;
  dica.textContent = '⚡ Faça um combo AGORA para cancelar o ataque!';
  dica.classList.remove('hidden', 'saindo');
  void dica.offsetWidth;
  dica.classList.add('mostra');
  vibrar(30);

  setTimeout(() => {
    dica.classList.remove('mostra');
    dica.classList.add('saindo');
    setTimeout(() => dica.classList.add('hidden'), 400);
  }, 3200);
}

function marcarCancelamentoAprendido() {
  storage.updateData({ cancelamentoVisto: true });
}

/**
 * Retorno bem visivel quando o jogador CANCELA um ataque. E o que faz o cerebro
 * ligar "combo -> defesa" e finalmente sacar a mecanica jogando.
 */
function celebrarCancelamento(qtd) {
  renderer.floatText(`🛡 -${qtd}`, idx(1, 4), '#8fe3ff', true);
  el.myBarTrack.classList.remove('bloqueou');
  void el.myBarTrack.offsetWidth;
  el.myBarTrack.classList.add('bloqueou');
  vibrar(20);

  // Depois que o jogador cancela na pratica, ele entendeu — pode parar de ver
  // a dica em partidas futuras.
  const dica = document.getElementById('coachTip');
  if (dica) dica.classList.add('hidden');
  marcarCancelamentoAprendido();
}

/**
 * Ataque enviado: o numero do dano aparece sobre o tabuleiro, se comprime e
 * VOA ate a miniatura do adversario alvo, que reage ao ser atingida. Da a
 * sensacao fisica de "acertei ele" em vez de um numero solto.
 */
let comboFxTimer = null;

/**
 * Anuncio de combo 'COMBO xN' pegando fogo, ACIMA do tabuleiro — nunca sobre as
 * pecas. O fogo e do CSS (texto em degrade quente + brilho tremeluzente). Fica
 * na area do placar/barra, que e interface, entao o jogo continua todo visivel.
 * Cresce e esquenta com o combo.
 */
function mostrarCombo(streak) {
  const fx = document.getElementById('comboFx');
  if (!fx) return;
  const nivel = Math.min(streak, 8);
  fx.textContent = `COMBO x${streak}`;
  fx.style.fontSize = (1.5 + Math.min(streak - 2, 6) * 0.32) + 'rem';
  fx.dataset.nivel = nivel >= 5 ? 'alto' : nivel >= 3 ? 'medio' : 'baixo';
  fx.classList.remove('mostra');
  void fx.offsetWidth;
  fx.classList.add('mostra');
  if (comboFxTimer) clearTimeout(comboFxTimer);
  comboFxTimer = setTimeout(() => fx.classList.remove('mostra'), 850);
}

function dispararAtaque(targetId, units) {
  const refs = opponentCards.get(targetId);
  const canvasRect = el.canvas.getBoundingClientRect();

  // Sem cartao do alvo (ex.: sozinho contra 1 e a miniatura fora da tela):
  // ao menos marca o impacto.
  if (!refs) {
    strikeOpponent(targetId);
    return;
  }

  const alvoRect = refs.card.getBoundingClientRect();
  const proj = document.createElement('div');
  proj.className = 'atk-proj';
  proj.textContent = `-${units}`;

  const x0 = canvasRect.left + canvasRect.width / 2;
  const y0 = canvasRect.top + canvasRect.height * 0.12;
  proj.style.left = x0 + 'px';
  proj.style.top = y0 + 'px';
  document.body.appendChild(proj);

  const dx = alvoRect.left + alvoRect.width / 2 - x0;
  const dy = alvoRect.top + alvoRect.height / 2 - y0;

  // 1. surge grande e pulsa; 2. comprime e dispara ate o alvo.
  requestAnimationFrame(() => {
    proj.classList.add('lancado');
    proj.style.transform = `translate(${dx}px, ${dy}px) scale(0.35)`;
    proj.style.opacity = '0.2';
  });

  const chegou = () => {
    proj.remove();
    strikeOpponent(targetId); // o cartao treme no impacto
    audio.play('attackSend');
  };
  proj.addEventListener('transitionend', chegou, { once: true });
  // Rede de seguranca caso o transitionend nao dispare (aba em segundo plano).
  setTimeout(() => proj.isConnected && chegou(), 700);
}

// ---------------------------------------------------------------------------
// HUD do jogador
// ---------------------------------------------------------------------------

let alertaAnterior = 'normal';

function updatePressureUI() {
  if (!session) return;
  const atual = session.pressure;
  const pendente = session.pending;
  const alerta = session.alert;

  const pctAtual = (atual / PRESSURE_MAX) * 100;
  const pctPendente = Math.max(0, Math.min(100 - pctAtual, (pendente / PRESSURE_MAX) * 100));

  el.myBarFill.style.width = pctAtual + '%';
  el.myPendingFill.style.left = pctAtual + '%';
  el.myPendingFill.style.width = pctPendente + '%';
  el.myBarCaption.textContent = `${atual} / ${PRESSURE_MAX}`;
  el.myBarTrack.setAttribute('aria-valuenow', String(Math.round(pctAtual)));

  el.myBarFill.classList.toggle('atencao', alerta === 'atencao');
  el.myBarFill.classList.toggle('perigo', alerta === 'perigo');
  el.myBarFill.classList.toggle('critico', alerta === 'critico');

  if (pendente > 0) {
    el.incomingBadge.textContent = '+' + pendente;
    el.incomingBadge.classList.remove('hidden');
  } else {
    el.incomingBadge.classList.add('hidden');
  }

  const emPartida = session.active;
  document.body.classList.toggle('perigo-perigo', emPartida && alerta === 'perigo');
  document.body.classList.toggle('perigo-critico', emPartida && alerta === 'critico');

  // O aviso usa ATUAL + PENDENTE: com 18 de pressao e 8 chegando o jogador ja
  // esta morto se nao reagir, mesmo com a barra solida marcando so 70%.
  const projetado = (atual + pendente) / PRESSURE_MAX;
  renderer.setDanger(Math.max(0, (projetado - 0.55) / 0.45));
  audio.setIntensity(Math.min(1, projetado));

  if (alerta !== alertaAnterior) {
    if (emPartida && alerta === 'critico') {
      audio.play('danger');
      if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
    }
    alertaAnterior = alerta;
  }
}

function updateScoreUI(bump) {
  el.myScore.textContent = String(session.localScore);
  if (bump) {
    el.myScore.classList.remove('bump');
    void el.myScore.offsetWidth;
    el.myScore.classList.add('bump');
  }
}

let debugLigado = false;
let ultimaSemente = 0;

/**
 * Painel tecnico. Existe para depurar de verdade: sem os numeros na tela,
 * investigar um desequilibrio vira adivinhacao ("achei que o combo estava
 * alto"). Mostra o que a partida sabe, nao o que ela aparenta.
 */
function updateDebugPanel() {
  if (!debugLigado || !session) return;
  const linhas = [
    `semente   ${ultimaSemente}`,
    `pressao   ${session.pressure} / ${PRESSURE_MAX}`,
    `pendente  +${session.pending}`,
    `projetado ${session.pressure + session.pending}`,
    `alerta    ${session.alert}`,
    `combo     x${session.comboStreak}`,
    `lixo      ${grid.filter(isBlocked).length}`,
    `espelho   ${(() => {
      const e = renderer.conferirEspelho();
      if (e.animando) return 'animando';
      return e.ok ? 'ok' : `${e.problemas.length} ERROS`;
    })()}`,
    `placar    ${session.localScore}`,
    `vivos     ${session.aliveCount}`,
  ];
  el.debugPanel.innerHTML = linhas
    .map((l) => (l.includes('alerta') && session.alert !== 'normal' ? `<b class="alerta">${l}</b>` : l))
    .join('\n');
}

function setDebug(ligado) {
  debugLigado = !!ligado;
  el.debugPanel.classList.toggle('hidden', !debugLigado);
  el.debugPanel.setAttribute('aria-hidden', String(!debugLigado));
  if (el.debugToggle) el.debugToggle.checked = debugLigado;
  storage.updateSettings({ debug: debugLigado });
}

function updateComboUI() {
  const streak = session.comboStreak;
  if (streak >= 2) {
    const mult = streakMultiplier(streak);
    el.comboBadge.textContent = `🔥 x${mult.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}`;
    el.comboBadge.classList.remove('hidden', 'pop');
    void el.comboBadge.offsetWidth;
    el.comboBadge.classList.add('pop');
  } else {
    el.comboBadge.classList.add('hidden');
  }
}

// ---------------------------------------------------------------------------
// Jogada
// ---------------------------------------------------------------------------

function soundForActivation(special) {
  if (special === 1 || special === 2) return 'striped';
  if (special === 3) return 'wrapped';
  if (special === 4) return 'colorBomb';
  return 'wrapped';
}

async function playPhases(phases) {
  for (const phase of phases) {
    audio.play('match', phase.cascade, phase.cleared.length);

    for (const act of phase.activations) audio.play(soundForActivation(act.special));
    if (phase.created.length) audio.play('createSpecial');

    // A intensidade do tranco cresce com a cascata: uma cascata de 6 tem que
    // SENTIR diferente de uma trinca simples, senao o jogador nao percebe que
    // fez algo grande. O soco de camera acompanha — toda jogada "bate".
    renderer.punchCamera(Math.min(0.085, 0.016 + phase.cascade * 0.012 + phase.activations.length * 0.02 + phase.cleared.length * 0.003));
    if (phase.cascade >= 2 || phase.activations.length) {
      renderer.shake(Math.min(20, 3 * phase.cascade + phase.activations.length * 3));
    }
    if (phase.cascade >= 3) {
      // Flash mais forte quanto maior a cascata, com um tom quente de festa.
      const intensidade = Math.min(0.5, 0.16 + phase.cascade * 0.06);
      renderer.flash(`rgba(255,240,210,${intensidade})`, 0.32);
      announce(`Cascata ${phase.cascade}!`);
    }

    await renderer.animatePhase(phase);
  }
}

// ---------------------------------------------------------------------------
// Player de replay (formato de perspectiva)
// ---------------------------------------------------------------------------
//
// Reproduz a PROPRIA partida gravada. O tabuleiro do jogador e reconstruido da
// semente e das operacoes gravadas em ordem (jogada, embaralho, lixo), o que o
// deixa identico ao que ele jogou. As barras vem prontas do estado gravado
// (nada e re-simulado, entao nada diverge) e as miniaturas dos adversarios das
// fotos gravadas. Ver src/game/replay-perspectiva.js.

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

let replayRodando = false;
let replayPausado = false;
let replayVelocidade = 1;

// Gravador da partida em andamento (perspectiva do jogador local). Vale para
// solo E online — cada cliente grava a propria partida.
let gravador = null;

/** Estado visivel do jogador local agora, para carimbar nos eventos gravados. */
function snapshotFoco() {
  if (!session) return { pressure: 0, pending: 0, alert: 'normal', score: 0 };
  return {
    pressure: session.pressure,
    pending: session.pending,
    alert: session.alert,
    score: session.localScore,
  };
}

/** Grava a foto do MEU tabuleiro (para eu virar miniatura na visao dos outros). */
function gravarMeuSnap() {
  if (gravador && session) {
    gravador.snap(session.localId, session.localScore, session.pressure, true, serializeTypes(grid), Date.now());
  }
}

// Um grid so-para-desenho a partir das cores (serializeTypes). E o que deixa o
// tabuleiro do adversario aparecer grande e de verdade — com as pecas do jogo,
// nao quadradinhos — tanto ao assistir quanto no espectador ao vivo.
function gridDeSnapshot(tipos) {
  const g = new Array(CELL_COUNT).fill(null);
  if (!tipos) return g;
  for (let i = 0; i < CELL_COUNT; i++) {
    const code = tipos[i];
    if (code == null) continue;
    if (code >= GEM_COLORS.length) {
      // A foto nao guarda o tipo exato do obstaculo; desenha um generico.
      g[i] = { id: i, type: 0, special: 0, blocker: { tipo: 'pedra', hp: 1 } };
    } else {
      g[i] = { id: i, type: code, special: 0, blocker: null };
    }
  }
  return g;
}

/** Mostra no tabuleiro GRANDE a foto de um jogador (espectador ou replay). */
function espelharTabuleiro(tipos) {
  grid = gridDeSnapshot(tipos);
  renderer.setGrid(grid);
}

/** Barra grande a partir de uma foto (deriva o nivel de alerta da pressao). */
function estadoDeSnap(s) {
  const pressure = s.pressure || 0;
  const ratio = pressure / PRESSURE_MAX;
  const alert = ratio >= 0.85 ? 'critico' : ratio >= 0.65 ? 'perigo' : ratio >= 0.4 ? 'atencao' : 'normal';
  return { pressure, pending: 0, alert, score: s.score || 0 };
}

// ---------------------------------------------------------------------------
// Espectador ao vivo (depois de ser eliminado no online)
// ---------------------------------------------------------------------------

let espectadorAtivo = false;
let espectadorAlvo = null;

function entrarEspectador() {
  if (espectadorAtivo) return;
  espectadorAtivo = true;
  document.body.classList.add('modo-espectador');
  audio.play('defeat');
  if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
  el.battleHint.textContent = '💥 Você foi eliminado! Assistindo — toque num jogador para ver de perto.';
  announce('Você foi eliminado. Assistindo o resto da partida.');
  const vivo = session.roster.find((p) => p.alive && p.id !== session.localId);
  if (vivo) espectar(vivo.id);
}

function espectar(id) {
  espectadorAlvo = id;
  atualizarEspectador(session.roster);
}

function atualizarEspectador(roster) {
  const alvo = roster.find((p) => p.id === espectadorAlvo);
  if (!alvo || !alvo.alive) {
    // O alvo caiu: pula para outro que ainda esteja vivo.
    const outro = roster.find((p) => p.alive && p.id !== session.localId);
    if (outro && outro.id !== espectadorAlvo) return espectar(outro.id);
    if (!outro) return;
  }
  const foco = roster.find((p) => p.id === espectadorAlvo);
  if (!foco) return;
  el.myNameLabel.textContent = 'Assistindo ' + foco.name;
  espelharTabuleiro(foco.boardTypes);
  aplicarEstadoReplay(estadoDeSnap({ score: foco.score, pressure: foco.pressure }));
  // Destaca no rol de miniaturas quem estou assistindo.
  for (const [id, refs] of opponentCards) refs.card.classList.toggle('assistindo', id === espectadorAlvo);
}

function sairDoEspectador() {
  espectadorAtivo = false;
  espectadorAlvo = null;
  document.body.classList.remove('modo-espectador');
}

/** Clique numa miniatura: troca quem estou assistindo (espectador ou replay). */
function aoClicarJogador(id) {
  if (replayRodando) trocarPerspectiva(id);
  else if (espectadorAtivo && id !== session.localId) {
    audio.play('tap');
    espectar(id);
  }
}

function aplicarEstadoReplay(st) {
  if (!st) return;
  const pend = st.pending || 0;
  const pctAtual = (st.pressure / PRESSURE_MAX) * 100;
  const pctPend = Math.max(0, Math.min(100 - pctAtual, (pend / PRESSURE_MAX) * 100));
  el.myBarFill.style.width = pctAtual + '%';
  el.myPendingFill.style.left = pctAtual + '%';
  el.myPendingFill.style.width = pctPend + '%';
  el.myBarCaption.textContent = `${st.pressure} / ${PRESSURE_MAX}`;
  el.myBarFill.classList.toggle('atencao', st.alert === 'atencao');
  el.myBarFill.classList.toggle('perigo', st.alert === 'perigo');
  el.myBarFill.classList.toggle('critico', st.alert === 'critico');
  el.myScore.textContent = st.score;
  el.incomingBadge.classList.toggle('hidden', pend <= 0);
  if (pend > 0) el.incomingBadge.textContent = '+' + pend;
  // A borda de perigo do tabuleiro segue a pressao mostrada (mesma conta do
  // jogo ao vivo). Sem isto, o replay herdaria o perigo da ultima partida.
  renderer.setDanger(Math.max(0, (st.pressure / PRESSURE_MAX - 0.55) / 0.45));
}

function montarMinisReplay(replay, foco) {
  el.opponentsRow.innerHTML = '';
  opponentCards.clear();
  for (const jog of replay.jogadores) {
    if (jog.id === foco) continue;
    const refs = buildOpponentCard({ id: jog.id, name: jog.name });
    if (refs) refs.card.classList.add('clicavel');
  }
}

function atualizarMiniReplay(ev) {
  const refs = opponentCards.get(ev.id);
  if (!refs) return;
  refs.score.textContent = ev.score;
  refs.fill.style.width = Math.min(100, (ev.pressure / PRESSURE_MAX) * 100) + '%';
  refs.card.classList.toggle('eliminated', !ev.alive);
  if (ev.tipos) pintarMiniatura(refs.board, ev.tipos);
}

async function animarJogadaReplay(a, b, resultado) {
  audio.play('swap');
  await renderer.animateSwap(a, b);
  await playPhases(resultado.phases);
}

function sairDoReplay() {
  replayRodando = false;
  replayGeracao++; // corta qualquer loop de perspectiva ainda rodando
  replayAtual = null;
  replayFoco = null;
  document.body.classList.remove('modo-replay');
  el.replayBar.classList.add('hidden');
  session = null;
  showScreen('Menu');
  refreshRankCard();
}

// Replay em andamento e de quem e a perspectiva. Uma "geracao" corta o loop
// antigo quando o jogador troca de perspectiva no meio.
let replayAtual = null;
let replayFoco = null;
let replayGeracao = 0;

/** Troca a perspectiva assistida (clique numa miniatura), do inicio. */
function trocarPerspectiva(id) {
  if (!replayAtual || id === replayFoco) return;
  audio.play('tap');
  assistirReplay(replayAtual, id);
}

async function assistirReplay(replay, focoPedido) {
  if (!ehReplayPessoal(replay)) {
    alert('Este replay não está disponível.');
    return;
  }

  replayAtual = replay;
  const foco = focoPedido || replay.euId;
  replayFoco = foco;
  const geracao = ++replayGeracao;
  const vivo = () => replayRodando && geracao === replayGeracao;

  replayRodando = true;
  replayPausado = false;
  replayVelocidade = 1;
  el.replaySpeed.textContent = '1x';
  el.replayPause.textContent = '⏸';

  // Assistindo a PROPRIA partida: animada, reconstruida da semente. Assistindo
  // OUTRO jogador: nao temos as jogadas dele, entao mostramos o tabuleiro dele
  // pelas fotos gravadas (as pecas de verdade, so sem a animacao da troca).
  const animado = foco === replay.euId;
  let rReplay = null;
  if (animado) {
    const inicial = tabuleiroInicial(replay.seed);
    grid = inicial.grid;
    rReplay = inicial.rng;
  } else {
    grid = new Array(CELL_COUNT).fill(null);
  }

  document.body.classList.add('modo-replay');
  const nomeDe = (id) => (replay.jogadores.find((p) => p.id === id) || {}).name || 'Jogador';
  el.myNameLabel.textContent = nomeDe(foco);
  el.battleHint.textContent =
    replay.jogadores.length > 1
      ? 'Assistindo — toque num jogador para ver a perspectiva dele'
      : 'Assistindo replay';
  showScreen('Battle');

  renderer.setGrid(grid);
  renderer.setSelection(null);
  renderer.setHint(null);
  montarMinisReplay(replay, foco);
  aplicarEstadoReplay({ pressure: 0, pending: 0, alert: 'normal', score: 0 });
  el.replayBar.classList.remove('hidden');
  await renderer.introDrop();
  if (!vivo()) return;

  const dur = Math.max(1, replay.duracao);
  let tAnterior = 0;

  for (const ev of replay.eventos) {
    if (!vivo()) return;
    while (replayPausado && vivo()) await espera(80);
    if (!vivo()) return;

    // Espera proporcional ao intervalo real, limitada para nao arrastar.
    const gap = Math.min(1000, Math.max(30, ev.t - tAnterior));
    await espera(gap / replayVelocidade);
    if (!vivo()) return;
    tAnterior = ev.t;
    el.replayProgress.style.width = Math.min(100, (ev.t / dur) * 100) + '%';

    if (animado) {
      // Caminho animado: o proprio jogador.
      if (ev.k === 'move') {
        const resultado = trySwap(grid, ev.a, ev.b, rReplay);
        if (resultado.ok) await animarJogadaReplay(ev.a, ev.b, resultado);
        aplicarEstadoReplay(ev.st);
      } else if (ev.k === 'shuffle') {
        shuffleGrid(grid, rReplay);
        renderer.setGrid(grid);
        await renderer.introDrop();
      } else if (ev.k === 'lixo') {
        injectGarbage(grid, ev.qtd, ev.tipo, rReplay);
        renderer.setGrid(grid);
        renderer.shake(6 + ev.qtd * 1.5);
        audio.play(ev.tipo === 'cadeado' ? 'createSpecial' : 'wrapped');
        aplicarEstadoReplay(ev.st);
      } else if (ev.k === 'in') {
        audio.play('swapFail');
        aplicarEstadoReplay(ev.st);
      } else if (ev.k === 'land') {
        renderer.shake(Math.min(24, 7 + ev.units * 2.2));
        renderer.flash('rgba(255,60,60,0.42)', 0.5);
        audio.play('attackTake');
        aplicarEstadoReplay(ev.st);
      } else if (ev.k === 'snap' && ev.id !== foco) {
        atualizarMiniReplay(ev);
      }
    } else {
      // Caminho por fotos: assistindo OUTRO jogador. So 'snap' importam.
      if (ev.k === 'snap') {
        if (ev.id === foco) {
          if (ev.tipos) espelharTabuleiro(ev.tipos);
          aplicarEstadoReplay(estadoDeSnap(ev));
        } else {
          atualizarMiniReplay(ev);
        }
      }
    }
  }

  if (!vivo()) return;
  el.replayProgress.style.width = '100%';
  const ganhouFoco = replay.vencedorId === foco;
  el.battleHint.textContent = ganhouFoco ? '🏆 Venceu esta partida' : 'Fim do replay';
  await espera(1400);
  if (geracao === replayGeracao) sairDoReplay();
}

/**
 * Deposita o lixo acumulado no tabuleiro.
 *
 * So roda com o tabuleiro parado: mexer no grid durante uma cascata deixaria
 * o espelho visual do renderer descrevendo um tabuleiro que nao existe mais.
 */
const COMO_QUEBRAR = {
  pedra: 'Combine AO LADO das pedras para quebrá-las',
  gelo: 'O gelo aguenta dois toques — combine ao lado dele',
  cadeado: 'A peça trancada ainda combina; use a cor dela',
};

function aplicarLixo() {
  if (!lixoPendente.length || !session || !session.active) return;
  const levas = lixoPendente;
  lixoPendente = [];

  let total = 0;
  let ultima = null;
  for (const lixo of levas) {
    const colocados = injectGarbage(grid, lixo.quantidade, lixo.tipo, rng);
    if (!colocados.length) continue;
    total += colocados.length;
    ultima = lixo;
    // Grava a QUANTIDADE PEDIDA (nao a colocada): e ela que injectGarbage usa
    // para consumir o gerador, entao e ela que o replay precisa repetir.
    if (gravador) gravador.lixo(lixo.tipo, lixo.quantidade, snapshotFoco(), Date.now());
  }
  if (!total) return;

  renderer.setGrid(grid);
  renderer.shake(6 + total * 1.5);
  audio.play(ultima.tipo === 'cadeado' ? 'createSpecial' : 'wrapped');

  // O MOTIVO na tela e o ponto do sistema de niveis: o jogador tem de ligar o
  // obstaculo ao golpe que o causou. Sem essa frase, o lixo continuaria
  // parecendo sorte, mesmo sendo determinado pelo tamanho do ataque.
  el.battleHint.textContent = `${ultima.explicacao}. ${COMO_QUEBRAR[ultima.tipo] || ''}`;
  announce(`${ultima.explicacao}: ${total} obstáculo(s) no seu tabuleiro`);
  session.broadcastLocalState();
  gravarMeuSnap();
}

async function attemptMove(a, b) {
  if (busy || !session || !session.active) return;
  if (!areAdjacent(a, b)) return;

  busy = true;
  selected = null;
  renderer.setSelection(null);
  renderer.setHint(null);
  resetIdleTimer();

  const result = trySwap(grid, a, b, rng);

  if (!result.ok) {
    audio.play('swapFail');
    await renderer.animateSwapRevert(a, b);
    busy = false;
    return;
  }

  audio.play('swap');
  await renderer.animateSwap(a, b);
  await playPhases(result.phases);

  // Obstaculo destruido devolve pressao: e o caminho de volta de quem esta
  // sob lixo. Contado antes de pontuar, para o alivio ja valer nesta jogada.
  const destruidos = result.phases.reduce(
    (soma, fase) => soma + (fase.danos || []).filter((d) => d.destruido).length,
    0
  );
  if (destruidos > 0) {
    const alivio = session.relieveFromGarbage(destruidos);
    if (alivio > 0) renderer.floatText(`-${alivio} pressão`, idx(1, 4), '#8fe3ff');
  }

  const info = session.reportLocalMove(result, a, b);
  if (info && info.points > 0) {
    renderer.floatText(`+${info.points}`, b, '#ffe27a', result.cascades >= 3);
  }
  // Grava a jogada ANTES do embaralho e do lixo, para o replay reproduzir o
  // consumo do gerador na mesma ordem em que aconteceu ao vivo.
  if (gravador) gravador.move(a, b, snapshotFoco(), info ? info.points : 0, Date.now());
  // O cancelamento e o ataque tem retorno proprio, mais forte, tratados nos
  // ganchos onLocalMove/onAttackSent (celebrarCancelamento e dispararAtaque).

  // Tabuleiro sem jogada possivel: embaralha em vez de travar o jogador.
  if (!hasValidMove(grid)) {
    announce('Sem jogadas. Embaralhando o tabuleiro.');
    el.battleHint.textContent = 'Sem jogadas — embaralhando!';
    shuffleGrid(grid, rng);
    if (gravador) gravador.shuffle(Date.now());
    renderer.setGrid(grid);
    await renderer.introDrop();
    el.battleHint.textContent = 'Arraste um doce para o vizinho para trocar';
    session.broadcastLocalState();
  }

  busy = false;
  // Foto do meu tabuleiro apos a jogada (alimenta minha miniatura na visao dos
  // outros e o assistir da minha perspectiva pelos outros).
  gravarMeuSnap();
  // O lixo que chegou durante a animacao entra agora.
  aplicarLixo();
}

// ---------------------------------------------------------------------------
// Entrada (toque e mouse)
// ---------------------------------------------------------------------------

const DRAG_THRESHOLD = 12;

el.canvas.addEventListener('pointerdown', (e) => {
  if (busy || !session || !session.active) return;
  const cell = renderer.pointerToCell(e.clientX, e.clientY);
  if (cell === null) return;
  el.canvas.setPointerCapture(e.pointerId);
  drag = { start: cell, x: e.clientX, y: e.clientY, moved: false };
});

el.canvas.addEventListener('pointermove', (e) => {
  if (!drag || drag.moved || busy) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;

  drag.moved = true;
  const r = rowOf(drag.start);
  const c = colOf(drag.start);
  let tr = r;
  let tc = c;
  if (Math.abs(dx) > Math.abs(dy)) tc += dx > 0 ? 1 : -1;
  else tr += dy > 0 ? 1 : -1;

  if (tr >= 0 && tr < ROWS && tc >= 0 && tc < COLS) attemptMove(drag.start, idx(tr, tc));
  drag = null;
  selected = null;
  renderer.setSelection(null);
});

el.canvas.addEventListener('pointerup', (e) => {
  if (!drag || drag.moved) {
    drag = null;
    return;
  }
  const cell = renderer.pointerToCell(e.clientX, e.clientY);
  drag = null;
  if (cell === null || busy) return;

  // Toque: primeiro seleciona, segundo troca (se for vizinho).
  if (selected === null) {
    selected = cell;
    audio.play('tap');
  } else if (selected === cell) {
    selected = null;
  } else if (areAdjacent(selected, cell)) {
    const from = selected;
    selected = null;
    attemptMove(from, cell);
    return;
  } else {
    selected = cell;
    audio.play('tap');
  }
  renderer.setSelection(selected);
});

el.canvas.addEventListener('pointercancel', () => {
  drag = null;
});

// Dica automatica depois de um tempo parado — reduz a frustracao de travar.
function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  if (!storage.settings.hints) return;
  idleTimer = setTimeout(() => {
    if (!busy && session && session.active) showHint();
  }, 7000);
}

function showHint() {
  const move = findMove(grid);
  if (move) {
    renderer.setHint(move);
    setTimeout(() => renderer.setHint(null), 2600);
  }
}

// ---------------------------------------------------------------------------
// Ciclo da partida
// ---------------------------------------------------------------------------

function createSessionWithHooks() {
  return createSession({
    getLocalBoardTypes: () => serializeTypes(grid),

    onRosterChange: (roster) => {
      renderOpponents(roster);
      renderRosterList(roster);
      // Fotos do tabuleiro de cada jogador (para as miniaturas e para poder
      // assistir da perspectiva deles depois). So durante a partida.
      if (gravador && session && session.active) {
        const agora = Date.now();
        for (const p of roster) {
          if (p.id === session.localId) continue;
          gravador.snap(p.id, p.score || 0, p.pressure || 0, p.alive !== false, p.boardTypes || null, agora);
        }
      }
      // Modo espectador ao vivo (depois de ser eliminado): espelha no tabuleiro
      // grande o jogador que estou assistindo.
      if (espectadorAlvo) atualizarEspectador(roster);
    },

    onLocalMove: (info) => {
      updateScoreUI(true);
      updatePressureUI();
      updateComboUI();
      // Combo pegando fogo, a partir de x2: o anuncio no DOM (acima do
      // tabuleiro), o tranco de tela no renderer.
      if (info.combo >= 2) {
        mostrarCombo(info.combo);
        renderer.showCombo(info.combo);
      }
      if (info.cancelled > 0) {
        // Cancelou o ataque que estava chegando: e a jogada mais importante do
        // jogo. Retorno bem visivel, para o jogador LIGAR combo -> defesa.
        audio.play('attackSend');
        celebrarCancelamento(info.cancelled);
      }
    },

    // Ataque ENFILEIRADO: ainda nao doeu, mas o relogio esta correndo.
    onIncoming: (units) => {
      updatePressureUI();
      audio.play('swapFail');
      announce(`Chegando: ${units} de pressão. Faça um combo para cancelar!`);
      if (gravador) gravador.incoming(units, snapshotFoco(), Date.now());
      // Ensino no momento exato: a primeira vez que chega pressao, a pessoa e
      // avisada de que pode cancelar. Foi o que os testes com gente mostraram
      // faltar — ninguem descobria o cancelamento sozinho.
      ensinarCancelamento();
    },

    onGarbage: (lixo) => {
      lixoPendente.push(lixo);
      if (!busy) aplicarLixo();
    },

    // Pendente venceu e virou pressao de verdade. Agora sim doi.
    onPressureLanded: (units) => {
      updatePressureUI();
      renderer.shake(Math.min(24, 7 + units * 2.2));
      renderer.flash('rgba(255,60,60,0.42)', 0.5);
      audio.play('attackTake');
      if (navigator.vibrate) navigator.vibrate(45);
      renderer.floatText(`-${units}`, idx(0, 4), '#ff8a8a', true);
      if (gravador) gravador.land(units, snapshotFoco(), Date.now());
      gravarMeuSnap();
    },

    onTick: () => {
      // No espectador a barra grande e do jogador assistido, nao minha.
      if (!espectadorAtivo) updatePressureUI();
      updateDebugPanel();
    },

    onAttackSent: (fromId, targetId, units) => {
      if (fromId === session.localId) dispararAtaque(targetId, units);
    },

    onPlayerEliminated: (id) => {
      if (id !== session.localId) {
        audio.play('eliminate');
        const p = session.roster.find((x) => x.id === id);
        if (p) announce(`${p.name} foi eliminado!`);
      }
    },

    onLocalEliminated: () => {
      busy = true;
      // No online, ser eliminado nao pode ser silencioso: avisa e, se a partida
      // continua com DOIS ou mais ainda vivos, vira espectador. Se so resta um,
      // a partida ja vai acabar — deixa o fim de jogo mostrar o resultado.
      if (!session.isSolo && session.active && session.aliveCount >= 2) {
        entrarEspectador();
      }
    },

    onComboReset: () => updateComboUI(),

    onGameEnd: (winnerId, summary) => finishMatch(winnerId, summary),

    onJoinedRoom: () => {
      showScreen('Waiting');
      el.hostCodeBox.classList.add('hidden');
    },

    onRefused: (motivo) => {
      setLobbyStatus(motivo, true);
      if (network) network.destroy();
      showScreen('Online');
    },

    onStart: (semente) => startCountdown(semente),
  });
}

function startCountdown(semente) {
  showScreen('Countdown');
  let n = 3;
  el.countdownNum.textContent = String(n);
  audio.play('countdown');

  const tick = setInterval(() => {
    n -= 1;
    if (n <= 0) {
      clearInterval(tick);
      audio.play('countdown', true);
      beginBattle(semente);
      return;
    }
    el.countdownNum.textContent = String(n);
    el.countdownNum.style.animation = 'none';
    void el.countdownNum.offsetWidth;
    el.countdownNum.style.animation = '';
    audio.play('countdown');
  }, 900);
}

function beginBattle(semente) {
  ultimaSemente = semente >>> 0;
  // createMatchRandom da um gerador por COLUNA a partir da semente da partida.
  // E o que garante que os dois jogadores recebam a mesma sequencia de doces
  // em cada coluna, independentemente de quem cascateou mais. Ver rng.js.
  rng = createMatchRandom(semente, COLS);
  grid = createGrid(rng);

  // Grava esta partida da perspectiva do jogador local (solo ou online).
  gravador = createGravador({
    seed: semente >>> 0,
    players: session.roster.map((p) => ({ id: p.id, name: p.name, isBot: p.isBot })),
    euId: session.localId,
    startedAt: Date.now(),
  });

  busy = false;
  selected = null;
  lixoPendente = [];
  sairDoEspectador();

  el.myNameLabel.textContent = storage.name || 'Você';
  updateScoreUI(false);
  updatePressureUI();
  updateComboUI();
  el.battleHint.textContent = 'Arraste um doce para o vizinho para trocar';

  showScreen('Battle');
  renderer.setGrid(grid);
  renderer.setSelection(null);
  renderer.setHint(null);
  renderOpponents(session.roster);

  renderer.introDrop().then(() => {
    session.launchBots();
    session.broadcastLocalState();
    resetIdleTimer();
  });

  audio.startMusic();

}

function finishMatch(winnerId, summary) {
  busy = true;
  sairDoEspectador();
  if (idleTimer) clearTimeout(idleTimer);
  audio.stopMusic();
  audio.setIntensity(0);
  document.body.classList.remove('perigo-perigo', 'perigo-critico');
  alertaAnterior = 'normal';

  // Fecha o replay desta partida (perspectiva do jogador local). Vale solo E
  // online — cada cliente gravou a propria partida.
  let replayDados = null;
  if (gravador) {
    gravador.fim(winnerId, summary.won, Date.now());
    replayDados = gravador.toJSON();
    gravador = null;
  }

  // A nota so muda contra adversario de forca CONHECIDA. Bot tem nota fixa
  // por dificuldade; humano online entra como desconhecido, porque sem
  // servidor nao ha como saber a nota dele (e o que ele mandasse pela rede
  // seria auto-declarado, ou seja, forjavel).
  const adversario = session.isSolo
    ? NOTA_DOS_BOTS[soloConfig.difficulty] || NOTA_DOS_BOTS.normal
    : { rating: 1500, desvio: 200 };

  const notaAntes = storage.rating;
  const chance = chanceDeVitoria(notaAntes, adversario);
  const calibrando = estaCalibrando(notaAntes);
  const regra = resultadoConta({
    notaAtual: notaExibida(notaAntes),
    adversario,
    venceu: summary.won,
    contraBot: session.isSolo,
  });

  const { depois: notaDepois } = storage.registrarResultado({
    venceu: summary.won,
    adversario,
    modo: session.isSolo ? 'solo' : 'online',
    nomeAdversario: session.roster.find((p) => p.id !== session.localId)?.name || null,
    contaParaNota: regra.conta,
    replay: replayDados,
    resumo: { score: summary.score, apm: summary.apm, bestCombo: summary.bestCombo },
  });
  mostrarVariacaoDeRank({
    notaAntes,
    notaDepois,
    venceu: summary.won,
    chance,
    calibrando,
    motivoBloqueio: regra.motivo,
  });

  const won = summary.won;
  const records = storage.recordMatch({
    won,
    score: summary.score,
    bestCombo: summary.bestCombo,
    bestCascade: summary.bestCascade,
    solo: summary.solo,
  });

  // Manda a nota para o ranking mundial (se configurado). E um extra: se
  // falhar, nao atrapalha o fim da partida em nada.
  if (leaderboardAtivo()) {
    const st = storage.stats;
    enviarPontuacao({
      name: storage.name,
      rating: notaExibida(storage.rating),
      rankId: rankDe(notaExibida(storage.rating)).id,
      wins: st.wins,
      games: st.games,
    });
  }

  el.resultEmoji.textContent = won ? '🏆' : '💥';
  el.resultTitle.textContent = won ? 'Você venceu!' : 'Você perdeu';
  el.resultTitle.className = won ? 'win' : 'lose';

  if (won) {
    el.resultSub.textContent = 'Último de pé. Mandou bem!';
    audio.play('victory');
  } else {
    const vencedor = session.roster.find((p) => p.id === winnerId);
    el.resultSub.textContent = vencedor ? `${vencedor.name} venceu a partida.` : 'A partida acabou.';
    audio.play('defeat');
    el.gameOverCard.classList.remove('shake');
    void el.gameOverCard.offsetWidth;
    el.gameOverCard.classList.add('shake');
  }

  el.resultStats.innerHTML = '';
  const stats = [
    { value: summary.unitsSent ?? 0, label: 'Ataque enviado' },
    { value: summary.unitsCancelled ?? 0, label: 'Pressão cancelada' },
    { value: summary.apm ?? 0, label: 'Ataque por min' },
    { value: 'x' + summary.bestCombo, label: 'Maior combo' },
    { value: summary.bestCascade, label: 'Maior cascata' },
    { value: summary.score, label: 'Pontos' },
  ];
  for (const stat of stats) {
    const box = document.createElement('div');
    box.className = 'stat-box';
    box.innerHTML = `<span class="stat-value">${stat.value}</span><span class="stat-label">${stat.label}</span>`;
    el.resultStats.appendChild(box);
  }

  if (records.length) {
    // "a e b e c" fica ruim; o certo em portugues e "a, b e c".
    const lista =
      records.length > 1 ? records.slice(0, -1).join(', ') + ' e ' + records[records.length - 1] : records[0];
    el.recordBanner.textContent = '🎉 Novo recorde de ' + lista + '!';
    el.recordBanner.classList.remove('hidden');
  } else {
    el.recordBanner.classList.add('hidden');
  }

  // Replay desta partida: gravado da perspectiva do jogador, funciona em solo
  // e online. O botao "Assistir" reproduz na hora, sem codigo.
  replayPendente = replayDados;
  el.btnWatchReplay.classList.toggle('hidden', !replayPendente);

  // Revanche: no solo sempre; no online, so quem e anfitriao pode reiniciar.
  const podeRevanche = session.isSolo || session.isHost;
  el.btnRematch.classList.toggle('hidden', !podeRevanche);

  showScreen('GameOver');
  if (won) spawnConfetti();
}

/**
 * Painel de rank na tela de fim.
 *
 * Explica POR QUE a nota mexeu daquele tanto. Ver o rank variar sem motivo
 * parece arbitrario, e um dos pilares do jogo e o jogador entender o proprio
 * resultado — isso vale para a nota tambem, nao so para a partida.
 */
function mostrarVariacaoDeRank({ notaAntes, notaDepois, venceu, chance, calibrando, motivoBloqueio }) {
  const antes = notaExibida(notaAntes);
  const depois = notaExibida(notaDepois);
  const diferenca = depois - antes;
  const rank = rankDe(depois);
  const rankAntigo = rankDe(antes);

  el.rankResultadoSelo.innerHTML = seloDoRank(rank, 46);
  el.rankResultadoNome.textContent = rank.nome;
  el.rankResultadoNome.style.color = rank.cor;

  const sinal = diferenca > 0 ? '+' : '';
  el.rankResultadoDelta.textContent = `${sinal}${diferenca}`;
  el.rankResultadoDelta.className =
    'rank-delta ' + (diferenca > 0 ? 'sobe' : diferenca < 0 ? 'desce' : '');

  let motivo = motivoBloqueio || explicarVariacao({ venceu, chance, diferenca, calibrando });
  if (rank.indice > rankAntigo.indice) motivo = `Subiu para ${rank.nome}!`;
  else if (rank.indice < rankAntigo.indice) motivo = `Caiu para ${rank.nome}.`;
  el.rankResultadoMotivo.textContent = motivo;

  el.rankResultado.classList.remove('hidden');
}

function spawnConfetti() {
  if (prefersReducedMotion()) return;
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:70';
  for (let i = 0; i < 44; i++) {
    const piece = document.createElement('div');
    const color = GEM_COLORS[i % GEM_COLORS.length];
    piece.style.cssText = `position:absolute;top:-14px;left:${Math.random() * 100}%;width:9px;height:15px;border-radius:2px;background:${color};animation:confettiFall ${1.7 + Math.random() * 1.3}s ease-in ${Math.random() * 0.5}s forwards`;
    container.appendChild(piece);
  }
  document.body.appendChild(container);
  setTimeout(() => container.remove(), 3600);
}

// Keyframe injetado aqui porque so o confete usa — nao vale poluir o CSS.
const confettiStyle = document.createElement('style');
confettiStyle.textContent =
  '@keyframes confettiFall{0%{transform:translateY(0) rotate(0);opacity:1}100%{transform:translateY(110vh) rotate(640deg);opacity:.8}}';
document.head.appendChild(confettiStyle);

// ---------------------------------------------------------------------------
// Modo solo
// ---------------------------------------------------------------------------

function buildDifficultyButtons() {
  el.difficultySelect.innerHTML = '';
  for (const [key, config] of Object.entries(DIFFICULTIES)) {
    const btn = document.createElement('button');
    btn.className = 'option-btn' + (key === soloConfig.difficulty ? ' active' : '');
    btn.textContent = config.label;
    btn.dataset.key = key;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(key === soloConfig.difficulty));
    btn.addEventListener('click', () => {
      soloConfig.difficulty = key;
      audio.play('tap');
      buildDifficultyButtons();
    });
    el.difficultySelect.appendChild(btn);
  }
  el.difficultyHint.textContent = DIFFICULTIES[soloConfig.difficulty].descricao;
}

function startSolo() {
  lastMode = 'solo';
  session = createSessionWithHooks();
  session.setupSolo({
    playerName: storage.name || 'Você',
    opponents: soloConfig.opponents,
    difficulty: soloConfig.difficulty,
  });
  session.start();
}

// ---------------------------------------------------------------------------
// Modo online
// ---------------------------------------------------------------------------

function setLobbyStatus(text, isError = false) {
  el.lobbyStatus.textContent = text;
  el.lobbyStatus.classList.toggle('erro', isError);
}

function createNetworkWithHooks() {
  return createNetwork({
    onHosting: (code) => {
      el.hostCodeDisplay.textContent = code;
      el.hostCodeBox.classList.remove('hidden');
      el.shareCodeBtn.classList.toggle('hidden', !navigator.share);
      showScreen('Waiting');
      setLobbyStatus('');
    },

    onPlayerJoined: (id, metadata) => {
      session.addNetworkPlayer(id, metadata);
      audio.play('tap');
    },

    onPlayerLeft: (id) => session.removeNetworkPlayer(id),

    onMessage: (fromId, msg) => session.handleMessage(fromId, msg),

    onConnected: () => setLobbyStatus('Conectado! Aguardando o anfitrião...'),

    onError: (mensagem) => {
      setLobbyStatus(mensagem, true);
      resetOnlineButtons();
      showScreen('Online');
    },

    onDisconnected: (mensagem) => {
      if (session && session.active) {
        session.abandon();
        el.resultEmoji.textContent = '📡';
        el.resultTitle.textContent = 'Conexão perdida';
        el.resultTitle.className = 'lose';
        el.resultSub.textContent = mensagem;
        el.resultStats.innerHTML = '';
        el.recordBanner.classList.add('hidden');
        el.btnRematch.classList.add('hidden');
        audio.stopMusic();
        showScreen('GameOver');
      } else {
        setLobbyStatus(mensagem, true);
        resetOnlineButtons();
        showScreen('Online');
      }
    },
  });
}

function resetOnlineButtons() {
  $('btnCreate').disabled = false;
  $('btnJoin').disabled = false;
  el.hostCodeBox.classList.add('hidden');
}

function hostRoom() {
  lastMode = 'online';
  // Descarta qualquer sala anterior antes de abrir outra. Sem isso, cada
  // tentativa deixava um Peer vivo e registrado no servidor de sinalizacao —
  // e a tentativa seguinte dava timeout em vez de conectar.
  leaveRoom();
  network = createNetworkWithHooks();
  session = createSessionWithHooks();
  session.setupOnline({ network, hostMode: true, playerName: storage.name || 'Anfitrião' });
  $('btnCreate').disabled = true;
  $('btnJoin').disabled = true;
  setLobbyStatus('Criando sala...');
  network.host(onlineConfig.maxPlayers);
}

function joinRoom() {
  const code = el.joinCodeInput.value.trim().toUpperCase();
  if (!code) {
    setLobbyStatus('Digite o código da sala.', true);
    return;
  }
  lastMode = 'online';
  leaveRoom(); // ver hostRoom: tentativa anterior nao pode deixar Peer orfao
  network = createNetworkWithHooks();
  session = createSessionWithHooks();
  session.setupOnline({ network, hostMode: false, playerName: storage.name || 'Jogador' });
  $('btnCreate').disabled = true;
  $('btnJoin').disabled = true;
  setLobbyStatus('Conectando...');
  network.join(code, { name: storage.name || 'Jogador' });
}

function renderRosterList(roster) {
  // Sem guarda de "so renderiza se a tela estiver visivel".
  //
  // Tinha uma, e ela causava dois bugs: o roster chega ANTES de a sala de
  // espera ser exibida (o anfitriao monta a lista ao criar a sala, o convidado
  // ao receber 'bemvindo'), entao a renderizacao era pulada e nunca refeita —
  // o convidado ficava olhando uma sala vazia para sempre, porque nenhuma
  // outra mensagem de roster chegava depois. Desenhar alguns <li> num elemento
  // escondido nao custa nada; perder o unico evento que tinha os dados custa.
  el.rosterList.innerHTML = '';
  for (const player of roster) {
    const li = document.createElement('li');
    const tag = player.id === session.localId ? 'você' : player.isBot ? 'máquina' : '';
    li.innerHTML = `<span>${escapeHtml(player.name)}</span><span class="tag">${tag}</span>`;
    el.rosterList.appendChild(li);
  }

  if (session.isHost && !session.isSolo) {
    const total = roster.length;
    el.waitingSub.textContent = `Jogadores na sala: ${total} de ${onlineConfig.maxPlayers}`;
    el.btnStartGame.classList.toggle('hidden', total < 2);
  } else {
    el.waitingSub.textContent = 'Aguardando o anfitrião iniciar...';
    el.btnStartGame.classList.add('hidden');
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

function leaveRoom() {
  if (session) session.abandon();
  if (network) network.destroy();
  network = null;
  session = null;
  resetOnlineButtons();
  setLobbyStatus('');
}

// ---------------------------------------------------------------------------
// Modais
// ---------------------------------------------------------------------------

function openModal(id) {
  $(id).classList.remove('hidden');
}

function closeModal(id) {
  $(id).classList.add('hidden');
}

document.querySelectorAll('[data-close-modal]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const modal = btn.closest('.modal');
    if (modal) modal.classList.add('hidden');
  });
});

document.querySelectorAll('.modal').forEach((modal) => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  document.querySelectorAll('.modal:not(.hidden)').forEach((m) => m.classList.add('hidden'));
});

function showStats() {
  const s = storage.stats;
  const winRate = s.games > 0 ? Math.round((s.wins / s.games) * 100) : 0;
  const items = [
    { value: s.games, label: 'Partidas' },
    { value: s.wins, label: 'Vitórias' },
    { value: winRate + '%', label: 'Aproveitamento' },
    { value: s.bestScore, label: 'Melhor pontuação' },
    { value: 'x' + s.bestCombo, label: 'Maior combo' },
    { value: s.bestCascade, label: 'Maior cascata' },
  ];
  el.statsGrid.innerHTML = '';
  for (const item of items) {
    const box = document.createElement('div');
    box.className = 'stat-box';
    box.innerHTML = `<span class="stat-value">${item.value}</span><span class="stat-label">${item.label}</span>`;
    el.statsGrid.appendChild(box);
  }
  renderHistorico();
  openModal('statsModal');
}

/** Data amigavel: "Hoje 14:32", "Ontem 09:10" ou "23/07 21:05". */
function formatarQuando(ts) {
  const d = new Date(ts);
  const hoje = new Date();
  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === hoje.toDateString()) return 'Hoje ' + hora;
  if (d.toDateString() === ontem.toDateString()) return 'Ontem ' + hora;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + hora;
}

/** Lista das partidas recentes, cada uma com botao de assistir se tem replay. */
function renderHistorico() {
  const lista = storage.historico || [];
  el.histLista.innerHTML = '';
  if (!lista.length) {
    el.histLista.innerHTML = '<p class="hist-vazio">Nenhuma partida ainda. Jogue uma!</p>';
    return;
  }
  for (const h of lista.slice(0, 20)) {
    const row = document.createElement('div');
    row.className = 'hist-row ' + (h.venceu ? 'venceu' : 'perdeu');

    const adv = h.adversario ? 'vs ' + h.adversario : h.modo === 'online' ? 'Online' : 'Solo';
    const pts = h.resumo && h.resumo.score != null ? ` · ${h.resumo.score} pts` : '';
    const info = document.createElement('span');
    info.className = 'hist-info';
    info.innerHTML = `<strong>${adv}</strong><small>${formatarQuando(h.quando)}${pts}</small>`;

    const res = document.createElement('span');
    res.className = 'hist-res';
    res.textContent = h.venceu ? '🏆' : '💥';

    row.appendChild(res);
    row.appendChild(info);

    if (ehReplayPessoal(h.replay)) {
      const btn = document.createElement('button');
      btn.className = 'hist-assistir';
      btn.textContent = '▶ Assistir';
      btn.addEventListener('click', () => {
        audio.play('tap');
        closeModal('statsModal');
        assistirReplay(h.replay);
      });
      row.appendChild(btn);
    }
    el.histLista.appendChild(row);
  }
}

/**
 * Modal do rank: como funciona + a escala inteira, do topo a base.
 *
 * Nao mostra o MMR em lugar nenhum — nem os limiares de pontos. O jogo todo
 * assume que o jogador ve o RANK, nunca o numero; expor os pontos aqui abriria
 * a mesma porta que a gente fechou de proposito. A escala mostra a ordem, o
 * selo e marca onde voce esta, e so.
 */
/**
 * Ranking mundial (Supabase). Mostra os melhores por nota, com selo e destaque
 * na sua linha. Enquanto nao houver banco configurado, explica que esta sendo
 * ativado — o jogo funciona igual sem ele.
 */
async function abrirPlacar() {
  openModal('leaderboardModal');
  const corpo = el.leaderboardBody;

  if (!leaderboardAtivo()) {
    corpo.innerHTML =
      '<p class="lb-vazio">O ranking mundial está sendo ativado.<br>' +
      'Em breve dá para ver os melhores do mundo aqui. 🌍</p>';
    return;
  }

  corpo.innerHTML = '<p class="lb-vazio">Carregando...</p>';
  const dados = await topJogadores(50);
  if (!dados) {
    corpo.innerHTML = '<p class="lb-vazio">Não consegui carregar o ranking agora.<br>Confira sua internet e tente de novo.</p>';
    return;
  }
  if (!dados.lista.length) {
    corpo.innerHTML = '<p class="lb-vazio">Ninguém no ranking ainda.<br>Jogue uma partida e seja o primeiro! 🏆</p>';
    return;
  }

  const linhas = dados.lista.map((j, i) => {
    const rank = rankDe(j.rating);
    const eu = j.player_key === dados.eu;
    const pos = i + 1;
    const medalha = pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : `${pos}`;
    return (
      `<div class="lb-row${eu ? ' eu' : ''}">` +
      `<span class="lb-pos">${medalha}</span>` +
      `<span class="lb-selo">${seloDoRank(rank, 30)}</span>` +
      `<span class="lb-nome">${escapeHtml(j.name)}${eu ? ' <b>(você)</b>' : ''}</span>` +
      `<span class="lb-rank" style="color:${rank.cor}">${rank.nome}</span>` +
      `</div>`
    );
  });
  corpo.innerHTML = linhas.join('');
}

function abrirModalRank() {
  const nota = storage.rating;
  const atual = rankDe(notaExibida(nota));

  // Cabecalho: onde voce esta agora.
  const detalhe = estaCalibrando(nota)
    ? `Calibrando — ${nota.partidas} partida(s) jogada(s)`
    : atual.proximo
      ? `Faltam ${atual.faltam} para ${atual.proximo.nome}`
      : 'Você chegou ao rank máximo.';
  el.rankAtual.innerHTML =
    `<span class="rank-atual-selo">${seloDoRank(atual, 52)}</span>` +
    `<span class="rank-atual-texto">` +
    `<small>Você está em</small>` +
    `<strong style="color:${atual.cor}">${atual.nome}</strong>` +
    `<span>${detalhe}</span></span>`;

  // Escala do MAIS TOP ao mais baixo.
  el.rankLadder.innerHTML = '';
  for (const rank of [...RANKS].reverse()) {
    const li = document.createElement('li');
    li.className = 'rank-row' + (rank.id === atual.id ? ' atual' : '');
    const soOnline = rank.minima > TETO_DO_SOLO;
    li.innerHTML =
      `<span class="rank-row-selo">${seloDoRank(rank, 34)}</span>` +
      `<span class="rank-row-nome" style="color:${rank.cor}">${rank.nome}</span>` +
      (rank.id === atual.id ? '<span class="rank-tag voce">você</span>' : '') +
      (soOnline ? '<span class="rank-tag online">só online</span>' : '');
    el.rankLadder.appendChild(li);
  }

  openModal('rankModal');
}

/**
 * Cartao de rank do menu.
 *
 * Mostra o RANK, nunca o MMR — numero cru vira obsessao e leitura errada
 * ("perdi 8 pontos numa partida que joguei bem"). Durante a calibragem o
 * cartao diz isso com todas as letras, senao o jogador acha que o rank baixo
 * inicial e um julgamento sobre ele.
 */
function refreshRankCard() {
  const nota = storage.rating;
  const rank = rankDe(notaExibida(nota));

  el.rankSelo.innerHTML = seloDoRank(rank, 54);
  el.rankNome.textContent = rank.nome;
  el.rankNome.style.color = rank.cor;
  el.rankProgresso.style.width = Math.round(rank.progresso * 100) + '%';
  el.rankProgresso.style.background = rank.cor;

  if (estaCalibrando(nota)) {
    el.rankDetalhe.textContent = `Calibrando — ${nota.partidas} partida(s)`;
  } else if (rank.proximo) {
    el.rankDetalhe.textContent = `Faltam ${rank.faltam} para ${rank.proximo.nome}`;
  } else {
    el.rankDetalhe.textContent = 'Rank máximo';
  }
}

function refreshMenuName() {
  el.menuPlayerName.textContent = storage.name || '—';
  const best = storage.stats.soloBest;
  el.soloRecord.textContent = best > 0 ? `Seu recorde no solo: ${best} pontos` : '';
}

// ---------------------------------------------------------------------------
// Ligacoes da interface
// ---------------------------------------------------------------------------

$('btnPlaySolo').addEventListener('click', () => {
  audio.play('tap');
  buildDifficultyButtons();
  refreshMenuName();
  showScreen('Solo');
});

$('btnPlayOnline').addEventListener('click', () => {
  audio.play('tap');
  setLobbyStatus('');
  showScreen('Online');
});

$('btnStats').addEventListener('click', () => {
  audio.play('tap');
  showStats();
});

$('btnSettings').addEventListener('click', () => {
  audio.play('tap');
  openModal('settingsModal');
});

document.querySelectorAll('[data-back]').forEach((btn) => {
  btn.addEventListener('click', () => {
    audio.play('tap');
    leaveRoom();
    showScreen(btn.dataset.back);
  });
});

el.botCountSelect.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  soloConfig.opponents = Number(btn.dataset.n);
  el.botCountSelect.querySelectorAll('.seg-btn').forEach((b) => {
    b.classList.toggle('active', b === btn);
    b.setAttribute('aria-checked', String(b === btn));
  });
  audio.play('tap');
});

el.playersSelect.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  onlineConfig.maxPlayers = Number(btn.dataset.n);
  el.playersSelect.querySelectorAll('.seg-btn').forEach((b) => {
    b.classList.toggle('active', b === btn);
    b.setAttribute('aria-checked', String(b === btn));
  });
  audio.play('tap');
});

$('btnStartSolo').addEventListener('click', () => {
  audio.unlock();
  startSolo();
});

$('btnCreate').addEventListener('click', () => {
  audio.unlock();
  hostRoom();
});

$('btnJoin').addEventListener('click', () => {
  audio.unlock();
  joinRoom();
});

el.joinCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoom();
});

$('btnStartGame').addEventListener('click', () => {
  if (!session || !session.isHost) return;
  session.start();
});

$('btnCancelWait').addEventListener('click', () => {
  audio.play('tap');
  leaveRoom();
  showScreen('Menu');
});

$('copyCodeBtn').addEventListener('click', async () => {
  const code = el.hostCodeDisplay.textContent;
  try {
    await navigator.clipboard.writeText(code);
    const btn = $('copyCodeBtn');
    btn.textContent = '✅ Copiado!';
    setTimeout(() => (btn.textContent = '📋 Copiar'), 1600);
  } catch {
    setLobbyStatus('Não consegui copiar. Anote: ' + code);
  }
});

el.shareCodeBtn.addEventListener('click', () => {
  const code = el.hostCodeDisplay.textContent;
  navigator
    .share({
      title: 'Doce Duelo',
      text: `Bora jogar Doce Duelo! Código da sala: ${code}`,
      url: location.href,
    })
    .catch(() => {});
});

$('btnQuit').addEventListener('click', () => {
  if (!confirm('Sair da partida?')) return;
  leaveRoom();
  audio.stopMusic();
  showScreen('Menu');
});

el.btnHint.addEventListener('click', () => {
  if (busy || !session || !session.active) return;
  audio.play('tap');
  showHint();
});

let replayPendente = null;

el.btnWatchReplay.addEventListener('click', () => {
  if (!replayPendente) return;
  audio.play('tap');
  assistirReplay(replayPendente);
});

el.replayPause.addEventListener('click', () => {
  replayPausado = !replayPausado;
  el.replayPause.textContent = replayPausado ? '▶' : '⏸';
});

el.replaySpeed.addEventListener('click', () => {
  replayVelocidade = replayVelocidade >= 4 ? 1 : replayVelocidade * 2;
  el.replaySpeed.textContent = replayVelocidade + 'x';
});

el.replayExit.addEventListener('click', () => {
  audio.play('tap');
  sairDoReplay();
});

el.btnRematch.addEventListener('click', () => {
  audio.play('tap');
  if (lastMode === 'solo') startSolo();
  else if (session && session.isHost) session.start();
});

$('btnBackLobby').addEventListener('click', () => {
  audio.play('tap');
  leaveRoom();
  refreshRankCard();
  showScreen('Menu');
});

$('btnRankCard').addEventListener('click', () => {
  audio.play('tap');
  abrirModalRank();
});

$('btnLeaderboard').addEventListener('click', () => {
  audio.play('tap');
  closeModal('rankModal');
  abrirPlacar();
});

$('btnRanking').addEventListener('click', () => {
  audio.play('tap');
  abrirPlacar();
});

el.soundBtn.addEventListener('click', () => {
  const muted = !storage.settings.muted;
  storage.updateSettings({ muted });
  applySettings();
  if (!muted) {
    audio.unlock();
    audio.play('tap');
    if (session && session.active) audio.startMusic();
  }
});

el.musicSlider.addEventListener('input', () => {
  const value = Number(el.musicSlider.value) / 100;
  storage.updateSettings({ music: value });
  audio.setMusicVolume(value);
  el.musicValue.textContent = el.musicSlider.value + '%';
});

el.sfxSlider.addEventListener('input', () => {
  const value = Number(el.sfxSlider.value) / 100;
  storage.updateSettings({ sfx: value });
  audio.setSfxVolume(value);
  el.sfxValue.textContent = el.sfxSlider.value + '%';
});

el.sfxSlider.addEventListener('change', () => audio.play('match', 2, 3));

el.reducedMotionToggle.addEventListener('change', () => {
  storage.updateSettings({ reducedMotion: el.reducedMotionToggle.checked });
  renderer.setReducedMotion(el.reducedMotionToggle.checked || modoLeveAtivo());
  backdrop.setReducedMotion(el.reducedMotionToggle.checked);
});

el.liteToggle.addEventListener('change', () => {
  storage.updateSettings({ modoLeve: el.liteToggle.checked });
  aplicarModoLeve();
});

if (el.debugToggle) {
  el.debugToggle.addEventListener('change', () => setDebug(el.debugToggle.checked));
}

// Tecla D alterna o painel tecnico durante a partida.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'd' && e.key !== 'D') return;
  if (e.target && /input|textarea/i.test(e.target.tagName)) return;
  setDebug(!debugLigado);
});

el.hintsToggle.addEventListener('change', () => {
  storage.updateSettings({ hints: el.hintsToggle.checked });
  el.btnHint.classList.toggle('hidden', !el.hintsToggle.checked);
});

$('btnResetStats').addEventListener('click', () => {
  if (!confirm('Zerar todas as estatísticas? Isso não pode ser desfeito.')) return;
  const nome = storage.name;
  storage.reset();
  storage.setName(nome);
  applySettings();
  refreshMenuName();
  showStats();
});

$('aboutBtn').addEventListener('click', () => openModal('aboutModal'));

$('btnEditName').addEventListener('click', () => {
  el.nameInput.value = storage.name;
  openModal('nameModal');
  setTimeout(() => el.nameInput.focus(), 120);
});

$('btnSaveName').addEventListener('click', saveName);
el.nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveName();
});

function saveName() {
  const value = el.nameInput.value.trim() || suggestName();
  storage.setName(value);
  refreshMenuName();
  closeModal('nameModal');

  // Atualiza o nome no ranking mundial NA HORA. Antes so ia junto no fim de uma
  // partida, entao trocar o nick nao aparecia la ate jogar de novo.
  if (leaderboardAtivo()) {
    const st = storage.stats;
    const nota = notaExibida(storage.rating);
    enviarPontuacao({ name: value, rating: nota, rankId: rankDe(nota).id, wins: st.wins, games: st.games });
  }
}

// ---------------------------------------------------------------------------
// Redimensionamento
// ---------------------------------------------------------------------------

let resizeTimer = null;
function handleResize() {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!screens.Battle.classList.contains('hidden')) renderer.resize();
    else backdrop.resize();
  }, 120);
}

window.addEventListener('resize', handleResize);
window.addEventListener('orientationchange', handleResize);

// Aba escondida: pausa a musica para nao tocar no bolso do jogador.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    audio.stopMusic();
    backdrop.stop();
  } else {
    if (session && session.active) audio.startMusic();
    if (screens.Battle.classList.contains('hidden')) backdrop.start();
  }
});

// ---------------------------------------------------------------------------
// Inicializacao
// ---------------------------------------------------------------------------

/**
 * Gemas flutuantes do menu, desenhadas pela MESMA funcao do tabuleiro.
 *
 * Antes eram quadradinhos de CSS, o que escondia justamente o que o jogo tem
 * de proprio: cada tipo tem uma FORMA, nao so uma cor. Reusar drawGem garante
 * que menu e tabuleiro nunca divirjam — mudar a arte das pecas muda as duas.
 */
function buildHeroGems() {
  if (!el.heroGems) return; // hub novo nao tem a fileira de gemas
  el.heroGems.innerHTML = '';
  const lado = 40;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);

  for (let tipo = 0; tipo < 5; tipo++) {
    const canvas = document.createElement('canvas');
    canvas.className = 'hero-gem';
    canvas.width = lado * dpr;
    canvas.height = lado * dpr;
    canvas.style.animationDelay = tipo * 0.16 + 's';

    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawGem(c, lado / 2, lado / 2, lado * 0.36, tipo, 0, 0);

    el.heroGems.appendChild(canvas);
  }
}

function boot() {
  if (!storage.name) storage.setName(suggestName());
  // Quem sumiu por semanas volta com mais incerteza, nao com a nota antiga
  // tratada como verdade.
  storage.aplicarAfastamento();

  // Antes de applySettings: ela ja troca o icone de som conforme o estado.
  aplicarIcones();
  applySettings();
  buildHeroGems();
  buildDifficultyButtons();
  refreshMenuName();
  refreshRankCard();
  showScreen('Menu');

  if (!storage.tutorialSeen) {
    openModal('tutorialModal');
    storage.markTutorialSeen();
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
}

boot();
