// Placar mundial via Supabase (banco hospedado + API REST pronta).
//
// Nao ha login: cada aparelho ganha uma chave estavel propria (playerKey) e
// ATUALIZA a propria linha em vez de criar duplicatas. E por isso que a tabela
// usa player_key como chave primaria e a gravacao e um "upsert".
//
// Nada aqui pode derrubar o jogo: toda chamada tem try/catch e falha em
// silencio. O placar e um extra — se a rede cair ou o Supabase estiver fora,
// a partida continua igual.
//
// Aviso de seguranca (ja combinado com o Guilherme): a chave anon e publica e o
// jogo roda no navegador, entao alguem determinado consegue forjar uma nota.
// Para amigos e para comecar, tudo bem. Blindar de verdade exige um servidor
// que revalida a partida pelo replay determinista — um passo posterior.

import { configLeaderboard, leaderboardAtivo } from '../leaderboard-config.js';

// Reexporta para quem usa o placar so precisar importar de um lugar.
export { leaderboardAtivo };

const TABELA = 'placar';

/** Chave estavel deste aparelho, para o jogador ter UMA linha no placar. */
function playerKey() {
  try {
    let k = localStorage.getItem('doceduelo:playerKey');
    if (!k) {
      k = (crypto.randomUUID && crypto.randomUUID()) || 'k-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      localStorage.setItem('doceduelo:playerKey', k);
    }
    return k;
  } catch {
    return 'anon-' + Math.random().toString(36).slice(2);
  }
}

export const meuId = playerKey;

function headers(c, extra) {
  return {
    apikey: c.anonKey,
    Authorization: `Bearer ${c.anonKey}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

/**
 * Envia (ou atualiza) a pontuacao do jogador no placar.
 * Devolve true se conseguiu, false se nao ha config ou a rede falhou.
 */
export async function enviarPontuacao({ name, rating, rankId, wins, games }) {
  const c = configLeaderboard();
  if (!c.url || !c.anonKey) return false;
  try {
    const res = await fetch(`${c.url}/rest/v1/${TABELA}`, {
      method: 'POST',
      headers: headers(c, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify([
        {
          player_key: playerKey(),
          name: String(name || 'Jogador').slice(0, 20),
          rating: Math.round(rating),
          rank_id: rankId || null,
          wins: wins | 0,
          games: games | 0,
          updated_at: new Date().toISOString(),
        },
      ]),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Busca os melhores do placar, ordenados por nota.
 * Devolve { eu, lista } ou null (sem config / falha de rede).
 */
export async function topJogadores(limite = 50) {
  const c = configLeaderboard();
  if (!c.url || !c.anonKey) return null;
  try {
    const url =
      `${c.url}/rest/v1/${TABELA}` +
      `?select=player_key,name,rating,rank_id,wins,games` +
      `&order=rating.desc,updated_at.asc&limit=${limite}`;
    const res = await fetch(url, { headers: headers(c) });
    if (!res.ok) return null;
    const lista = await res.json();
    return { eu: playerKey(), lista: Array.isArray(lista) ? lista : [] };
  } catch {
    return null;
  }
}
