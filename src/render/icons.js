// Icones da interface, desenhados em SVG.
//
// Mesma razao pela qual as pecas do tabuleiro nao sao emoji: cada aparelho
// desenha o emoji do proprio jeito. Um 🤖 no Android, no iPhone e no Windows
// sao tres desenhos diferentes, e nenhum deles combina com o resto do jogo.
// Desenhado aqui, fica igual em todo lugar e conversa com a paleta das gemas.
//
// Todos usam a mesma linguagem: caixa 24x24, traco arredondado de ~1.8, formas
// geometricas simples. Icone com detalhe demais vira mancha a 24 pixels.

const PALETA = {
  rosa: '#ff4d8d',
  rosaEscuro: '#ff2d78',
  ciano: '#45d9ff',
  ambar: '#ffb340',
  verde: '#35d98b',
  roxo: '#b45cff',
  escuro: '#1c1038',
};

const svg = (conteudo, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" ` +
  `aria-hidden="true" focusable="false" ${extra}>${conteudo}</svg>`;

/** Jogar sozinho: cabeca de robo. Silhueta bem distinta ate pequena. */
const solo = svg(`
  <path d="M12 2.8v2.6" stroke="${PALETA.ciano}" stroke-width="1.8" stroke-linecap="round"/>
  <circle cx="12" cy="2" r="1.5" fill="${PALETA.ciano}"/>
  <path d="M3.6 10.5H2.4v3.2h1.2M20.4 10.5h1.2v3.2h-1.2"
        stroke="${PALETA.ciano}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="3.6" y="5.4" width="16.8" height="14" rx="4.6"
        fill="url(#gradRobo)" stroke="rgba(255,255,255,.28)" stroke-width="1"/>
  <circle cx="9" cy="11.4" r="1.9" fill="${PALETA.escuro}"/>
  <circle cx="15" cy="11.4" r="1.9" fill="${PALETA.escuro}"/>
  <circle cx="9.6" cy="10.8" r="0.6" fill="#fff"/>
  <circle cx="15.6" cy="10.8" r="0.6" fill="#fff"/>
  <path d="M9.2 15.8h5.6" stroke="${PALETA.escuro}" stroke-width="1.7" stroke-linecap="round"/>
  <defs>
    <linearGradient id="gradRobo" x1="4" y1="5" x2="20" y2="19">
      <stop offset="0" stop-color="${PALETA.ciano}"/>
      <stop offset="1" stop-color="#2b7fd4"/>
    </linearGradient>
  </defs>
`);

/**
 * Jogar com amigos: duas pessoas, uma na frente da outra.
 *
 * Duas figuras humanas leem melhor que dois tabuleiros ou dois controles —
 * qualquer pessoa entende em meio segundo, sem precisar aprender o simbolo.
 */
const amigos = svg(`
  <circle cx="16.2" cy="8.4" r="3" fill="${PALETA.ciano}" opacity=".75"/>
  <path d="M11.4 19.4c0-2.7 2.2-4.8 4.8-4.8s4.8 2.1 4.8 4.8"
        fill="${PALETA.ciano}" opacity=".75"/>
  <circle cx="8.6" cy="7.6" r="3.6" fill="url(#gradAmigo)"/>
  <path d="M2.6 19.8c0-3.3 2.7-5.9 6-5.9s6 2.6 6 5.9"
        fill="url(#gradAmigo)"/>
  <defs>
    <linearGradient id="gradAmigo" x1="3" y1="4" x2="15" y2="20">
      <stop offset="0" stop-color="${PALETA.rosa}"/>
      <stop offset="1" stop-color="${PALETA.rosaEscuro}"/>
    </linearGradient>
  </defs>
`);

/** Estatisticas: barras subindo, com a maior coroada por uma gema. */
const estatisticas = svg(`
  <rect x="3" y="13.5" width="4.4" height="7.5" rx="1.6" fill="${PALETA.roxo}" opacity=".85"/>
  <rect x="9.8" y="9.5" width="4.4" height="11.5" rx="1.6" fill="${PALETA.ciano}" opacity=".9"/>
  <rect x="16.6" y="5.5" width="4.4" height="15.5" rx="1.6" fill="url(#gradBarra)"/>
  <path d="M18.8 1.6l1.5 1.6-1.5 1.6-1.5-1.6z" fill="${PALETA.ambar}"/>
  <defs>
    <linearGradient id="gradBarra" x1="17" y1="5" x2="21" y2="21">
      <stop offset="0" stop-color="${PALETA.ambar}"/>
      <stop offset="1" stop-color="${PALETA.rosa}"/>
    </linearGradient>
  </defs>
`);

/**
 * Ajustes: controles deslizantes, nao engrenagem.
 *
 * A tela de ajustes e feita de sliders — o icone mostrar exatamente o que ha
 * do outro lado poupa uma leitura.
 */
const ajustes = svg(`
  <path d="M4 6.5h16M4 12h16M4 17.5h16"
        stroke="rgba(255,255,255,.32)" stroke-width="2" stroke-linecap="round"/>
  <circle cx="15.5" cy="6.5" r="3.1" fill="${PALETA.rosa}" stroke="${PALETA.escuro}" stroke-width="1.4"/>
  <circle cx="8" cy="12" r="3.1" fill="${PALETA.ciano}" stroke="${PALETA.escuro}" stroke-width="1.4"/>
  <circle cx="13" cy="17.5" r="3.1" fill="${PALETA.ambar}" stroke="${PALETA.escuro}" stroke-width="1.4"/>
`);

/** Som ligado. */
const somLigado = svg(`
  <path d="M4 9.2h3.4L12 5.2v13.6l-4.6-4H4z" fill="${PALETA.ciano}"/>
  <path d="M15.4 9.4a3.6 3.6 0 010 5.2" stroke="${PALETA.ciano}"
        stroke-width="1.9" stroke-linecap="round"/>
  <path d="M18 7a7.2 7.2 0 010 10" stroke="${PALETA.ciano}" stroke-width="1.9"
        stroke-linecap="round" opacity=".6"/>
`);

/** Som desligado. */
const somMudo = svg(`
  <path d="M4 9.2h3.4L12 5.2v13.6l-4.6-4H4z" fill="rgba(255,255,255,.42)"/>
  <path d="M16 9.5l5 5M21 9.5l-5 5" stroke="${PALETA.rosa}"
        stroke-width="2" stroke-linecap="round"/>
`);

/** Dica. */
const dica = svg(`
  <path d="M12 3a6.2 6.2 0 00-3.6 11.3c.5.4.8 1 .8 1.6v.4h5.6v-.4c0-.6.3-1.2.8-1.6A6.2 6.2 0 0012 3z"
        fill="url(#gradDica)"/>
  <path d="M9.6 18.6h4.8M10.4 21h3.2" stroke="${PALETA.ambar}"
        stroke-width="1.8" stroke-linecap="round"/>
  <defs>
    <linearGradient id="gradDica" x1="8" y1="3" x2="16" y2="17">
      <stop offset="0" stop-color="#ffe27a"/>
      <stop offset="1" stop-color="${PALETA.ambar}"/>
    </linearGradient>
  </defs>
`);

/** Editar o proprio nome. */
const editar = svg(`
  <path d="M4 20h4.2l9.6-9.6-4.2-4.2L4 15.8V20z" fill="${PALETA.ambar}" opacity=".9"/>
  <path d="M15.2 4.8l4.2 4.2 1.4-1.4a1.6 1.6 0 000-2.3l-1.9-1.9a1.6 1.6 0 00-2.3 0l-1.4 1.4z"
        fill="${PALETA.rosa}"/>
`);

/** Sair da partida. */
const sair = svg(`
  <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke="currentColor"
        stroke-width="2.2" stroke-linecap="round"/>
`);

export const ICONES = {
  solo,
  editar,
  amigos,
  estatisticas,
  ajustes,
  somLigado,
  somMudo,
  dica,
  sair,
};

/**
 * Preenche todo elemento com `data-icone` pelo icone correspondente.
 * Chamado uma vez na inicializacao.
 */
export function aplicarIcones(raiz = document) {
  for (const alvo of raiz.querySelectorAll('[data-icone]')) {
    const nome = alvo.dataset.icone;
    if (ICONES[nome]) alvo.innerHTML = ICONES[nome];
  }
}
