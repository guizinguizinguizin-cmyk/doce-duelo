// Teste de fumaca: abre o jogo num navegador de verdade e JOGA.
//
// Verificar sintaxe nao prova nada — um erro de import, um id de DOM errado ou
// uma promessa que nunca resolve passam pelo `node --check` e quebram o jogo
// na cara do jogador. Este script inicia o servidor, abre o Chromium, comeca
// uma partida solo, procura uma jogada valida por forca bruta e confirma que
// a pontuacao subiu. Qualquer erro de console derruba o teste.
//
//   npm run smoke

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 8123;
const BASE = `http://localhost:${PORT}`;
const COLS = 8;
const BOARD_PAD = 10;
const CELL_GAP = 4;

const falhas = [];
const passos = [];

function ok(texto) {
  passos.push(`  ✓ ${texto}`);
  console.log(`  ✓ ${texto}`);
}

function falhar(texto) {
  falhas.push(texto);
  console.log(`  ✗ ${texto}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function esperarServidor(tentativas = 40) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const res = await fetch(BASE + '/index.html');
      if (res.ok) return true;
    } catch {
      /* ainda subindo */
    }
    await sleep(150);
  }
  return false;
}

const servidor = spawn(process.execPath, ['scripts/serve.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});

let navegador = null;

try {
  if (!(await esperarServidor())) throw new Error('o servidor de desenvolvimento nao subiu');
  ok('servidor respondendo');

  navegador = await chromium.launch();
  const contexto = await navegador.newContext({
    viewport: { width: 420, height: 900 },
    deviceScaleFactor: 2,
  });
  const pagina = await contexto.newPage();

  const errosConsole = [];
  pagina.on('console', (msg) => {
    if (msg.type() === 'error') errosConsole.push(msg.text());
  });
  pagina.on('pageerror', (err) => errosConsole.push('pageerror: ' + err.message));

  await pagina.goto(BASE, { waitUntil: 'networkidle' });
  ok('pagina carregou');

  if (await pagina.locator('#bootError:not(.hidden)').count()) {
    falhar('a tela de erro de carregamento apareceu');
  }

  // O tutorial abre na primeira visita.
  const tutorial = pagina.locator('#tutorialModal:not(.hidden)');
  if (await tutorial.count()) {
    await tutorial.locator('[data-close-modal]').click();
    ok('tutorial apareceu e fechou');
  } else {
    falhar('o tutorial deveria abrir na primeira visita');
  }

  // ---- menu -> solo ----
  await pagina.locator('#btnPlaySolo').click();
  await pagina.waitForSelector('#screenSolo:not(.hidden)', { timeout: 5000 });
  ok('tela de configuracao do solo abriu');

  const dificuldades = await pagina.locator('#difficultySelect .option-btn').count();
  if (dificuldades >= 4) ok(`${dificuldades} dificuldades listadas`);
  else falhar(`esperava 4 dificuldades, achei ${dificuldades}`);

  // ---- comecar partida ----
  await pagina.locator('#btnStartSolo').click();
  await pagina.waitForSelector('#screenCountdown:not(.hidden)', { timeout: 5000 });
  ok('contagem regressiva comecou');

  await pagina.waitForSelector('#screenBattle:not(.hidden)', { timeout: 10000 });
  ok('tela de batalha abriu');

  // A entrada das pecas leva ~1s; esperar antes de olhar o canvas.
  await sleep(1800);

  const caixa = await pagina.locator('#boardCanvas').boundingBox();
  if (!caixa || caixa.width < 100 || caixa.height < 100) {
    throw new Error('o canvas do tabuleiro nao tem tamanho valido');
  }
  ok(`canvas dimensionado (${Math.round(caixa.width)}x${Math.round(caixa.height)})`);

  // O canvas esta realmente desenhando alguma coisa?
  const pixelsPintados = await pagina.evaluate(() => {
    const canvas = document.getElementById('boardCanvas');
    const ctx = canvas.getContext('2d');
    const dados = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const cores = new Set();
    for (let i = 0; i < dados.length; i += 4 * 97) {
      cores.add(`${dados[i]},${dados[i + 1]},${dados[i + 2]}`);
    }
    return cores.size;
  });
  if (pixelsPintados > 20) ok(`tabuleiro desenhado (${pixelsPintados} cores distintas)`);
  else falhar(`o canvas parece vazio (so ${pixelsPintados} cores)`);

  const adversarios = await pagina.locator('.opponent-card').count();
  if (adversarios === 1) ok('cartao do adversario renderizado');
  else falhar(`esperava 1 adversario, achei ${adversarios}`);

  await pagina.screenshot({ path: 'scripts/.saida/tabuleiro.png' });

  // ---- procurar uma jogada valida ----
  const celula = (caixa.width - BOARD_PAD * 2 - CELL_GAP * (COLS - 1)) / COLS;
  const passo = celula + CELL_GAP;
  const centro = (linha, coluna) => ({
    x: caixa.x + BOARD_PAD + coluna * passo + celula / 2,
    y: caixa.y + BOARD_PAD + linha * passo + celula / 2,
  });

  const pontos = () => pagina.locator('#myScore').innerText().then(Number);

  let jogou = false;
  let tentativas = 0;

  for (let linha = 0; linha < 8 && !jogou; linha++) {
    for (let coluna = 0; coluna < 7 && !jogou; coluna++) {
      tentativas += 1;
      const de = centro(linha, coluna);
      const para = centro(linha, coluna + 1);

      await pagina.mouse.move(de.x, de.y);
      await pagina.mouse.down();
      await pagina.mouse.move(para.x, para.y, { steps: 6 });
      await pagina.mouse.up();
      await sleep(520);

      if ((await pontos()) > 0) jogou = true;
    }
  }

  if (jogou) ok(`jogada valida pontuou (na ${tentativas}a tentativa, ${await pontos()} pontos)`);
  else falhar('nenhuma das 56 trocas horizontais pontuou');

  // A barra de pressao deve ter reagido aos pontos.
  const larguraBarra = await pagina.locator('#myBarFill').evaluate((n) => n.style.width);
  ok(`barra de pressao em "${larguraBarra || '0%'}"`);

  // ---- o bot esta jogando sozinho? ----
  const pontosBotAntes = await pagina.locator('.opponent-card .opponent-score').innerText();
  await sleep(6000);
  const pontosBotDepois = await pagina.locator('.opponent-card .opponent-score').innerText();
  if (pontosBotAntes !== pontosBotDepois) {
    ok(`bot jogando sozinho (${pontosBotAntes} -> ${pontosBotDepois})`);
  } else {
    falhar(`o bot nao pontuou em 6s (parado em ${pontosBotAntes})`);
  }

  // ---- a pressao pendente aparece de verdade? ----
  // E a mecanica central do jogo: o ataque do bot precisa ficar visivel na
  // fila ANTES de virar dano, senao o jogador nao tem como reagir.
  let viuPendente = false;
  let maiorPendente = '';
  for (let i = 0; i < 60 && !viuPendente; i++) {
    const visivel = await pagina.locator('#incomingBadge:not(.hidden)').count();
    if (visivel) {
      maiorPendente = await pagina.locator('#incomingBadge').innerText();
      const largura = await pagina.locator('#myPendingFill').evaluate((n) => n.style.width);
      viuPendente = parseFloat(largura) > 0;
      if (viuPendente) {
        await pagina.screenshot({ path: 'scripts/.saida/pendente.png' });
        ok(`pressao pendente visivel na fila (${maiorPendente}, faixa ${largura})`);
      }
    }
    await sleep(500);
  }
  if (!viuPendente) falhar('o bot atacou mas a pressao pendente nunca apareceu na interface');

  await pagina.screenshot({ path: 'scripts/.saida/partida.png' });

  // ---- estabilidade sob toque aleatorio ----
  for (let i = 0; i < 14; i++) {
    const linha = Math.floor(Math.random() * 8);
    const coluna = Math.floor(Math.random() * 8);
    const p = centro(linha, coluna);
    await pagina.mouse.click(p.x, p.y);
    await sleep(120);
  }
  ok('sobreviveu a 14 toques aleatorios');

  if (errosConsole.length) {
    falhar(`${errosConsole.length} erro(s) de console:`);
    for (const erro of errosConsole.slice(0, 8)) console.log(`      ${erro}`);
  } else {
    ok('nenhum erro de console');
  }
} catch (err) {
  falhar('excecao: ' + err.message);
} finally {
  if (navegador) await navegador.close();
  servidor.kill();
}

console.log('');
if (falhas.length) {
  console.log(`FALHOU — ${falhas.length} problema(s)\n`);
  process.exit(1);
}
console.log(`PASSOU — ${passos.length} verificacoes\n`);
