# Chat Privado

> Chat interno web com login, presença online e envio de imagens por Ctrl+V.

---

## Sumário

- [Visão geral](#visão-geral)
- [Objetivo do projeto](#objetivo-do-projeto)
- [Custos (stack 100% sem pagamento obrigatório)](#custos-stack-100-sem-pagamento-obrigatório)
- [Stack e arquitetura](#stack-e-arquitetura)
- [Estrutura do repositório](#estrutura-do-repositório)
- [Fluxos principais](#fluxos-principais)
- [APIs (contratos)](#apis-contratos)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Supabase esperado](#supabase-esperado)
- [Como rodar](#como-rodar)
- [Segurança e limitações atuais](#segurança-e-limitações-atuais)
- [Roadmap sugerido](#roadmap-sugerido)

---

## Visão geral

Este projeto é uma aplicação de chat para uso interno com:

- autenticação simples por usuário/senha,
- sessão no navegador,
- feed de mensagens com atualização periódica,
- menções com destaque visual,
- presença online,
- upload de imagem por colagem (Ctrl+V),
- notificações sonoras de novas mensagens/menções.

---

## Objetivo do projeto

Criar um canal de conversa privado para um grupo específico de pessoas, com acesso controlado e interface discreta, sem depender de plataformas externas de chat tradicionais.

---

## Custos (stack 100% sem pagamento obrigatório)

Este sistema foi pensado para funcionar **sem contratar plano pago**.

### O que foi usado sem custo obrigatório

- **Front-end estático** (HTML/CSS/JS): sem custo de licença.
- **Node.js + npm**: ecossistema open source.
- **Dependências do projeto**:
  - `@supabase/supabase-js` (open source)
  - `formidable` (open source)
- **Supabase**: pode operar no plano gratuito para este caso de uso.
- **Deploy serverless (ex.: Vercel)**: pode operar no plano gratuito (hobby).

### Observação importante

Não existe cobrança obrigatória no código para ele funcionar. O projeto pode rodar no modo gratuito enquanto estiver dentro dos limites de uso dos provedores (quota de requests, storage, bandwidth e execução serverless).

---

## Stack e arquitetura

### Front-end

- HTML/CSS/JS puro (sem framework front-end).
- Tela de login (`index.html`, `css/loginf.css`, `js/loginf.js`).
- Tela principal do chat (`m3yxe8u27wpoovbz.html`, com script inline).

### Back-end (serverless)

Rotas em `api/`:

- `api/login.js` → autenticação baseada em `LOGIN_USERS`.
- `api/messages.js` → leitura/escrita de mensagens via Supabase REST.
- `api/online.js` → heartbeat de usuários online.
- `api/upload.js` → upload multipart para Supabase Storage.

### Dependências

- `@supabase/supabase-js`
- `formidable`

---

## Estrutura do repositório

```text
.
├── api/
│   ├── login.js
│   ├── messages.js
│   ├── online.js
│   └── upload.js
├── css/
│   └── loginf.css
├── js/
│   └── loginf.js
├── favicon.png
├── index.html
├── m3yxe8u27wpoovbz.html
├── message.mp3
├── package.json
└── package-lock.json
```

> Observação: o nome `m3yxe8u27wpoovbz.html` pode ser renomeado no futuro para algo mais semântico (ex.: `chat.html`).

---

## Fluxos principais

### 1) Login

1. Usuário informa `username` e `password`.
2. Front envia `POST /api/login`.
3. API valida credenciais na env var `LOGIN_USERS`.
4. Em sucesso, o front salva `token` e `loggedUser` no `sessionStorage` e redireciona para o chat.

### 2) Proteção da página de chat

Ao carregar a página de chat, se `token`/`loggedUser` não existir no `sessionStorage`, o usuário é redirecionado para `index.html`.

### 3) Mensagens

- **Leitura**: `GET /api/messages` (ordenação crescente por `created_at`).
- **Envio**: `POST /api/messages` com `{ name, content, image_url }`.
- Polling no front a cada 3 segundos para atualizar o feed.

### 4) Presença online

- `POST /api/online` (heartbeat) a cada 5 segundos.
- `GET /api/online` para listar usuários ativos.
- Janela de atividade considerada online: ~15 segundos.

### 5) Upload de imagem (Ctrl+V)

1. Evento `paste` detecta imagem no campo de texto.
2. Front faz `POST /api/upload` com `multipart/form-data`.
3. API envia para bucket `chat-images` no Supabase Storage.
4. URL pública retorna para o front e é associada à próxima mensagem enviada.

---

## APIs (contratos)

### `POST /api/login`

**Request**

```json
{
  "username": "usuario",
  "password": "senha"
}
```

**200**

```json
{
  "success": true,
  "token": "...",
  "user": "usuario"
}
```

**401**

```json
{ "success": false }
```

---

### `GET /api/messages`

Retorna array de mensagens.

### `POST /api/messages`

**Request**

```json
{
  "name": "usuario",
  "content": "texto",
  "image_url": "https://..."
}
```

`image_url` é opcional.

---

### `GET /api/online`

Retorna array de usuários online pela janela de `last_seen`.

### `POST /api/online`

**Request**

```json
{ "name": "usuario" }
```

Faz upsert de `last_seen`.

---

### `POST /api/upload`

- `multipart/form-data`
- campos esperados:
  - `file` (obrigatório)
  - `fileName` (opcional)
- resposta de sucesso:

```json
{ "url": "https://..." }
```

---

## Variáveis de ambiente

Defina no ambiente de execução (ex.: Vercel):

- `LOGIN_USERS`
  - formato: `usuario1:senha1,usuario2:senha2`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

---

## Supabase esperado

### Tabela `messages`

Campos usados pelo sistema:

- `id`
- `name`
- `content`
- `image_url` (opcional)
- `created_at`

### Tabela `online_users`

Campos usados:

- `name` (idealmente único)
- `last_seen`

### Storage

- Bucket: `chat-images`
- Objetos com URL pública para renderização/abertura no chat.

---

## Como rodar

### Deploy recomendado (Vercel)

1. Conectar este repositório.
2. Configurar as env vars.
3. Fazer deploy.

### Execução local (ambiente compatível com funções serverless)

```bash
npm install
vercel dev
```

---

## Segurança e limitações atuais

- Autenticação simples via `LOGIN_USERS` (adequada para uso interno básico, não enterprise).
- Token salvo em `sessionStorage` sem middleware robusto de autorização nos endpoints.
- Upload usa `SUPABASE_SERVICE_ROLE_KEY` (deve permanecer protegido no ambiente de deploy).
- Projeto sem suíte de testes automatizados no momento.

---

## Roadmap sugerido

- Adotar autenticação robusta com validação de token no backend.
- Adicionar autorização por rota/endpoint.
- Implementar rate limit e validações adicionais de payload.
- Criar testes automatizados para APIs.
- Renomear arquivo principal do chat para nome semântico.

---

Projeto e ideias feitos originalmente por **fragass**.
