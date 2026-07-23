// Renderizador do tabuleiro em Canvas 2D.
//
// O renderer mantem seu PROPRIO espelho visual do tabuleiro (`cellSprites`) e
// o evolui aplicando as fases devolvidas por `resolve()`. Ele nunca le o grid
// final — quando a animacao comeca, a logica ja terminou e o grid ja e o
// estado final. Sao as fases que contam o caminho: o que sumiu, o que caiu de
// onde para onde, o que nasceu. Sem esse espelho seria impossivel animar algo
// que a logica ja desfez.

import { COLS, ROWS, CELL_COUNT, idx, rowOf, colOf } from '../core/board.js';
import { drawGem, drawBlocker, GEM_TYPES } from './gems.js';
import { createParticleSystem } from './particles.js';

const BOARD_PAD = 10;
const CELL_GAP = 4;

const TIMING = {
  swap: 150,
  swapBack: 130,
  pop: 230,
  fallBase: 210,
  spawnStagger: 26,
  morph: 320,
};

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInQuad = (t) => t * t;
const easeOutBack = (t) => {
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};
// Queda com pequena compressao no fim: a peca passa um pouco do lugar e volta.
const easeLand = (t) => {
  if (t < 0.82) return easeOutCubic(t / 0.82) * 1.055;
  const k = (t - 0.82) / 0.18;
  return 1.055 - 0.055 * easeOutCubic(k);
};

export function createRenderer(canvas, options = {}) {
  const ctx = canvas.getContext('2d', { alpha: true });
  const particles = createParticleSystem();

  let reducedMotion = !!options.reducedMotion;
  let dpr = 1;
  let cssWidth = 0;
  let cellSize = 36;
  let pitch = 40;

  /** id -> sprite. Sprite guarda posicao VISUAL (float), nao logica. */
  const sprites = new Map();
  /** indice do tabuleiro -> sprite (ou null). Espelho visual. */
  let cellSprites = new Array(CELL_COUNT).fill(null);

  let tweens = [];
  let effects = [];
  let floatTexts = [];

  let selection = null;
  let hint = null;
  let hintPulse = 0;
  let shakeMag = 0;
  let shakeTime = 0;
  let flashColor = null;
  let flashAlpha = 0;
  let dangerLevel = 0;

  let time = 0;
  let rafId = null;
  let lastFrame = 0;
  let running = false;

  const scale = (ms) => (reducedMotion ? ms * 0.45 : ms);

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const width = rect.width || canvas.clientWidth || 320;
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    cssWidth = width;

    cellSize = Math.max(18, (width - BOARD_PAD * 2 - CELL_GAP * (COLS - 1)) / COLS);
    pitch = cellSize + CELL_GAP;

    const cssHeight = BOARD_PAD * 2 + cellSize * ROWS + CELL_GAP * (ROWS - 1);
    canvas.style.height = `${cssHeight}px`;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const cellX = (col) => BOARD_PAD + col * pitch + cellSize / 2;
  const cellY = (row) => BOARD_PAD + row * pitch + cellSize / 2;

  /** Converte coordenada de tela em indice do tabuleiro, ou null se fora. */
  function pointerToCell(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left - BOARD_PAD;
    const y = clientY - rect.top - BOARD_PAD;
    const c = Math.floor(x / pitch);
    const r = Math.floor(y / pitch);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null;
    return idx(r, c);
  }

  // ---------------------------------------------------------------------------
  // Tweens
  // ---------------------------------------------------------------------------

  function runTweens(specs) {
    const real = specs.filter(Boolean);
    if (!real.length) return Promise.resolve();
    return new Promise((resolve) => {
      let remaining = real.length;
      const done = () => {
        remaining -= 1;
        if (remaining === 0) resolve();
      };
      for (const spec of real) {
        const from = {};
        for (const key in spec.to) from[key] = spec.target[key];
        tweens.push({
          target: spec.target,
          from,
          to: spec.to,
          duration: Math.max(1, spec.duration),
          delay: spec.delay || 0,
          ease: spec.ease || easeOutCubic,
          elapsed: 0,
          onComplete: spec.onComplete,
          done,
        });
      }
    });
  }

  function updateTweens(dt) {
    if (!tweens.length) return;
    const still = [];
    for (const tw of tweens) {
      tw.elapsed += dt * 1000;
      const local = tw.elapsed - tw.delay;
      if (local < 0) {
        still.push(tw);
        continue;
      }
      const t = Math.min(1, local / tw.duration);
      const e = tw.ease(t);
      for (const key in tw.to) {
        tw.target[key] = tw.from[key] + (tw.to[key] - tw.from[key]) * e;
      }
      if (t >= 1) {
        if (tw.onComplete) tw.onComplete();
        tw.done();
      } else {
        still.push(tw);
      }
    }
    tweens = still;
  }

  // ---------------------------------------------------------------------------
  // Sprites
  // ---------------------------------------------------------------------------

  function makeSprite(cell, row, col) {
    return {
      id: cell.id,
      type: cell.type,
      special: cell.special,
      blocker: cell.blocker ? { ...cell.blocker } : null,
      col,
      row,
      scale: 1,
      alpha: 1,
      glow: 0,
      spin: 0,
    };
  }

  /** Sincroniza tudo de uma vez, sem animar (inicio de partida). */
  function setGrid(grid) {
    sprites.clear();
    cellSprites = new Array(CELL_COUNT).fill(null);
    tweens = [];
    effects = [];
    floatTexts = [];
    particles.clear();
    for (let i = 0; i < CELL_COUNT; i++) {
      const cell = grid[i];
      if (!cell) continue;
      const sprite = makeSprite(cell, rowOf(i), colOf(i));
      sprites.set(cell.id, sprite);
      cellSprites[i] = sprite;
    }
  }

  /** Entrada em cascata no comeco da partida: as pecas caem para o lugar. */
  function introDrop() {
    const specs = [];
    for (let i = 0; i < CELL_COUNT; i++) {
      const sprite = cellSprites[i];
      if (!sprite) continue;
      const targetRow = sprite.row;
      sprite.row = targetRow - ROWS - 2;
      sprite.alpha = 1;
      specs.push({
        target: sprite,
        to: { row: targetRow },
        duration: scale(430),
        delay: scale(colOf(i) * 34 + rowOf(i) * 12),
        ease: easeLand,
      });
    }
    return runTweens(specs);
  }

  // ---------------------------------------------------------------------------
  // Efeitos visuais
  // ---------------------------------------------------------------------------

  function addEffect(effect) {
    if (reducedMotion && effect.type !== 'flash') return;
    effects.push({ life: effect.maxLife, ...effect });
  }

  function spawnActivationEffect(activation) {
    const { index, special } = activation;
    const r = rowOf(index);
    const c = colOf(index);
    const x = cellX(c);
    const y = cellY(r);

    switch (special) {
      case 1: // listrada horizontal
        addEffect({ type: 'beamH', row: r, maxLife: 0.34, color: '#fff2b0' });
        particles.emit({ x, y, count: 16, color: '#fff2b0', shape: 'spark', speed: 620, angle: 0, spread: 0.5, life: 0.32, gravity: 0.15 });
        particles.emit({ x, y, count: 16, color: '#fff2b0', shape: 'spark', speed: 620, angle: Math.PI, spread: 0.5, life: 0.32, gravity: 0.15 });
        break;
      case 2: // listrada vertical
        addEffect({ type: 'beamV', col: c, maxLife: 0.34, color: '#fff2b0' });
        particles.emit({ x, y, count: 16, color: '#fff2b0', shape: 'spark', speed: 620, angle: -Math.PI / 2, spread: 0.5, life: 0.32, gravity: 0.15 });
        particles.emit({ x, y, count: 16, color: '#fff2b0', shape: 'spark', speed: 620, angle: Math.PI / 2, spread: 0.5, life: 0.32, gravity: 0.15 });
        break;
      case 3: // embrulhada
        addEffect({ type: 'ring', x, y, radius: cellSize * 2.4, maxLife: 0.42, color: '#ffc45c' });
        particles.emit({ x, y, count: 26, color: '#ffb347', speed: 380, size: 6, life: 0.6 });
        particles.emit({ x, y, count: 10, color: '#fff', speed: 240, size: 4, life: 0.45, shape: 'circle' });
        break;
      case 4: // bomba colorida
        addEffect({ type: 'ring', x, y, radius: cellSize * 5, maxLife: 0.6, color: '#d0a3ff' });
        addEffect({ type: 'flash', maxLife: 0.28, color: 'rgba(255,255,255,0.5)' });
        for (const g of GEM_TYPES) {
          particles.emit({ x, y, count: 8, color: g.base, speed: 520, size: 6, life: 0.8 });
        }
        break;
      default: // formatos de combo
        addEffect({ type: 'ring', x, y, radius: cellSize * 4, maxLife: 0.5, color: '#ffffff' });
        addEffect({ type: 'flash', maxLife: 0.22, color: 'rgba(255,255,255,0.38)' });
        particles.emit({ x, y, count: 40, color: '#fff', speed: 600, size: 6, life: 0.7 });
        break;
    }
  }

  function updateEffects(dt) {
    if (!effects.length) return;
    const still = [];
    for (const fx of effects) {
      fx.life -= dt;
      if (fx.life > 0) still.push(fx);
    }
    effects = still;
  }

  function drawEffects() {
    for (const fx of effects) {
      const t = 1 - fx.life / fx.maxLife;
      const alpha = 1 - t;

      if (fx.type === 'beamH') {
        const y = cellY(fx.row);
        const h = cellSize * (0.3 + t * 1.1);
        const g = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(0.5, fx.color);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = alpha * 0.9;
        ctx.fillStyle = g;
        ctx.fillRect(0, y - h / 2, cssWidth, h);
        ctx.restore();
      } else if (fx.type === 'beamV') {
        const x = cellX(fx.col);
        const w = cellSize * (0.3 + t * 1.1);
        const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(0.5, fx.color);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = alpha * 0.9;
        ctx.fillStyle = g;
        ctx.fillRect(x - w / 2, 0, w, canvas.height);
        ctx.restore();
      } else if (fx.type === 'ring') {
        const radius = fx.radius * easeOutCubic(t);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = alpha * 0.85;
        ctx.strokeStyle = fx.color;
        ctx.lineWidth = Math.max(2, cellSize * 0.22 * (1 - t));
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (fx.type === 'flash') {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = fx.color;
        ctx.fillRect(0, 0, cssWidth, canvas.height);
        ctx.restore();
      }
    }
  }

  function floatText(text, index, color = '#ffe27a', big = false) {
    floatTexts.push({
      text,
      x: cellX(colOf(index)),
      y: cellY(rowOf(index)),
      life: big ? 1.2 : 0.95,
      maxLife: big ? 1.2 : 0.95,
      color,
      big,
    });
  }

  function updateFloatTexts(dt) {
    if (!floatTexts.length) return;
    const still = [];
    for (const ft of floatTexts) {
      ft.life -= dt;
      ft.y -= dt * 62;
      if (ft.life > 0) still.push(ft);
    }
    floatTexts = still;
  }

  function drawFloatTexts() {
    for (const ft of floatTexts) {
      const t = 1 - ft.life / ft.maxLife;
      const pop = t < 0.18 ? easeOutBack(t / 0.18) : 1;
      const alpha = t > 0.65 ? 1 - (t - 0.65) / 0.35 : 1;
      const size = (ft.big ? cellSize * 0.72 : cellSize * 0.5) * pop;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.font = `800 ${size}px 'Segoe UI', system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(2, size * 0.16);
      ctx.strokeStyle = 'rgba(10,4,24,0.85)';
      ctx.strokeText(ft.text, ft.x, ft.y);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }
  }

  function shake(magnitude) {
    if (reducedMotion) return;
    shakeMag = Math.max(shakeMag, magnitude);
    shakeTime = 0;
  }

  function flash(color, strength = 0.45) {
    flashColor = color;
    flashAlpha = strength;
  }

  function setDanger(level) {
    dangerLevel = Math.max(0, Math.min(1, level));
  }

  // ---------------------------------------------------------------------------
  // Animacoes de jogada
  // ---------------------------------------------------------------------------

  function animateSwap(a, b) {
    const sa = cellSprites[a];
    const sb = cellSprites[b];
    if (!sa || !sb) return Promise.resolve();

    cellSprites[a] = sb;
    cellSprites[b] = sa;

    return runTweens([
      { target: sa, to: { col: colOf(b), row: rowOf(b) }, duration: scale(TIMING.swap) },
      { target: sb, to: { col: colOf(a), row: rowOf(a) }, duration: scale(TIMING.swap) },
    ]);
  }

  /** Troca invalida: vai e volta, com um tranco no fim. */
  async function animateSwapRevert(a, b) {
    await animateSwap(a, b);

    // Depois de animateSwap o espelho JA ESTA trocado: quem ocupa `a` e a peca
    // que comecou em `b`. Os nomes abaixo dizem a origem, nao a casa atual —
    // a versao anterior chamava estas variaveis de `sa` e `sb`, o que sugeria
    // o contrario, e por isso as posicoes finais acabaram invertidas.
    const veioDeB = cellSprites[a];
    const veioDeA = cellSprites[b];

    await runTweens([
      { target: veioDeB, to: { col: colOf(b), row: rowOf(b) }, duration: scale(TIMING.swapBack), ease: easeInQuad },
      { target: veioDeA, to: { col: colOf(a), row: rowOf(a) }, duration: scale(TIMING.swapBack), ease: easeInQuad },
    ]);

    // Cada peca volta para a casa de origem, no espelho E na posicao desenhada.
    // As duas coisas TEM de concordar: se divergirem, a proxima cascata remove
    // o sprite errado e o tabuleiro fica com buraco de um lado e peca
    // sobreposta do outro.
    cellSprites[a] = veioDeA;
    cellSprites[b] = veioDeB;
    veioDeA.col = colOf(a);
    veioDeA.row = rowOf(a);
    veioDeB.col = colOf(b);
    veioDeB.row = rowOf(b);
  }

  function burstAt(index, type, special) {
    const x = cellX(colOf(index));
    const y = cellY(rowOf(index));
    const color = special === 4 ? '#ffffff' : (GEM_TYPES[type] || GEM_TYPES[0]).base;
    particles.emit({ x, y, count: reducedMotion ? 3 : 9, color, speed: 250, size: cellSize * 0.16, life: 0.5 });
    particles.emit({ x, y, count: reducedMotion ? 2 : 5, color: '#ffffff', speed: 170, size: cellSize * 0.1, life: 0.35, shape: 'circle' });
  }

  /**
   * Anima uma fase completa: explosao -> remocao -> queda -> entrada.
   * Aplica as mudancas ao espelho visual na mesma ordem que a logica aplicou
   * ao grid, senao os indices deixam de bater.
   */
  async function animatePhase(phase) {
    for (const act of phase.activations) spawnActivationEffect(act);

    // 1. Pop das pecas que somem
    const popSpecs = [];
    for (const i of phase.cleared) {
      const sprite = cellSprites[i];
      if (!sprite) continue;
      cellSprites[i] = null;
      burstAt(i, sprite.type, sprite.special);
      popSpecs.push({
        target: sprite,
        to: { scale: 0, alpha: 0, spin: (Math.random() - 0.5) * 2 },
        duration: scale(TIMING.pop),
        ease: easeInQuad,
        onComplete: () => sprites.delete(sprite.id),
      });
    }

    // 1b. Obstaculos atingidos: tremem, soltam lasca, e somem se acabaram.
    const danoSpecs = [];
    for (const dano of phase.danos || []) {
      const sprite = cellSprites[dano.index];
      if (!sprite) continue;

      const x = cellX(colOf(dano.index));
      const y = cellY(rowOf(dano.index));
      const cor = dano.tipo === 'gelo' ? '#bfe9ff' : dano.tipo === 'cadeado' ? '#cfc6e0' : '#9a92ad';
      particles.emit({
        x,
        y,
        count: reducedMotion ? 3 : dano.destruido ? 18 : 9,
        color: cor,
        speed: dano.destruido ? 300 : 190,
        size: cellSize * 0.15,
        life: 0.5,
      });

      if (dano.destruido) {
        if (dano.tipo === 'cadeado') {
          // A peca sobrevive: some so a corrente.
          sprite.blocker = null;
        } else {
          cellSprites[dano.index] = null;
          danoSpecs.push({
            target: sprite,
            to: { scale: 0, alpha: 0 },
            duration: scale(TIMING.pop),
            ease: easeInQuad,
            onComplete: () => sprites.delete(sprite.id),
          });
        }
      } else if (sprite.blocker) {
        sprite.blocker = { ...sprite.blocker, hp: dano.hp };
        // Tranco curto: comunica "levou, mas aguentou".
        sprite.scale = 1.18;
        danoSpecs.push({
          target: sprite,
          to: { scale: 1 },
          duration: scale(220),
          ease: easeOutBack,
        });
      }
    }

    // 2. Especiais que nascem (a peca sobrevive e se transforma)
    const morphSpecs = [];
    for (const created of phase.created) {
      const sprite = cellSprites[created.index];
      if (!sprite) continue;
      sprite.type = created.type;
      sprite.special = created.special;
      sprite.scale = 0.25;
      sprite.glow = 1;
      morphSpecs.push({
        target: sprite,
        to: { scale: 1, glow: 0 },
        duration: scale(TIMING.morph),
        ease: easeOutBack,
      });
      const x = cellX(colOf(created.index));
      const y = cellY(rowOf(created.index));
      particles.emit({ x, y, count: reducedMotion ? 4 : 22, color: '#ffffff', speed: 300, size: cellSize * 0.13, life: 0.55, shape: 'circle' });
    }

    await runTweens([...popSpecs, ...danoSpecs, ...morphSpecs]);

    // 3. Queda das pecas que sobraram
    const fallSpecs = [];
    for (const fall of phase.falls) {
      const sprite = cellSprites[fall.from];
      if (!sprite) continue;
      cellSprites[fall.from] = null;
      cellSprites[fall.to] = sprite;
      const distance = rowOf(fall.to) - rowOf(fall.from);
      fallSpecs.push({
        target: sprite,
        to: { row: rowOf(fall.to) },
        duration: scale(TIMING.fallBase + Math.sqrt(Math.max(1, distance)) * 55),
        ease: easeLand,
      });
    }

    // 4. Pecas novas entrando por cima
    for (const spawn of phase.spawns) {
      const sprite = {
        id: spawn.id,
        type: spawn.type,
        special: 0,
        blocker: null,
        col: colOf(spawn.to),
        row: rowOf(spawn.to) - spawn.height - 0.6,
        scale: 1,
        alpha: 1,
        glow: 0,
        spin: 0,
      };
      sprites.set(sprite.id, sprite);
      cellSprites[spawn.to] = sprite;
      fallSpecs.push({
        target: sprite,
        to: { row: rowOf(spawn.to) },
        duration: scale(TIMING.fallBase + spawn.height * 24),
        delay: scale(spawn.height * TIMING.spawnStagger * 0.35),
        ease: easeLand,
      });
    }

    await runTweens(fallSpecs);
  }

  function setSelection(index) {
    selection = index;
  }

  function setHint(move) {
    hint = move;
    hintPulse = 0;
  }

  // ---------------------------------------------------------------------------
  // Desenho
  // ---------------------------------------------------------------------------

  function drawBoardBackground() {
    const h = BOARD_PAD * 2 + cellSize * ROWS + CELL_GAP * (ROWS - 1);
    const raio = 18;

    // Base em degrade, um pouco mais rico que dois tons chapados.
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#241547');
    g.addColorStop(0.5, '#180d30');
    g.addColorStop(1, '#0f0722');
    ctx.fillStyle = g;
    roundRect(0, 0, cssWidth, h, raio);
    ctx.fill();

    // Nichos rebaixados: fundo escuro + um fio de luz na aresta de baixo,
    // que ler como se a casa fosse escavada. O custo continua O(64) fills,
    // sem gradiente por celula (que mataria o desempenho no celular).
    const lipH = Math.max(1, cellSize * 0.06);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = BOARD_PAD + c * pitch;
        const y = BOARD_PAD + r * pitch;
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        roundRect(x, y, cellSize, cellSize, cellSize * 0.24);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        roundRect(x, y + cellSize - lipH, cellSize, lipH, lipH);
        ctx.fill();
      }
    }

    // Vinheta interna: cantos mais escuros, foco no centro do tabuleiro.
    ctx.save();
    roundRect(0, 0, cssWidth, h, raio);
    ctx.clip();
    const vg = ctx.createRadialGradient(
      cssWidth / 2, h * 0.42, Math.min(cssWidth, h) * 0.18,
      cssWidth / 2, h * 0.5, Math.max(cssWidth, h) * 0.72
    );
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, cssWidth, h);

    // Brilho no topo: uma leve claridade que sugere luz vindo de cima.
    const sheen = ctx.createLinearGradient(0, 0, 0, h * 0.42);
    sheen.addColorStop(0, 'rgba(255,255,255,0.06)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, cssWidth, h * 0.42);
    ctx.restore();

    // Moldura: um fio de luz em volta, mais claro no topo. Da acabamento e
    // separa o tabuleiro do fundo atras dele.
    ctx.save();
    const rim = ctx.createLinearGradient(0, 0, 0, h);
    rim.addColorStop(0, 'rgba(255,255,255,0.18)');
    rim.addColorStop(0.5, 'rgba(255,255,255,0.04)');
    rim.addColorStop(1, 'rgba(150,110,230,0.12)');
    ctx.strokeStyle = rim;
    ctx.lineWidth = 1.5;
    roundRect(0.75, 0.75, cssWidth - 1.5, h - 1.5, raio);
    ctx.stroke();
    ctx.restore();

    // Aviso de perigo: borda vermelha pulsando quando a barra esta quase cheia.
    if (dangerLevel > 0.01) {
      const pulse = 0.45 + 0.55 * Math.sin(time * 7);
      ctx.save();
      ctx.strokeStyle = `rgba(255,70,70,${dangerLevel * pulse * 0.9})`;
      ctx.lineWidth = 3 + dangerLevel * 4;
      roundRect(2, 2, cssWidth - 4, h - 4, raio);
      ctx.stroke();
      ctx.restore();
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
  }

  function drawSelection() {
    if (selection === null || selection === undefined) return;
    const sprite = cellSprites[selection];
    if (!sprite) return;
    const x = cellX(sprite.col);
    const y = cellY(sprite.row);
    const pulse = 0.8 + 0.2 * Math.sin(time * 9);
    ctx.save();
    ctx.strokeStyle = `rgba(255,255,255,${0.85 * pulse})`;
    ctx.lineWidth = Math.max(2, cellSize * 0.09);
    roundRect(x - cellSize / 2 - 2, y - cellSize / 2 - 2, cellSize + 4, cellSize + 4, cellSize * 0.28);
    ctx.stroke();
    ctx.restore();
  }

  function drawHint() {
    if (!hint) return;
    const alpha = 0.35 + 0.35 * Math.sin(hintPulse * 4);
    for (const index of [hint.a, hint.b]) {
      const sprite = cellSprites[index];
      if (!sprite) continue;
      const x = cellX(sprite.col);
      const y = cellY(sprite.row);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(120,220,255,${alpha})`;
      roundRect(x - cellSize / 2, y - cellSize / 2, cellSize, cellSize, cellSize * 0.26);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawSprites() {
    // Respiro em repouso: com o tabuleiro parado, cada peca oscila de leve, com
    // fase propria (pelo id), formando uma onda suave em vez de tudo junto. So
    // afeta o DESENHO — a posicao logica nunca muda. Durante uma jogada a onda
    // e desligada, para nao tremer no meio da queda.
    const emRepouso = !reducedMotion && tweens.length === 0;

    for (const sprite of sprites.values()) {
      if (sprite.alpha <= 0.01 || sprite.scale <= 0.01) continue;
      const x = cellX(sprite.col);
      const bob = emRepouso ? Math.sin(time * 1.5 + sprite.id * 0.7) * cellSize * 0.025 : 0;
      const y = cellY(sprite.row) + bob;
      const radius = (cellSize / 2) * 0.86 * sprite.scale;

      ctx.save();
      ctx.globalAlpha = sprite.alpha;
      if (sprite.spin) {
        ctx.translate(x, y);
        ctx.rotate(sprite.spin);
        ctx.translate(-x, -y);
      }
      if (sprite.glow > 0.01) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = sprite.glow * 0.8;
        const g = ctx.createRadialGradient(x, y, 0, x, y, cellSize * 1.3);
        g.addColorStop(0, 'rgba(255,255,255,0.9)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, cellSize * 1.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      if (sprite.blocker && sprite.blocker.tipo !== 'cadeado') {
        // Pedra e gelo ocupam a casa: nao ha peca por baixo.
        drawBlocker(ctx, x, y, radius, sprite.blocker.tipo, sprite.blocker.hp);
      } else {
        drawGem(ctx, x, y, radius, sprite.type, sprite.special, time);
        // Cadeado e sobreposicao: a cor tem de continuar legivel, porque a
        // peca ainda combina.
        if (sprite.blocker) drawBlocker(ctx, x, y, radius, 'cadeado', sprite.blocker.hp);
      }
      ctx.restore();
    }
  }

  function frame(now) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);

    // dt limitado: se a aba ficou em segundo plano, `now - lastFrame` vem com
    // segundos de diferenca e tudo teleporta ao voltar.
    const dt = Math.min(0.05, (now - lastFrame) / 1000 || 0);
    lastFrame = now;
    time += dt;
    hintPulse += dt;

    updateTweens(dt);
    particles.update(dt);
    updateEffects(dt);
    updateFloatTexts(dt);

    if (shakeMag > 0.05) {
      shakeTime += dt;
      shakeMag *= Math.pow(0.0015, dt);
      if (shakeMag < 0.05) shakeMag = 0;
    }
    if (flashAlpha > 0.001) flashAlpha *= Math.pow(0.02, dt);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let ox = 0;
    let oy = 0;
    if (shakeMag > 0) {
      ox = (Math.random() - 0.5) * shakeMag;
      oy = (Math.random() - 0.5) * shakeMag;
      ctx.translate(ox, oy);
    }

    drawBoardBackground();
    drawHint();
    drawSelection();
    drawSprites();
    particles.draw(ctx);
    drawEffects();
    drawFloatTexts();

    if (flashAlpha > 0.001 && flashColor) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, flashAlpha);
      ctx.fillStyle = flashColor;
      ctx.fillRect(-ox, -oy, cssWidth, canvas.height);
      ctx.restore();
    }
  }

  function start() {
    if (running) return;
    running = true;
    lastFrame = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  function setReducedMotion(value) {
    reducedMotion = !!value;
  }

  /**
   * Confere se o espelho visual bate com o que esta desenhado.
   *
   * Existe por causa de um bug real: uma troca invalida devolvia as duas pecas
   * para as casas TROCADAS na posicao desenhada, enquanto o espelho ficava
   * certo. Nada quebrava na hora — mas na cascata seguinte o sprite errado era
   * removido, e o tabuleiro ganhava um buraco de um lado e duas pecas
   * empilhadas do outro. Era invisivel para os testes, que so olhavam o estado
   * logico, e so apareceu numa foto de alguem jogando.
   *
   * So faz sentido com o tabuleiro parado: no meio de uma animacao as pecas
   * estao legitimamente entre duas casas.
   */
  function conferirEspelho() {
    const problemas = [];
    if (tweens.length > 0) return { ok: true, animando: true, problemas };

    const vistos = new Map();
    for (let i = 0; i < CELL_COUNT; i++) {
      const sprite = cellSprites[i];
      if (!sprite) {
        problemas.push(`casa ${i} vazia no espelho`);
        continue;
      }
      if (vistos.has(sprite.id)) {
        problemas.push(`sprite ${sprite.id} ocupa as casas ${vistos.get(sprite.id)} e ${i}`);
      }
      vistos.set(sprite.id, i);

      if (!sprites.has(sprite.id)) {
        problemas.push(`sprite ${sprite.id} na casa ${i} nao existe mais`);
      }
      if (Math.round(sprite.row) !== rowOf(i) || Math.round(sprite.col) !== colOf(i)) {
        problemas.push(
          `sprite da casa ${i} desenhado em (${Math.round(sprite.row)},${Math.round(sprite.col)})`
        );
      }
    }

    // Sprite visivel que nenhuma casa referencia: e o que aparece empilhado.
    for (const sprite of sprites.values()) {
      if (vistos.has(sprite.id)) continue;
      if (sprite.alpha > 0.05 && sprite.scale > 0.05) {
        problemas.push(`sprite ${sprite.id} desenhado sem casa`);
      }
    }

    return { ok: problemas.length === 0, animando: false, problemas };
  }

  resize();

  return {
    resize,
    start,
    stop,
    setGrid,
    introDrop,
    animateSwap,
    animateSwapRevert,
    animatePhase,
    setSelection,
    setHint,
    floatText,
    shake,
    flash,
    setDanger,
    pointerToCell,
    setReducedMotion,
    conferirEspelho,
    get cellSize() {
      return cellSize;
    },
  };
}
