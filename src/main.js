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
import { GEM_COLORS, BLOCKED_COLOR, drawGem } from './render/gems.js';
import { ICONES, aplicarIcones } from './render/icons.js';
import { createAudio } from './audio/audio.js';
import { createSession } from './game/session.js';
import { PRESSURE_MAX, streakMultiplier } from './game/balance.js';
import { DIFFICULTIES } from './game/bot.js';
import { createNetwork } from './net/peer.js';
import { storage, suggestName } from './storage.js';

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
  btnRematch: $('btnRematch'),
  btnReplay: $('btnReplay'),
  debugPanel: $('debugPanel'),
  debugToggle: $('debugToggle'),
  gameOverCard: $('gameOverCard'),

  statsGrid: $('statsGrid'),
  nameInput: $('nameInput'),
  musicSlider: $('musicSlider'),
  sfxSlider: $('sfxSlider'),
  musicValue: $('musicValue'),
  sfxValue: $('sfxValue'),
  reducedMotionToggle: $('reducedMotionToggle'),
  hintsToggle: $('hintsToggle'),
};

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

const audio = createAudio();
const renderer = createRenderer(el.canvas, { reducedMotion: prefersReducedMotion() });
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

function prefersReducedMotion() {
  const saved = storage.settings.reducedMotion;
  if (saved !== null && saved !== undefined) return saved;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ---------------------------------------------------------------------------
// Telas
// ---------------------------------------------------------------------------

function showScreen(name) {
  for (const key in screens) screens[key].classList.toggle('hidden', key !== name);
  if (name === 'Battle') {
    renderer.resize();
    renderer.start();
  } else {
    renderer.stop();
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
  renderer.setReducedMotion(prefersReducedMotion());

  el.musicSlider.value = Math.round(s.music * 100);
  el.sfxSlider.value = Math.round(s.sfx * 100);
  el.musicValue.textContent = Math.round(s.music * 100) + '%';
  el.sfxValue.textContent = Math.round(s.sfx * 100) + '%';
  el.reducedMotionToggle.checked = prefersReducedMotion();
  el.hintsToggle.checked = s.hints;
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

  const board = document.createElement('div');
  board.className = 'mini-board';
  board.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;
  const cells = new Array(CELL_COUNT);
  for (let i = 0; i < CELL_COUNT; i++) {
    const cell = document.createElement('div');
    cell.className = 'mini-cell';
    board.appendChild(cell);
    cells[i] = cell;
  }

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

  const refs = { card, name, cells, fill, score };
  opponentCards.set(player.id, refs);
  return refs;
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

    if (player.boardTypes) {
      for (let i = 0; i < CELL_COUNT; i++) {
        // O codigo acima da faixa de cores e lixo: quem assiste precisa ver
        // o tabuleiro do adversario sujando.
        const codigo = player.boardTypes[i];
        refs.cells[i].style.background =
          codigo >= GEM_COLORS.length ? BLOCKED_COLOR : GEM_COLORS[codigo] || '#2b1a52';
      }
    }
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
    // fez algo grande.
    if (phase.cascade >= 2 || phase.activations.length) {
      renderer.shake(Math.min(16, 2.5 * phase.cascade + phase.activations.length * 2.5));
    }
    if (phase.cascade >= 4) {
      renderer.flash('rgba(255,255,255,0.30)', 0.3);
      announce(`Cascata ${phase.cascade}!`);
    }

    await renderer.animatePhase(phase);
  }
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
  if (info) {
    if (info.points > 0) {
      renderer.floatText(`+${info.points}`, b, '#ffe27a', result.cascades >= 3);
    }
    // Cancelar e a jogada mais importante do jogo: precisa de retorno visual
    // proprio, diferente de "ataquei".
    if (info.cancelled > 0) {
      renderer.floatText(`bloqueou ${info.cancelled}`, idx(2, 4), '#8fe3ff', true);
    } else if (info.sent > 0) {
      renderer.floatText(`ataque ${info.sent}`, idx(2, 4), '#ffb15c');
    }
  }

  // Tabuleiro sem jogada possivel: embaralha em vez de travar o jogador.
  if (!hasValidMove(grid)) {
    announce('Sem jogadas. Embaralhando o tabuleiro.');
    el.battleHint.textContent = 'Sem jogadas — embaralhando!';
    shuffleGrid(grid, rng);
    renderer.setGrid(grid);
    await renderer.introDrop();
    el.battleHint.textContent = 'Arraste um doce para o vizinho para trocar';
    session.broadcastLocalState();
  }

  busy = false;
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
    },

    onLocalMove: (info) => {
      updateScoreUI(true);
      updatePressureUI();
      updateComboUI();
      if (info.cancelled > 0) audio.play('attackSend');
    },

    // Ataque ENFILEIRADO: ainda nao doeu, mas o relogio esta correndo.
    onIncoming: (units) => {
      updatePressureUI();
      audio.play('swapFail');
      announce(`Chegando: ${units} de pressão. Faça um combo para cancelar!`);
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
    },

    onTick: () => {
      updatePressureUI();
      updateDebugPanel();
    },

    onAttackSent: (fromId, targetId) => {
      if (fromId === session.localId) strikeOpponent(targetId);
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

  busy = false;
  selected = null;
  lixoPendente = [];

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
  if (idleTimer) clearTimeout(idleTimer);
  audio.stopMusic();
  audio.setIntensity(0);
  document.body.classList.remove('perigo-perigo', 'perigo-critico');
  alertaAnterior = 'normal';

  const won = summary.won;
  const records = storage.recordMatch({
    won,
    score: summary.score,
    bestCombo: summary.bestCombo,
    bestCascade: summary.bestCascade,
    solo: summary.solo,
  });

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

  // Replay: so existe no solo (ver session.js — o anfitriao nao recebe as
  // jogadas do convidado, entao um replay online seria incompleto).
  const replay = session.replayDaPartida ? session.replayDaPartida() : null;
  replayPendente = replay && replay.veredito.valido ? replay.dados : null;
  el.btnReplay.classList.toggle('hidden', !replayPendente);
  if (replay && !replay.veredito.valido) {
    // Nao oferecer um replay que nao se reproduz: melhor nao ter do que
    // entregar um arquivo que mostra outra partida.
    console.warn('replay descartado:', replay.veredito.motivo);
  }

  // Revanche: no solo sempre; no online, so quem e anfitriao pode reiniciar.
  const podeRevanche = session.isSolo || session.isHost;
  el.btnRematch.classList.toggle('hidden', !podeRevanche);

  showScreen('GameOver');
  if (won) spawnConfetti();
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
  openModal('statsModal');
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

el.btnReplay.addEventListener('click', async () => {
  if (!replayPendente) return;
  audio.play('tap');
  try {
    await navigator.clipboard.writeText(JSON.stringify(replayPendente));
    el.btnReplay.textContent = '✅ Replay copiado!';
  } catch {
    el.btnReplay.textContent = '⚠️ Não consegui copiar';
  }
  setTimeout(() => (el.btnReplay.textContent = '💾 Copiar replay desta partida'), 2200);
});

el.btnRematch.addEventListener('click', () => {
  audio.play('tap');
  if (lastMode === 'solo') startSolo();
  else if (session && session.isHost) session.start();
});

$('btnBackLobby').addEventListener('click', () => {
  audio.play('tap');
  leaveRoom();
  showScreen('Menu');
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
  renderer.setReducedMotion(el.reducedMotionToggle.checked);
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
}

// ---------------------------------------------------------------------------
// Redimensionamento
// ---------------------------------------------------------------------------

let resizeTimer = null;
function handleResize() {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!screens.Battle.classList.contains('hidden')) renderer.resize();
  }, 120);
}

window.addEventListener('resize', handleResize);
window.addEventListener('orientationchange', handleResize);

// Aba escondida: pausa a musica para nao tocar no bolso do jogador.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) audio.stopMusic();
  else if (session && session.active) audio.startMusic();
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

  // Antes de applySettings: ela ja troca o icone de som conforme o estado.
  aplicarIcones();
  applySettings();
  buildHeroGems();
  buildDifficultyButtons();
  refreshMenuName();
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
