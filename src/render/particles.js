// Sistema de particulas do tabuleiro.
//
// Pool de tamanho fixo: alocar objetos novos a cada explosao faria o coletor
// de lixo rodar no meio de uma cascata, que e exatamente o momento em que o
// jogo mais precisa de quadros estaveis. Particula "morta" fica no array e e
// reaproveitada.

const MAX_PARTICLES = 420;
const GRAVITY = 1400;

export function createParticleSystem() {
  const pool = new Array(MAX_PARTICLES);
  for (let i = 0; i < MAX_PARTICLES; i++) {
    pool[i] = { alive: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 4, color: '#fff', shape: 'square', rot: 0, spin: 0, gravity: 1, fade: 1 };
  }
  let cursor = 0;

  function acquire() {
    // Procura um slot livre; se todos estiverem ocupados, sobrescreve o mais
    // antigo. Roubar uma particula velha e imperceptivel, travar nao e.
    for (let n = 0; n < MAX_PARTICLES; n++) {
      const p = pool[cursor];
      cursor = (cursor + 1) % MAX_PARTICLES;
      if (!p.alive) return p;
    }
    const p = pool[cursor];
    cursor = (cursor + 1) % MAX_PARTICLES;
    return p;
  }

  function emit(options) {
    const {
      x,
      y,
      count = 10,
      color = '#fff',
      speed = 260,
      speedVariance = 0.6,
      size = 5,
      sizeVariance = 0.5,
      life = 0.6,
      lifeVariance = 0.35,
      shape = 'square',
      gravity = 1,
      angle = null,
      spread = Math.PI * 2,
      fade = 1,
    } = options;

    for (let i = 0; i < count; i++) {
      const p = acquire();
      const dir = angle === null ? Math.random() * Math.PI * 2 : angle + (Math.random() - 0.5) * spread;
      const spd = speed * (1 + (Math.random() - 0.5) * 2 * speedVariance);
      p.alive = true;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(dir) * spd;
      p.vy = Math.sin(dir) * spd;
      p.maxLife = life * (1 + (Math.random() - 0.5) * 2 * lifeVariance);
      p.life = p.maxLife;
      p.size = size * (1 + (Math.random() - 0.5) * 2 * sizeVariance);
      p.color = color;
      p.shape = shape;
      p.rot = Math.random() * Math.PI * 2;
      p.spin = (Math.random() - 0.5) * 14;
      p.gravity = gravity;
      p.fade = fade;
    }
  }

  function update(dt) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = pool[i];
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      p.vy += GRAVITY * p.gravity * dt;
      p.vx *= 1 - 1.6 * dt; // arrasto: sem isso as faiscas voam reto e parecem chuva
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
    }
  }

  function draw(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = pool[i];
      if (!p.alive) continue;
      const t = p.life / p.maxLife;
      ctx.globalAlpha = Math.max(0, Math.min(1, t * p.fade));
      ctx.fillStyle = p.color;

      if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * t, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === 'spark') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.atan2(p.vy, p.vx));
        ctx.fillRect(-p.size * 2 * t, -p.size * 0.22, p.size * 4 * t, p.size * 0.44);
        ctx.restore();
      } else {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        const s = p.size * t;
        ctx.fillRect(-s / 2, -s / 2, s, s);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  function clear() {
    for (let i = 0; i < MAX_PARTICLES; i++) pool[i].alive = false;
  }

  function activeCount() {
    let n = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) if (pool[i].alive) n++;
    return n;
  }

  return { emit, update, draw, clear, activeCount };
}
