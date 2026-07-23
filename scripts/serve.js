// Servidor de desenvolvimento.
//
// Existe porque o jogo usa modulos ES e service worker: os dois sao bloqueados
// quando a pagina e aberta como arquivo (file://). Rodar `npm run dev` e a
// unica forma de testar de verdade.
//
// Escuta em 0.0.0.0 de proposito, para dar para abrir no celular pelo IP da
// rede local — testar toque num celular de verdade vale mais do que emular.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT) || 8080;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';

    // Impede que "../.." escape da pasta do projeto.
    const alvo = join(ROOT, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!alvo.startsWith(ROOT)) {
      res.writeHead(403).end('Proibido');
      return;
    }

    const info = await stat(alvo).catch(() => null);
    if (!info || !info.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Não encontrado: ' + pathname);
      return;
    }

    const conteudo = await readFile(alvo);
    res.writeHead(200, {
      'Content-Type': TIPOS[extname(alvo).toLowerCase()] || 'application/octet-stream',
      // Sem cache: em desenvolvimento, cache velho e sempre atrapalho.
      'Cache-Control': 'no-store',
    });
    res.end(conteudo);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Erro: ' + err.message);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Doce Duelo rodando:\n`);
  console.log(`    Neste computador:  http://localhost:${PORT}`);
  for (const [nome, addrs] of Object.entries(networkInterfaces())) {
    for (const addr of addrs || []) {
      if (addr.family === 'IPv4' && !addr.internal) {
        console.log(`    No celular (${nome}):  http://${addr.address}:${PORT}`);
      }
    }
  }
  console.log('');
});
