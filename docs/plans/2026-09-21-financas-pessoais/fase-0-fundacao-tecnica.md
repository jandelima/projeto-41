# Fase 0 — Fundação técnica

> **Para o agente:** leia [`00-plano-mestre.md`](00-plano-mestre.md) antes desta
> fase. Este documento é a fonte de verdade da fase 0. Nenhuma tabela do módulo
> de finanças é criada aqui — esta fase só prepara o terreno.

- **Depende de:** nada
- **Habilita:** todas as demais fases
- **Entregável:** o app continua se comportando exatamente como hoje, mas com
  migrações versionadas, helpers de centavos, rotas modularizadas e contratos
  compartilhados com o frontend.
- **Decisões aplicadas:** D19, D26, D27, D28

## Por que esta fase existe

Três limitações do código atual inviabilizam um módulo do tamanho do planejado:

1. **Não há sistema de migração.** `migrate(db)` em `packages/db/src/index.ts` é
   um único `db.exec()` com `CREATE TABLE IF NOT EXISTS` para as 9 tabelas, mais
   um helper `ensureColumn` que faz `PRAGMA table_info` + `ALTER TABLE ADD
   COLUMN`. Isso adiciona coluna, mas **não** altera `CHECK`, não renomeia, não
   remove e não tem ordem nem histórico.
2. **`app.ts` concentra ~30 rotas inline em 261 linhas.** O módulo dobraria o
   arquivo.
3. **`apps/web` duplica à mão os tipos de contrato** em `src/lib/types.ts`. Com
   ~15 entidades novas, manter duas cópias é garantia de divergência.

## Escopo

**Entra:** runner de migrações, helpers monetários, plugins Fastify, contratos
compartilhados.

**Não entra:** nenhuma tabela, rota ou tela do módulo de finanças. Nenhuma
mudança de comportamento visível ao usuário. As tabelas antigas de investimento
**continuam em `REAL`** (D19) — esta fase não as converte.

---

### Task 1: Sistema de migrações versionadas

**Files:**
- Create: `packages/db/src/migrations/index.ts`
- Create: `packages/db/src/migrations/runner.ts`
- Create: `packages/db/src/migrations/runner.test.ts`
- Create: `packages/db/src/migrations/001-baseline.ts`
- Modify: `packages/db/src/index.ts`

**Steps:**

1. Criar a tabela de controle em `runner.ts`:
   `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`.
2. Definir o tipo de uma migração:
   `type Migration = { version: number; name: string; up: (db: Database) => void }`.
   Sem `down` — o app é local, o caminho de volta é restaurar backup.
3. Implementar `runMigrations(db, migrations)`: ordena por `version`, lê as
   versões já aplicadas, e para cada pendente executa `up` **e** o `INSERT` em
   `schema_migrations` **dentro de uma mesma transação**. Falha em uma migração
   aborta o processo inteiro com erro descritivo contendo versão e nome.
4. Validar na carga que não existem versões duplicadas nem buracos na sequência,
   lançando erro imediato se houver.
5. Implementar o helper `rebuildTable(db, { table, createSql, columns })` para o
   caso que `ensureColumn` não cobre (alterar `CHECK`, remover coluna, mudar
   tipo): `PRAGMA foreign_keys=OFF` → criar `table__new` → `INSERT INTO
   table__new (cols) SELECT cols FROM table` → `DROP TABLE table` → `ALTER TABLE
   table__new RENAME TO table` → recriar índices → `PRAGMA foreign_keys=ON`.
   Documentar no topo do arquivo que ele **deve** rodar dentro da transação da
   migração. Este helper é o que atende R-01.
6. Criar `001-baseline.ts` como migração vazia que apenas marca o esquema atual
   como versão 1 — o `migrate()` existente continua responsável pelas tabelas
   legadas e roda **antes** do runner.
7. Em `createDatabase()`, chamar `migrate(db)` como hoje e em seguida
   `runMigrations(db, migrations)`.
8. Testes em `runner.test.ts`, com `createDatabase(":memory:")`: aplica
   pendentes na ordem; não reaplica o que já rodou; falha de uma migração faz
   rollback e não grava a versão; versão duplicada é rejeitada; `rebuildTable`
   preserva dados e troca um `CHECK`.
9. Commit: `feat(db): add versioned migration runner`

---

### Task 2: Helpers monetários em centavos

**Files:**
- Create: `packages/finance/src/money.ts`
- Create: `packages/finance/src/money.test.ts`
- Modify: `packages/finance/src/index.ts`

**Steps:**

1. Implementar as conversões de fronteira: `toCents(value: number): number`
   (arredondamento half-up, não truncamento) e `fromCents(cents: number):
   number`. São usadas **só** na conversão entre o módulo de finanças (centavos)
   e o de investimentos (`REAL`).
2. Implementar `splitCents(total: number, parts: number): number[]`: divide em
   `parts` valores iguais e joga **todo o resto na primeira posição**, conforme
   6.3 do plano mestre. `splitCents(10000, 3)` devolve `[3334, 3333, 3333]`.
   Garantir por construção que a soma é sempre igual ao total.
3. Implementar `sumCents(values: number[]): number` e
   `allocateByRatio(total: number, ratios: number[]): number[]` — o segundo é
   usado pela divisão-alvo proporcional à renda (6.4) e também precisa fechar
   exatamente no total, com o resto indo para a maior fração (método do maior
   resto).
4. Implementar `parseCurrencyInput(text: string): number | null`, aceitando as
   formas que o usuário digita em pt-BR: `1.234,56`, `1234,56`, `1234.56`,
   `R$ 1.234,56`, `1234`. Devolve centavos ou `null` se não for parseável.
5. Não colocar formatação de exibição aqui — formatação vive em
   `apps/web/src/lib/format.ts` e precisa honrar o modo privacidade (R-04).
6. Testes cobrindo: arredondamento de `.005`, `splitCents` fechando o total para
   1..24 parcelas, `allocateByRatio` com proporções 1/3 e 2/3, entradas
   inválidas em `parseCurrencyInput`, e valores negativos.
7. Commit: `feat(finance): add integer-cents money helpers`

---

### Task 3: Modularizar as rotas em plugins Fastify

**Files:**
- Create: `apps/api/src/routes/portfolio.routes.ts`
- Create: `apps/api/src/routes/operations.routes.ts`
- Create: `apps/api/src/routes/positions.routes.ts`
- Create: `apps/api/src/routes/prices.routes.ts`
- Create: `apps/api/src/routes/icons.routes.ts`
- Create: `apps/api/src/routes/import-export.routes.ts`
- Create: `apps/api/src/routes/index.ts`
- Modify: `apps/api/src/app.ts`

**Steps:**

1. Definir em `routes/index.ts` o contrato de um plugin de rotas:
   `type RouteDeps = { db: AppDatabase; priceService: PriceService; iconService: IconService }`
   e `type RoutePlugin = (app: FastifyInstance, deps: RouteDeps) => void`.
2. Mover as rotas existentes de `app.ts` para os arquivos acima, **agrupadas por
   recurso e sem alterar path, método, validação, códigos de status ou formato
   de resposta**. Esta é uma refatoração pura.
3. Manter em `app.ts` apenas: CORS, o parser de `text/csv`, o error handler
   global, o registro dos plugins e o serviço de arquivos estáticos do frontend.
4. Preservar a convenção de que mutações devolvem o agregado recalculado
   (`{ ok: true, portfolios }`) — é dela que o frontend depende para atualizar
   em uma única ida ao servidor.
5. Rodar `npm test` e confirmar que `apps/api/src/app.test.ts` passa **sem
   nenhuma alteração no arquivo de teste**. Se o teste precisar mudar, a
   refatoração alterou comportamento e está errada.
6. Commit: `refactor(api): split inline routes into per-resource plugins`

---

### Task 4: Compartilhar contratos com o frontend

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/tsconfig.json`
- Modify: `apps/web/vite.config.ts`
- Delete: `apps/web/src/lib/types.ts`
- Modify: arquivos de `apps/web/src` que importam de `lib/types`

**Steps:**

1. Adicionar `@projeto41/contracts` às dependências de `apps/web` e garantir que
   o alias de path já definido em `tsconfig.base.json` seja resolvido também
   pelo Vite (`resolve.alias`), já que os pacotes são consumidos como
   `./src/index.ts` sem build.
2. Conferir tipo a tipo se `lib/types.ts` diverge de `packages/contracts`. Onde
   divergir, **o contrato vence**; ajustar o consumo no frontend.
3. Substituir os imports e apagar `lib/types.ts`.
4. Confirmar que o bundle não passou a carregar `zod` desnecessariamente: o
   frontend deve importar **apenas tipos** (`import type`), para que a validação
   continue sendo responsabilidade do servidor e o Zod seja eliminado do bundle.
5. Rodar `npm run typecheck` e `npm run build`; comparar o tamanho do bundle
   antes e depois e registrar no commit se houve variação relevante.
6. Commit: `refactor(web): consume shared contracts package`

---

## Critérios de aceite

- `npm test`, `npm run typecheck`, `npm run lint` e `npm run build` passam.
- Nenhum teste existente precisou ser alterado.
- O app roda com `npm run dev` e todas as telas atuais funcionam como antes.
- Um banco criado antes da fase 0 abre sem erro e ganha a linha de versão em
  `schema_migrations`.
- Um banco novo é criado do zero sem erro.
- `rebuildTable` tem teste provando que troca um `CHECK` preservando os dados.
- `splitCents` tem teste provando que a soma fecha para 1 a 24 parcelas.
- `apps/web/src/lib/types.ts` não existe mais e nada importa dele.
- O bundle do frontend não contém `zod`.
