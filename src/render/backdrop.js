// Fundo "aurora de doce": as PROPRIAS pecas do jogo como luzes flutuando.
//
// A ideia e coesao total: em vez de importar um cenario de fora, o fundo nasce
// da identidade do proprio jogo — as 6 gemas e as cores neon delas. Assim ele
// nunca destoa das pecas do tabuleiro, porque E das mesmas pecas.
//
// Tres camadas de profundidade de campo:
//  - FUNDO: muitas gemas pequenas, bem desfocadas, quase paradas — poeira de luz;
//  - MEIO: medias, desfoque leve, deriva lenta;
//  - FRENTE: poucas grandes, macias, fora de foco, passando devagar.
// Cada gema tem um HALO de luz na propria cor, entao brilha como um doce de
// vidro num ceu escuro. Por cima, brilhos piscam de leve.
//
// Barato no celular: o halo + desfoque sao ASSADOS uma vez em cada textura; por
// quadro so ha blit. ~30fps, para fora da batalha.

import { drawGem, GEM_TYPES } from './gems.js';

const TILE = 148;
const FPS = 30;
const FRAME_MS = 1000 / FPS;

// Planos de foco, do fundo para a frente.
const PLANOS = [
  { blur: 0.1, sMin: 14, sMax: 28, alpha: 0.16, vMin: 0.004, vMax: 0.012, n: 12 },
  { blur: 0.055, sMin: 32, sMax: 58, alpha: 0.22, vMin: 0.012, vMax: 0.026, n: 8 },
  { blur: 0.03, sMin: 74, sMax: 132, alpha: 0.26, vMin: 0.024, vMax: 0.045, n: 5 },
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
  let time = 0;
  let reduced = false;

  const tiles = []; // tiles[plano][tipo]
  const gemas = [];
  const brilhos = [];

  function buildTiles() {
    tiles.length = 0;
    for (const plano of PLANOS) {
      const linha = [];
      for (let t = 0; t < GEM_TYPES.length; t++) {
        const off = document.createElement('canvas');
        off.width = TILE;
        off.height = TILE;
        const o = off.getContext('2d');

        // Halo de luz na cor da gema, para ela brilhar como doce de vidro.
        const cor = GEM_TYPES[t].base;
        const halo = o.createRadialGradient(TILE / 2, TILE / 2, TILE * 0.05, TILE / 2, TILE / 2, TILE * 0.5);
        halo.addColorStop(0, cor + 'cc');
        halo.addColorStop(0.4, cor + '55');
        halo.addColorStop(1, cor + '00');
        o.fillStyle = halo;
        o.fillRect(0, 0, TILE, TILE);

        try {
          o.filter = `blur(${plano.blur * TILE}px)`;
        } catch {
          /* navegador sem filter no canvas: fica nitido, ainda funciona */
        }
        drawGem(o, TILE / 2, TILE / 2, TILE * 0.2, t, 0, 0);
        linha.push(off);
      }
      tiles.push(linha);
    }
  }

  function seed() {
    gemas.length = 0;
    PLANOS.forEach((plano, p) => {
      for (let i = 0; i < plano.n; i++) {
        const dir = Math.random() * Math.PI * 2;
        const v = plano.vMin + Math.random() * (plano.vMax - plano.vMin);
        gemas.push({
          plano: p,
          type: (Math.random() * GEM_TYPES.length) | 0,
          x: Math.random(),
          y: Math.random(),
          size: plano.sMin + Math.random() * (plano.sMax - plano.sMin),
          vx: Math.cos(dir) * v,
          vy: Math.sin(dir) * v,
          rot: Math.random() * Math.PI * 2,
          rotSpeed: (Math.random() - 0.5) * 0.18,
          alpha: plano.alpha * (0.75 + Math.random() * 0.5),
        });
      }
    });
    gemas.sort((a, b) => a.plano - b.plano);

    brilhos.length = 0;
    for (let i = 0; i < 26; i++) {
      brilhos.push({
        x: Math.random(),
        y: Math.random(),
        r: 1 + Math.random() * 2,
        fase: Math.random() * Math.PI * 2,
        vel: 0.6 + Math.random() * 1.2,
        cor: Math.random() < 0.5 ? '#ffffff' : GEM_TYPES[(Math.random() * GEM_TYPES.length) | 0].base,
      });
    }
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
    for (const g of gemas) {
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      g.rot += g.rotSpeed * dt;
      if (g.x < -0.2) g.x = 1.2;
      else if (g.x > 1.2) g.x = -0.2;
      if (g.y < -0.2) g.y = 1.2;
      else if (g.y > 1.2) g.y = -0.2;
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Gemas-luz, de tras para a frente.
    for (const g of gemas) {
      const tile = tiles[g.plano] && tiles[g.plano][g.type];
      if (!tile) continue;
      const s = g.size * (TILE / (TILE * 0.5));
      ctx.save();
      ctx.globalAlpha = g.alpha;
      ctx.globalCompositeOperation = 'lighter'; // luz soma, nao tapa
      ctx.translate(g.x * W, g.y * H);
      ctx.rotate(g.rot);
      ctx.drawImage(tile, -s / 2, -s / 2, s, s);
      ctx.restore();
    }

    // Brilhos piscando por cima.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const b of brilhos) {
      const cintila = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * b.vel + b.fase));
      ctx.globalAlpha = cintila * 0.9;
      ctx.fillStyle = b.cor;
      ctx.beginPath();
      ctx.arc(b.x * W, b.y * H, b.r * (0.6 + cintila * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function frame(now) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    const delta = Math.min(100, now - last);
    last = now;
    acc += delta;
    if (acc < FRAME_MS) return;
    const dt = acc / 1000;
    time += dt;
    step(dt);
    acc = 0;
    draw();
  }

  function ensure() {
    if (!tiles.length) buildTiles();
    if (!gemas.length) seed();
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
