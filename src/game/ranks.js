// Ranks: a face visivel da nota.
//
// O jogador NUNCA ve o MMR — ve o rank. Numero cru vira obsessao e leitura
// errada ("perdi 8 pontos numa partida que joguei bem"), enquanto um nome com
// identidade vira meta. Foi a sua decisao no documento de design e e o que
// TETR.IO, Valorant e League fazem.
//
// A escala e de DOCES, do mais barato de feira ao mais raro de confeitaria,
// em vez de Bronze/Prata/Ouro. Metal generico nao diz nada sobre este jogo;
// alguem falar "cheguei em Trufa" carrega o jogo junto na frase.
//
// Importante: o rank sai da nota CONSERVADORA (rating - 2 x desvio), nunca da
// nota crua. Ninguem chega a um rank alto com duas partidas de sorte — para
// subir e preciso que o sistema tenha parado de duvidar.

export const RANKS = [
  { id: 'algodao', nome: 'Algodão-doce', minima: 0, cor: '#ff9ec4', brilho: '#ffd6e8' },
  { id: 'bala', nome: 'Bala', minima: 900, cor: '#ff6b6b', brilho: '#ffb3b3' },
  { id: 'marshmallow', nome: 'Marshmallow', minima: 1050, cor: '#ffd166', brilho: '#fff0b8' },
  { id: 'caramelo', nome: 'Caramelo', minima: 1200, cor: '#ff9a3d', brilho: '#ffd0a0' },
  { id: 'chocolate', nome: 'Chocolate', minima: 1350, cor: '#a9714b', brilho: '#d9a97f' },
  { id: 'trufa', nome: 'Trufa', minima: 1500, cor: '#b45cff', brilho: '#ddb3ff' },
  { id: 'cristal', nome: 'Cristal', minima: 1700, cor: '#45d9ff', brilho: '#c3f2ff' },
  { id: 'lenda', nome: 'Lenda', minima: 1900, cor: '#ffd700', brilho: '#fff6c2' },
];

/**
 * Notas fixas dos bots.
 *
 * Existem para a nota funcionar DESDE JA, sem depender de haver gente online.
 * Um bot no dificil e uma forca conhecida, do mesmo jeito que um computador de
 * xadrez com nivel definido — ganhar dele diz algo real sobre voce.
 *
 * Nao da para inflar a nota moendo bot: conforme a sua nota passa a do bot, a
 * vitoria vira o resultado esperado e o ganho tende a zero sozinho. E o
 * proprio Glicko-2 que freia, sem precisar de regra extra.
 *
 * O desvio baixo diz que sao adversarios previsiveis — a forca deles nao varia.
 */
export const NOTA_DOS_BOTS = {
  facil: { rating: 900, desvio: 60 },
  normal: { rating: 1300, desvio: 60 },
  dificil: { rating: 1700, desvio: 60 },
  pesadelo: { rating: 2050, desvio: 60 },
};

/**
 * Teto do que se alcanca jogando sozinho.
 *
 * Decisao de design: o solo leva ate Cristal, e LENDA exige ganhar de gente.
 * Bot nao se adapta, nao blefa e nao aprende — quem so venceu maquina nao
 * provou o topo. Deixar o rank maximo acessivel offline esvaziaria o online,
 * que e o ponto do jogo.
 */
export const TETO_DO_SOLO = RANKS[RANKS.length - 1].minima - 50;

/**
 * Margem acima do adversario a partir da qual vencer nao rende mais nada.
 *
 * Existe porque o Glicko-2 NAO freia sozinho, ao contrario do que eu supus:
 * a chance esperada se aproxima de 1 mas nunca chega, entao sobra sempre um
 * ganho minusculo. Um teste de 400 vitorias seguidas contra o bot facil
 * chegou a Trufa — moendo o adversario mais fraco do jogo.
 */
const MARGEM_SEM_GANHO = 100;

/**
 * A partida deve mexer na nota?
 *
 * Derrota SEMPRE conta: tropecar em quem e mais fraco tem de doer, senao daria
 * para blindar o rank escolhendo adversario. So a vitoria esvaziada e ignorada.
 */
export function resultadoConta({ notaAtual, adversario, venceu, contraBot }) {
  if (!venceu) return { conta: true, motivo: null };

  if (contraBot && notaAtual >= TETO_DO_SOLO) {
    return { conta: false, motivo: 'Rank máximo do solo — enfrente gente para chegar a Lenda.' };
  }
  if (notaAtual >= adversario.rating + MARGEM_SEM_GANHO) {
    return { conta: false, motivo: 'Adversário fraco demais para render rank.' };
  }
  return { conta: true, motivo: null };
}

/** Rank correspondente a uma nota exibida, com o quanto falta para o proximo. */
export function rankDe(notaExibida) {
  let indice = 0;
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (notaExibida >= RANKS[i].minima) {
      indice = i;
      break;
    }
  }

  const atual = RANKS[indice];
  const proximo = RANKS[indice + 1] || null;

  let progresso = 1;
  if (proximo) {
    const faixa = proximo.minima - atual.minima;
    progresso = Math.max(0, Math.min(1, (notaExibida - atual.minima) / faixa));
  }

  return {
    ...atual,
    indice,
    proximo,
    progresso,
    faltam: proximo ? Math.max(0, proximo.minima - notaExibida) : 0,
  };
}

/**
 * Contador para dar um id unico a cada gradiente gerado.
 *
 * Nao e frescura: o menu e a tela de fim mostram o selo AO MESMO TEMPO no
 * documento. Com id repetido, o navegador resolve `url(#id)` sempre para o
 * primeiro que encontra — e quando esse primeiro esta dentro de um elemento
 * escondido (a tela do menu, com display:none), o gradiente nao pode ser
 * referenciado e o selo aparece cinza. Foi exatamente o que aconteceu.
 */
let proximoSelo = 0;

/** Selo do rank em SVG: uma gema com a cor do nivel. */
export function seloDoRank(rank, tamanho = 48) {
  const id = `selo-${rank.id}-${proximoSelo++}`;
  return `<svg viewBox="0 0 48 48" width="${tamanho}" height="${tamanho}"
    xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="${id}" x1="10" y1="4" x2="38" y2="44">
        <stop offset="0" stop-color="${rank.brilho}"/>
        <stop offset="0.5" stop-color="${rank.cor}"/>
        <stop offset="1" stop-color="${rank.cor}" stop-opacity="0.65"/>
      </linearGradient>
    </defs>
    <path d="M24 3l16 8.5v17L24 45 8 28.5v-17z"
          fill="url(#${id})" stroke="rgba(255,255,255,.45)" stroke-width="1.6"
          stroke-linejoin="round"/>
    <path d="M24 3l16 8.5L24 20 8 11.5z" fill="#fff" opacity="0.22"/>
    <ellipse cx="18" cy="14" rx="4.5" ry="2.6" fill="#fff" opacity="0.35"
             transform="rotate(-28 18 14)"/>
  </svg>`;
}

/**
 * Frase curta explicando o resultado da partida.
 *
 * Um dos pilares do jogo e "o jogador entende por que perdeu". Isso vale
 * tambem para a nota: ver o rank mexer sem saber o motivo e pior do que nao
 * ver nada, porque parece arbitrario.
 */
export function explicarVariacao({ venceu, chance, diferenca, calibrando }) {
  if (calibrando) {
    return venceu
      ? 'Ainda calibrando: as primeiras partidas mexem bastante.'
      : 'Ainda calibrando: o sistema está descobrindo seu nível.';
  }
  if (diferenca === 0) return 'Resultado dentro do esperado.';

  const zebra = venceu ? chance < 0.35 : chance > 0.65;
  if (venceu) {
    return zebra ? 'Vitória contra o favorito — valeu mais.' : 'Vitória esperada, ganho menor.';
  }
  return zebra ? 'Derrota para um azarão — custou mais.' : 'Derrota esperada, perda menor.';
}
