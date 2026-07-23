// Tabela de ataque: converte uma jogada em UNIDADES INTEIRAS de pressao.
//
// Tudo aqui e inteiro, de proposito. Dano fracionario ("voce recebeu 3,7 de
// pressao") e ilegivel no meio de uma partida: o jogador nao consegue bater o
// olho e calcular se um combo cancela o ataque que esta chegando. Com unidades
// inteiras ele pensa "vem 4, preciso de 4" — e essa conta mental e justamente
// a decisao tatica do jogo.
//
// Como a forma da combinacao e lida: o core ja decide que especial nasce de
// cada formato, entao o especial criado IDENTIFICA o formato sem precisar de
// deteccao separada.
//
//   sequencia de 4  -> nasce listrado    -> match 4
//   sequencia de 5+ -> nasce bomba       -> match 5
//   cruzamento L/T  -> nasce embrulhado  -> forma L/T
//   sequencia de 3  -> nao nasce nada    -> match 3

import { SPECIAL } from '../core/board.js';

/** Unidades por formato de combinacao. Numeros do documento de design. */
export const ATTACK_TABLE = {
  match3: 0,
  match4: 1,
  match5: 2,
  formaLT: 3,
};

/**
 * Unidades por especial DETONADO.
 *
 * Nao estava no documento original, e foi adicionado por um motivo: sem isso,
 * detonar um listrado que voce construiu ao longo de tres jogadas nao envia
 * absolutamente nada. Construir e usar especiais e a jogada mais habilidosa
 * do jogo, e ela precisa valer alguma coisa — senao o metajogo vira "so faca
 * sequencias de 4 e ignore os especiais".
 */
export const ATTACK_PER_ACTIVATION = 1;

/**
 * Teto do bonus de combo.
 *
 * A tabela de design ia ate x4 = +3 e nao dizia o que acontece depois. Deixar
 * crescer sem limite foi um erro que a simulacao pegou: quem joga rapido nunca
 * deixa a sequencia expirar, entao um combo x20 rendia +19 unidades e a
 * partida virava binaria — 0% ou 100%, sem meio-termo. Com teto, sequencia
 * longa continua otima, mas para de ser uma vitoria automatica.
 */
export const COMBO_BONUS_CAP = 5;

/**
 * Bonus de combo (jogadas pontuando em sequencia).
 * x2 = +1, x3 = +2, x4 = +3, ate o teto acima.
 */
export function comboBonus(comboCount) {
  if (comboCount < 2) return 0;
  return Math.min(comboCount - 1, COMBO_BONUS_CAP);
}

/**
 * Multiplicador de cascata.
 *
 * O documento pedia "multiplicador" sem definir a curva. Esta e linear e suave
 * (cascata 2 = 1,5x; 3 = 2x; 4 = 2,5x), com arredondamento para baixo so no
 * fim para o resultado continuar inteiro. Curva mais agressiva transformaria
 * uma cascata sortuda numa vitoria instantanea, o que briga com o principio de
 * "habilidade vence sorte".
 */
export function cascadeMultiplier(cascade) {
  return 1 + (cascade - 1) * 0.5;
}

/** Unidades geradas por uma unica fase de cascata, antes do multiplicador. */
export function baseUnitsForPhase(phase) {
  let units = 0;

  for (const created of phase.created) {
    switch (created.special) {
      case SPECIAL.STRIPED_H:
      case SPECIAL.STRIPED_V:
        units += ATTACK_TABLE.match4;
        break;
      case SPECIAL.WRAPPED:
        units += ATTACK_TABLE.formaLT;
        break;
      case SPECIAL.COLOR_BOMB:
        units += ATTACK_TABLE.match5;
        break;
    }
  }

  units += phase.activations.length * ATTACK_PER_ACTIVATION;
  return units;
}

/**
 * Unidades totais de uma jogada resolvida.
 * `comboCount` e a sequencia de jogadas que pontuaram seguidas, incluindo esta.
 */
export function unitsForMove(result, comboCount = 1) {
  if (!result || !result.ok) return 0;

  let total = 0;
  for (const phase of result.phases) {
    total += baseUnitsForPhase(phase) * cascadeMultiplier(phase.cascade);
  }

  total = Math.floor(total) + comboBonus(comboCount);
  return Math.max(0, total);
}

/** Detalhamento para a tela de fim de partida e para o replay. */
export function describeMove(result, comboCount = 1) {
  const formas = [];
  let ativacoes = 0;
  let cascataMaxima = 0;

  for (const phase of result.phases) {
    cascataMaxima = Math.max(cascataMaxima, phase.cascade);
    ativacoes += phase.activations.length;
    for (const created of phase.created) {
      if (created.special === SPECIAL.STRIPED_H || created.special === SPECIAL.STRIPED_V) formas.push('match4');
      else if (created.special === SPECIAL.WRAPPED) formas.push('formaLT');
      else if (created.special === SPECIAL.COLOR_BOMB) formas.push('match5');
    }
  }

  return {
    unidades: unitsForMove(result, comboCount),
    formas,
    ativacoes,
    cascataMaxima,
    bonusCombo: comboBonus(comboCount),
  };
}
