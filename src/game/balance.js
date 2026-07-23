// Constantes de balanceamento, num lugar so.
//
// Estavam duplicadas entre session.js e bot.js (o divisor, a janela de combo,
// o teto). Numero de balanceamento duplicado sempre diverge: alguem ajusta um
// lado, esquece o outro, e o bot passa a jogar com regras diferentes das do
// jogador. Como o bot precisa ser honesto para o modo solo valer alguma coisa,
// isso e um bug esperando acontecer.
//
// Tudo aqui e afinado por medicao: `npm run balance` roda centenas de partidas
// com relogio virtual e reporta taxa de vitoria e duracao.

// ---------------------------------------------------------------------------
// Pressao
// ---------------------------------------------------------------------------

/**
 * Pressao maxima, em UNIDADES inteiras. Chegou no teto, colapso.
 *
 * Unidades inteiras em vez de porcentagem porque o jogador precisa conseguir
 * contar: "estou em 14 de 20, vem 5 chegando, preciso cancelar 5 ou morro".
 * Essa conta e impossivel com dano fracionario. A interface mostra porcentagem
 * porque le melhor numa barra, mas por baixo e tudo inteiro.
 */
export const PRESSURE_MAX = 26;

/**
 * Quanto tempo um ataque fica PENDENTE antes de virar pressao de verdade.
 *
 * Este numero e o coracao do jogo. Ataque que entra na hora nao tem
 * counterplay: voce so assiste. Com uma janela, receber pressao vira uma
 * pergunta — "consigo montar um combo em 3,5 segundos?" — e e dessa pergunta
 * que sai a tensao. Curto demais e injusto; longo demais e o ataque perde
 * peso e vira sugestao.
 */
export const PENDING_DELAY_MS = 3500;

/** Limiares de alerta, como fracao de PRESSURE_MAX. */
export const ALERT_TIERS = {
  atencao: 0.6,
  perigo: 0.8,
  critico: 0.95,
};

/**
 * Nivel de alerta a partir da pressao ATUAL + PENDENTE.
 *
 * Somar as duas e o ponto: com 14 de pressao e 7 chegando, o jogador ja esta
 * morto se nao reagir, mesmo que a barra "atual" mostre so 70%. Alertar so
 * pela pressao atual avisaria tarde demais — quando ja nao ha o que fazer.
 */
export function alertLevel(current, pending) {
  const total = (current + pending) / PRESSURE_MAX;
  if (total >= ALERT_TIERS.critico) return 'critico';
  if (total >= ALERT_TIERS.perigo) return 'perigo';
  if (total >= ALERT_TIERS.atencao) return 'atencao';
  return 'normal';
}

// ---------------------------------------------------------------------------
// Combo (usado para PONTUACAO; o ataque tem a tabela propria em attack.js)
// ---------------------------------------------------------------------------

/**
 * Tempo sem pontuar que zera a sequencia de combo.
 *
 * Estava em 4000 e punia o jogador lento DUAS vezes: alem de jogar menos, ele
 * perdia a sequencia toda vez, porque um iniciante pensa ~3,6s por jogada e
 * ficava bem na borda da janela. Como o bonus de combo ja e multiplicativo em
 * cima de uma vantagem de velocidade que e linear, isso tornava a partida
 * binaria. Em 6000 o ritmo humano normal sustenta a sequencia.
 */
export const STREAK_TIMEOUT_MS = 6000;
export const STREAK_STEP = 0.2;
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

export function streakMultiplier(streak, isBot = false) {
  if (streak < 2) return 1;
  const cap = isBot ? BOT_STREAK_CAP : STREAK_CAP;
  return 1 + Math.min(streak - 1, cap) * STREAK_STEP;
}

// ---------------------------------------------------------------------------
// Escalada (morte subita)
// ---------------------------------------------------------------------------

export const ESCALATION_START_MS = 75_000;
export const ESCALATION_FULL_MS = 210_000;
export const ESCALATION_MAX = 3;

/**
 * Multiplicador de ataque em funcao do tempo de partida.
 *
 * Existe porque dois jogadores fracos quase nao se arranham: na simulacao,
 * 31% das partidas de iniciante contra bot facil passavam de SEIS MINUTOS.
 * Isso nao se conserta calibrando forca — se os dois batem pouco, a partida
 * nao acaba, ponto. Sem efeito nenhum numa partida de duracao normal, porque
 * so liga depois de 75 segundos.
 */
export function escalation(elapsedMs) {
  if (elapsedMs <= ESCALATION_START_MS) return 1;
  const t = Math.min(1, (elapsedMs - ESCALATION_START_MS) / (ESCALATION_FULL_MS - ESCALATION_START_MS));
  return 1 + t * (ESCALATION_MAX - 1);
}

/** Aplica a escalada mantendo o resultado inteiro (minimo 1 se havia ataque). */
export function escalateUnits(units, elapsedMs) {
  if (units <= 0) return 0;
  return Math.max(1, Math.floor(units * escalation(elapsedMs)));
}

// ---------------------------------------------------------------------------
// Lixo (obstaculos que o ataque deposita no tabuleiro)
// ---------------------------------------------------------------------------

/**
 * Quantas unidades de pressao que ENTRARAM valem um obstaculo.
 *
 * Numero alto de proposito. O obstaculo e uma segunda punicao pelo mesmo
 * ataque, e empilhar lixo em quem ja esta perdendo trabalha contra o pilar de
 * "sempre existe chance de virar": quanto pior a sua situacao, menos jogadas
 * voce tem para reagir. A taxa baixa mantem o lixo como uma presenca que
 * incomoda, nao como uma bola de neve.
 */
export const GARBAGE_PER_PRESSURE = 4;

/**
 * Cada obstaculo destruido devolve esta pressao.
 *
 * E a valvula de contra-jogo: o lixo no seu tabuleiro nao e so estorvo, e
 * tambem pressao que voce pode remover. Sem isso, receber lixo seria dano
 * puro sem resposta, e o jogador nao teria caminho de volta.
 */
export const PRESSURE_RELIEF_PER_GARBAGE = 1;

/** Quantos obstaculos nascem de uma leva de pressao que acabou de entrar. */
export function garbageForPressure(unidadesQueEntraram, acumuladoAnterior = 0) {
  const total = acumuladoAnterior + unidadesQueEntraram;
  return {
    quantidade: Math.floor(total / GARBAGE_PER_PRESSURE),
    resto: total % GARBAGE_PER_PRESSURE,
  };
}
