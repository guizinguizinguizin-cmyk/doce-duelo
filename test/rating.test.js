import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RATING_INICIAL,
  DESVIO_INICIAL,
  novoJogador,
  atualizar,
  afastamento,
  notaExibida,
  estaCalibrando,
  chanceDeVitoria,
} from '../src/game/rating.js';
import { RANKS, rankDe, seloDoRank, resultadoConta, NOTA_DOS_BOTS } from '../src/game/ranks.js';

// ---------------------------------------------------------------------------
// Referencia oficial
// ---------------------------------------------------------------------------

test('bate com o exemplo numerico do artigo do Glickman', () => {
  // "Example of the Glicko-2 system", Mark Glickman. Jogador 1500/200/0.06
  // contra tres adversarios, com tau = 0.5. E o unico jeito honesto de saber
  // se a formula esta certa: rating errado nao quebra nada visivelmente, so
  // distribui as pessoas errado durante meses.
  const jogador = { rating: 1500, desvio: 200, volatilidade: 0.06, partidas: 0 };

  const resultado = atualizar(jogador, [
    { rating: 1400, desvio: 30, pontos: 1 },
    { rating: 1550, desvio: 100, pontos: 0 },
    { rating: 1700, desvio: 300, pontos: 0 },
  ]);

  // Valores do artigo: mu' = -0.2069, fi' = 0.8722, sigma' = 0.05999
  assert.ok(
    Math.abs(resultado.rating - 1464) <= 1,
    `esperava rating ~1464, veio ${resultado.rating}`
  );
  assert.ok(
    Math.abs(resultado.desvio - 152) <= 1,
    `esperava desvio ~152, veio ${resultado.desvio}`
  );
  assert.ok(
    Math.abs(resultado.volatilidade - 0.05999) < 0.0001,
    `esperava volatilidade ~0.05999, veio ${resultado.volatilidade}`
  );
});

// ---------------------------------------------------------------------------
// Comportamento basico
// ---------------------------------------------------------------------------

test('jogador novo comeca no meio e com incerteza maxima', () => {
  const j = novoJogador();
  assert.equal(j.rating, RATING_INICIAL);
  assert.equal(j.desvio, DESVIO_INICIAL);
  assert.equal(j.partidas, 0);
  assert.equal(estaCalibrando(j), true);
});

test('vencer sobe a nota, perder desce', () => {
  const j = novoJogador();
  const adversario = { rating: 1500, desvio: 100, pontos: 1 };

  const ganhou = atualizar(j, [adversario]);
  const perdeu = atualizar(j, [{ ...adversario, pontos: 0 }]);

  assert.ok(ganhou.rating > j.rating, 'vitoria tem de subir');
  assert.ok(perdeu.rating < j.rating, 'derrota tem de descer');
});

test('cada partida diminui a duvida do sistema', () => {
  let j = novoJogador();
  const antes = j.desvio;
  for (let i = 0; i < 10; i++) {
    j = atualizar(j, [{ rating: 1500, desvio: 80, pontos: i % 2 }]);
  }
  assert.ok(j.desvio < antes, `o desvio deveria cair: ${antes} -> ${j.desvio}`);
});

test('ganhar de quem e muito mais forte vale mais que de quem e mais fraco', () => {
  const j = { rating: 1500, desvio: 80, volatilidade: 0.06, partidas: 30 };

  const contraForte = atualizar(j, [{ rating: 2000, desvio: 80, pontos: 1 }]);
  const contraFraco = atualizar(j, [{ rating: 1000, desvio: 80, pontos: 1 }]);

  assert.ok(
    contraForte.rating - j.rating > contraFraco.rating - j.rating,
    'derrubar um favorito tem de valer mais'
  );
});

test('perder para quem e muito mais fraco custa mais', () => {
  const j = { rating: 1500, desvio: 80, volatilidade: 0.06, partidas: 30 };

  const paraFraco = atualizar(j, [{ rating: 1000, desvio: 80, pontos: 0 }]);
  const paraForte = atualizar(j, [{ rating: 2000, desvio: 80, pontos: 0 }]);

  assert.ok(
    j.rating - paraFraco.rating > j.rating - paraForte.rating,
    'tropecar num azarao tem de doer mais'
  );
});

test('quem acabou de chegar se move muito mais rapido que um veterano', () => {
  const novato = novoJogador();
  const veterano = { rating: 1500, desvio: 50, volatilidade: 0.06, partidas: 200 };
  const adversario = { rating: 1700, desvio: 60, pontos: 1 };

  const saltoNovato = atualizar(novato, [adversario]).rating - novato.rating;
  const saltoVeterano = atualizar(veterano, [adversario]).rating - veterano.rating;

  assert.ok(
    saltoNovato > saltoVeterano * 2,
    `novato deveria mover muito mais (${saltoNovato} vs ${saltoVeterano})`
  );
});

// ---------------------------------------------------------------------------
// Afastamento
// ---------------------------------------------------------------------------

test('sumir por um tempo devolve a incerteza', () => {
  const j = { rating: 1800, desvio: 60, volatilidade: 0.06, partidas: 100 };
  const voltou = afastamento(j, 20);

  assert.equal(voltou.rating, 1800, 'a nota em si nao muda por ausencia');
  assert.ok(voltou.desvio > j.desvio, 'a duvida tem de crescer');
});

test('a incerteza nunca passa do teto, por mais tempo que passe', () => {
  const j = { rating: 1800, desvio: 300, volatilidade: 0.09, partidas: 100 };
  const voltou = afastamento(j, 10000);
  assert.ok(voltou.desvio <= DESVIO_INICIAL, `desvio estourou: ${voltou.desvio}`);
});

// ---------------------------------------------------------------------------
// Nota exibida
// ---------------------------------------------------------------------------

test('a nota exibida e conservadora: duas partidas de sorte nao viram rank alto', () => {
  const sortudo = { rating: 2000, desvio: 300, volatilidade: 0.06, partidas: 2 };
  const provado = { rating: 2000, desvio: 50, volatilidade: 0.06, partidas: 150 };

  assert.ok(
    notaExibida(sortudo) < notaExibida(provado),
    'com a mesma nota crua, quem ainda nao provou tem de exibir menos'
  );
  assert.ok(notaExibida(sortudo) < 1500, 'duas partidas nao podem valer rank alto');
});

// ---------------------------------------------------------------------------
// Convergencia
// ---------------------------------------------------------------------------

test('a nota converge para a forca real ao longo de muitas partidas', () => {
  // Jogador que ganha exatamente metade das partidas de um adversario de 1600
  // tem, por definicao, a forca dele. O sistema precisa descobrir isso sozinho.
  let j = novoJogador();
  const adversario = { rating: 1600, desvio: 40 };

  for (let i = 0; i < 300; i++) {
    j = atualizar(j, [{ ...adversario, pontos: i % 2 }]);
  }

  assert.ok(
    Math.abs(j.rating - 1600) < 90,
    `esperava convergir perto de 1600, parou em ${j.rating}`
  );
  assert.equal(estaCalibrando(j), false, 'depois de 300 partidas nao deveria mais calibrar');
});

test('quem ganha sempre sobe acima do adversario e para de calibrar', () => {
  let j = novoJogador();
  for (let i = 0; i < 60; i++) {
    j = atualizar(j, [{ rating: 1500, desvio: 40, pontos: 1 }]);
  }
  assert.ok(j.rating > 1500, `ganhando sempre deveria passar de 1500, ficou em ${j.rating}`);
  assert.equal(estaCalibrando(j), false);
});

test('a nota nunca vira NaN nem infinito, mesmo em sequencias extremas', () => {
  // Um NaN aqui contaminaria o perfil salvo e so apareceria muito depois.
  let j = novoJogador();
  for (let i = 0; i < 200; i++) {
    const adversario = {
      rating: i % 3 === 0 ? 100 : 2800,
      desvio: i % 2 === 0 ? 30 : 350,
      pontos: i % 5 === 0 ? 0 : 1,
    };
    j = atualizar(j, [adversario]);

    assert.ok(Number.isFinite(j.rating), `rating invalido na partida ${i}: ${j.rating}`);
    assert.ok(Number.isFinite(j.desvio), `desvio invalido na partida ${i}: ${j.desvio}`);
    assert.ok(Number.isFinite(j.volatilidade), `volatilidade invalida na partida ${i}`);
    assert.ok(j.desvio > 0, `desvio nao pode zerar (partida ${i})`);
  }
});

// ---------------------------------------------------------------------------
// Previsao
// ---------------------------------------------------------------------------

test('a chance de vitoria acompanha a diferenca de nota', () => {
  const eu = { rating: 1500, desvio: 60, volatilidade: 0.06, partidas: 50 };

  const contraIgual = chanceDeVitoria(eu, { rating: 1500, desvio: 60 });
  const contraForte = chanceDeVitoria(eu, { rating: 2000, desvio: 60 });
  const contraFraco = chanceDeVitoria(eu, { rating: 1000, desvio: 60 });

  assert.ok(Math.abs(contraIgual - 0.5) < 0.02, 'contra igual tem de dar meio a meio');
  assert.ok(contraForte < 0.25, `contra alguem 500 acima deveria ser baixa: ${contraForte}`);
  assert.ok(contraFraco > 0.75, `contra alguem 500 abaixo deveria ser alta: ${contraFraco}`);
});

// ---------------------------------------------------------------------------
// Ranks
// ---------------------------------------------------------------------------

test('a escala de ranks e crescente e sem buraco', () => {
  for (let i = 1; i < RANKS.length; i++) {
    assert.ok(
      RANKS[i].minima > RANKS[i - 1].minima,
      `${RANKS[i].nome} nao pode exigir menos que ${RANKS[i - 1].nome}`
    );
  }
  assert.equal(RANKS[0].minima, 0, 'o primeiro rank tem de aceitar qualquer nota');
});

test('jogador novo cai no primeiro rank, nao num rank do meio', () => {
  const rank = rankDe(notaExibida(novoJogador()));
  assert.equal(rank.indice, 0, `novato entrou em ${rank.nome}`);
});

test('cada rank sabe quanto falta para o proximo', () => {
  const meio = rankDe(1250);
  assert.ok(meio.proximo, 'deveria haver proximo rank');
  assert.ok(meio.faltam > 0);
  assert.ok(meio.progresso >= 0 && meio.progresso <= 1);

  const topo = rankDe(99999);
  assert.equal(topo.proximo, null, 'o ultimo rank nao tem proximo');
  assert.equal(topo.faltam, 0);
});

test('cada selo gera um id de gradiente proprio', () => {
  // Id repetido faz o navegador resolver url(#id) para o primeiro do
  // documento; se esse estiver dentro de um elemento escondido, o selo sai
  // cinza. Aconteceu entre o cartao do menu e o painel de fim de partida.
  const rank = rankDe(1250);
  const a = seloDoRank(rank);
  const b = seloDoRank(rank);

  const idDe = (svg) => /id="([^"]+)"/.exec(svg)[1];
  assert.notEqual(idDe(a), idDe(b), 'dois selos nao podem compartilhar o id do gradiente');
  assert.ok(a.includes(`url(#${idDe(a)})`), 'o selo tem de referenciar o proprio gradiente');
  assert.ok(b.includes(`url(#${idDe(b)})`));
});

test('bot de cada dificuldade tem nota conhecida e crescente', () => {
  const ordem = ['facil', 'normal', 'dificil', 'pesadelo'];
  for (let i = 1; i < ordem.length; i++) {
    assert.ok(
      NOTA_DOS_BOTS[ordem[i]].rating > NOTA_DOS_BOTS[ordem[i - 1]].rating,
      `${ordem[i]} deveria valer mais que ${ordem[i - 1]}`
    );
  }
});

test('nao da para inflar a nota moendo o bot mais fraco', () => {
  // Eu SUPUS que o Glicko-2 frearia sozinho, porque a chance esperada tende a
  // 1. Nao freia: ela se aproxima mas nunca chega, entao sobra sempre um ganho
  // minusculo. Este teste, na primeira versao, chegou a Trufa moendo o bot
  // facil 400 vezes. Dai a regra explicita em resultadoConta().
  let j = novoJogador();
  for (let i = 0; i < 400; i++) {
    const regra = resultadoConta({
      notaAtual: notaExibida(j),
      adversario: NOTA_DOS_BOTS.facil,
      venceu: true,
      contraBot: true,
    });
    if (!regra.conta) continue;
    j = atualizar(j, [{ ...NOTA_DOS_BOTS.facil, pontos: 1 }]);
  }
  const rank = rankDe(notaExibida(j));
  assert.ok(
    rank.indice <= 2,
    `moer o bot facil levou a ${rank.nome} (nota ${notaExibida(j)}) — deveria estagnar perto dele`
  );
});

test('derrota conta mesmo contra adversario fraco', () => {
  // Assimetria de proposito: se a derrota tambem fosse ignorada, daria para
  // blindar o rank escolhendo so adversario fraco.
  const forte = { rating: 2000, desvio: 50, volatilidade: 0.06, partidas: 100 };
  const regra = resultadoConta({
    notaAtual: notaExibida(forte),
    adversario: NOTA_DOS_BOTS.facil,
    venceu: false,
    contraBot: true,
  });
  assert.equal(regra.conta, true, 'tropecar no bot facil tem de doer');
});

test('so o solo nao chega a Lenda', () => {
  // Bot nao adapta, nao blefa e nao aprende. O rank maximo exige gente.
  let j = novoJogador();
  for (let i = 0; i < 600; i++) {
    const regra = resultadoConta({
      notaAtual: notaExibida(j),
      adversario: NOTA_DOS_BOTS.pesadelo,
      venceu: true,
      contraBot: true,
    });
    if (!regra.conta) continue;
    j = atualizar(j, [{ ...NOTA_DOS_BOTS.pesadelo, pontos: 1 }]);
  }
  const rank = rankDe(notaExibida(j));
  assert.notEqual(rank.id, 'lenda', `o solo chegou a Lenda (nota ${notaExibida(j)})`);
  assert.ok(rank.indice >= 5, `mas vencer o pesadelo tem de levar longe, ficou em ${rank.nome}`);
});
