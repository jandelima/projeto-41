# Projeto 41 Webapp Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Construir um webapp local que importe `Projeto 41.xlsx` e substitua
suas funcionalidades financeiras com calculos testados, SQLite, atualizacao
automatica de precos e uma interface polida.

**Architecture:** Monorepo TypeScript com `apps/web`, `apps/api` e pacotes
compartilhados para banco, contratos e regras financeiras. O backend Fastify e
a unica camada com acesso ao SQLite e provedores; o React consome contratos
Zod compartilhados.

**Tech Stack:** pnpm workspaces, TypeScript, React, Vite, Fastify, SQLite,
Drizzle ORM, Zod, Tailwind CSS, Recharts, Vitest e Playwright.

## Premissas De Execucao

- Executar no WSL com Node.js LTS.
- Inicializar Git antes de criar um worktree; o diretorio ainda nao e um repo.
- Nunca adicionar `Projeto 41.xlsx`, bancos, backups ou `.env` ao Git.
- Usar TDD em todas as regras financeiras e integracoes.
- Manter o servidor em `127.0.0.1`.

### Task 1: Inicializar Repositorio E Monorepo

**Files:**
- Create: `.gitignore`
- Create: `.env.example`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.workspace.ts`
- Create: `README.md`

**Steps:**
1. Executar `git init` e criar uma branch de trabalho.
2. Adicionar ao `.gitignore`: `Projeto 41.xlsx`, `*.sqlite*`, `data/`,
   `backups/`, `.env`, `node_modules/`, `dist/`, `playwright-report/`.
3. Criar os workspaces `apps/*` e `packages/*` com scripts `dev`, `build`,
   `test`, `lint` e `typecheck`.
4. Instalar dependencias e executar `pnpm typecheck`.
5. Confirmar que `git status --short` nao lista a planilha.
6. Commit: `chore: initialize projeto 41 monorepo`.

### Task 2: Criar Contratos Financeiros Basicos

**Files:**
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/assets.ts`
- Create: `packages/contracts/src/operations.ts`
- Test: `packages/contracts/src/operations.test.ts`

**Steps:**
1. Escrever testes falhando para moedas, classes de ativo, tipo de operacao,
   precisao decimal e validacao de compra/venda.
2. Executar `pnpm vitest packages/contracts/src/operations.test.ts`.
3. Implementar schemas Zod e tipos inferidos.
4. Reexecutar o teste e `pnpm typecheck`.
5. Commit: `feat: define financial contracts`.

### Task 3: Implementar Regras De Carteira Com TDD

**Files:**
- Create: `packages/finance/package.json`
- Create: `packages/finance/src/portfolio.ts`
- Create: `packages/finance/src/allocation.ts`
- Create: `packages/finance/src/planning.ts`
- Test: `packages/finance/src/portfolio.test.ts`
- Test: `packages/finance/src/allocation.test.ts`
- Test: `packages/finance/src/planning.test.ts`

**Steps:**
1. Testar quantidade como compras menos vendas.
2. Testar investimento e preco medio usando somente compras.
3. Testar `Valor vendido` como soma dos valores de venda.
4. Testar saldo, conversao USD/BRL, PnL, dividendos e pesos.
5. Testar alocacao real versus ideal da aba `MODELO`.
6. Testar projecoes da aba `Planning`, incluindo inflacao.
7. Implementar o minimo para passar cada grupo de testes.
8. Executar `pnpm --filter @projeto41/finance test`.
9. Commit: `feat: implement tested portfolio calculations`.

### Task 4: Criar Schema SQLite E Repositorios

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/src/schema.ts`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/repositories/*.ts`
- Test: `packages/db/src/repositories/repositories.test.ts`

**Steps:**
1. Testar persistencia em SQLite temporario.
2. Modelar `assets`, `operations`, `manual_positions`, `fixed_income`,
   `contributions`, `allocation_targets`, `prices`, `price_attempts`,
   `snapshots`, `snapshot_prices` e `imports`.
3. Adicionar constraints de moeda, operacao, unicidade e datas.
4. Implementar repositorios transacionais.
5. Executar testes com banco temporario e migracoes.
6. Commit: `feat: add sqlite financial data model`.

### Task 5: Construir Leitor Seguro Do XLSX

**Files:**
- Create: `apps/api/src/import/xlsx-reader.ts`
- Create: `apps/api/src/import/workbook-types.ts`
- Test: `apps/api/src/import/xlsx-reader.test.ts`
- Create: `apps/api/test/fixtures/workbook-synthetic.xlsx`

**Steps:**
1. Criar fixture sintetica sem dados financeiros reais.
2. Testar leitura de abas, tabelas, formulas, valores e datas.
3. Implementar o leitor com biblioteca XLSX estruturada.
4. Garantir que testes e logs nao exibam valores da planilha real.
5. Executar o teste isolado.
6. Commit: `feat: add safe xlsx workbook reader`.

### Task 6: Mapear A Planilha Para O Dominio

**Files:**
- Create: `apps/api/src/import/projeto41-mapper.ts`
- Create: `apps/api/src/import/manual-position-map.ts`
- Test: `apps/api/src/import/projeto41-mapper.test.ts`

**Steps:**
1. Testar mapeamento de `Operations`, `Operacoes`, `Fixa`, `History`,
   `Aportes`, `MODELO`, `Planning` e listas de ativos.
2. Mapear as parcelas manuais para os nomes aprovados no design.
3. Tratar `Outros titulos` e Tesouro BTG como posicoes agregadas.
4. Preservar dividendos B3 como total manual por ativo.
5. Executar os testes com dados sinteticos equivalentes.
6. Commit: `feat: map workbook data to application domain`.

### Task 7: Importacao Transacional E Relatorio De Conciliacao

**Files:**
- Create: `apps/api/src/import/import-service.ts`
- Create: `apps/api/src/import/reconciliation.ts`
- Create: `apps/api/src/cli/import-workbook.ts`
- Test: `apps/api/src/import/import-service.test.ts`
- Test: `apps/api/src/import/reconciliation.test.ts`

**Steps:**
1. Testar importacao idempotente e rollback integral em erro.
2. Testar conciliacao de quantidades, preco medio, classes e patrimonio.
3. Implementar modo `--dry-run` que nao grava dados.
4. Implementar confirmacao explicita para gravacao definitiva.
5. Executar primeiro o dry-run com a planilha real localmente.
6. Corrigir divergencias antes da importacao definitiva.
7. Commit: `feat: import and reconcile projeto 41 workbook`.

### Task 8: Implementar Provedores De Precos

**Files:**
- Create: `apps/api/src/prices/provider.ts`
- Create: `apps/api/src/prices/crypto-provider.ts`
- Create: `apps/api/src/prices/brapi-provider.ts`
- Create: `apps/api/src/prices/bcb-provider.ts`
- Test: `apps/api/src/prices/*.test.ts`

**Steps:**
1. Testar parsing do servidor cripto usando respostas HTTP simuladas.
2. Testar brapi com um ativo por requisicao, token e erros HTTP.
3. Testar USD/BRL pela API estruturada do Banco Central.
4. Implementar timeout, retry limitado e validacao Zod.
5. Nunca substituir um preco valido por resposta invalida.
6. Executar os testes sem rede externa.
7. Commit: `feat: add resilient price providers`.

### Task 9: Orquestrar Cache E Agendamentos

**Files:**
- Create: `apps/api/src/prices/price-service.ts`
- Create: `apps/api/src/jobs/scheduler.ts`
- Create: `apps/api/src/jobs/market-hours.ts`
- Create: `apps/api/src/jobs/daily-snapshot.ts`
- Test: `apps/api/src/jobs/*.test.ts`

**Steps:**
1. Testar cripto a cada 15 minutos.
2. Testar B3 a cada 30 minutos somente durante o pregao.
3. Testar atualizacao manual forcada.
4. Testar snapshot as `23:59` em `America/Fortaleza`.
5. Testar unicidade de snapshot por data e uso do ultimo preco valido.
6. Implementar scheduler com relogio injetavel para testes.
7. Commit: `feat: schedule prices and daily snapshots`.

### Task 10: Criar API Fastify

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/src/routes/*.ts`
- Test: `apps/api/src/routes/*.test.ts`

**Steps:**
1. Testar healthcheck e bind configurado para `127.0.0.1`.
2. Criar rotas de dashboard, ativos, operacoes, posicoes manuais, renda fixa,
   dividendos, aportes, planejamento, alocacao, historico e precos.
3. Validar request e response com contratos Zod.
4. Recalcular derivados apos qualquer mutacao.
5. Padronizar erros sem vazar caminhos, token ou dados sensiveis.
6. Executar testes de injecao Fastify.
7. Commit: `feat: expose local financial api`.

### Task 11: Criar Fundacao Visual

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/app/App.tsx`
- Create: `apps/web/src/styles/index.css`
- Create: `apps/web/src/components/ui/*`
- Create: `apps/web/src/components/layout/*`
- Test: `apps/web/src/app/App.test.tsx`

**Steps:**
1. Testar navegacao principal e estados de carregamento/erro.
2. Configurar Tailwind, tokens de cor, tipografia e tema escuro.
3. Criar shell responsivo, sidebar, header e componentes de dados.
4. Verificar contraste, foco por teclado e labels acessiveis.
5. Executar testes e build do frontend.
6. Commit: `feat: add polished application shell`.

### Task 12: Implementar Dashboard E Status De Precos

**Files:**
- Create: `apps/web/src/pages/DashboardPage.tsx`
- Create: `apps/web/src/features/dashboard/*`
- Create: `apps/web/src/features/prices/*`
- Test: `apps/web/src/pages/DashboardPage.test.tsx`

**Steps:**
1. Testar cards, distribuicao, reserva, historico e estados de cotacao.
2. Implementar graficos com tooltips e formatacao BRL/USD.
3. Implementar botao manual com progresso por provedor.
4. Exibir fonte, horario e estado atualizado/atrasado/indisponivel.
5. Executar teste visual responsivo em larguras desktop e mobile.
6. Commit: `feat: build portfolio dashboard`.

### Task 13: Implementar Carteiras E Operacoes

**Files:**
- Create: `apps/web/src/pages/CryptoPage.tsx`
- Create: `apps/web/src/pages/B3Page.tsx`
- Create: `apps/web/src/features/operations/*`
- Create: `apps/web/src/features/portfolios/*`
- Test: `apps/web/src/features/operations/*.test.tsx`

**Steps:**
1. Testar tabelas, filtros e formularios de compra/venda.
2. Implementar criar, editar e excluir operacoes.
3. Exibir preco medio, valor vendido, dividendos, PnL e pesos.
4. Implementar edicao manual de dividendos acumulados B3.
5. Confirmar recalculo imediato apos mutacoes.
6. Commit: `feat: add crypto and b3 portfolio workflows`.

### Task 14: Implementar Posicoes Manuais E Renda Fixa

**Files:**
- Create: `apps/web/src/pages/ManualPositionsPage.tsx`
- Create: `apps/web/src/features/manual-positions/*`
- Test: `apps/web/src/features/manual-positions/*.test.tsx`

**Steps:**
1. Testar edicao das posicoes nomeadas.
2. Implementar agrupamento por Dolar, Caixa BR, Reserva e Renda fixa.
3. Mostrar investimento, valor atual, rentabilidade e participacao.
4. Recalcular dashboard apos salvar.
5. Commit: `feat: manage cash reserve and fixed income`.

### Task 15: Implementar Aportes, Planejamento E Alocacao

**Files:**
- Create: `apps/web/src/pages/ContributionsPage.tsx`
- Create: `apps/web/src/pages/PlanningPage.tsx`
- Create: `apps/web/src/pages/AllocationPage.tsx`
- Create: `apps/web/src/features/contributions/*`
- Create: `apps/web/src/features/planning/*`
- Test: `apps/web/src/pages/{Contributions,Planning,Allocation}Page.test.tsx`

**Steps:**
1. Testar grade semanal/mensal e totais anuais.
2. Testar inputs e resultados do simulador.
3. Testar comparacao ideal versus real.
4. Implementar as tres telas com graficos e tabelas responsivas.
5. Commit: `feat: add contributions planning and allocation`.

### Task 16: Implementar Historico E Exportacao

**Files:**
- Create: `apps/web/src/pages/HistoryPage.tsx`
- Create: `apps/web/src/features/history/*`
- Create: `apps/api/src/export/export-service.ts`
- Create: `apps/api/src/backup/backup-service.ts`
- Test: `apps/api/src/{export,backup}/*.test.ts`

**Steps:**
1. Testar grafico e tabela de snapshots importados e novos.
2. Testar exportacao de dados sem segredos.
3. Testar backup antes de migracoes.
4. Implementar download local e retencao configuravel de backups.
5. Commit: `feat: add history export and backups`.

### Task 17: Validar Fluxos End-To-End

**Files:**
- Create: `e2e/import.spec.ts`
- Create: `e2e/operations.spec.ts`
- Create: `e2e/prices.spec.ts`
- Create: `e2e/snapshot.spec.ts`
- Create: `playwright.config.ts`

**Steps:**
1. Testar importacao com fixture sintetica.
2. Testar compra, venda, dividendo e posicao manual.
3. Testar atualizacao manual e fallback de preco.
4. Testar criacao idempotente do snapshot diario.
5. Executar `pnpm test`, `pnpm typecheck`, `pnpm lint` e `pnpm build`.
6. Commit: `test: cover critical financial workflows`.

### Task 18: Conciliar Dados Reais E Preparar Uso Local

**Files:**
- Modify: `README.md`
- Create: `docs/operations/local-runbook.md`
- Create: `docs/operations/data-migration-checklist.md`

**Steps:**
1. Configurar `BRAPI_TOKEN` localmente sem gravar o valor.
2. Executar o importador em dry-run sobre `Projeto 41.xlsx`.
3. Comparar o relatorio de conciliacao com a planilha.
4. Fazer backup e executar a importacao definitiva.
5. Iniciar o app e validar todas as paginas com os dados reais.
6. Confirmar bind somente em `127.0.0.1`.
7. Documentar inicializacao, backup, restauracao e atualizacao.
8. Executar a suite completa uma ultima vez.
9. Commit: `docs: add local operations and migration runbook`.

## Criterios De Aceite

- A planilha e importada integralmente sem ser modificada.
- Dashboard e consolidacoes conciliam com os dados de origem.
- Operacoes recalculam todos os derivados automaticamente.
- Preco medio usa somente compras e vendas aparecem como `Valor vendido`.
- Cripto, B3 e USD/BRL atualizam nas frequencias aprovadas.
- Falhas mantem o ultimo preco valido e ficam visiveis.
- Snapshot diario e criado uma vez as `23:59`.
- Todas as areas funcionais da planilha existem no app.
- O app escuta somente em localhost e nao inclui dados confidenciais no Git.
- Testes, typecheck, lint, build e fluxos Playwright passam.
