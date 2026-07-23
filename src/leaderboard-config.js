// Configuracao do placar online (Supabase).
//
// Duas chaves, que o Guilherme pega no painel do Supabase (Settings -> API):
//  - url:     o "Project URL" (ex.: https://abcdefgh.supabase.co)
//  - anonKey: a chave "anon public" (e publica de proposito — pode ficar aqui)
//
// Enquanto estiverem vazias, o placar aparece como "sendo ativado" e o jogo
// funciona normalmente sem ele.
//
// Tambem da para definir por localStorage (para testar sem rebuild):
//   localStorage.setItem('doceduelo:supabase', JSON.stringify({url, anonKey}))

const PADRAO = {
  url: 'https://ctoqbmdngwstumujzzta.supabase.co',
  // Chave "publishable" — publica de proposito, so le o placar e envia a
  // propria nota. A chave SECRETA nunca vai aqui.
  anonKey: 'sb_publishable_-Eth3gzXfl67JvP3Z-VnVA_2SDD0rje',
};

export function configLeaderboard() {
  try {
    const salvo = localStorage.getItem('doceduelo:supabase');
    if (salvo) {
      const c = JSON.parse(salvo);
      // Desligamento explicito: { off: true }. Usado nos testes automatizados
      // para que jogar uma partida de robo NUNCA envie nota ao placar real.
      if (c && c.off) return { url: '', anonKey: '' };
      if (c && c.url && c.anonKey) return c;
    }
  } catch {
    /* localStorage bloqueado: cai no padrao */
  }
  return PADRAO;
}

export function leaderboardAtivo() {
  const c = configLeaderboard();
  return !!(c.url && c.anonKey);
}
