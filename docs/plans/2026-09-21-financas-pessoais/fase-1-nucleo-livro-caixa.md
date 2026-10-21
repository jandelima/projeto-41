# Fase 1 — Núcleo do livro-caixa

> **Para o agente:** leia [`00-plano-mestre.md`](00-plano-mestre.md) antes desta
> fase. Este documento é a fonte de verdade da fase 1. As regras das seções 6.1
> (saldos) e 4 (modelo de dados) do plano mestre valem integralmente aqui e não
> podem ser reinterpretadas.

- **Depende de:** fase 0
- **Habilita:** fases 2, 3, 4, 6
- **Entregável:** o usuário cadastra pessoas, contas e categorias, registra
  entradas, saídas e transferências com foto e local, filtra o livro e vê o
  saldo de cada conta e o consolidado.
- **Decisões aplicadas:** D01, D02, D05, D06, D07, D08, D11, D18, D19, D20, D21,
  D24, D29

## Escopo

**Entra:** pessoas, contas (incluindo vale-refeição e dinheiro vivo),
categorias, etiquetas, locais, lançamentos de entrada e saída, transferências
genéricas, status pago/pendente, anexo de foto, filtros, telas separadas de
gastos e entradas, saldo por conta e consolidado, backup/restauração.

**Não entra:** cartão de crédito e fatura (fase 3), parcelamento (fase 3),
dashboard e gráficos (fase 2), orçamento e alvos (fase 2), caixinhas (fase 5),
importação (fase 6), recorrentes (fase 7).

**Contas do tipo `credit_card` não são criáveis nesta fase.** O `CHECK` da
coluna `kind` já nasce com todos os valores previstos no plano mestre para que a
fase 3 não precise de rebuild de tabela (R-01), mas a interface só oferece
`checking`, `savings`, `cash` e `meal_voucher`.

---

### Task 1: Esquema do livro-caixa

**Files:**
- Create: `packages/db/src/migrations/002-ledger-core.ts`
- Modify: `packages/db/src/migrations/index.ts`
- Create: `packages/db/src/migrations/002-ledger-core.test.ts`

**Steps:**

1. Criar as tabelas `people`, `accounts`, `categories`, `tags`, `places`,
   `entries`, `transfers`, `entry_tags` e `attachments` exatamente com as
   colunas, tipos e `CHECK` das seções 4.1 e 4.2 do plano mestre. Todo valor
   monetário é `INTEGER` com sufixo `_cents`.
2. Incluir no `CHECK` de `accounts.kind` **todos** os sete valores previstos
   (`checking`, `savings`, `cash`, `meal_voucher`, `credit_card`, `investment`,
   `goal`), mesmo que a interface desta fase só use quatro.
3. Criar as colunas que as fases seguintes vão usar e que esta fase deixa sempre
   nulas: `statement_month`, `installment_plan_id`, `installment_number`,
   `parent_entry_id`, `refund_of_entry_id`, `external_id`, `import_row_id`,
   `content_hash`, `raw_description`. Declará-las agora evita `ALTER TABLE`
   depois. **Não** criar ainda a FK para `installment_plans` nem para
   `import_rows`, pois essas tabelas não existem — deixar como `INTEGER` solto e
   adicionar a integridade nas fases 3 e 6 via `rebuildTable`.
4. Criar os índices: `(account_id, date)`, `(date)`, `(category_id, date)`,
   `(person_id, date)` e o índice único parcial
   `UNIQUE(account_id, external_id) WHERE external_id IS NOT NULL`.
5. Semear na própria migração: as pessoas `Steylor`, `Bianca` e `Conjunto`
   (esta com `kind='joint'`), e um conjunto inicial de categorias em pt-BR com
   cores distintas — saídas: Mercado, Restaurante, Transporte, Moradia, Saúde,
   Lazer, Assinaturas, Educação, Vestuário, Presentes, Outros; entradas:
   Salário, Freelance, Reembolso, Rendimentos, Outros. Semear **só quando as
   tabelas estiverem vazias**, para não duplicar em banco existente.
6. Testes: o esquema é criado; os índices existem (`PRAGMA index_list`); a
   semeadura roda uma vez e é idempotente; um `INSERT` violando
   `CHECK(kind)` falha; um `INSERT` de `entries` com `kind='transfer'` e
   `category_id` preenchido falha.
7. Commit: `feat(db): add ledger core schema`

---

### Task 2: Contratos Zod do módulo

**Files:**
- Create: `packages/contracts/src/ledger.ts`
- Modify: `packages/contracts/src/index.ts`

**Steps:**

1. Criar os enums primeiro, seguindo a convenção do arquivo existente
   (`xxxSchema` + `export type Xxx = z.infer<...>`): `personKindSchema`,
   `accountKindSchema`, `categoryKindSchema`, `entryKindSchema`,
   `entryStatusSchema`, `paymentMethodSchema`, `transferPurposeSchema`.
2. Criar os schemas de entidade: `personSchema`, `accountSchema`,
   `categorySchema`, `tagSchema`, `placeSchema`, `entrySchema`,
   `transferSchema`.
3. Valores monetários são `z.number().int()` — nunca `z.number()` solto.
   Nomear os campos com sufixo `Cents` no contrato, espelhando o banco.
4. Cor é `z.string().regex(/^#[0-9a-fA-F]{6}$/)`.
5. Data é `z.string().date()`, como já se faz em `operationSchema`.
6. Modelar as regras que o banco não consegue expressar, com `.superRefine`:
   `category_id` obrigatoriamente ausente quando `kind === 'transfer'`;
   `amountCents !== 0`; sinal coerente com o tipo (`expense` negativo, `income`
   positivo).
7. **Exceção de sinal para estorno:** a regra acima não vale quando
   `refundOfEntryId` está preenchido. Um estorno de despesa é um lançamento
   `kind='expense'` com valor **positivo**, e é assim que ele abate a categoria
   em vez de virar receita (plano mestre 6.6). A fase 3 depende disso; deixar a
   exceção pronta agora evita ter que mexer no contrato depois. Incluir teste
   dos dois casos.
8. Criar os schemas de filtro do livro (`entryFilterSchema`) com todos os campos
   da Task 6, todos opcionais, e os de paginação.
9. Commit: `feat(contracts): add ledger schemas`

---

### Task 3: Repositórios de cadastro

**Files:**
- Create: `packages/db/src/repositories/people.ts`
- Create: `packages/db/src/repositories/accounts.ts`
- Create: `packages/db/src/repositories/categories.ts`
- Create: `packages/db/src/repositories/tags.ts`
- Create: `packages/db/src/repositories/places.ts`
- Create: `packages/db/src/repositories/*.test.ts`
- Modify: `packages/db/src/index.ts`

**Steps:**

1. Seguir o padrão existente: funções que recebem a instância `Database`,
   `prepare` com parâmetros nomeados `@campo`, SELECT com alias `snake_case AS
   camelCase`, retorno de `Number(result.lastInsertRowid)` na criação.
2. Cada repositório expõe `list`, `get`, `create`, `update`, `archive`. **Nunca
   `delete` físico** para cadastros que já foram usados em lançamentos —
   arquivar preserva o histórico. `delete` só é permitido se não houver
   lançamento referenciando, e nesse caso é um `delete` de verdade.
3. `places.create` calcula `normalized_name` removendo acentos (NFD), passando
   para minúsculo e retirando pontuação — a mesma normalização de `safeKey()` em
   `apps/api/src/icons/icon-service.ts`, que deve ser extraída para um helper
   compartilhado em vez de duplicada.
4. `places.findOrCreate(name)` resolve por `normalized_name` e é o ponto de
   entrada usado tanto pela UI quanto pela importação da fase 6.
5. `accounts.list` devolve também o saldo atual e o previsto de cada conta,
   calculados pela Task 4 — a UI nunca faz esse cálculo.
6. Registrar os novos repositórios no objeto devolvido por `createDatabase()`.
7. Testes com `:memory:` para cada repositório, incluindo: arquivar não remove;
   `findOrCreate` reaproveita registro com acentuação diferente
   (`Assaí` = `assai`); `delete` é bloqueado quando há lançamento vinculado.
8. Commit: `feat(db): add ledger registry repositories`

---

### Task 4: Repositório de lançamentos e cálculo de saldos

**Files:**
- Create: `packages/db/src/repositories/entries.ts`
- Create: `packages/db/src/repositories/entries.test.ts`
- Create: `packages/db/src/repositories/balances.ts`
- Create: `packages/db/src/repositories/balances.test.ts`
- Modify: `packages/db/src/index.ts`

**Steps:**

1. `entries.create(input)`: resolve `person_id` a partir da conta quando não
   informado (D01), normaliza o sinal de `amount_cents` conforme `kind`, e
   grava. Retorna o id.
2. `entries.createTransfer(input)`: dentro de **uma** `db.transaction()`, cria
   os dois lançamentos com valores opostos, `category_id` nulo e
   `kind='transfer'`, e a linha em `transfers`. Rejeita conta de origem igual à
   de destino. Esta é a única maneira de criar transferência — nunca criar as
   duas pontas soltas.
3. `entries.update` e `entries.remove`: ao mexer numa ponta de transferência, a
   outra é atualizada ou removida junto, na mesma transação. Remover um
   lançamento remove seus anexos em cascata (arquivos tratados na Task 5).
4. `entries.list(filter)`: monta a consulta com os filtros da Task 6, ordena por
   `date DESC, id DESC`, pagina, e devolve junto o total de linhas e a soma do
   período (entradas, saídas e líquido) — a UI não soma nada no cliente.
5. `balances.forAccount(accountId, asOf)`: implementa 6.1 do plano mestre —
   saldo atual usa `status IN ('cleared','reconciled')` e `date <= hoje`; saldo
   previsto inclui `pending` até o fim do período. Contas `credit_card` são
   tratadas pela fase 3; aqui devolvem saldo devedor simples.
6. `balances.consolidated()`: soma as contas com `include_in_net_worth = 1`,
   **excluindo** `credit_card`.
7. Todos os cálculos são derivados por `SUM` (D24). Nenhum saldo é armazenado.
8. Testes: saldo ignora lançamento futuro; saldo previsto o inclui; saldo ignora
   `pending` no atual; transferência não altera o consolidado; remover uma ponta
   remove a outra; soma do período bate com os lançamentos.
9. Commit: `feat(db): add entries repository and derived balances`

---

### Task 5: Anexos de foto

**Files:**
- Create: `apps/api/src/attachments/attachment-service.ts`
- Create: `apps/api/src/attachments/attachment-service.test.ts`
- Create: `apps/api/src/routes/attachments.routes.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `package.json` (raiz e `apps/api`)

**Steps:**

1. Adicionar as dependências `@fastify/multipart`, `sharp` e `file-type`.
   Registrar no README que, no Windows, uma instalação que falhe com
   `Could not load the "sharp" module` se resolve com
   `npm install --include=optional` (R-05).
2. Registrar `@fastify/multipart` com `fileSize` explícito de 15 MB — **o
   padrão de 1 MiB corta foto de celular silenciosamente** (R-06).
3. Receber o upload com `request.file()` e gravar em arquivo temporário com
   `pipeline(part.file, createWriteStream(tmp))` de `node:stream/promises`.
   Nunca usar `toBuffer()` nem `attachFieldsToBody`, que carregam a imagem
   inteira na memória.
4. Em `finally`, apagar o temporário; e se `part.file.truncated` for verdadeiro
   ou vier `FST_REQ_FILE_TOO_LARGE`, apagar o arquivo parcial já escrito e
   responder 413 (R-06).
5. Validar o tipo real por magic bytes com `file-type` (import dinâmico, pois é
   ESM puro), aceitando apenas `image/jpeg`, `image/png`, `image/webp` e
   `image/heic`. A validação definitiva é o reencode pelo `sharp`.
6. Processar com `sharp`: `.autoOrient()` **antes** do resize, depois
   `.resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })` e
   `.webp({ quality: 80 })`. Gerar também a miniatura de 320px. **Não** usar
   `keepMetadata()`/`withMetadata()` — fotos de celular carregam GPS, e o
   comportamento padrão do `sharp` de descartar metadados é exatamente o
   desejado. O original é descartado (D29).
7. Armazenar por conteúdo: `sha256` do arquivo processado, caminho
   `data/attachments/ab/cd/<hash>.webp` e
   `data/attachments/ab/cd/<hash>_thumb.webp`, com dois níveis de fanout —
   diretório plano com dezenas de milhares de arquivos degrada NTFS, Explorer e
   antivírus. Hash repetido reaproveita o arquivo existente.
8. Nunca usar o nome de arquivo enviado pelo cliente para compor caminho
   (`../`, `C:\`, `a.jpg:evil`, `CON`). Guardar o nome original apenas como
   coluna em `attachments`.
9. Servir por `GET /api/attachments/:id` e `GET /api/attachments/:id/thumb`,
   resolvendo o caminho pelo banco e nunca pela URL, com `path.resolve` +
   verificação de prefixo, `Content-Type` vindo do valor **armazenado** e
   `X-Content-Type-Options: nosniff`. `Cache-Control: private, max-age=31536000,
   immutable`, já que o nome é o hash.
10. `DELETE /api/attachments/:id` remove a linha; o arquivo só é apagado se
    nenhuma outra linha referenciar o mesmo hash.
11. Testes: upload gera webp e miniatura; EXIF de orientação é aplicado e os
    metadados somem do resultado; upload do mesmo conteúdo duas vezes reaproveita
    o arquivo; arquivo truncado não deixa lixo em disco; `image/svg+xml` é
    rejeitado; caminho com `..` no id não escapa do diretório.
12. Commit: `feat(api): add receipt photo attachments`

---

### Task 6: Rotas do módulo

**Files:**
- Create: `apps/api/src/routes/ledger.routes.ts`
- Create: `apps/api/src/routes/ledger.routes.test.ts`
- Modify: `apps/api/src/routes/index.ts`

**Steps:**

1. Cadastros, todos com o mesmo formato:
   `GET|POST /api/ledger/people`, `PUT|DELETE /api/ledger/people/:id`, e o
   equivalente para `accounts`, `categories`, `tags` e `places`.
2. Livro: `GET /api/ledger/entries` com os filtros
   `from`, `to`, `kind`, `accountId`, `personId`, `categoryId[]`, `tagId[]`,
   `placeId`, `status`, `search` (texto livre em descrição e local),
   `minCents`, `maxCents`, `page`, `pageSize`. Todos opcionais, validados por
   `entryFilterSchema`.
3. `POST /api/ledger/entries`, `PUT /api/ledger/entries/:id`,
   `DELETE /api/ledger/entries/:id`.
4. `POST /api/ledger/transfers` para o par de lançamentos.
5. `GET /api/ledger/balances` devolve saldo atual e previsto por conta mais o
   consolidado.
6. Seguir a convenção do app: mutação devolve o agregado recalculado — aqui,
   `{ ok: true, balances }` — para o frontend atualizar em uma ida só.
7. Mensagens de erro em português **sem acento**, como no restante de
   `apps/api`. O error handler global já cuida de `ZodError`.
8. Testes com `app.inject`, cobrindo: criação e listagem; filtro por período e
   por categoria; transferência criando duas linhas; validação rejeitando
   categoria em transferência; 404 em id inexistente.
9. Commit: `feat(api): add ledger routes`

---

### Task 7: Telas de cadastro

**Files:**
- Create: `apps/web/src/pages/finance/Accounts.tsx`
- Create: `apps/web/src/pages/finance/Categories.tsx`
- Create: `apps/web/src/components/ColorPicker.tsx`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/styles/index.css`

**Steps:**

1. Em `apps/web/src/app/App.tsx`, acrescentar ao array `nav` um grupo
   **"Finanças"** com os itens
   Transações, Gastos, Entradas, Contas e Categorias, estender o union `Page` e
   a cadeia de render. Usar ícones do `lucide-react` já presente.
2. `Accounts.tsx`: lista as contas agrupadas por pessoa, cada uma com saldo
   atual e previsto, usando `Card`/`Panel` e `AnimatedNumber` já existentes.
   Criar e editar pelo `Drawer`, que é a superfície padrão de formulário do app.
3. O formulário de conta tem nome, pessoa, tipo, instituição, cor, saldo inicial
   e data inicial. Os campos de cartão (`closing_day`, `due_day`,
   `credit_limit_cents`) **não** aparecem nesta fase.
4. `Categories.tsx`: duas listas lado a lado, saídas e entradas, cada item com
   bolinha da cor, nome e ações. Arquivar em vez de excluir quando houver
   lançamento.
5. `ColorPicker.tsx`: seletor com roda de cor. Usar `<input type="color">` como
   base — é nativo, acessível e dá a roda RGB pedida — acompanhado de uma
   paleta de atalhos com as cores do tema (`useTheme().colors.series`) e de um
   campo de hex digitável. Nenhuma biblioteca nova.
6. Estilos: adicionar em `index.css` apenas classes novas com prefixo `fin-`,
   usando exclusivamente os tokens existentes (`--surface`, `--border`,
   `--text-muted`, `--accent`…). Nenhuma cor literal, para o tema claro
   continuar funcionando.
7. Commit: `feat(web): add accounts and categories screens`

---

### Task 8: Livro de transações

**Files:**
- Create: `apps/web/src/pages/finance/Transactions.tsx`
- Create: `apps/web/src/pages/finance/Expenses.tsx`
- Create: `apps/web/src/pages/finance/Income.tsx`
- Create: `apps/web/src/components/finance/EntryTable.tsx`
- Create: `apps/web/src/components/finance/EntryFilters.tsx`
- Create: `apps/web/src/components/finance/EntryDrawer.tsx`
- Create: `apps/web/src/components/finance/PhotoField.tsx`
- Modify: `apps/web/src/lib/format.ts`

**Steps:**

1. `EntryTable` é o componente único que serve as três telas, parametrizado pelo
   filtro fixo de cada uma: Transações sem filtro de tipo, Gastos com
   `kind=expense`, Entradas com `kind=income`. **Mesmo design nas três**, como
   pedido. Usar `<table className="data-table">` dentro de `.table-scroll`, como
   no resto do app.
2. Colunas: data, descrição (com o local abaixo em fonte menor), categoria (com
   bolinha da cor), pessoa, conta, status, valor. Miniatura do anexo à esquerda
   da descrição quando houver, abrindo a foto ampliada em `Modal` ao clicar.
3. `EntryFilters`: período com o `DateField` existente, mais categoria, conta,
   pessoa, etiqueta, local, status e busca textual. Atalhos de período (mês
   atual, mês passado, ano, tudo). O filtro aplicado fica visível como chips
   removíveis.
4. `EntryDrawer`: formulário de criar e editar. Campos: tipo (entrada/saída/
   transferência, via `Segmented`), valor, data, categoria, conta, pessoa (já
   preenchida pela conta), descrição, local com autocomplete, etiquetas, status
   pago/pendente, forma de pagamento e foto. Descrição, local, etiquetas e foto
   são opcionais.
5. Ao escolher um local que tenha categoria padrão, preencher a categoria
   automaticamente **se ela ainda estiver vazia** — nunca sobrescrever escolha
   do usuário.
6. Quando o tipo for transferência, esconder categoria (D21) e mostrar conta de
   origem e conta de destino.
7. `PhotoField`: seleção de arquivo, pré-visualização, substituição e remoção.
   Mostrar progresso durante o envio e tratar o 413 com mensagem clara sobre o
   limite de 15 MB.
8. Em `format.ts`, acrescentar os formatadores de que o módulo precisa a partir
   de centavos (`moneyFromCents` e afins). **Cada um precisa respeitar a flag de
   máscara do modo privacidade**, como os formatadores existentes, e ter teste
   provando isso (R-04).
9. Commit: `feat(web): add transactions ledger with filters and photos`

---

### Task 9: Backup e exportação

**Files:**
- Modify: `apps/api/src/routes/import-export.routes.ts`
- Modify: `apps/web/src/pages/finance/Transactions.tsx`

**Steps:**

1. Estender o `GET /api/export` existente para incluir as tabelas do módulo.
2. Criar `GET /api/ledger/export.csv`, respeitando os mesmos filtros da
   listagem, para exportar o que está na tela. Seguir o formato do
   `operations.csv` que já existe.
3. Criar `GET /api/backup` que devolve uma cópia consistente do arquivo SQLite
   usando a API `backup()` do better-sqlite3 — copiar o arquivo com o processo
   rodando em WAL corrompe o resultado.
4. Num app local sem nuvem, backup não é conveniência, é requisito: deixar o
   botão visível na tela, não escondido em configurações.
5. Commit: `feat(api): add ledger export and database backup`

---

## Critérios de aceite

- `npm test`, `npm run typecheck`, `npm run lint` e `npm run build` passam.
- É possível cadastrar pessoa, conta, categoria, etiqueta e local pela
  interface, sem tocar no banco.
- É possível registrar entrada, saída e transferência, com e sem foto, e o
  saldo da conta reflete cada uma imediatamente.
- Transferência entre duas contas não altera o saldo consolidado e não aparece
  em nenhum relatório de receita ou despesa.
- Lançamento marcado como pendente não entra no saldo atual e entra no previsto.
- O filtro combina período, categoria, conta, pessoa, etiqueta, status e busca
  textual, e o total exibido corresponde ao filtro aplicado.
- A foto aparece como miniatura na listagem e amplia ao clique; o arquivo em
  `data/attachments/` está em WebP e menor que o original.
- O modo privacidade mascara todos os valores novos, e há teste provando.
- O tema claro funciona em todas as telas novas.
- Excluir um lançamento com anexo remove a linha e, se nenhum outro lançamento
  usar o mesmo arquivo, também o arquivo.
- O backup baixa um `.sqlite` que abre íntegro.
