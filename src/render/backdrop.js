// Fundo: chuva de doce com PROFUNDIDADE DE CAMPO.
//
// A primeira tentativa foi uma rua desenhada a mao (predios, guias, janelas) e
// ficou com cara de arte de programador. A licao: profundidade que parece
// premium nao vem de geometria, vem de LUZ e DESFOQUE em camadas — e o que os
// menus de jogo caros fazem.
//
// Aqui os doces caem em tres planos de foco:
//  - FUNDO: muitos, pequenos, bem desfocados, lentos, quase transparentes;
//  - MEIO: medios, desfoque leve;
//  - FRENTE: poucos, grandes, macios, rapidos, passando fora de foco.
//
// O olho le a diferenca de nitidez e de velocidade como distancia. Cai devagar,
// como chuva. Sonhador, nao carregado.
//
// Barato no celular: o desfoque e ASSADO uma vez em cada textura (filter no
// canvas offscreen, na criacao); por quadro so ha blit. ~30fps, para fora da
// batalha.

import { drawGem, GEM_TYPES } from './gems.js';

const TILE = 128;
const FPS = 30;
const FRAME_MS = 1000 / FPS;

// Planos de foco, do fundo para a frente. `speed` e fracao da altura por segundo.
const PLANOS = [
  { blur: 0.13, sMin: 10, sMax: 22, alpha: 0.1, vMin: 0.02, vMax: 0.045, n: 16 },
  { blur: 0.06, sMin: 26, sMax: 50, alpha: 0.17, vMin: 0.05, vMax: 0.085, n: 11 },
  { blur: 0.03, sMin: 66, sMax: 128, alpha: 0.22, vMin: 0.1, vMax: 0.17, n: 6 },
];

export function createBackdrop(canvas) {
  const ctx = canvas.getContext('2d');
  let dpr = 1;
  let W = 0;
  let H = 0;
  let running = false;
  let rafId = null;
  let last = 0;
  let acc = 0;
  let reduced = false;

  // tiles[plano][tipo] = textura do doce ja desfocada naquele plano.
  const tiles = [];
  const gotas = [];

  function buildTiles() {
    tiles.length = 0;
    for (const plano of PLANOS) {
      const linha = [];
      for (let t = 0; t < GEM_TYPES.length; t++) {
        const off = document.createElement('canvas');
        off.width = TILE;
        off.height = TILE;
        const o = off.getContext('2d');
        // O desfoque sangra alem da borda; desenhar a gema menor deixa margem.
        try {
          o.filter = `blur(${plano.blur * TILE}px)`;
        } catch {
          /* navegador sem filter no canvas: fica nitido, ainda funciona */
        }
        drawGem(o, TILE / 2, TILE / 2, TILE * 0.28, t, 0, 0);
        linha.push(off);
      }
      tiles.push(linha);
    }
  }

  function seedGotas() {
    gotas.length = 0;
    PLANOS.forEach((plano, p) => {
      for (let i = 0; i < plano.n; i++) {
        gotas.push({
          plano: p,
          type: (Math.random() * GEM_TYPES.length) | 0,
          x: Math.random(),
          y: Math.random(),
          size: plano.sMin + Math.random() * (plano.sMax - plano.sMin),
          speed: plano.vMin + Math.random() * (plano.vMax - plano.vMin),
          drift: (Math.random() - 0.5) * 0.012,
          rot: Math.random() * Math.PI * 2,
          rotSpeed: (Math.random() - 0.5) * 0.5,
          alpha: plano.alpha * (0.75 + Math.random() * 0.5),
        });
      }
    });
    // Ordena do fundo para a frente, para os grandes passarem por cima.
    gotas.sort((a, b) => a.plano - b.plano);
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    W = r.width || window.innerWidth;
    H = r.height || window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function step(dt) {
    for (const g of gotas) {
      g.y += g.speed * dt;
      g.x += g.drift * dt;
      g.rot += g.rotSpeed * dt;
      if (g.y > 1.2) {
        g.y = -0.2;
        g.x = Math.random();
      }
      if (g.x < -0.15) g.x = 1.15;
      else if (g.x > 1.15) g.x = -0.15;
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const g of gotas) {
      const tile = tiles[g.plano] && tiles[g.plano][g.type];
      if (!tile) continue;
      // A textura ja tem o desfoque assado; o tamanho na tela e proporcional
      // ao doce, mas a fonte e sempre TILE (com margem para o blur nao cortar).
      const draw = g.size * (TILE / (TILE * 0.56));
      ctx.save();
      ctx.globalAlpha = g.alpha;
      ctx.translate(g.x * W, g.y * H);
      ctx.rotate(g.rot);
      ctx.drawImage(tile, -draw / 2, -draw / 2, draw, draw);
      ctx.restore();
    }
  }

  function frame(now) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    const delta = Math.min(100, now - last);
    last = now;
    acc += delta;
    if (acc < FRAME_MS) return;
    step(acc / 1000);
    acc = 0;
    draw();
  }

  function ensure() {
    if (!tiles.length) buildTiles();
    if (!gotas.length) seedGotas();
  }

  return {
    start() {
      if (running) return;
      ensure();
      resize();
      if (reduced) {
        draw();
        return;
      }
      running = true;
      last = performance.now();
      acc = FRAME_MS;
      rafId = requestAnimationFrame(frame);
    },

    stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
    },

    resize() {
      if (!tiles.length) return;
      resize();
      if (!running) draw();
    },

    setReducedMotion(value) {
      reduced = !!value;
    },
  };
}
