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
# S1mpl3s v1.0.2026.03.07 — Final Build by fragass

Documentação final e completa do projeto **w0rkd4y**.

---

## Visão geral
## 1) O que é este projeto

Este repositório contém um chat web interno com:

Este projeto é uma aplicação de chat para uso interno com:
- login por usuário/senha (validados no Supabase);
- chat público com mensagens em tempo real por polling;
- sussurros (mensagens privadas dentro do feed público);
- salas privadas (DM) com criação/entrada/saída por comandos;
- sistema de reply (resposta) em mensagens públicas e privadas;
- upload de imagem no chat via **Ctrl+V** (clipboard);
- perfil de usuário com avatar (upload para bucket dedicado);
- indicação de presença online e status de digitação;
- contador de mensagens não lidas no título da aba;
- comando administrativo para limpar completamente o chat.

- autenticação simples por usuário/senha,
- sessão no navegador,
- feed de mensagens com atualização periódica,
- menções com destaque visual,
- presença online,
- upload de imagem por colagem (Ctrl+V),
- notificações sonoras de novas mensagens/menções.
A aplicação foi construída com **HTML/CSS/JS puro no front-end** e **funções serverless em Node.js** no diretório `api/`.

---

## Objetivo do projeto
## 2) Stack técnica

Criar um canal de conversa privado para um grupo específico de pessoas, com acesso controlado e interface discreta, sem depender de plataformas externas de chat tradicionais.
- **Front-end:** HTML + CSS + JavaScript vanilla
- **Back-end:** funções serverless (padrão Vercel)
- **Banco/Storage:** Supabase (Postgres + REST + Storage)
- **Dependências Node:**
  - `@supabase/supabase-js`
  - `formidable`

---

## Custos (stack 100% sem pagamento obrigatório)
## 3) Estrutura real do projeto

Este sistema foi pensado para funcionar **sem contratar plano pago**.
```text
.
├── 8617a543f74d88b440f5ba33e1713f063665240f.html  # Tela principal do chat
├── index.html                                      # Tela de login
├── css/
│   └── loginf.css
├── js/
│   └── loginf.js
├── api/
│   ├── admin/
│   │   └── clear.js
│   ├── dm/
│   │   ├── create.js
│   │   ├── enter.js
│   │   ├── leave.js
│   │   └── messages.js
│   ├── login.js
│   ├── messages.js
│   ├── online.js
│   ├── profile.js
│   ├── profile-upload.js
│   └── upload.js
├── favicon.png
├── message.mp3
├── package.json
└── package-lock.json
```

### O que foi usado sem custo obrigatório
> O arquivo principal do chat usa um nome ofuscado/hash (`8617a543f74d88b440f5ba33e1713f063665240f.html`).

- **Front-end estático** (HTML/CSS/JS): sem custo de licença.
- **Node.js + npm**: ecossistema open source.
- **Dependências do projeto**:
  - `@supabase/supabase-js` (open source)
  - `formidable` (open source)
- **Supabase**: pode operar no plano gratuito para este caso de uso.
- **Deploy serverless (ex.: Vercel)**: pode operar no plano gratuito (hobby).
---

### Observação importante
## 4) Fluxo funcional completo

Não existe cobrança obrigatória no código para ele funcionar. O projeto pode rodar no modo gratuito enquanto estiver dentro dos limites de uso dos provedores (quota de requests, storage, bandwidth e execução serverless).
### 4.1 Login e sessão

---
1. Usuário acessa `index.html`.
2. Front envia `POST /api/login` com `username` e `password`.
3. API consulta tabela `users` no Supabase.
4. Se válido, retorna `token`, `user` e `isAdmin`.
5. Front salva em `sessionStorage`:
   - `token`
   - `loggedUser`
   - `isAdmin`
6. Front redireciona para `8617a543f74d88b440f5ba33e1713f063665240f.html`.

## Stack e arquitetura
### 4.2 Proteção de rota no front

### Front-end
A página do chat verifica se `token` e `loggedUser` existem no `sessionStorage`; sem isso, redireciona para `index.html`.

- HTML/CSS/JS puro (sem framework front-end).
- Tela de login (`index.html`, `css/loginf.css`, `js/loginf.js`).
- Tela principal do chat (`m3yxe8u27wpoovbz.html`, com script inline).
### 4.3 Chat público

### Back-end (serverless)
- Polling de mensagens a cada **3 segundos** (`GET /api/messages`).
- Envio com `POST /api/messages`.
- Mensagens com `to` funcionam como sussurro e só ficam visíveis para remetente/destinatário.
- Menções (`@usuario`) são destacadas no render.
- Mensagens podem conter reply (`reply_to` + `reply_preview`).

Rotas em `api/`:
### 4.4 Salas privadas (DM)

- `api/login.js` → autenticação baseada em `LOGIN_USERS`.
- `api/messages.js` → leitura/escrita de mensagens via Supabase REST.
- `api/online.js` → heartbeat de usuários online.
- `api/upload.js` → upload multipart para Supabase Storage.
Comandos no input do chat:

### Dependências
- **Criar sala privada:**
  - `/c @usuario nome-da-sala`
- **Entrar em sala privada:**
  - `/entrar nome-da-sala`
- **Sair da sala privada:**
  - `/sair`

- `@supabase/supabase-js`
- `formidable`
As DMs usam endpoints em `api/dm/*` e tabela própria de mensagens privadas.

---
### 4.5 Sussurro no chat público

## Estrutura do repositório
Comando:

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
- `/s @usuario mensagem`

> Observação: o nome `m3yxe8u27wpoovbz.html` pode ser renomeado no futuro para algo mais semântico (ex.: `chat.html`).
Isso envia mensagem pública com campo `to`, exibida com visual de sussurro.

---
### 4.6 Reply (responder mensagem)

## Fluxos principais
- Clique numa mensagem para selecionar reply.
- O sistema preenche barra de resposta.
- Ao enviar, inclui referência `reply_to` e um preview textual.
- Em DM, se o backend não aceitar colunas de reply, o front tenta fallback sem reply.

### 1) Login
### 4.7 Upload de imagem no chat

1. Usuário informa `username` e `password`.
2. Front envia `POST /api/login`.
3. API valida credenciais na env var `LOGIN_USERS`.
4. Em sucesso, o front salva `token` e `loggedUser` no `sessionStorage` e redireciona para o chat.
- Usuário cola imagem no textarea (`Ctrl+V`).
- Front envia multipart para `POST /api/upload`.
- API grava no bucket `chat-images` e retorna URL pública.
- A próxima mensagem envia essa URL em `image_url`.

### 2) Proteção da página de chat
### 4.8 Perfil e avatar

Ao carregar a página de chat, se `token`/`loggedUser` não existir no `sessionStorage`, o usuário é redirecionado para `index.html`.
- `GET /api/profile?username=...` para carregar perfil.
- `POST /api/profile` para salvar `display_name`/`avatar_url`.
- `POST /api/profile-upload` para upload de avatar no bucket `profile-avatars`.
- Upload de avatar possui validações de tipo e tamanho (máx. 3 MB).

### 3) Mensagens
### 4.9 Presença e digitação

- **Leitura**: `GET /api/messages` (ordenação crescente por `created_at`).
- **Envio**: `POST /api/messages` com `{ name, content, image_url }`.
- Polling no front a cada 3 segundos para atualizar o feed.
- Heartbeat em `POST /api/online` a cada **5 segundos**.
- Lista online em `GET /api/online` a cada **5 segundos**.
- Indicador de digitação consultado a cada **900 ms**.
- Presença ativa considerada por janela de aproximadamente **15 segundos**.

### 4) Presença online
### 4.10 Comando administrativo de limpeza total

- `POST /api/online` (heartbeat) a cada 5 segundos.
- `GET /api/online` para listar usuários ativos.
- Janela de atividade considerada online: ~15 segundos.
Comando no input:

### 5) Upload de imagem (Ctrl+V)
- `/clear all`

1. Evento `paste` detecta imagem no campo de texto.
2. Front faz `POST /api/upload` com `multipart/form-data`.
3. API envia para bucket `chat-images` no Supabase Storage.
4. URL pública retorna para o front e é associada à próxima mensagem enviada.
Fluxo:

1. Front pede confirmação textual (`CLEAR ALL`).
2. Chama `POST /api/admin/clear` com `username` e `scope: "all"`.
3. Backend valida se usuário é admin (`users.is_admin`).
4. Remove imagens do bucket `chat-images`.
5. Limpa tabelas de mensagens públicas, mensagens privadas e canais privados.

---

## APIs (contratos)
## 5) Endpoints (contrato resumido)

## Autenticação

### `POST /api/login`

**Request**
**Body**

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
  "token": "<hex>",
  "user": "usuario",
  "isAdmin": true
}
```

**401**

```json
{ "success": false }
```

---

## Mensagens públicas

### `GET /api/messages`

Retorna array de mensagens.
Retorna mensagens públicas ordenadas por `created_at asc`, enriquecidas com `is_admin` do autor.

### `POST /api/messages`

**Request**
**Body (principal)**

```json
{
  "name": "usuario",
  "content": "texto",
  "image_url": "https://..."
  "image_url": "https://... (opcional)",
  "to": "destinatario (opcional)",
  "reply_to": 123,
  "reply_preview": {
    "id": 123,
    "name": "autor-original",
    "snippet": "prévia...",
    "hasImage": false,
    "created_at": "2026-03-07T00:00:00.000Z"
  }
}
```

`image_url` é opcional.

---

## Presença

### `GET /api/online`

Retorna array de usuários online pela janela de `last_seen`.
Retorna usuários considerados online.

### `POST /api/online`

**Request**
**Body**

```json
{ "name": "usuario" }
{
  "name": "usuario",
  "typing": true,
  "typing_room": "nome-da-sala-ou-null"
}
```

Faz upsert de `last_seen`.

---

## Upload de imagem no chat

### `POST /api/upload`

- `multipart/form-data`
- campos esperados:
  - `file` (obrigatório)
  - `fileName` (opcional)
- resposta de sucesso:
- Multipart (`file`, `fileName` opcional)
- Upload para bucket `chat-images`
- Retorno:

```json
{
  "url": "https://..."
}
```

---

## Perfil

### `GET /api/profile?username=usuario`

Retorna perfil; se não existir, devolve fallback com `display_name = username`.

### `POST /api/profile`

Upsert de perfil.

**Body**

```json
{ "url": "https://..." }
{
  "username": "usuario",
  "display_name": "Nome exibido",
  "avatar_url": "https://..."
}
```

### `POST /api/profile-upload`

- Multipart (`file`, `username`)
- Tipos aceitos: jpeg/png/webp
- Máximo: 3MB
- Bucket: `profile-avatars`
- Atualiza `user_profiles.avatar_url`

---

## DM (salas privadas)

### `POST /api/dm/create`

Cria sala privada entre dois usuários ou reutiliza uma existente.

### `POST /api/dm/enter`

Valida acesso à sala e retorna metadados para entrar.

### `POST /api/dm/leave`

Registra atividade e permite retorno ao chat público.

### `GET /api/dm/messages?room=<sala>&name=<usuario>`

Lista mensagens privadas da sala (com validação de participante).

### `POST /api/dm/messages`

Envia mensagem privada (texto/imagem, com suporte a reply).

---

## Admin

### `POST /api/admin/clear`

Limpa completamente:

- `messages`
- `private_messages`
- `private_channels`
- imagens no bucket `chat-images`

Requer usuário admin.

---

## Variáveis de ambiente
## 6) Variáveis de ambiente

Defina no ambiente de execução (ex.: Vercel):
Configure no ambiente de deploy/local:

- `LOGIN_USERS`
  - formato: `usuario1:senha1,usuario2:senha2`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DM_TTL_MINUTES` (opcional; padrão: `360`)

---

## Supabase esperado
## 7) Modelo de dados esperado (Supabase)

## Tabela `users`

Campos usados pelo projeto:

### Tabela `messages`
- `username` (texto único)
- `password` (texto)
- `is_admin` (boolean)

Campos usados pelo sistema:
## Tabela `messages`

- `id`
- `name`
- `content`
- `image_url` (opcional)
- `to` (nullable, para sussurro)
- `image_url` (nullable)
- `reply_to` (nullable)
- `reply_preview` (json/jsonb nullable)
- `created_at`

### Tabela `online_users`

Campos usados:
## Tabela `online_users`

- `name` (idealmente único)
- `last_seen`
- `typing` (opcional)
- `typing_room` (opcional)
- `updated_at` (opcional, dependendo do schema)

## Tabela `user_profiles`

### Storage
- `username` (chave única)
- `display_name`
- `avatar_url`
- `updated_at`

- Bucket: `chat-images`
- Objetos com URL pública para renderização/abertura no chat.
## Tabela `private_channels`

- `id`
- `room` (nome da sala)
- `user1`
- `user2`
- `last_activity`
- restrição de unicidade por dupla (`user1`,`user2`) via regra da instância

## Tabela `private_messages`

- `id`
- `channel_id`
- `sender`
- `message`
- `image_url` (nullable)
- `reply_to` (nullable)
- `reply_preview` (json/jsonb nullable)
- `created_at`

## Buckets do Supabase Storage

- `chat-images`
- `profile-avatars`

---

## Como rodar
## 8) Como rodar

### Deploy recomendado (Vercel)
## Recomendado (Vercel)

1. Conectar este repositório.
2. Configurar as env vars.
3. Fazer deploy.
1. Importar o repositório no Vercel.
2. Configurar variáveis de ambiente.
3. Deploy.

### Execução local (ambiente compatível com funções serverless)
## Local

```bash
npm install
vercel dev
```

> Se não tiver Vercel CLI:
>
> ```bash
> npm i -g vercel
> ```

---

## 9) Comandos de chat disponíveis para o usuário

- `mensagem normal` → envia no público.
- `/s @usuario mensagem` → sussurro no público.
- `/c @usuario sala` → cria sala privada.
- `/entrar sala` → entra na sala privada.
- `/sair` → volta ao público.
- `/clear all` → limpeza total (somente admin, com confirmação).

---

## Segurança e limitações atuais
## 10) Limitações e observações importantes

- Autenticação simples via `LOGIN_USERS` (adequada para uso interno básico, não enterprise).
- Token salvo em `sessionStorage` sem middleware robusto de autorização nos endpoints.
- Upload usa `SUPABASE_SERVICE_ROLE_KEY` (deve permanecer protegido no ambiente de deploy).
- Projeto sem suíte de testes automatizados no momento.
- Autenticação é simples (comparação direta de senha na tabela `users`).
- Token gerado no login é armazenado no front e não há middleware robusto de autorização por token em todas as rotas.
- `SERVICE_ROLE_KEY` é necessária em rotas de escrita sensíveis; deve ficar somente no backend.
- Atualização em tempo “quase real” é por polling, não por websocket/realtime.

---

## Roadmap sugerido
## 11) Versão final

Este README foi escrito como documentação final do projeto:

- Adotar autenticação robusta com validação de token no backend.
- Adicionar autorização por rota/endpoint.
- Implementar rate limit e validações adicionais de payload.
- Criar testes automatizados para APIs.
- Renomear arquivo principal do chat para nome semântico.
  
**v1.0.2026.03.07 — Final Build by fragass**
