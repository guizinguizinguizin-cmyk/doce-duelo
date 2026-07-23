// Constantes de balanceamento, num lugar so.
//
// Estavam duplicadas entre session.js e bot.js (o divisor `/8`, a janela de
// combo, o teto do multiplicador). Numero de balanceamento duplicado sempre
// diverge: alguem ajusta um lado, esquece o outro, e o bot passa a jogar com
// regras diferentes das do jogador. Como o bot precisa ser honesto para o modo
// solo valer alguma coisa, isso e um bug esperando acontecer.
//
// Tudo aqui e afinado por teste de jogo. Ao mexer, rodar `npm run balance`.

/** Barra cheia = eliminado. */
export const BAR_MAX = 100;

/** Teto acima do maximo, para o golpe final ser visivel antes da eliminacao. */
export const BAR_OVERFLOW_CAP = 150;

/**
 * Quanta pontuacao vira 1 ponto de barra.
 *
 * Numero MENOR = partida mais violenta. Estava em 8, e a partida solo acabava
 * em ~12 segundos: um jogador mediano faz uns 45 pontos por segundo, o que a
 * 8 dava 5,6 de barra por segundo — barra cheia em 18s sem nenhuma troca de
 * golpes. A 20 a partida respira e da tempo de reagir a um ataque.
 */
export const BAR_DIVISOR = 20;

/** Tempo sem pontuar que zera a sequencia de combo. */
export const STREAK_TIMEOUT_MS = 4000;

/** Quanto cada nivel de sequencia adiciona ao multiplicador. */
export const STREAK_STEP = 0.2;

/** Niveis de sequencia contados acima do primeiro. */
export const STREAK_CAP = 5;

/**
 * Teto de sequencia para bots.
 *
 * Um bot joga em intervalo fixo e curto, entao a sequencia dele NUNCA expira e
 * ele fica cravado no multiplicador maximo o tempo todo. Humano para para
 * pensar e perde a sequencia. Sem este teto separado, "mesmas regras para os
 * dois" na pratica favorece a maquina.
 */
export const BOT_STREAK_CAP = 3;

/** Multiplicador de sequencia a partir do numero de jogadas seguidas. */
export function streakMultiplier(streak, isBot = false) {
  if (streak < 2) return 1;
  const cap = isBot ? BOT_STREAK_CAP : STREAK_CAP;
  return 1 + Math.min(streak - 1, cap) * STREAK_STEP;
}

// ---------------------------------------------------------------------------
// Escalada (morte subita)
// ---------------------------------------------------------------------------

/** Quando o dano comeca a crescer. Antes disso a partida corre normal. */
export const ESCALATION_START_MS = 75_000;
/** Quando o dano atinge o multiplicador maximo. */
export const ESCALATION_FULL_MS = 210_000;
export const ESCALATION_MAX = 4;

/**
 * Multiplicador de dano em funcao do tempo de partida.
 *
 * Existe porque dois jogadores fracos quase nao se arranham: na simulacao,
 * 31% das partidas de iniciante contra bot facil passavam de SEIS MINUTOS.
 * Isso nao se conserta calibrando forca — se os dois batem pouco, a partida
 * nao acaba, ponto. A escalada resolve pela estrutura, e sem efeito nenhum
 * numa partida de duracao normal, porque so liga depois de 75 segundos.
 */
export function escalation(elapsedMs) {
  if (elapsedMs <= ESCALATION_START_MS) return 1;
  const t = Math.min(1, (elapsedMs - ESCALATION_START_MS) / (ESCALATION_FULL_MS - ESCALATION_START_MS));
  return 1 + t * (ESCALATION_MAX - 1);
}

/**
 * Converte pontuacao em "forca": primeiro limpa a propria barra, o resto vira
 * ataque. E essa regra que faz uma cascata grande ser defesa E ataque ao mesmo
 * tempo, e e o coracao da decisao tatica do jogo.
 */
export function applyPower(points, currentBar) {
  const power = points / BAR_DIVISOR;
  if (currentBar >= power) {
    return { newBar: currentBar - power, overflow: 0 };
  }
  return { newBar: 0, overflow: power - currentBar };
}
