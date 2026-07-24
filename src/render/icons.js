// Icones da interface, desenhados em SVG.
//
// Mesma razao pela qual as pecas do tabuleiro nao sao emoji: cada aparelho
// desenha o emoji do proprio jeito. Um 🤖 no Android, no iPhone e no Windows
// sao tres desenhos diferentes, e nenhum deles combina com o resto do jogo.
// Desenhado aqui, fica igual em todo lugar e conversa com a paleta das gemas.
//
// Linguagem visual: caixa 24x24, formas CHEIAS e arredondadas com um degrade
// da propria cor (claro -> escuro) e um brilho branco discreto. Nada de tracos
// finos que somem a 26px — silhueta grossa que le de longe.

const PALETA = {
  rosa: '#ff4d8d',
  rosaEscuro: '#ff2d78',
  rosaClaro: '#ff85a9',
  ciano: '#45d9ff',
  cianoClaro: '#8fe8ff',
  cianoEscuro: '#2b7fd4',
  ambar: '#ffb340',
  ambarClaro: '#ffe08a',
  verde: '#35d98b',
  roxo: '#b45cff',
  roxoClaro: '#d7a3ff',
  escuro: '#0e1030',
};

const svg = (conteudo, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" ` +
  `aria-hidden="true" focusable="false" ${extra}>${conteudo}</svg>`;

/** Degrade linear reutilizavel. */
const grad = (id, c1, c2, x1 = 4, y1 = 3, x2 = 20, y2 = 21) =>
  `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" gradientUnits="userSpaceOnUse">` +
  `<stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>`;

/** Jogar sozinho: cabeca de robo, cheia e amigavel. */
const solo = svg(`
  <path d="M12 2.2v3.2" stroke="${PALETA.cianoClaro}" stroke-width="2" stroke-linecap="round"/>
  <circle cx="12" cy="2" r="1.7" fill="${PALETA.cianoClaro}"/>
  <rect x="2.1" y="10.3" width="2.3" height="4.4" rx="1.15" fill="${PALETA.cianoEscuro}"/>
  <rect x="19.6" y="10.3" width="2.3" height="4.4" rx="1.15" fill="${PALETA.cianoEscuro}"/>
  <rect x="3.9" y="5.6" width="16.2" height="14" rx="5.4" fill="url(#gSolo)"/>
  <path d="M3.9 11c0-3 2.4-5.4 5.4-5.4h5.4c3 0 5.4 2.4 5.4 5.4z" fill="#fff" opacity=".14"/>
  <rect x="7" y="10.1" width="3.7" height="4.4" rx="1.85" fill="${PALETA.escuro}"/>
  <rect x="13.3" y="10.1" width="3.7" height="4.4" rx="1.85" fill="${PALETA.escuro}"/>
  <circle cx="8.85" cy="11.5" r="0.95" fill="#fff"/>
  <circle cx="15.15" cy="11.5" r="0.95" fill="#fff"/>
  <path d="M9.4 17.1h5.2" stroke="${PALETA.escuro}" stroke-width="1.9" stroke-linecap="round"/>
  <defs>${grad('gSolo', PALETA.cianoClaro, PALETA.cianoEscuro, 4, 5, 20, 20)}</defs>
`);

/** Jogar com amigos: duas pessoas, uma na frente da outra. */
const amigos = svg(`
  <circle cx="15.6" cy="8.4" r="3.1" fill="${PALETA.ciano}"/>
  <path d="M9.6 20a6 6 0 0112 0z" fill="${PALETA.ciano}"/>
  <circle cx="8.4" cy="7.9" r="3.7" fill="url(#gAmi)"/>
  <path d="M1.8 20.8a6.6 6.6 0 0113.2 0z" fill="url(#gAmi)"/>
  <ellipse cx="7" cy="6.6" rx="1.3" ry="0.8" fill="#fff" opacity=".3"/>
  <defs>${grad('gAmi', PALETA.rosaClaro, PALETA.rosaEscuro, 2, 4, 15, 21)}</defs>
`);

/** Ranking mundial: trofeu robusto com estrela. */
const trofeu = svg(`
  <path d="M6 3.6h12V8a6 6 0 01-12 0z" fill="url(#gTro)"/>
  <path d="M6 5.3H3.4v1.6a3 3 0 003 3M18 5.3h2.6v1.6a3 3 0 01-3 3"
        stroke="${PALETA.ambar}" stroke-width="1.7" fill="none" stroke-linecap="round"/>
  <rect x="10.5" y="12.4" width="3" height="3.4" fill="${PALETA.ambar}"/>
  <path d="M7 20.6h10l-1.1-2.4a1.6 1.6 0 00-1.5-.95H9.6a1.6 1.6 0 00-1.5.95z" fill="url(#gTro)"/>
  <path d="M12 5.1l1.05 2.13 2.35.34-1.7 1.66.4 2.34L12 10.8l-2.1 1.1.4-2.34-1.7-1.66 2.35-.34z" fill="#fff" opacity=".85"/>
  <defs>${grad('gTro', PALETA.ambarClaro, PALETA.ambar, 6, 3, 18, 21)}</defs>
`);

/** Estatisticas: barras arredondadas subindo, com um brilho no topo. */
const estatisticas = svg(`
  <rect x="2.8" y="12.8" width="4.7" height="8.4" rx="2.1" fill="${PALETA.roxo}"/>
  <rect x="9.65" y="8.8" width="4.7" height="12.4" rx="2.1" fill="${PALETA.ciano}"/>
  <rect x="16.5" y="4.8" width="4.7" height="16.4" rx="2.1" fill="url(#gBar)"/>
  <path d="M18.85 1.4l.86 1.74 1.92.28-1.39 1.35.33 1.91-1.72-.9-1.72.9.33-1.91-1.39-1.35 1.92-.28z" fill="${PALETA.ambarClaro}"/>
  <defs>${grad('gBar', PALETA.ambarClaro, PALETA.rosa, 16, 5, 21, 21)}</defs>
`);

/** Ajustes: tres sliders com botoes grossos. */
const ajustes = svg(`
  <path d="M4 6.5h16M4 12h16M4 17.5h16" stroke="rgba(255,255,255,.3)" stroke-width="2.4" stroke-linecap="round"/>
  <circle cx="15.5" cy="6.5" r="3.4" fill="${PALETA.rosa}"/>
  <circle cx="8" cy="12" r="3.4" fill="${PALETA.ciano}"/>
  <circle cx="13.5" cy="17.5" r="3.4" fill="${PALETA.ambar}"/>
  <circle cx="14.4" cy="5.6" r="1" fill="#fff" opacity=".55"/>
  <circle cx="6.9" cy="11.1" r="1" fill="#fff" opacity=".55"/>
  <circle cx="12.4" cy="16.6" r="1" fill="#fff" opacity=".55"/>
`);

/** Som ligado: alto-falante cheio com ondas. */
const somLigado = svg(`
  <path d="M4 9.1h3.3L11.6 5.1v13.8l-4.3-4H4z" fill="url(#gSom)"/>
  <path d="M14.8 9.3a4 4 0 010 5.4" stroke="${PALETA.cianoClaro}" stroke-width="2" stroke-linecap="round"/>
  <path d="M17.4 6.9a7.4 7.4 0 010 10.2" stroke="${PALETA.ciano}" stroke-width="2" stroke-linecap="round" opacity=".55"/>
  <defs>${grad('gSom', PALETA.cianoClaro, PALETA.cianoEscuro, 4, 5, 12, 19)}</defs>
`);

/** Som desligado. */
const somMudo = svg(`
  <path d="M4 9.1h3.3L11.6 5.1v13.8l-4.3-4H4z" fill="rgba(255,255,255,.44)"/>
  <path d="M15.4 9.4l5.2 5.2M20.6 9.4l-5.2 5.2" stroke="${PALETA.rosa}" stroke-width="2.3" stroke-linecap="round"/>
`);

/** Dica: lampada acesa. */
const dica = svg(`
  <path d="M12 2.4a6.6 6.6 0 00-4.1 11.8c.6.5 1 1.2 1 2v.5h6.2v-.5c0-.8.4-1.5 1-2A6.6 6.6 0 0012 2.4z" fill="url(#gDica)"/>
  <path d="M9.4 18.6h5.2M10.3 21h3.4" stroke="${PALETA.ambar}" stroke-width="2" stroke-linecap="round"/>
  <path d="M9.6 8.4a2.6 2.6 0 012.4-1.7" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity=".6"/>
  <defs>${grad('gDica', '#fff0a8', PALETA.ambar, 7, 2, 16, 16)}</defs>
`);

/** Editar o proprio nome: lapis. */
const editar = svg(`
  <path d="M3.6 20.4h4.3l9.9-9.9-4.3-4.3-9.9 9.9z" fill="url(#gEdit)"/>
  <path d="M15.3 4.4l4.3 4.3 1.35-1.35a1.7 1.7 0 000-2.4l-1.9-1.9a1.7 1.7 0 00-2.4 0z" fill="${PALETA.rosa}"/>
  <path d="M3.6 20.4l1-3.6 2.6 2.6z" fill="${PALETA.escuro}" opacity=".55"/>
  <defs>${grad('gEdit', PALETA.ambarClaro, PALETA.ambar, 4, 6, 18, 20)}</defs>
`);

/** Sair da partida. */
const sair = svg(`
  <path d="M7 7l10 10M17 7L7 17" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
`);

export const ICONES = {
  solo,
  trofeu,
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
