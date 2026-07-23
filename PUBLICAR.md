# Publicar o Doce Duelo

O jogo é 100% estático — não precisa de servidor, banco nem build complicado.
Qualquer hospedagem de site estático serve, e todas as opções abaixo são
gratuitas.

```
npm run build
```

Isso gera a pasta `dist/` (~343 KB). **É o conteúdo dela que vai para o ar.**

> **HTTPS é obrigatório.** WebRTC (a conexão entre os jogadores) e o service
> worker só funcionam em HTTPS. Todas as opções abaixo já dão HTTPS de graça.
> Abrir o arquivo direto (`file://`) não funciona.

---

## Opção 1 — Netlify Drop (mais rápido, sem conta)

Para testar com os amigos hoje:

1. Rode `npm run build`
2. Abra <https://app.netlify.com/drop>
3. Arraste a pasta `dist` para a página
4. Pronto — sai uma URL `https://algo-aleatorio.netlify.app`

Leva menos de um minuto. Criando conta (grátis), a URL vira permanente e você
pode escolher o nome.

## Opção 2 — GitHub Pages (URL permanente)

1. Crie um repositório no GitHub
2. No terminal, dentro da pasta do projeto:

```bash
git remote add origin https://github.com/SEU-USUARIO/doce-duelo.git
git branch -M main
git push -u origin main
```

3. Em **Settings → Pages**, escolha a branch `main` e a pasta `/ (root)`

Como o `index.html` está na raiz do projeto, o Pages já funciona sem build.
A URL fica `https://SEU-USUARIO.github.io/doce-duelo/`.

O jogo foi testado servido de subpasta exatamente assim — todos os caminhos
são relativos.

## Opção 3 — Cloudflare Pages / Vercel

Conectam direto ao repositório do GitHub. Configuração:

- Comando de build: `npm run build`
- Pasta de saída: `dist`

---

## Servidor de salas

A conexão entre jogadores usa PeerJS. Por padrão ele usa o servidor público e
gratuito do projeto — funciona, mas tem limite de uso e já saiu do ar algumas
vezes.

Para apontar para outro servidor sem mexer no código, basta a URL:

```
https://seu-site.com/?peer=meu.servidor.com:443
```

## Se alguém não conseguir conectar

O jogo tenta conexão direta entre os celulares (mais rápido) e, se a rede não
permitir, cai para um servidor de retransmissão. Mesmo assim algumas redes
bloqueiam tudo.

Ordem do que checar:

1. **Os dois estão na mesma rede?** Wi-Fi de um e 4G do outro é o caso que mais
   dá problema. Peça para os dois entrarem no mesmo Wi-Fi e teste de novo.
2. **Wi-Fi corporativo ou de escola** costuma bloquear esse tipo de conexão.
3. **O código está certo?** Sem os caracteres `I`, `O`, `0` e `1`, justamente
   para não confundir.

A mensagem de erro na tela distingue "sala não encontrada" (código errado) de
"não consegui completar a conexão" (rede bloqueando) — vale ler qual apareceu.

## Testando no celular sem publicar

Para testar rápido na sua própria rede, sem subir nada:

```
npm run dev
```

Ele imprime o endereço de rede local (algo como `http://192.168.1.7:8080`).
Funciona em qualquer celular no mesmo Wi-Fi.

Só que **sem HTTPS o service worker não funciona**, e alguns navegadores de
celular limitam recursos. Serve para sentir o toque e o ritmo; para testar de
verdade com os amigos, publique.
