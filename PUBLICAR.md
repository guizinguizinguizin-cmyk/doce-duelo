# Publicar o Doce Duelo (link permanente e grátis)

O jogo é 100% estático — não precisa de servidor, banco nem cartão de crédito.
Este guia deixa você com uma **URL própria que não morre** e que se atualiza
sozinha quando você mexe no jogo.

> **Por que HTTPS importa:** a conexão entre os jogadores (WebRTC) e o modo
> offline (service worker) só funcionam em HTTPS. Todas as opções abaixo já
> dão HTTPS de graça. Abrir o arquivo direto (`file://`) não funciona.

---

## Opção A — GitHub Pages (recomendada: atualiza sozinha)

Depois de configurar uma vez, **todo `git push` republica o jogo automático**.
Já deixei o robô de publicação pronto em `.github/workflows/deploy.yml`.

### 1. Coloque o projeto no GitHub

Se você **não** mexe com git no terminal, o jeito mais fácil é o app
**GitHub Desktop** (tem versão em português, com botões):

1. Instale o GitHub Desktop e faça login na sua conta.
2. **File → Add local repository** e aponte para a pasta do jogo.
3. Clique em **Publish repository**. Pode deixar público. Pronto — ele cuida
   do login e do envio sem você digitar senha nenhuma.

Se você prefere o terminal e já tem o `gh` (GitHub CLI):

```bash
gh auth login
gh repo create doce-duelo --public --source=. --push
```

### 2. Ligue o GitHub Pages

No site do GitHub, dentro do seu repositório:

**Settings → Pages → Build and deployment → Source: “GitHub Actions”**

Só isso. Não precisa escolher branch nem pasta.

### 3. Espere ~1 minuto

Na aba **Actions** do repositório aparece a publicação rodando. Quando ficar
verde, seu link está no ar:

```
https://SEU-USUARIO.github.io/doce-duelo/
```

Desse ponto em diante, cada mudança que você enviar (Push no GitHub Desktop,
ou `git push`) republica sozinha.

---

## Opção B — Netlify (mais rápido agora, atualização manual)

Se você só quer o link **hoje**, sem git:

1. Rode `npm run build` (gera a pasta `dist/`).
2. Abra <https://app.netlify.com/drop> e arraste a pasta `dist`.
3. Sai uma URL HTTPS na hora.

Criando conta grátis, a URL vira permanente e você pode dar um nome a ela. A
desvantagem é que **cada atualização exige arrastar a `dist/` de novo** — por
isso, se você vai continuar mexendo no jogo, a Opção A compensa mais.

> Se preferir conectar o Netlify ao seu repositório do GitHub (aí ele também
> atualiza sozinho), o arquivo `netlify.toml` já está pronto: é só apontar o
> Netlify para o repositório.

---

## Se um amigo não conseguir conectar no multiplayer

O jogo tenta conexão direta entre os celulares e, se a rede não deixar, cai
para um servidor de retransmissão. Ordem do que checar:

1. **Os dois estão na mesma rede?** Um no Wi-Fi e outro no 4G é o caso que
   mais dá problema. Peça para os dois entrarem no mesmo Wi-Fi e teste.
2. **Wi-Fi de escola ou empresa** costuma bloquear esse tipo de conexão.
3. **O código está certo?** Ele não usa as letras `I`, `O` nem os números `0`
   e `1`, justamente para não confundir.

A mensagem de erro na tela separa "sala não encontrada" (código errado) de
"não consegui completar a conexão" (rede bloqueando) — vale ler qual apareceu.

---

## Servidor de salas

A conexão usa o servidor público e gratuito do PeerJS. Funciona, mas tem
limite de uso. Para apontar para outro sem mexer no código, basta a URL:

```
https://seu-site.com/?peer=meu.servidor.com:443
```

## Testar na sua rede sem publicar

```bash
npm run dev
```

Imprime um endereço de rede local (`http://192.168.x.x:8080`) que abre em
qualquer celular no mesmo Wi-Fi. Serve para sentir o toque rápido; para os
amigos jogarem de qualquer lugar, publique (Opção A ou B).
