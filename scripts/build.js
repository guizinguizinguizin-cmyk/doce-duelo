// Monta a pasta `dist/`: exatamente o que vai para o ar, e nada mais.
//
// Publicar a pasta do projeto inteira mandaria junto os testes, os scripts de
// simulacao e o node_modules — megabytes inuteis, e codigo de desenvolvimento
// exposto sem motivo. `dist/` e o que voce arrasta para a hospedagem.
//
//   npm run build

import { cp, rm, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(RAIZ, 'dist');

/** Tudo que o jogo precisa em producao. */
const ARQUIVOS = [
  'index.html',
  'styles.css',
  'manifest.json',
  'sw.js',
  'icon-192.png',
  'icon-512.png',
  'icon-512-maskable.png',
];

const PASTAS = ['src', 'vendor'];

async function tamanhoDe(caminho) {
  const info = await stat(caminho);
  if (!info.isDirectory()) return info.size;
  let total = 0;
  for (const item of await readdir(caminho)) {
    total += await tamanhoDe(join(caminho, item));
  }
  return total;
}

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

for (const arquivo of ARQUIVOS) {
  await cp(join(RAIZ, arquivo), join(DIST, arquivo));
}
for (const pasta of PASTAS) {
  await cp(join(RAIZ, pasta), join(DIST, pasta), { recursive: true });
}

// Impede que a hospedagem processe os arquivos (o GitHub Pages roda Jekyll por
// padrao e ignora pastas comecando com underscore).
await writeFile(join(DIST, '.nojekyll'), '');

const bytes = await tamanhoDe(DIST);
console.log(`\n  dist/ pronto — ${(bytes / 1024).toFixed(0)} KB`);
console.log(`  ${DIST}\n`);
console.log('  Publique o CONTEUDO desta pasta (nao a pasta em si).\n');
