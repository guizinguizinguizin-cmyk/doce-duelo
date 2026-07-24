// Teste de multiplayer real: navegadores separados, WebRTC de verdade.
//
// O modo solo nao exercita NADA da rede — ele roda inteiro em memoria. Todo o
// protocolo (sala, roster, inicio sincronizado, ataque, eliminacao, saida no
// meio da partida) so aparece aqui.
//
// Sobe um servidor de sinalizacao LOCAL em vez de usar o broker publico do
// PeerJS: teste nao pode depender da internet nem gastar cota de um servico
// gratuito de terceiros.
//
//   npm run multiplayer

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { PeerServer } from 'peer';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORTA_WEB = 8124;
const PORTA_PEER = 9321;
// BASE_PATH permite testar servido de uma subpasta ('/doce-duelo/'), que e
// como o GitHub Pages publica — caminho errado quebra so la.
const BASE_PATH = process.env.BASE_PATH || '/';
const BASE = `http://localhost:${PORTA_WEB}${BASE_PATH}?peer=localhost:${PORTA_PEER}`;

const PAD = 10;
const GAP = 4;

const falhas = [];
let verificacoes = 0;

const ok = (t) => {
  verificacoes += 1;
  console.log(`    ✓ ${t}`);
};
const falhar = (t) => {
  falhas.push(t);
  console.log(`    ✗ ${t}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Infraestrutura
// ---------------------------------------------------------------------------

async function esperarServidorWeb() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://localhost:${PORTA_WEB}${BASE_PATH}index.html`);
      if (r.ok) return true;
    } catch {
      /* subindo */
    }
    await sleep(150);
  }
  return false;
}

/** Abre o jogo num contexto isolado, com nome fixo e tutorial ja visto. */
async function abrirJogador(navegador, nome) {
  const contexto = await navegador.newContext({ viewport: { width: 420, height: 900 } });
  const pagina = await contexto.newPage();
  const erros = [];

  pagina.on('console', (m) => {
    if (m.type() === 'error') erros.push(`[${nome}] ${m.text()}`);
  });
  pagina.on('pageerror', (e) => erros.push(`[${nome}] pageerror: ${e.message}`));

  await pagina.addInitScript((n) => {
    localStorage.setItem(
      'doceduelo:v2',
      // debug: true deixa o painel tecnico (com a semente) disponivel ao teste.
      JSON.stringify({ name: n, tutorialSeen: true, settings: { muted: true, debug: true } })
    );
    // Placar desligado: teste nao envia nota-fantasma ao Supabase real.
    localStorage.setItem('doceduelo:supabase', JSON.stringify({ off: true }));
  }, nome);

  await pagina.goto(BASE, { waitUntil: 'networkidle' });
  const tutorial = pagina.locator('#tutorialModal:not(.hidden)');
  if (await tutorial.count()) await tutorial.locator('[data-close-modal]').click();

  return { pagina, contexto, erros, nome };
}

async function criarSala(jogador, tamanho) {
  await jogador.pagina.locator('#btnPlayOnline').click();
  await jogador.pagina.waitForSelector('#screenOnline:not(.hidden)');
  if (tamanho) await jogador.pagina.locator(`#playersSelect .seg-btn[data-n="${tamanho}"]`).click();
  await jogador.pagina.locator('#btnCreate').click();
  await jogador.pagina.waitForSelector('#hostCodeBox:not(.hidden)', { timeout: 25000 });
  return (await jogador.pagina.locator('#hostCodeDisplay').innerText()).trim();
}

async function entrarNaSala(jogador, codigo) {
  await jogador.pagina.locator('#btnPlayOnline').click();
  await jogador.pagina.waitForSelector('#screenOnline:not(.hidden)');
  await jogador.pagina.locator('#joinCodeInput').fill(codigo);
  await jogador.pagina.locator('#btnJoin').click();
}

/**
 * Le o NUMERO da semente no painel tecnico. E o sinal certo para "a semente
 * sincronizou": o hash de pixels do canvas engana, porque a animacao (shimmer)
 * dos clientes roda fora de fase — mesmo tabuleiro, pixels diferentes.
 */
async function lerSemente(pagina) {
  await pagina.evaluate(() => {
    if (document.getElementById('debugPanel').classList.contains('hidden')) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
    }
  });
  // O painel so ganha a semente no proximo tick da partida; da um tempo e tenta.
  for (let i = 0; i < 10; i++) {
    const txt = await pagina.locator('#debugPanel').innerText();
    const m = /semente\s+(\d+)/.exec(txt);
    if (m) return m[1];
    await sleep(200);
  }
  return null;
}

async function geometriaDoTabuleiro(pagina) {
  const caixa = await pagina.locator('#boardCanvas').boundingBox();
  const celula = (caixa.width - PAD * 2 - GAP * 7) / 8;
  const passo = celula + GAP;
  return (l, c) => ({
    x: caixa.x + PAD + c * passo + celula / 2,
    y: caixa.y + PAD + l * passo + celula / 2,
  });
}

/** Uma troca horizontal na posicao dada. */
async function trocar(pagina, ponto, l, c) {
  const a = ponto(l, c);
  const b = ponto(l, c + 1);
  await pagina.mouse.move(a.x, a.y);
  await pagina.mouse.down();
  await pagina.mouse.move(b.x, b.y, { steps: 4 });
  await pagina.mouse.up();
}

/**
 * Joga de forma SUSTENTADA ate `condicao()` virar true, ou estourar o tempo.
 *
 * Jogo sustentado importa: alinhar 3 vale 0 unidades de ataque por design,
 * entao uma jogada isolada nao envia nada. O ataque so aparece com sequencia
 * de 4+, formato L/T, cascata ou combo encadeado. Um teste que fizesse uma
 * jogada so mediria a regra errada e passaria por acaso.
 */
async function jogarAte(pagina, condicao, tempoMs = 90000) {
  const ponto = await geometriaDoTabuleiro(pagina);
  const limite = Date.now() + tempoMs;
  let l = 0;
  let c = 0;

  while (Date.now() < limite) {
    await trocar(pagina, ponto, l, c);
    await sleep(380);

    c += 1;
    if (c >= 7) {
      c = 0;
      l = (l + 1) % 8;
    }
    if (await condicao()) return true;
  }
  return false;
}

const pressaoDe = async (jogador) => {
  const atual = Number(await jogador.pagina.locator('#myBarTrack').getAttribute('aria-valuenow'));
  const temFila = await jogador.pagina.locator('#incomingBadge:not(.hidden)').count();
  return { atual, temFila: temFila > 0 };
};

// ---------------------------------------------------------------------------
// Cenario 1: partida de dois
// ---------------------------------------------------------------------------

async function cenarioDuplo(navegador) {
  console.log('\n  Cenario 1 — partida de dois');
  const anfitriao = await abrirJogador(navegador, 'Anfitriao');
  const convidado = await abrirJogador(navegador, 'Convidado');

  try {
    const codigo = await criarSala(anfitriao, 2);
    if (/^[A-Z0-9]{5}$/.test(codigo)) ok(`sala criada (${codigo})`);
    else falhar(`codigo invalido: "${codigo}"`);

    if ((await anfitriao.pagina.locator('#rosterList li').count()) === 1) {
      ok('anfitriao aparece na propria sala de espera');
    } else {
      falhar('anfitriao nao se ve na sala de espera');
    }

    await entrarNaSala(convidado, codigo);
    await convidado.pagina.waitForSelector('#screenWaiting:not(.hidden)', { timeout: 30000 });
    await sleep(1200);

    const nA = await anfitriao.pagina.locator('#rosterList li').count();
    const nB = await convidado.pagina.locator('#rosterList li').count();
    if (nA === 2 && nB === 2) ok('os dois veem a sala com 2 jogadores');
    else falhar(`roster dessincronizado: anfitriao ${nA}, convidado ${nB}`);

    const nomes = (await anfitriao.pagina.locator('#rosterList li').allInnerTexts()).join(' ');
    if (nomes.includes('Convidado')) ok('o nome escolhido trafegou pela rede');
    else falhar(`nome do convidado ausente: ${nomes}`);

    await anfitriao.pagina.locator('#btnStartGame').click();
    await Promise.all([
      anfitriao.pagina.waitForSelector('#screenBattle:not(.hidden)', { timeout: 20000 }),
      convidado.pagina.waitForSelector('#screenBattle:not(.hidden)', { timeout: 20000 }),
    ]);
    ok('os dois entraram na partida juntos');

    await sleep(2200);

    const semA = await lerSemente(anfitriao.pagina);
    const semB = await lerSemente(convidado.pagina);
    if (semA && semA === semB) ok(`semente compartilhada nos dois (${semA})`);
    else falhar(`semente nao sincronizou: ${semA} x ${semB}`);

    // ---- ataque anfitriao -> convidado ----
    const chegou = await jogarAte(anfitriao.pagina, async () => {
      const p = await pressaoDe(convidado);
      return p.atual > 0 || p.temFila;
    });
    if (chegou) ok('ataque do ANFITRIAO virou pressao no convidado');
    else falhar('convidado nunca recebeu pressao em 90s');

    const placar = Number(await anfitriao.pagina.locator('#myScore').innerText());
    const placarRemoto = Number(
      (await convidado.pagina.locator('.opponent-card .opponent-score').innerText()).replace(/\D/g, '')
    );
    if (placarRemoto === placar) ok(`placar replicado (${placar})`);
    else falhar(`placar dessincronizado: local ${placar}, remoto ${placarRemoto}`);

    // ---- ataque convidado -> anfitriao (sentido oposto!) ----
    // O convidado nao ataca direto: ele PEDE ao anfitriao, que e a autoridade.
    // Esse caminho e diferente e precisa de teste proprio.
    const voltou = await jogarAte(convidado.pagina, async () => {
      const p = await pressaoDe(anfitriao);
      return p.atual > 0 || p.temFila;
    });
    if (voltou) ok('ataque do CONVIDADO chegou no anfitriao (pedido -> autoridade -> entrega)');
    else falhar('o anfitriao nunca recebeu pressao do convidado');

    await anfitriao.pagina.screenshot({ path: 'scripts/.saida/mp-anfitriao.png' });
    await convidado.pagina.screenshot({ path: 'scripts/.saida/mp-convidado.png' });

    // ---- queda abrupta ----
    await convidado.pagina.close();
    await anfitriao.pagina.waitForSelector('#screenGameOver:not(.hidden)', { timeout: 25000 }).then(
      () => ok('queda do convidado encerrou a partida no anfitriao'),
      () => falhar('anfitriao ficou preso na partida apos a queda')
    );
  } finally {
    const erros = [...anfitriao.erros, ...convidado.erros];
    if (erros.length) {
      falhar(`${erros.length} erro(s) de console`);
      erros.slice(0, 6).forEach((e) => console.log(`        ${e}`));
    } else {
      ok('sem erros de console');
    }
    await anfitriao.contexto.close().catch(() => {});
    await convidado.contexto.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Cenario 2: sala de tres
// ---------------------------------------------------------------------------

async function cenarioTriplo(navegador) {
  console.log('\n  Cenario 2 — sala de tres');
  const anfitriao = await abrirJogador(navegador, 'Anfitriao');
  const jogador2 = await abrirJogador(navegador, 'Segundo');
  const jogador3 = await abrirJogador(navegador, 'Terceiro');

  try {
    const codigo = await criarSala(anfitriao, 3);
    await entrarNaSala(jogador2, codigo);
    await jogador2.pagina.waitForSelector('#screenWaiting:not(.hidden)', { timeout: 30000 });
    await entrarNaSala(jogador3, codigo);
    await jogador3.pagina.waitForSelector('#screenWaiting:not(.hidden)', { timeout: 30000 });
    await sleep(1800);

    const contagens = await Promise.all(
      [anfitriao, jogador2, jogador3].map((j) => j.pagina.locator('#rosterList li').count())
    );
    if (contagens.every((n) => n === 3)) ok('os tres veem a sala completa');
    else falhar(`roster dessincronizado entre os tres: ${contagens.join(', ')}`);

    await anfitriao.pagina.locator('#btnStartGame').click();
    await Promise.all(
      [anfitriao, jogador2, jogador3].map((j) =>
        j.pagina.waitForSelector('#screenBattle:not(.hidden)', { timeout: 20000 })
      )
    );
    ok('os tres entraram na partida');

    await sleep(2200);

    const cards = await Promise.all(
      [anfitriao, jogador2, jogador3].map((j) => j.pagina.locator('.opponent-card').count())
    );
    if (cards.every((n) => n === 2)) ok('cada jogador ve os outros dois');
    else falhar(`cartoes de adversario errados: ${cards.join(', ')}`);

    const sementes = await Promise.all(
      [anfitriao, jogador2, jogador3].map((j) => lerSemente(j.pagina))
    );
    if (sementes[0] && new Set(sementes).size === 1) ok(`os tres tem a mesma semente (${sementes[0]})`);
    else falhar(`sementes diferentes entre os tres: ${sementes.join(', ')}`);

    // Um jogador sai no meio: a partida NAO pode acabar, ainda ha dois vivos.
    await jogador3.pagina.close();
    await sleep(12000);

    const anfitriaoAindaJoga = await anfitriao.pagina.locator('#screenBattle:not(.hidden)').count();
    const segundoAindaJoga = await jogador2.pagina.locator('#screenBattle:not(.hidden)').count();
    if (anfitriaoAindaJoga && segundoAindaJoga) {
      ok('saida de um jogador nao encerrou a partida dos outros dois');
    } else {
      falhar('a partida acabou cedo demais quando o terceiro saiu');
    }

    const cardsDepois = await anfitriao.pagina.locator('.opponent-card.eliminated').count();
    if (cardsDepois >= 1) ok('quem saiu aparece como eliminado');
    else falhar('quem saiu nao foi marcado como eliminado');

    await anfitriao.pagina.screenshot({ path: 'scripts/.saida/mp-trio.png' });
  } finally {
    const erros = [...anfitriao.erros, ...jogador2.erros, ...jogador3.erros];
    if (erros.length) {
      falhar(`${erros.length} erro(s) de console`);
      erros.slice(0, 6).forEach((e) => console.log(`        ${e}`));
    } else {
      ok('sem erros de console');
    }
    await Promise.all(
      [anfitriao, jogador2, jogador3].map((j) => j.contexto.close().catch(() => {}))
    );
  }
}

// ---------------------------------------------------------------------------
// Cenario 3: erros de sala
// ---------------------------------------------------------------------------

async function cenarioErros(navegador) {
  console.log('\n  Cenario 3 — erros de sala');
  const anfitriao = await abrirJogador(navegador, 'Anfitriao');
  const bom = await abrirJogador(navegador, 'Bom');
  const intruso = await abrirJogador(navegador, 'Intruso');

  try {
    // Codigo inexistente precisa de mensagem, nao de tela travada.
    await entrarNaSala(intruso, 'ZZZZZ');
    // Espera a classe `erro`, nao qualquer texto: "Conectando..." tambem
    // preenche o elemento e faria o teste passar sem erro nenhum ter ocorrido.
    await intruso.pagina
      .waitForSelector('#lobbyStatus.erro', { timeout: 40000 })
      .then(async () => {
        const msg = await intruso.pagina.locator('#lobbyStatus').innerText();
        ok(`codigo inexistente avisa o jogador ("${msg.slice(0, 45)}")`);
      })
      .catch(() => falhar('codigo inexistente nao mostrou mensagem de erro'));

    if (await intruso.pagina.locator('#btnJoin').isEnabled()) {
      ok('o botao de entrar volta a funcionar apos o erro');
    } else {
      falhar('o botao de entrar ficou travado apos o erro');
    }

    // Sala de 2 ja cheia deve recusar o terceiro.
    const codigo = await criarSala(anfitriao, 2);
    await entrarNaSala(bom, codigo);
    await bom.pagina.waitForSelector('#screenWaiting:not(.hidden)', { timeout: 30000 });
    await sleep(1000);

    await intruso.pagina.locator('#joinCodeInput').fill(codigo);
    await intruso.pagina.locator('#btnJoin').click();

    await intruso.pagina
      .waitForFunction(
        () => /cheia|começou|comecou/i.test(document.getElementById('lobbyStatus').textContent),
        { timeout: 30000 }
      )
      .then(async () => {
        const msg = await intruso.pagina.locator('#lobbyStatus').innerText();
        ok(`sala cheia recusa e explica ("${msg.slice(0, 40)}")`);
      })
      .catch(async () => {
        const msg = await intruso.pagina.locator('#lobbyStatus').innerText();
        const naSala = await intruso.pagina.locator('#screenWaiting:not(.hidden)').count();
        falhar(naSala ? 'o intruso ENTROU numa sala cheia' : `recusa sem mensagem clara ("${msg}")`);
      });

    const aindaDois = await anfitriao.pagina.locator('#rosterList li').count();
    if (aindaDois === 2) ok('a sala cheia continua com exatamente 2 jogadores');
    else falhar(`sala cheia ficou com ${aindaDois} jogadores`);
  } finally {
    const erros = [...anfitriao.erros, ...bom.erros, ...intruso.erros];
    if (erros.length) {
      falhar(`${erros.length} erro(s) de console`);
      erros.slice(0, 6).forEach((e) => console.log(`        ${e}`));
    } else {
      ok('sem erros de console');
    }
    await Promise.all([anfitriao, bom, intruso].map((j) => j.contexto.close().catch(() => {})));
  }
}

// ---------------------------------------------------------------------------

const servidorWeb = spawn(process.execPath, ['scripts/serve.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORTA_WEB) },
  stdio: 'ignore',
});
const servidorPeer = PeerServer({ port: PORTA_PEER, path: '/', allow_discovery: false });

let navegador = null;
try {
  if (!(await esperarServidorWeb())) throw new Error('servidor web nao subiu');
  console.log('\n  servidor web + sinalizacao local no ar');

  navegador = await chromium.launch({ args: ['--no-sandbox'] });

  await cenarioDuplo(navegador);
  await cenarioTriplo(navegador);
  await cenarioErros(navegador);
} catch (err) {
  falhar('excecao: ' + err.message);
} finally {
  if (navegador) await navegador.close();
  servidorWeb.kill();
  servidorPeer.close?.();
}

console.log('');
if (falhas.length) {
  console.log(`FALHOU — ${falhas.length} problema(s)\n`);
  process.exit(1);
}
console.log(`PASSOU — ${verificacoes} verificacoes\n`);
process.exit(0);
