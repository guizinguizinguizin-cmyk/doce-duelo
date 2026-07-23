// Motor de rating (Glicko-2).
//
// Por que Glicko-2 e nao Elo: alem da nota, ele carrega o quanto o sistema
// CONFIA nela (o desvio) e o quanto o jogador anda instavel (a volatilidade).
// Isso importa muito num jogo comecando: com tres partidas, o Elo trata sua
// nota como se fosse verdade e joga voce contra qualquer um; o Glicko-2 sabe
// que nao faz ideia de quem voce e, ajusta rapido no comeco e vai freando
// conforme a duvida diminui.
//
// Este modulo e PURO — sem DOM, sem armazenamento, sem rede. E de proposito:
// quando existir servidor, ele roda exatamente este arquivo para recalcular a
// nota do lado autoritativo, e os dois lados nunca discordam.
//
// A implementacao segue o artigo do Glickman ("Example of the Glicko-2
// system"), e o teste em test/rating.test.js confere contra o exemplo
// numerico dele. Rating e um daqueles codigos em que um sinal trocado nao
// quebra nada visivelmente — so distribui as pessoas errado por meses.

/** Nota inicial de quem nunca jogou. */
export const RATING_INICIAL = 1500;
/** Desvio inicial: incerteza maxima. */
export const DESVIO_INICIAL = 350;
export const VOLATILIDADE_INICIAL = 0.06;

/**
 * Freio do sistema (tau). Menor = a volatilidade muda mais devagar.
 * Glickman sugere entre 0.3 e 1.2; 0.5 e o meio-termo usual.
 */
const TAU = 0.5;

/** Fator de conversao entre a escala visivel e a interna do Glicko-2. */
const ESCALA = 173.7178;

/** Desvio maximo: acima disso a nota deixa de significar qualquer coisa. */
const DESVIO_MAXIMO = 350;
/** Desvio minimo: nunca ter certeza absoluta permite o jogador mudar. */
const DESVIO_MINIMO = 45;

const g = (fi) => 1 / Math.sqrt(1 + (3 * fi * fi) / (Math.PI * Math.PI));
const E = (mu, muAdv, fiAdv) => 1 / (1 + Math.exp(-g(fiAdv) * (mu - muAdv)));

export function novoJogador() {
  return {
    rating: RATING_INICIAL,
    desvio: DESVIO_INICIAL,
    volatilidade: VOLATILIDADE_INICIAL,
    partidas: 0,
  };
}

/**
 * Nova volatilidade, pelo algoritmo iterativo do artigo (metodo de Illinois).
 *
 * E a parte mais delicada do Glicko-2: resolve uma equacao que nao tem forma
 * fechada. O limite de iteracoes existe porque um dado corrompido poderia
 * fazer o laco nunca convergir, e travar o jogo por causa de uma nota e
 * inaceitavel.
 */
function novaVolatilidade(fi, v, delta, sigma) {
  const a = Math.log(sigma * sigma);
  const f = (x) => {
    const ex = Math.exp(x);
    const parteA = (ex * (delta * delta - fi * fi - v - ex)) / (2 * Math.pow(fi * fi + v + ex, 2));
    const parteB = (x - a) / (TAU * TAU);
    return parteA - parteB;
  };

  let A = a;
  let B;
  if (delta * delta > fi * fi + v) {
    B = Math.log(delta * delta - fi * fi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0 && k < 100) k += 1;
    B = a - k * TAU;
  }

  let fA = f(A);
  let fB = f(B);
  let iteracoes = 0;

  while (Math.abs(B - A) > 0.000001 && iteracoes < 100) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
    iteracoes += 1;
  }

  return Math.exp(A / 2);
}

/**
 * Atualiza a nota depois de um conjunto de resultados.
 *
 * `resultados` = [{ rating, desvio, pontos }], onde pontos e 1 vitoria,
 * 0 derrota, 0.5 empate. Aceita varios de uma vez porque o Glicko-2 foi
 * desenhado para periodos com varias partidas — aplicar de uma em uma
 * funciona, mas mexe mais na nota do que o artigo previa.
 */
export function atualizar(jogador, resultados) {
  if (!resultados.length) return afastamento(jogador, 1);

  const mu = (jogador.rating - RATING_INICIAL) / ESCALA;
  const fi = jogador.desvio / ESCALA;

  let somaV = 0;
  let somaDelta = 0;

  for (const r of resultados) {
    const muAdv = (r.rating - RATING_INICIAL) / ESCALA;
    const fiAdv = r.desvio / ESCALA;
    const esperado = E(mu, muAdv, fiAdv);
    const gAdv = g(fiAdv);

    somaV += gAdv * gAdv * esperado * (1 - esperado);
    somaDelta += gAdv * (r.pontos - esperado);
  }

  const v = 1 / somaV;
  const delta = v * somaDelta;

  const novaSigma = novaVolatilidade(fi, v, delta, jogador.volatilidade);
  const fiEstrela = Math.sqrt(fi * fi + novaSigma * novaSigma);
  const novoFi = 1 / Math.sqrt(1 / (fiEstrela * fiEstrela) + 1 / v);
  const novoMu = mu + novoFi * novoFi * somaDelta;

  return {
    rating: Math.round(novoMu * ESCALA + RATING_INICIAL),
    desvio: Math.min(DESVIO_MAXIMO, Math.max(DESVIO_MINIMO, Math.round(novoFi * ESCALA))),
    volatilidade: novaSigma,
    partidas: jogador.partidas + resultados.length,
  };
}

/**
 * Quem some volta a ser um desconhecido.
 *
 * Sem isso, alguem que parou por um ano volta com a nota antiga tratada como
 * verdade e destroi (ou apanha de) quem esta ativo. O desvio crescer devolve
 * a duvida e faz as primeiras partidas de volta corrigirem rapido.
 */
export function afastamento(jogador, periodos = 1) {
  if (periodos <= 0) return { ...jogador };
  const fi = jogador.desvio / ESCALA;
  const sigma = jogador.volatilidade;
  const novoFi = Math.sqrt(fi * fi + periodos * sigma * sigma);
  return {
    ...jogador,
    desvio: Math.min(DESVIO_MAXIMO, Math.round(novoFi * ESCALA)),
  };
}

/**
 * Nota conservadora: o piso do intervalo de confianca.
 *
 * E ela que decide o rank exibido, nunca a nota crua. Assim ninguem chega a
 * um rank alto com duas partidas de sorte — para subir e preciso que o
 * sistema tenha PARADO de duvidar, o que so vem com volume.
 */
export function notaExibida(jogador) {
  return Math.round(jogador.rating - 2 * jogador.desvio);
}

/** Quantas partidas ainda faltam para a nota sair da fase de calibragem. */
export const PARTIDAS_DE_CALIBRAGEM = 10;

export function estaCalibrando(jogador) {
  return jogador.partidas < PARTIDAS_DE_CALIBRAGEM || jogador.desvio > 110;
}

/** Chance de vitoria prevista — usada para explicar o resultado ao jogador. */
export function chanceDeVitoria(jogador, adversario) {
  const mu = (jogador.rating - RATING_INICIAL) / ESCALA;
  const muAdv = (adversario.rating - RATING_INICIAL) / ESCALA;
  const fiAdv = adversario.desvio / ESCALA;
  return E(mu, muAdv, fiAdv);
}
