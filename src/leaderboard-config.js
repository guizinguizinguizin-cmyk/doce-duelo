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
  url: '',
  anonKey: '',
};

export function configLeaderboard() {
  try {
    const salvo = localStorage.getItem('doceduelo:supabase');
    if (salvo) {
      const c = JSON.parse(salvo);
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
