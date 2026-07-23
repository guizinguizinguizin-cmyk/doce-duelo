import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, createMatchRandom } from '../src/core/rng.js';
import { createGrid, allMoves, trySwap, cloneGrid, findMove, shuffleGrid, COLS } from '../src/core/board.js';
import { createMatch } from '../src/game/match.js';
import { createRecorder, playback, verificar, serializar, desserializar } from '../src/game/replay.js';

/**
 * Roda uma partida completa gravando tudo.
 *
 * Este e o lado "ao vivo" do teste: ele escolhe as jogadas por conta propria
 * (com um gerador separado, imitando jogadores) e nao usa nada do modulo de
 * replay. O replay depois so recebe a lista de jogadas e precisa chegar
 * exatamente ao mesmo lugar.
 */
function jogarPartidaGravando(seed, perfis, { limiteMs = 400000 } = {}) {
  const players = perfis.map((perfil, i) => ({
    id: 'j' + (i + 1),
    name: perfil.nome,
    isBot: true,
  }));

  const partida = createMatch({ seed, players, startedAt: 0 });
  const gravador = createRecorder({ seed, players, startedAt: 0 });

  const mesas = new Map();
  players.forEach((p, i) => {
    const rng = createMatchRandom(seed, COLS);
    mesas.set(p.id, {
      grid: createGrid(rng),
      rng,
      cerebro: createRng((seed ^ ((i + 1) * 0x9e3779b9)) >>> 0),
      perfil: perfis[i],
      proxima: Math.round(perfis[i].thinkMs),
    });
  });

  let t = 0;
  while (!partida.finished && t < limiteMs) {
    // Quem joga primeiro define o avanco do relogio.
    let vezDe = null;
    for (const p of players) {
      const mesa = mesas.get(p.id);
      if (!partida.jogador(p.id).alive) continue;
      if (!vezDe || mesa.proxima < mesas.get(vezDe).proxima) vezDe = p.id;
    }
    if (!vezDe) break;

    const mesa = mesas.get(vezDe);
    t = mesa.proxima;

    partida.avancarPara(t);
    if (partida.finished) break;

    if (!findMove(mesa.grid)) shuffleGrid(mesa.grid, mesa.rng);

    const jogadas = allMoves(mesa.grid);
    if (jogadas.length) {
      // Escolha por qualidade, com ruido — imita um jogador de verdade.
      const avaliadas = jogadas.map((jogada) => {
        const copia = cloneGrid(mesa.grid);
        const r = trySwap(copia, jogada.a, jogada.b, mesa.rng.fork());
        return { jogada, valor: r.ok ? r.points : -1 };
      });
      avaliadas.sort((x, y) => x.valor - y.valor);
      const inicio = Math.floor((avaliadas.length - 1) * mesa.perfil.skill);
      const faixa = avaliadas.slice(inicio);
      const escolhida = faixa[mesa.cerebro.int(faixa.length)].jogada;

      const resultado = trySwap(mesa.grid, escolhida.a, escolhida.b, mesa.rng);
      if (resultado.ok) {
        gravador.registrarJogada(vezDe, escolhida.a, escolhida.b, t);
        partida.aplicarJogada(vezDe, resultado, t);
      }
    }

    // Inteiro de proposito: Date.now() so devolve milissegundo cheio, e o
    // gravador arredonda. Um relogio fracionario aqui mediria uma precisao
    // que a partida real nunca tem.
    mesa.proxima = t + Math.round(mesa.perfil.thinkMs * (0.8 + mesa.cerebro.next() * 0.4));
  }

  partida.avancarPara(t);
  gravador.finalizar(partida.winnerId, t);

  return {
    replay: gravador.toJSON(),
    vencedor: partida.winnerId,
    assinatura: partida.assinatura(),
    eventos: partida.eventos,
    finalizada: partida.finished,
  };
}

const PERFIS = [
  { nome: 'Ana', thinkMs: 1800, skill: 0.7 },
  { nome: 'Bruno', thinkMs: 2200, skill: 0.55 },
];

// ---------------------------------------------------------------------------

test('o replay reproduz exatamente a partida gravada', () => {
  for (const seed of [1, 7, 42, 1234, 98765]) {
    const aoVivo = jogarPartidaGravando(seed, PERFIS);
    assert.ok(aoVivo.finalizada, `semente ${seed}: a partida nao terminou`);
    assert.ok(aoVivo.replay.jogadas.length > 5, `semente ${seed}: partida curta demais para valer o teste`);

    const reexecucao = playback(aoVivo.replay);

    assert.equal(
      reexecucao.vencedor,
      aoVivo.vencedor,
      `semente ${seed}: a reexecucao deu outro vencedor`
    );
    assert.equal(
      reexecucao.assinatura,
      aoVivo.assinatura,
      `semente ${seed}: o estado final divergiu\n  ao vivo: ${aoVivo.assinatura}\n  replay:  ${reexecucao.assinatura}`
    );
  }
});

test('a linha de eventos do replay bate evento a evento com a partida', () => {
  const aoVivo = jogarPartidaGravando(2024, PERFIS);
  const reexecucao = playback(aoVivo.replay);

  const resumir = (eventos) =>
    eventos.map((e) => `${e.t}:${e.tipo}:${e.jogador || e.de || ''}:${e.unidades ?? ''}`);

  assert.deepEqual(
    resumir(reexecucao.eventos),
    resumir(aoVivo.eventos),
    'ataques, pressao e eliminacoes precisam ocorrer nos mesmos instantes'
  );
});

test('o replay sobrevive a ida e volta em texto', () => {
  const aoVivo = jogarPartidaGravando(555, PERFIS);
  const texto = serializar(aoVivo.replay);
  const devolta = desserializar(texto);

  const reexecucao = playback(devolta);
  assert.equal(reexecucao.vencedor, aoVivo.vencedor);
  assert.equal(reexecucao.assinatura, aoVivo.assinatura);
});

test('uma partida inteira cabe em poucos kilobytes', () => {
  const aoVivo = jogarPartidaGravando(31337, PERFIS);
  const bytes = Buffer.byteLength(serializar(aoVivo.replay), 'utf8');
  const segundos = aoVivo.replay.duracao / 1000;

  assert.ok(
    bytes < 40000,
    `replay de ${segundos.toFixed(0)}s ocupou ${bytes} bytes — grande demais para compartilhar`
  );
});

test('verificar aprova um replay integro', () => {
  const aoVivo = jogarPartidaGravando(88, PERFIS);
  const veredito = verificar(aoVivo.replay);
  assert.equal(veredito.valido, true, veredito.motivo || '');
  assert.equal(veredito.obtido, aoVivo.vencedor);
});

test('verificar reprova um resultado adulterado', () => {
  // Base do anti-cheat: nao adianta declarar que venceu se a reexecucao das
  // proprias jogadas mostra outro vencedor.
  const aoVivo = jogarPartidaGravando(99, PERFIS);
  const adulterado = JSON.parse(serializar(aoVivo.replay));
  adulterado.vencedor = adulterado.vencedor === 'j1' ? 'j2' : 'j1';

  const veredito = verificar(adulterado);
  assert.equal(veredito.valido, false, 'resultado trocado deveria ser reprovado');
  assert.equal(veredito.obtido, aoVivo.vencedor, 'a reexecucao aponta o vencedor verdadeiro');
});

test('verificar reprova um replay com jogadas removidas', () => {
  const aoVivo = jogarPartidaGravando(4242, PERFIS);
  const mutilado = JSON.parse(serializar(aoVivo.replay));
  // Remove um quarto das jogadas do meio da partida.
  const corte = Math.floor(mutilado.jogadas.length / 2);
  mutilado.jogadas.splice(corte, Math.floor(mutilado.jogadas.length / 4));

  const veredito = verificar(mutilado);
  assert.equal(veredito.valido, false, 'jogadas faltando deveriam mudar o resultado');
});

test('a mesma semente com as mesmas jogadas sempre da o mesmo resultado', () => {
  const a = jogarPartidaGravando(777, PERFIS);
  const b = jogarPartidaGravando(777, PERFIS);

  assert.equal(a.vencedor, b.vencedor);
  assert.equal(a.assinatura, b.assinatura);
  assert.deepEqual(a.replay.jogadas, b.replay.jogadas);
});

test('sementes diferentes produzem partidas diferentes', () => {
  const a = jogarPartidaGravando(1, PERFIS);
  const b = jogarPartidaGravando(2, PERFIS);
  assert.notEqual(a.assinatura, b.assinatura, 'sementes distintas nao podem dar partidas iguais');
});

test('replay de sala de tres tambem reproduz', () => {
  const tres = [
    { nome: 'Ana', thinkMs: 1700, skill: 0.72 },
    { nome: 'Bruno', thinkMs: 2100, skill: 0.5 },
    { nome: 'Célia', thinkMs: 2500, skill: 0.6 },
  ];
  // Escolha de alvo com tres jogadores era o ponto onde Math.random quebrava
  // a reexecucao: com dois nao ha desempate, com tres ha.
  for (const seed of [11, 222, 3333]) {
    const aoVivo = jogarPartidaGravando(seed, tres);
    const reexecucao = playback(aoVivo.replay);
    assert.equal(reexecucao.vencedor, aoVivo.vencedor, `semente ${seed}: vencedor diferente`);
    assert.equal(reexecucao.assinatura, aoVivo.assinatura, `semente ${seed}: estado final diferente`);
  }
});

test('saida por desconexao e reproduzida', () => {
  const aoVivo = jogarPartidaGravando(606, PERFIS);
  const comSaida = JSON.parse(serializar(aoVivo.replay));

  // Injeta uma queda de conexao logo no comeco: o outro jogador tem de vencer.
  comSaida.eliminacoes.push({ t: 3000, j: 'j2', motivo: 'desconectou' });
  comSaida.vencedor = 'j1';

  const veredito = verificar(comSaida);
  assert.equal(veredito.valido, true, veredito.motivo || 'quem ficou deveria vencer');
});
