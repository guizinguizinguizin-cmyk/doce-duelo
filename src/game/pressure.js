// Estado de pressao de UM jogador: o que ja entrou e o que esta a caminho.
//
// Modulo compartilhado de proposito. Jogador humano e bot usam esta mesma
// instancia de logica, entao e impossivel o bot ter regras de cancelamento
// diferentes das suas. Duplicar isso ja mordeu este projeto uma vez (o divisor
// de dano estava copiado em dois arquivos e divergiu).
//
// O ciclo que isso cria:
//
//   ataque chega  ->  fica PENDENTE por alguns segundos
//                 ->  voce faz um combo   -> cancela o pendente
//                 ->  nao fez nada a tempo -> vira pressao de verdade
//
// Enquanto esta pendente, ainda da para reagir. E dai que vem a tensao.

import { PRESSURE_MAX, PENDING_DELAY_MS, alertLevel } from './balance.js';

export function createPressure() {
  let current = 0;
  /** Fila ordenada por chegada: [{ units, from, landsAt }] */
  let queue = [];

  const pendingTotal = () => queue.reduce((soma, item) => soma + item.units, 0);

  return {
    get current() {
      return current;
    },
    get pending() {
      return pendingTotal();
    },
    /** Soma do que ja doi com o que vai doer. E por este numero que se alerta. */
    get projected() {
      return current + pendingTotal();
    },
    get queue() {
      return queue.map((item) => ({ ...item }));
    },
    get dead() {
      return current >= PRESSURE_MAX;
    },
    get alert() {
      return alertLevel(current, pendingTotal());
    },
    /** Fracao 0..1 da pressao ja efetivada. */
    get ratio() {
      return Math.min(1, current / PRESSURE_MAX);
    },
    /** Fracao 0..1 do que esta a caminho, para a UI desenhar a faixa. */
    get pendingRatio() {
      return Math.min(1, pendingTotal() / PRESSURE_MAX);
    },

    /**
     * Enfileira um ataque recebido. Ele so vira pressao depois da janela.
     *
     * `especial` marca ataque vindo de combinacao de especiais. O tamanho e a
     * natureza do golpe viajam junto com ele ate cair, porque e disso que sai
     * o TIPO de obstaculo — sem carregar essa informacao, o lixo que aparece
     * no tabuleiro nao teria como ser explicado pelo ataque que o causou.
     */
    queueAttack(units, from, now = Date.now(), especial = false) {
      if (units <= 0) return;
      queue.push({ units, from, especial, landsAt: now + PENDING_DELAY_MS });
    },

    /**
     * Gasta unidades de ataque geradas por uma jogada.
     * Cancela o pendente MAIS ANTIGO primeiro (o que esta prestes a cair) e
     * devolve o que sobrou, que vira ataque no adversario.
     */
    spend(units) {
      let restante = units;
      let cancelado = 0;

      while (restante > 0 && queue.length > 0) {
        const primeiro = queue[0];
        if (primeiro.units <= restante) {
          restante -= primeiro.units;
          cancelado += primeiro.units;
          queue.shift();
        } else {
          primeiro.units -= restante;
          cancelado += restante;
          restante = 0;
        }
      }

      return { sobra: restante, cancelado };
    },

    /**
     * Converte em pressao real tudo que venceu a janela.
     *
     * Devolve `{ total, caidos }`. Os ataques caidos vem inteiros, cada um com
     * o proprio tamanho, e nao somados: o tipo de obstaculo depende do tamanho
     * de CADA golpe, entao somar antes destruiria justamente a informacao que
     * torna o lixo legivel.
     */
    tick(now = Date.now()) {
      if (!queue.length) return { total: 0, caidos: [] };

      const caidos = [];
      const restantes = [];
      for (const item of queue) {
        if (item.landsAt <= now) caidos.push(item);
        else restantes.push(item);
      }
      queue = restantes;

      const total = caidos.reduce((soma, item) => soma + item.units, 0);
      if (total > 0) current = Math.min(PRESSURE_MAX, current + total);
      return { total, caidos };
    },

    /** Alivio direto de pressao ja efetivada (nao usado pelo ataque normal). */
    relieve(units) {
      current = Math.max(0, current - units);
    },

    reset() {
      current = 0;
      queue = [];
    },
  };
}
