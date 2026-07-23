// Desenho das pecas.
//
// Duas escolhas deliberadas aqui:
//
// 1. Nada de emoji. O emoji muda de desenho em cada celular (Android, iOS e
//    Windows renderizam o mesmo caractere de formas diferentes), entao o jogo
//    nunca teria identidade visual propria. Desenhado a mao no canvas, fica
//    igual em todo lugar.
//
// 2. Cada tipo tem FORMA propria, nao so cor. Cerca de 8% dos homens tem algum
//    daltonismo, e um match-3 que so distingue por cor e injogavel para eles.
//    Com forma distinta o jogo funciona ate em preto e branco.

export const GEM_TYPES = [
  { name: 'morango', shape: 'circle', base: '#ff3d6e', light: '#ff9bb4', dark: '#a3062f' },
  { name: 'limao', shape: 'square', base: '#ffd21f', light: '#fff09a', dark: '#a37800' },
  { name: 'laranja', shape: 'triangle', base: '#ff8a1f', light: '#ffc487', dark: '#a34d00' },
  { name: 'kiwi', shape: 'diamond', base: '#33d17a', light: '#a3f0c4', dark: '#0c7a3f' },
  { name: 'mirtilo', shape: 'hexagon', base: '#3d8bff', light: '#a3c8ff', dark: '#0a3f9e' },
  { name: 'uva', shape: 'star', base: '#b45cff', light: '#ddb3ff', dark: '#5c179e' },
];

/** Cor solida de cada tipo — usada nos tabuleiros miniatura dos adversarios. */
export const GEM_COLORS = GEM_TYPES.map((g) => g.base);

function shapePath(ctx, shape, cx, cy, r) {
  ctx.beginPath();
  switch (shape) {
    case 'circle':
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      break;

    case 'square': {
      const s = r * 0.88;
      const k = r * 0.3; // canto arredondado
      ctx.moveTo(cx - s + k, cy - s);
      ctx.lineTo(cx + s - k, cy - s);
      ctx.quadraticCurveTo(cx + s, cy - s, cx + s, cy - s + k);
      ctx.lineTo(cx + s, cy + s - k);
      ctx.quadraticCurveTo(cx + s, cy + s, cx + s - k, cy + s);
      ctx.lineTo(cx - s + k, cy + s);
      ctx.quadraticCurveTo(cx - s, cy + s, cx - s, cy + s - k);
      ctx.lineTo(cx - s, cy - s + k);
      ctx.quadraticCurveTo(cx - s, cy - s, cx - s + k, cy - s);
      break;
    }

    case 'triangle': {
      const R = r * 1.12;
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
        const x = cx + Math.cos(a) * R;
        const y = cy + Math.sin(a) * R * 0.96 + r * 0.1;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
    }

    case 'diamond':
      ctx.moveTo(cx, cy - r * 1.1);
      ctx.lineTo(cx + r * 0.92, cy);
      ctx.lineTo(cx, cy + r * 1.1);
      ctx.lineTo(cx - r * 0.92, cy);
      ctx.closePath();
      break;

    case 'hexagon':
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 3;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;

    case 'star': {
      const spikes = 5;
      const outer = r * 1.12;
      const inner = r * 0.52;
      for (let i = 0; i < spikes * 2; i++) {
        const rad = i % 2 === 0 ? outer : inner;
        const a = -Math.PI / 2 + (i * Math.PI) / spikes;
        const x = cx + Math.cos(a) * rad;
        const y = cy + Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
    }
  }
}

function drawStripes(ctx, cx, cy, r, horizontal) {
  ctx.save();
  ctx.clip();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  const band = r * 0.26;
  const gap = r * 0.34;
  for (let o = -r * 1.2; o < r * 1.2; o += band + gap) {
    if (horizontal) ctx.fillRect(cx - r * 1.3, cy + o, r * 2.6, band);
    else ctx.fillRect(cx + o, cy - r * 1.3, band, r * 2.6);
  }
  ctx.restore();
}

function drawWrappedGlow(ctx, cx, cy, r, time) {
  const pulse = 0.5 + 0.5 * Math.sin(time * 6);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 1.5);
  g.addColorStop(0, `rgba(255,255,255,${0.35 + pulse * 0.25})`);
  g.addColorStop(0.6, `rgba(255,220,120,${0.18 + pulse * 0.16})`);
  g.addColorStop(1, 'rgba(255,180,60,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = `rgba(255,255,255,${0.6 + pulse * 0.4})`;
  ctx.lineWidth = Math.max(1.5, r * 0.12);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.98, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawColorBomb(ctx, cx, cy, r, time) {
  // Esfera escura com pontos coloridos girando: le como "todas as cores" sem
  // precisar de gradiente conico, que o Safari antigo nao suporta.
  const body = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
  body.addColorStop(0, '#4a4560');
  body.addColorStop(0.7, '#1c1830');
  body.addColorStop(1, '#0a0814');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.94, 0, Math.PI * 2);
  ctx.clip();
  const dots = 14;
  for (let i = 0; i < dots; i++) {
    const a = time * 1.6 + (i * Math.PI * 2) / dots;
    const orbit = r * (0.34 + 0.34 * Math.sin(i * 1.7 + time * 0.9));
    const x = cx + Math.cos(a) * orbit;
    const y = cy + Math.sin(a * 1.3) * orbit * 0.8;
    const depth = 0.55 + 0.45 * Math.sin(a);
    ctx.globalAlpha = depth;
    ctx.fillStyle = GEM_TYPES[i % GEM_TYPES.length].base;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.17 * depth, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.5 + 0.3 * Math.sin(time * 5);
  const glow = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 1.4);
  glow.addColorStop(0, 'rgba(255,255,255,0.28)');
  glow.addColorStop(1, 'rgba(160,120,255,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = Math.max(1, r * 0.07);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.97, 0, Math.PI * 2);
  ctx.stroke();
}

/**
 * Desenha uma peca centrada em (cx, cy).
 * `special` usa os valores de SPECIAL do core; 4 = bomba colorida.
 */
export function drawGem(ctx, cx, cy, radius, type, special = 0, time = 0) {
  if (special === 4) {
    drawColorBomb(ctx, cx, cy, radius, time);
    return;
  }

  const gem = GEM_TYPES[type] || GEM_TYPES[0];
  const r = radius;

  // Sombra projetada: da profundidade e separa a peca do fundo do tabuleiro.
  ctx.save();
  ctx.globalAlpha = 0.32;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.72, r * 0.78, r * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (special === 3) drawWrappedGlow(ctx, cx, cy, r, time);

  // Corpo
  const grad = ctx.createRadialGradient(cx - r * 0.34, cy - r * 0.4, r * 0.08, cx, cy, r * 1.18);
  grad.addColorStop(0, gem.light);
  grad.addColorStop(0.48, gem.base);
  grad.addColorStop(1, gem.dark);

  shapePath(ctx, gem.shape, cx, cy, r);
  ctx.fillStyle = grad;
  ctx.fill();

  if (special === 1 || special === 2) {
    shapePath(ctx, gem.shape, cx, cy, r);
    drawStripes(ctx, cx, cy, r, special === 1);
  }

  // Contorno interno claro: "borda de bala", faz a peca parecer solida.
  shapePath(ctx, gem.shape, cx, cy, r);
  ctx.strokeStyle = 'rgba(255,255,255,0.34)';
  ctx.lineWidth = Math.max(1, r * 0.09);
  ctx.stroke();

  // Brilho especular
  ctx.save();
  shapePath(ctx, gem.shape, cx, cy, r);
  ctx.clip();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.3, cy - r * 0.42, r * 0.34, r * 0.2, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(cx - r * 0.38, cy - r * 0.46, r * 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Miniatura simples para o tabuleiro dos adversarios. */
export function drawMiniGem(ctx, x, y, size, type) {
  const gem = GEM_TYPES[type] || GEM_TYPES[0];
  ctx.fillStyle = gem.base;
  const r = size * 0.22;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, size, size, r) : ctx.rect(x, y, size, size);
  ctx.fill();
}
