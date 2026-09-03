# Fluxo | Central de Devolucoes

Sistema web para gerenciamento de devolucoes, com areas separadas para clientes e atendentes.

## O que foi utilizado

- **HTML5**: estrutura semantica das telas, formularios, tabelas e navegacao.
- **CSS3**: layout responsivo, variaveis de cores, estados visuais, grid e media queries.
- **JavaScript puro (ES6+)**: autenticacao demonstrativa, troca de perfis, renderizacao das telas, formularios, filtros, atualizacao de status e persistencia dos dados.
- **LocalStorage**: banco de dados local do navegador para manter sessoes, produtos, pedidos e devolucoes.
- **Evento `storage`**: atualiza outras abas abertas quando produtos, pedidos ou devolucoes sao alterados.
- **Git e GitHub**: versionamento e publicacao do projeto.

O projeto nao utiliza frameworks, bibliotecas externas, banco de dados remoto ou servidor backend.

## Estrutura

```text
.
├── shopee-returns-system.html  # Pagina principal da aplicacao
├── assets/
│   ├── css/
│   │   └── app.css             # Estilos e responsividade
│   └── js/
│       └── app.js              # Regras, dados e interacoes
└── README.md                   # Documentacao do projeto
```

## Perfis de acesso

### Cliente

- Visualiza o painel pessoal.
- Consulta suas devolucoes.
- Cria uma nova solicitacao.
- Seleciona pedidos e produtos cadastrados.
- Acessa seus dados e perfil.

### Atendente

- Visualiza o painel operacional.
- Consulta a fila de devolucoes.
- Filtra solicitacoes por texto e status.
- Avanca o status de uma solicitacao de `Pendente` para `Em analise` e depois para `Aprovada`.
- Gerencia pedidos e produtos no banco local.

## Credenciais de demonstracao

| Perfil | E-mail | Senha |
|---|---|---|
| Cliente | `cliente@fluxo.com` | `123456` |
| Atendente | `atendente@fluxo.com` | `123456` |

O botao de troca no canto superior direito encerra a sessao atual e solicita um novo login para o outro perfil.

## Banco de dados local

A area **Banco de dados** permite:

- Adicionar produtos com nome, preco e estoque.
- Adicionar pedidos vinculados a produtos e clientes.
- Consultar produtos, pedidos e devolucoes existentes.
- Usar os registros cadastrados nas novas solicitacoes.

Os dados sao armazenados no navegador com estas chaves:

- `fluxo_user`: sessao e perfil autenticado.
- `fluxo_returns_db`: devolucoes.
- `fluxo_products_db`: produtos.
- `fluxo_orders_db`: pedidos.

Como os dados estao no `localStorage`, eles ficam restritos ao navegador e ao dispositivo atual. Limpar os dados do navegador remove os registros. A sincronizacao entre abas funciona no mesmo navegador, mas ainda nao e uma sincronizacao entre usuarios ou dispositivos.

## Como executar

1. Clone ou baixe o repositorio.
2. Abra `shopee-returns-system.html` diretamente no navegador, ou use a extensao **Live Server** no VS Code.
3. Entre usando uma das credenciais de demonstracao.

Como os arquivos CSS e JavaScript usam caminhos relativos, mantenha a estrutura de pastas original.

## Fluxo principal

1. O usuario escolhe o perfil no login.
2. O sistema valida as credenciais de demonstracao.
3. O painel correspondente e carregado.
4. O cliente cria uma solicitacao escolhendo pedido e produto.
5. A solicitacao e salva no banco local.
6. O atendente visualiza a mesma base e atualiza o status.
7. Outras abas recebem a alteracao por meio do evento `storage`.

## Publicacao

Repositorio GitHub:

https://github.com/gabrielsantanaalmeida15-hash/Codigo-de-returns-shopee

## Backend de producao

A pasta `backend/` contem uma API Express pronta para substituir o `localStorage` quando o ambiente de producao estiver configurado.

### Estrutura do backend

```text
backend/
├── src/
│   ├── db.js              # Pool PostgreSQL
│   └── server.js          # API, autenticacao e autorizacao
├── db/schema.sql          # Tabelas, enums, indices e relacionamentos
├── tests/api.test.js      # Testes de endpoints protegidos
├── nginx/default.conf     # HTTPS e proxy reverso
├── Dockerfile
├── docker-compose.yml     # PostgreSQL local
├── docker-compose.prod.yml
├── .env.example
└── package.json
```

### Seguranca implementada

- JWT com expiracao de 8 horas.
- Senhas armazenadas com `bcrypt` e custo 12.
- Controle de acesso por papel: `client` e `agent`.
- `helmet`, CORS configuravel e rate limit no login.
- Validacao de payloads com Zod.
- Queries parametrizadas contra SQL injection.
- Upload limitado a 5 arquivos de ate 10 MB, aceitando imagem e video.
- Nome aleatorio para arquivos enviados, sem expor o nome original no caminho.
- Auditoria de criacao, alteracao de status e upload.
- Notificacao persistida quando o atendente altera uma devolucao.

### Executar a API localmente

```bash
cd backend
copy .env.example .env
docker compose up -d postgres
npm install
npm run dev
```

API: `http://localhost:3000`

Endpoints principais:

- `GET /health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/products` e `POST /api/products` (atendente)
- `GET /api/orders` e `POST /api/orders` (atendente)
- `GET /api/returns` e `POST /api/returns` (cliente)
- `PATCH /api/returns/:id/status` (atendente)
- `POST /api/returns/:id/attachments`
- `GET /api/notifications`
- `GET /api/audit-logs` (atendente)

### Testes

```bash
cd backend
npm test
```

Os testes verificam que endpoints protegidos rejeitam requisicoes sem token. Para testes completos de integracao, inicie um PostgreSQL de teste e adicione variaveis isoladas no pipeline.

### Deploy com HTTPS

O arquivo `backend/nginx/default.conf` redireciona HTTP para HTTPS e encaminha `/api/` para a API. Em producao:

1. Configure `.env` com uma senha forte, `DATABASE_URL` seguro e `JWT_SECRET` com pelo menos 32 caracteres.
2. Coloque o certificado e a chave em `backend/certs/fullchain.pem` e `backend/certs/privkey.pem`.
3. Execute `docker compose -f docker-compose.prod.yml up -d --build` dentro de `backend`.
4. Use certificados reais, renovacao automatica e backups do PostgreSQL.

O frontend antigo continua funcional para demonstracao com `localStorage`; a integracao dele com a API deve ser feita em uma etapa seguinte, trocando as funcoes de leitura e escrita locais por chamadas autenticadas.
