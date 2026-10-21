# Fase 2 — Dashboard, relatórios e divisão-alvo

> **Para o agente:** leia [`00-plano-mestre.md`](00-plano-mestre.md) antes desta
> fase. Este documento é a fonte de verdade da fase 2. As regras das seções 6.1
> (saldos), 6.4 (divisão-alvo), 6.5 (orçamento por categoria) e 6.6 (estorno) do
> plano mestre valem integralmente aqui e não podem ser reinterpretadas. Onde
> este documento detalha um caso que o plano mestre não enumera — arredondamento
> de percentual, mês parcial, empate na distribuição de centavos — ele está
> **preenchendo lacuna**, não reinterpretando regra.

- **Depende de:** fase 1
- **Habilita:** fase 4 (patrimônio unificado reaproveita o dashboard), fase 5
- **Entregável:** o usuário abre um painel do módulo e vê saldo consolidado
  atual e previsto, saldo por conta, resumo do mês, quanto gastou por categoria
  contra o orçamento, a composição do gasto em rosca (mês e ano), a comparação
  contra o período anterior e as barras de alvo × realizado do casal.
- **Decisões aplicadas:** D01, D02, D03, D08, D09, D10, D19, D21, D24

## Escopo

**Entra:** tela de dashboard do módulo, tela de relatórios, tabela de totais por
categoria com orçamento (6.5), roscas de composição do mês e do ano,
comparativo entre períodos por categoria, tendência por categoria, os três modos
de divisão-alvo (6.4), a materialização de `entries.counts_toward_target` com
exceção manual, e os formatadores de centavos que faltam.

**Não entra:** fatura e limite de cartão (fase 3), patrimônio somando
investimentos (fase 4), caixinhas e projeção de CDI (fase 5), relatório de
importação (fase 6), qualquer alvo por categoria **por pessoa** (não existe:
orçamento é por categoria, alvo é por pessoa), exportação em PDF.

**Nenhuma tela desta fase soma nada no cliente.** Toda agregação é feita em
`packages/finance` (puro), consultada pelos repositórios de
`packages/db` e servida pela API já pronta para renderizar. A regra existe
porque a mesma soma feita em dois lugares diverge, e porque o cálculo puro é o
único que dá para testar sem banco e sem DOM.

**Lacuna do plano mestre que esta fase preenche:** a seção 4.3 define
`budget_periods` com `pooled_income_cents` e `joint_expense_target_cents`, mas
não nomeia a coluna que guarda o **gasto-alvo total** do período, exigido pelos
modos `none` e `income_proportional` em 6.4. Esta fase acrescenta
`total_expense_target_cents` e a seção 4.3 do plano mestre deve ser atualizada
para incluí-la.

---

### Task 1: Esquema dos alvos e materialização de `counts_toward_target`

**Files:**
- Create: `packages/db/src/migrations/003-budget-targets.ts`
- Create: `packages/db/src/migrations/003-budget-targets.test.ts`
- Modify: `packages/db/src/migrations/index.ts`
- Modify: `packages/db/src/repositories/entries.ts`
- Modify: `packages/db/src/repositories/entries.test.ts`

**Steps:**

1. Criar `budget_periods` e `person_period_budgets` exatamente como na seção 4.3
   do plano mestre, acrescentando a coluna `total_expense_target_cents INTEGER
   NULL` em `budget_periods` (ver "Lacuna" no Escopo). A linha do período é
   criada sob demanda: nenhum mês é pré-semeado.
2. `budget_periods.split_mode` nasce com o `CHECK` completo
   (`'none','income_proportional','pooled'`) e `DEFAULT 'none'`, para que
   nenhuma fase futura precise de `rebuildTable` (R-01).
3. A coluna `entries.counts_toward_target` já existe desde a fase 1 (seção 4.2).
   Esta migração **não** a cria; ela faz o backfill do valor derivado para todas
   as linhas existentes, usando a regra do passo 4.
4. Implementar em `entries.ts` a função pura de derivação
   `deriveCountsTowardTarget({ kind, amountCents, transferPurpose, refundOfEntryId })`,
   que materializa 6.4 do plano mestre **e nada além dela**:
   - `kind='expense'` → `1`.
   - `kind='income'` → `0`.
   - `kind='adjustment'` → `0`.
   - `kind='transfer'` com `purpose='goal_deposit'` → `1` **somente na ponta de
     saída** (`amount_cents < 0`); a ponta de entrada é `0`. Sem essa restrição o
     depósito na caixinha conta duas vezes e se anula.
   - Qualquer outra transferência, incluindo `purpose='investment'`,
     `'invoice_payment'`, `'goal_withdrawal'`, `'settlement'` e `'generic'` →
     `0` nas duas pontas. O caso `investment` é o motivo de o alvo existir, e o
     caso `goal_withdrawal` segue a enumeração de 6.4 ("não conta: nenhuma outra
     transferência"): sacar da caixinha **não** devolve folga ao alvo do mês.
   - Estorno (`refund_of_entry_id NOT NULL`) → `1`, com `amount_cents` positivo,
     para que ele **abata** a despesa original no somatório (6.6).
5. Chamar a derivação em `entries.create` e `entries.createTransfer`. Em
   `entries.update`, **só** re-derivar quando `kind`, `refund_of_entry_id` ou o
   `purpose` da transferência mudarem — nunca em toda edição, senão uma edição
   de descrição apaga a exceção manual do usuário. Quando a re-derivação
   acontecer e o valor gravado for diferente do derivado, devolver
   `targetFlagReset: true` no resultado para a UI avisar.
6. Expor `entries.setCountsTowardTarget(id, value)` como a única porta da
   exceção manual caso a caso prevista em 6.4. Ela não toca em mais nada.
7. Testes: as duas tabelas existem com o `CHECK` completo; o backfill marca uma
   despesa antiga com `1` e uma transferência `investment` com `0`; a ponta de
   entrada de um `goal_deposit` fica `0` e a de saída `1`; editar a descrição de
   um lançamento com exceção manual **não** altera a flag; trocar o `kind`
   re-deriva e sinaliza.
8. Commit: `feat(db): add budget periods and materialize target flag`

---

### Task 2: Contratos Zod de relatórios e alvos

**Files:**
- Create: `packages/contracts/src/reports.ts`
- Modify: `packages/contracts/src/index.ts`

**Steps:**

1. Criar `splitModeSchema` (`'none' | 'income_proportional' | 'pooled'`) e
   `periodSchema` — `z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)` para
   `YYYY-MM`, distinto de `z.string().date()`, que é a data do lançamento.
2. Criar `reportRangeSchema` com `from` e `to` (`z.string().date()`), mais os
   atalhos `period` (mês) e `year`. Exatamente um dos três deve vir preenchido —
   validar com `.superRefine`, não com precedência silenciosa.
3. Criar os schemas de resposta: `categoryReportRowSchema`,
   `categoryReportSchema`, `categoryTrendSchema`, `ledgerSummarySchema`,
   `targetRowSchema`, `targetReportSchema`.
4. Todo campo monetário é `z.number().int()` com sufixo `Cents` (D19). Nenhum
   `z.number()` solto em dinheiro, em nenhuma resposta.
5. Participação da fatia é `sharePerMille: z.number().int().min(0).max(1000)` —
   milésimos, não fração. A representação inteira é o que permite garantir que a
   soma fecha exatamente em 1000 (Task 3); um `number` de fração não permite.
6. Variação do comparativo é `variationRatio: z.number().nullable()` — `null`
   quando o período anterior é zero. Ver a regra completa na Task 3.
7. Criar os schemas de entrada das mutações: `budgetPeriodInputSchema`
   (`splitMode`, `totalExpenseTargetCents?`, `pooledIncomeCents?`,
   `jointExpenseTargetCents?`) e `personPeriodBudgetInputSchema`
   (`incomeOverrideCents?`, `targetOverrideCents?`, ambos `.nullable()` porque
   `null` é o gesto de **limpar** o override e precisa ser distinguível de
   ausente).
8. Commit: `feat(contracts): add report and target schemas`

---

### Task 3: Agregação por categoria em `packages/finance`

**Files:**
- Create: `packages/finance/src/reporting.ts`
- Create: `packages/finance/src/reporting.test.ts`
- Modify: `packages/finance/src/index.ts`

**Steps:**

1. Tudo aqui é função pura sobre arrays de linhas já somadas pelo banco; zero
   dependência, zero `Date.now()` — a data de referência sempre chega por
   parâmetro, senão o teste vira refém do relógio.
2. `distributeShares(values: number[]): number[]` — participação de cada fatia em
   **milésimos**, pelo método do maior resto: calcular `exato_i = valor_i × 1000
   / total`, tomar o piso de cada um, e distribuir os milésimos restantes, um a
   um, para os maiores restos fracionários. Empate resolvido pelo maior valor
   absoluto e, persistindo, pelo menor índice — o resultado precisa ser
   determinístico, não depender da ordem de `sort` do runtime. **A soma é sempre
   exatamente 1000**; total zero devolve tudo zero. Teste obrigatório: três
   fatias iguais devolvem `[334, 333, 333]` e somam 1000; sete fatias de
   `1/7` somam 1000; um caso com 13 fatias somando 1000.
3. `categoryTotals(rows, { budgets, monthsInPeriod })` — monta a linha de cada
   categoria com `spentCents`, `budgetCents` e `overBudget`:
   - `spentCents` é o gasto **positivo** (o repositório entrega `-SUM`), já
     líquido de estornos (6.6). Uma categoria pode ficar **negativa** quando o
     estorno de uma compra parcelada chega inteiro antes das parcelas; o valor
     negativo é exibido como está, nunca zerado nem descartado.
   - Sem `monthly_budget_cents` → `budgetCents: null` e `overBudget: false`. A
     UI mostra só o valor, sem placeholder (6.5).
   - Com orçamento e período de N meses **inteiros** → `budgetCents =
     monthly_budget_cents × N`. Um período que não é um número inteiro de meses
     (ex.: 10/03 a 22/04) devolve `budgetCents: null`: proporcionalizar
     orçamento mensal por dias gera alarme falso e não foi pedido. Teste
     obrigatório para os três casos.
   - `overBudget = spentCents > budgetCents`. Igualdade não estoura.
4. `topSlices(rows, limit = 9)` — reduz as fatias da rosca às `limit` maiores em
   valor absoluto e agrega o resto em uma fatia `Outras`. Com 20 categorias, as
   linhas-guia do `Donut` se atropelam e a rosca deixa de comunicar; o corte é
   parte do cálculo, não da renderização, para poder ser testado. Fatias com
   valor `<= 0` ficam **fora** da rosca (fatia negativa em pizza não significa
   nada) e continuam na tabela. As participações são calculadas **depois** do
   corte, sobre as fatias que restaram, para continuarem somando 1000.
5. `comparePeriods(current, previous)` — para cada categoria, devolve
   `variationRatio` e o rótulo pronto:
   - `variationRatio = (atual − anterior) / |anterior|`.
   - `anterior = 0` e `atual > 0` → `variationRatio: null` e rótulo `"novo"`.
     **Nunca** exibir infinito, nem 100%, nem 0%.
   - `atual = 0` e `anterior > 0` → `−1`, rótulo `"não gastou"`.
   - Ambos zero → categoria omitida do comparativo.
   - Rótulo em texto: `gastou 32% a mais em Mercado` e `gastou 12% a menos em
     Transporte`, com o percentual arredondado para inteiro. A frase é montada
     aqui, não na UI, para ter teste.
   - **Atenção ao sinal:** em despesa, variação positiva é ruim. A função
     devolve `tone: 'negative' | 'positive' | 'neutral'` já invertido em relação
     ao `Delta` do app, que assume "subir é bom". A UI usa esse `tone` e **não**
     deriva a cor do sinal do número.
6. `previousRange(range, { today })` — define contra o que se compara:
   - Se o período é exatamente um mês-calendário, o anterior é o **mês-calendário
     anterior**, não "30 dias antes". Fevereiro comparado com janeiro inteiro.
   - Caso contrário, o anterior é a mesma quantidade de dias imediatamente antes
     de `from`.
7. `partialPeriod(range, { today })` e o comparativo justo — **este é o ponto
   sutil da tarefa**. Comparar 21 dias do mês corrente contra 31 dias do mês
   passado sempre diz que se gastou menos, o que é mentira:
   - Se `today` está dentro do período, ele é **parcial**: devolver
     `{ partial: true, daysElapsed, daysInPeriod }`.
   - O período anterior é então truncado no **mesmo dia do mês**, com o dia
     limitado ao último dia daquele mês: comparar 30/03 com fevereiro trunca em
     28/02 (ou 29/02 em ano bissexto). Teste obrigatório para esse
     recorte.
   - A resposta carrega **os dois números**: `previousCents` (mês anterior
     inteiro) e `previousToDateCents` (truncado). A UI destaca o truncado e
     rotula `parcial: 21 de 30 dias`; o inteiro fica como informação secundária.
     Nunca exibir só o inteiro quando o atual é parcial.
8. Exportar tudo em `index.ts` e cobrir cada regra acima com teste. Os casos de
   `distributeShares`, `previousRange`, o recorte de fevereiro e o orçamento de
   período não-inteiro são **obrigatórios**, não opcionais.
9. Commit: `feat(finance): add category aggregation and period comparison`

---

### Task 4: Divisão-alvo entre autores em `packages/finance`

**Files:**
- Create: `packages/finance/src/targets.ts`
- Create: `packages/finance/src/targets.test.ts`
- Modify: `packages/finance/src/index.ts`

**Steps:**

1. Implementar `computeTargets(input): TargetResult`, que recebe apenas dados —
   pessoas, rendas apuradas, overrides, configuração do período e realizado por
   pessoa — e devolve as barras prontas. Sem banco, sem `Date`, sem I/O.
2. **Renda de cada pessoa** = `income_override_cents` quando existir (inclusive
   quando for `0`, que é um override legítimo), senão a soma dos lançamentos
   `kind='income'` da pessoa no período. O alvo considera **todos os status**,
   `pending` incluído: ele é sobre o mês combinado, não sobre a liquidação
   bancária. Isso difere de 6.1 de propósito e precisa estar comentado no
   código.
3. **Realizado de cada pessoa** = `−SUM(amount_cents)` dos lançamentos do
   período com `counts_toward_target = 1` agrupados por `entries.person_id`
   (D01). O estorno entra positivo e abate naturalmente. Realizado negativo é
   devolvido como está; a barra renderiza vazia e mostra o número negativo.
4. **Gasto-alvo total do período** (`totalTargetCents`), usado pelos modos
   `none` e `income_proportional`: `budget_periods.total_expense_target_cents`
   quando preenchido; quando `NULL`, o fallback é a soma de
   `categories.monthly_budget_cents` das categorias de saída não arquivadas
   (6.5) — o casal já definiu esses tetos e repetir o número à mão só cria duas
   verdades. Se não houver nenhum orçamento de categoria, o alvo é `null` e a
   tela mostra o realizado sem barra de alvo.
5. **Modo `none`** — uma única barra, alvo total × realizado total do período.
   Nada por pessoa.
6. **Modo `income_proportional`** (6.4):
   - Participantes: pessoas `kind='individual'` e `active = 1`.
   - Base a repartir = `totalTargetCents − jointExpenseTargetCents` quando
     `joint_expense_target_cents` estiver preenchido (o Conjunto ganha barra
     própria com esse teto); quando for `NULL`, a base é o total inteiro e a
     barra do Conjunto aparece **sem alvo**, só com o realizado.
   - Repartição com `allocateByRatio(base, [renda_A, renda_B, ...])` da fase 0 —
     inteiro, método do maior resto, soma fechando exatamente na base. Nunca
     `Math.round` de um percentual float: com 33,3% e 66,7% de R$ 4.000 a soma
     erra um centavo.
   - Renda total zero → repartição igual entre os participantes, com o aviso
     `sem renda no período` na resposta.
   - `target_override_cents` de uma pessoa vence o cálculo. O restante
     (`base − soma dos overrides`) é repartido proporcionalmente entre as
     pessoas **sem** override. Se todos tiverem override, a soma pode não bater
     com a base: devolver o aviso `overrides não fecham com o alvo total` e
     **não** ajustar ninguém à força.
   - Teste obrigatório do exemplo do plano mestre: rendas 2.500 e 5.000 → 33,3%
     e 66,7%; e um caso com resto ímpar em centavos provando que a soma fecha.
7. **Modo `pooled`** (6.4):
   - `pooledIncomeCents` = `budget_periods.pooled_income_cents` quando
     preenchido, senão a soma das rendas de **todas** as pessoas do período,
     incluindo a `joint`.
   - `jointExpenseTargetCents` é o teto do autor `joint` (Conjunto).
   - Sobra = `pooledIncomeCents − jointExpenseTargetCents`, repartida
     **igualmente** entre as pessoas `individual` ativas com
     `allocateByRatio(sobra, [1, 1, ...])`; o centavo ímpar vai para a primeira
     pessoa na ordem de `people.id`, e essa ordem precisa estar no teste para o
     resultado não oscilar.
   - Exemplo do plano mestre, que vira teste: 7.500 e 4.000 → Conjunto 4.000,
     Steylor 1.750, Bianca 1.750.
   - Sobra negativa (teto conjunto maior que o bolo) → tetos pessoais zerados e
     aviso `teto conjunto maior que a renda do bolo`. Não gerar alvo negativo.
   - **A sobra zera todo mês e não acumula.** A função nem recebe o período
     anterior como parâmetro — é a forma mais segura de garantir a regra. Teste
     obrigatório: dois meses seguidos com configuração idêntica produzem tetos
     idênticos, independentemente do que sobrou no primeiro.
8. Para cada barra, devolver `targetCents`, `realizedCents`,
   `ratioPerMille` (realizado ÷ alvo em milésimos, `null` quando não há alvo) e
   `over: boolean`. O percentual é calculado aqui porque ele continua visível no
   modo privacidade — a UI mascara o dinheiro, não a proporção (R-04).
9. Commit: `feat(finance): add couple target split calculation`

---

### Task 5: Consultas de relatório no banco

**Files:**
- Create: `packages/db/src/repositories/reports.ts`
- Create: `packages/db/src/repositories/reports.test.ts`
- Create: `packages/db/src/repositories/budget-periods.ts`
- Create: `packages/db/src/repositories/budget-periods.test.ts`
- Modify: `packages/db/src/index.ts`

**Steps:**

1. Estes repositórios **só consultam**. Nenhuma regra de 6.4, 6.5 ou 6.6 é
   reimplementada em SQL: eles entregam somas cruas para `packages/finance`.
   Percentual, orçamento, comparação e alvo não aparecem aqui.
2. `reports.totalsByCategory({ from, to, kind })` — `GROUP BY category_id` sobre
   `entries` no período, devolvendo `categoryId`, `name`, `color`,
   `monthlyBudgetCents` e `totalCents = -SUM(amount_cents)`. Excluir
   `kind='transfer'` (D21) e incluir os lançamentos sem categoria como uma linha
   `categoryId: null` rotulada `Sem categoria` — esconder essa linha maquia o
   total. Usa o índice `(category_id, date)` da fase 1.
3. `reports.monthSummary({ from, to })` — entradas, saídas e líquido do período,
   já excluindo transferências.
4. `reports.trendByCategory({ categoryIds, months, endMonth })` — série mensal
   por categoria, agrupando por `strftime('%Y-%m', date)`. **Preencher os meses
   sem lançamento com zero** no repositório: um `GROUP BY` sem linha some com o
   mês e o gráfico de área desenha uma reta enganosa entre dois pontos
   distantes.
5. `reports.incomeByPerson({ from, to })` e
   `reports.realizedByPerson({ from, to })` — o segundo filtra
   `counts_toward_target = 1` e devolve `-SUM(amount_cents)`, sem filtro de
   status (Task 4, passo 2). Usam o índice `(person_id, date)`.
6. `budgetPeriods.get(period)` devolve a linha de `budget_periods` e as de
   `person_period_budgets` do período, ou os padrões (`split_mode='none'`, tudo
   `NULL`) quando o mês nunca foi configurado — **sem** inserir linha na
   leitura.
7. `budgetPeriods.upsert(period, input)` e
   `budgetPeriods.upsertPerson(period, personId, input)` criam a linha sob
   demanda com `INSERT ... ON CONFLICT DO UPDATE`. Passar `null` explicitamente
   em um override o **apaga**; passar `undefined` o preserva.
8. Registrar os dois repositórios no objeto devolvido por `createDatabase()`.
9. Testes com `createDatabase(":memory:")`: transferência não aparece em
   nenhum total de categoria; pagamento de fatura idem; lançamento sem categoria
   vira a linha `Sem categoria`; estorno reduz o total da categoria; mês vazio
   aparece com zero na série; `upsert` com `null` limpa o override e com
   `undefined` não mexe nele.
10. Commit: `feat(db): add report queries and budget period repository`

---

### Task 6: Rotas de dashboard, relatórios e alvos

**Files:**
- Create: `apps/api/src/routes/ledger-reports.routes.ts`
- Create: `apps/api/src/routes/ledger-reports.routes.test.ts`
- Modify: `apps/api/src/routes/index.ts`
- Modify: `apps/api/src/routes/ledger.routes.ts`

**Steps:**

1. Registrar o plugin novo no `routes/index.ts`, seguindo o contrato
   `RoutePlugin` da fase 0. As rotas de cadastro e livro continuam em
   `ledger.routes.ts`; relatório e alvo têm arquivo próprio porque a superfície
   é grande.
2. `GET /api/ledger/summary?period=YYYY-MM` — o que o dashboard precisa em uma
   ida só: `consolidated { currentCents, projectedCents }` (6.1),
   `accounts[]` com saldo atual e previsto por conta, `month { incomeCents,
   expenseCents, netCents }` e `previousMonth` com os mesmos três campos, para o
   `Delta`. Reaproveitar `balances.forAccount` e `balances.consolidated` da fase
   1 — **não** reescrever cálculo de saldo aqui.
3. `GET /api/ledger/reports/categories` com `from`/`to` ou `period` ou `year`,
   mais `kind` (padrão `expense`) e `compare` (padrão `1`). Devolve as linhas da
   tabela, as fatias da rosca já cortadas em `Outras`, o `sharePerMille` de cada
   fatia, o bloco de orçamento e o comparativo com o período anterior, incluindo
   `partial`, `previousCents` e `previousToDateCents`. A rosca do ano é esta
   mesma rota com `year=2026`: não criar rota separada.
4. `GET /api/ledger/reports/categories/trend?categoryId=&months=12` —
   `categoryId` pode repetir para comparar categorias. Devolve
   `[{ categoryId, points: [{ month, totalCents }] }]`.
5. `GET /api/ledger/targets?period=YYYY-MM` — devolve `splitMode`, os valores de
   configuração, as barras de `computeTargets` e a lista de `warnings` da Task 4.
6. `PUT /api/ledger/targets/:period` e
   `PUT /api/ledger/targets/:period/people/:personId` gravam a configuração e os
   overrides. Como toda mutação do app, devolvem o agregado recalculado
   (`{ ok: true, targets }`) para a tela atualizar em uma ida só.
7. `PATCH /api/ledger/entries/:id/target` com `{ countsTowardTarget: boolean }`
   é a exceção manual de 6.4. Fica em `ledger.routes.ts`, junto das demais
   rotas de lançamento. Responder 404 em id inexistente.
8. Validar `period` e `year` pelos schemas da Task 2 e recusar intervalo com
   `to < from` com 400 e mensagem em português **sem acento**, como no resto de
   `apps/api`.
9. Testes com `app.inject`: o resumo bate com os lançamentos semeados; a soma de
   `sharePerMille` das fatias é exatamente 1000; categoria com orçamento
   estourado vem com `overBudget: true`; transferência `investment` não entra no
   realizado e `goal_deposit` entra; o modo `pooled` devolve as três barras do
   exemplo do plano mestre; `PATCH` do alvo muda o realizado da pessoa na
   consulta seguinte; `period` malformado devolve 400.
10. Commit: `feat(api): add ledger dashboard, report and target routes`

---

### Task 7: Rosca por cor de categoria e formatadores de centavos

**Files:**
- Modify: `apps/web/src/components/charts.tsx`
- Modify: `apps/web/src/lib/format.ts`
- Modify: `apps/web/src/lib/format.test.ts`

**Steps:**

1. **Reaproveitar o `Donut` existente** (`charts.tsx:146`), que já resolve
   colisão de rótulo com linha-guia. Não criar componente de rosca novo, não
   adicionar biblioteca de gráfico.
2. Estender o tipo de `data` para
   `{ key, label, value, color?, percentLabel? }[]`, mantendo os dois campos
   novos opcionais. `Allocation.tsx` e `Dashboard.tsx` continuam chamando como
   hoje e renderizando exatamente como hoje — se algum teste existente precisar
   mudar, a alteração está errada.
3. A cor da fatia passa a ser `item.color ?? seriesColor(index, colors.series)`.
   Categoria tem cor escolhida pelo usuário (D05) e é ela que precisa aparecer;
   a paleta do tema é só o fallback de quem não tem cor.
4. Corrigir junto um defeito latente: hoje `renderLabel` recalcula
   `colors.series[index % ...]` para a linha-guia e o ponto, em vez de usar a
   cor da fatia. Com cor de categoria, linha e fatia ficariam de cores
   diferentes. Resolver a cor **uma vez** e usar a mesma no `Cell`, na
   `polyline` e no `circle`.
5. Usar `percentLabel` no rótulo quando ele vier, em vez do `percent` do
   Recharts. O percentual precisa ser o arredondado por maior resto da Task 3,
   que soma exatamente 100,0% — o do Recharts é o bruto e a soma dos rótulos dá
   99,9% ou 100,1%, que é exatamente o tipo de detalhe que destrói a confiança
   no relatório.
6. Acrescentar as props `showValue?: boolean` (padrão `false`) e
   `formatValue?: (value: number) => string` (padrão `money`). Com
   `showValue`, o rótulo ganha uma terceira linha com o total absoluto da fatia,
   em `var(--text-muted)`, abaixo do percentual. `formatValue` também substitui
   o `money()` do tooltip — obrigatório, porque esta fase passa **centavos** e o
   `money()` atual interpretaria centavos como reais.
7. A fatia agregada `Outras` (Task 3) recebe `color: "var(--text-muted)"`. Cores
   escolhidas pelo usuário podem se repetir entre categorias; não remapear nada
   silenciosamente — o `paddingAngle` já separa as fatias e a cor é escolha
   dele.
8. Generalizar `DualAreaTrend` com as props opcionais `xKey` (padrão `"year"`),
   `keys` (padrão `["nominal","real"]`) e `names` (padrão
   `["Saldo nominal","Saldo corrigido"]`), para o comparativo período atual ×
   anterior poder usá-lo. Defaults preservam o comportamento atual.
9. Em `format.ts`, a fase 1 já introduziu `moneyFromCents`. Acrescentar apenas o
   que falta: `signedMoneyFromCents`, `compactMoneyFromCents` (para o eixo Y) e
   `budgetPair(spentCents, budgetCents)`, que produz o `500/800` de 6.5.
   **Cada um precisa honrar a flag de máscara do modo privacidade** (R-04);
   percentual continua visível por decisão de produto.
10. `AreaTrend` formata o eixo Y com `compactMoney`, que espera reais. A série de
    tendência converte centavos → reais com `fromCents` da fase 0 **apenas na
    fronteira de renderização**, e isso fica comentado no ponto da conversão.
    Nenhuma soma acontece depois dessa conversão.
11. Testes em `format.test.ts`: com a máscara ligada, `signedMoneyFromCents`,
    `compactMoneyFromCents` e os dois lados de `budgetPair` saem mascarados;
    com ela desligada, `budgetPair(50000, 80000)` produz o par esperado e
    `12345` centavos vira `R$ 123,45`.
12. Commit: `feat(web): support category colors and cent values in charts`

---

### Task 8: Tela de dashboard do módulo

**Files:**
- Create: `apps/web/src/pages/finance/FinanceDashboard.tsx`
- Create: `apps/web/src/components/finance/PeriodPicker.tsx`
- Create: `apps/web/src/components/finance/TargetBars.tsx`
- Create: `apps/web/src/components/finance/TargetDrawer.tsx`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/styles/index.css`

**Steps:**

1. Em `App.tsx`, acrescentar o item **Painel** como primeiro do grupo
   "Finanças" criado na fase 1, estender o union `Page` e a cadeia de render.
   Ícone do `lucide-react` já presente.
2. `PeriodPicker`: `Segmented` com mês atual, mês passado, ano e personalizado;
   o personalizado abre os dois `DateField` da fase 1. O período escolhido é
   `useState` na página e é passado às duas telas desta fase — sem react-router,
   sem estado global novo.
3. Carregar `GET /ledger/summary` e `GET /ledger/targets` com o wrapper `api<T>()`
   dentro de `useEffect` (lembrar que ele já prefixa `/api`, então o caminho
   passado é `/ledger/...`). `Skeleton` enquanto carrega, `Empty` quando não há
   nenhum lançamento no período.
4. Destaque do topo: saldo consolidado **atual** e **previsto** (6.1) em `Kpi`
   com `AnimatedNumber` usando `moneyFromCents`. O previsto vem rotulado como
   previsto, ao lado e nunca no lugar do atual — são números diferentes e
   trocá-los é o erro mais caro da tela.
5. Saldo por conta: lista agrupada por pessoa em `Panel`, cada conta com nome,
   bolinha da cor e os dois saldos. Conta arquivada não aparece.
6. Resumo do mês em três `Stat`: entradas, saídas e líquido, cada um com `Delta`
   contra o mês anterior vindo de `previousMonth`.
7. `TargetBars`: uma barra por pessoa, na ordem Conjunto, Steylor, Bianca, com
   alvo, realizado, o percentual (visível no modo privacidade) e destaque
   quando `over`. Modo `none` mostra uma barra só. Pessoa sem alvo mostra só o
   realizado, com a barra em estado neutro e o texto `sem alvo definido` — nada
   de barra vazia sem explicação. Renderizar os `warnings` da Task 4 como aviso
   discreto acima das barras.
8. `TargetDrawer`: formulário no `Drawer` para configurar o período — modo em
   `Segmented`, e os campos de cada modo aparecendo conforme a escolha
   (`total_expense_target_cents` nos modos `none` e `income_proportional`;
   `pooled_income_cents` e `joint_expense_target_cents` no `pooled`), mais os
   overrides de renda e de alvo por pessoa. Mostrar ao lado de cada campo de
   renda o valor **apurado** dos lançamentos, para o usuário ver o que está
   sobrescrevendo. Ao salvar, usar o `targets` devolvido pela mutação em vez de
   refazer a consulta.
9. Rosca do mês em `Panel`, alimentada por `GET /ledger/reports/categories`, com
   um link para a tela de relatórios. Uma rosca só no dashboard; as duas ficam
   na Task 9.
10. Estilos: só classes novas com prefixo `fin-` em `index.css`, usando
    exclusivamente os tokens de `:root`. **Nenhuma cor literal** — a única cor
    fora dos tokens é a da categoria, que vem do banco e entra por `style`
    inline. Conferir a tela nos dois temas antes do commit.
11. Commit: `feat(web): add finance dashboard with balances and targets`

---

### Task 9: Tela de relatórios

**Files:**
- Create: `apps/web/src/pages/finance/Reports.tsx`
- Create: `apps/web/src/components/finance/CategoryTotalsTable.tsx`
- Create: `apps/web/src/components/finance/CategoryDonuts.tsx`
- Create: `apps/web/src/components/finance/PeriodComparison.tsx`
- Create: `apps/web/src/components/finance/CategoryTrend.tsx`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/styles/index.css`

**Steps:**

1. Acrescentar o item **Relatórios** ao grupo "Finanças" em `App.tsx` e
   reaproveitar o `PeriodPicker` da Task 8.
2. `CategoryTotalsTable`: `<table className="data-table">` dentro de
   `.table-scroll`, como no resto do app. Colunas: bolinha da cor + nome,
   valor (ou o par `500/800` quando houver orçamento, 6.5), participação em
   percentual, e a variação contra o período anterior. O par inteiro fica em
   vermelho ao estourar, via classe `fin-budget-over` usando o token
   `--negative` — nunca um vermelho literal. Categoria sem orçamento mostra só o
   valor. A linha `Sem categoria` aparece ao final, com um atalho para o livro
   filtrado. Uma linha de total fecha a tabela.
3. `CategoryDonuts`: duas roscas lado a lado, **mês selecionado** e **ano
   inteiro**, ambas com o `Donut` da Task 7 — `showValue`, `formatValue =
   moneyFromCents`, `color` da categoria e `percentLabel` do servidor. Cada
   fatia mostra rótulo, percentual e total absoluto. Empilhar verticalmente
   abaixo de ~900px; a rosca com linha-guia não sobrevive a duas colunas
   estreitas.
4. `PeriodComparison`: lista por categoria com a frase pronta vinda do servidor
   (`gastou 32% a mais em Mercado`), ordenada pela maior variação absoluta em
   reais — ordenar por percentual promove a categoria de R$ 12 que dobrou e
   esconde a de R$ 900 que subiu 20%. Usar o `tone` do servidor para a cor, não
   o sinal do número (Task 3, passo 5).
5. Quando o período corrente for parcial, exibir o aviso
   `parcial: 21 de 30 dias` no topo do comparativo e usar `previousToDateCents`
   como base; o total do mês anterior inteiro fica visível como referência
   secundária. Sem esse rótulo o comparativo mente todo dia 3.
6. `CategoryTrend`: ao clicar numa categoria da tabela, abrir a série dos
   últimos 12 meses com `AreaTrend`, passando `date` no formato `YYYY-MM-01`
   para o `shortAxis` existente formatar como `jan/26`. Selecionando duas
   categorias, usar o `DualAreaTrend` generalizado na Task 7.
7. `Empty` quando o período não tem lançamento, `Skeleton` durante a carga, e
   nenhuma soma feita no cliente — todos os números vêm prontos das rotas da
   Task 6.
8. Estilos novos só com prefixo `fin-` e tokens existentes; conferir tema claro
   e escuro, e conferir a tela inteira com o modo privacidade ligado, valor por
   valor (R-04).
9. Commit: `feat(web): add category reports with donuts, budgets and comparison`

---

## Critérios de aceite

- `npm test`, `npm run typecheck`, `npm run lint` e `npm run build` passam.
- Nenhum teste da fase 0 ou da fase 1 precisou ser alterado, e `Allocation.tsx` e
  `Dashboard.tsx` renderizam suas roscas exatamente como antes.
- O dashboard mostra saldo consolidado atual e previsto como dois números
  distintos e rotulados, mais o saldo de cada conta agrupado por pessoa.
- O resumo do mês traz entradas, saídas e líquido, com variação contra o mês
  anterior.
- A tabela de totais por categoria mostra `500/800` para categoria com
  orçamento, em vermelho quando estourado, e só o valor para categoria sem
  orçamento.
- As duas roscas — mês e ano — usam a cor escolhida de cada categoria, e cada
  fatia exibe percentual e total absoluto.
- A soma dos percentuais exibidos na rosca é exatamente 100,0%, com teste
  unitário provando.
- O comparativo entre períodos exibe a frase no formato `gastou 32% a mais em
  Mercado`, com cor invertida em relação ao `Delta` padrão, e categoria nova
  aparece como `novo` em vez de percentual infinito.
- Mês corrente parcial é comparado contra o mês anterior truncado no mesmo dia e
  fica rotulado como parcial; o mês anterior inteiro continua visível como
  referência.
- Os três modos de divisão-alvo funcionam: `none` com uma barra, proporcional
  reproduzindo 33,3% / 66,7% do exemplo do plano mestre, e `pooled` reproduzindo
  4.000 / 1.750 / 1.750.
- No modo `pooled`, dois meses com a mesma configuração produzem os mesmos
  tetos: a sobra não acumula, e há teste provando.
- Transferência com `purpose='goal_deposit'` entra no realizado do alvo, uma só
  vez; transferência com `purpose='investment'` não entra.
- A exceção manual em `counts_toward_target` sobrevive a uma edição de descrição
  do lançamento e é refeita — com aviso — quando o `kind` muda.
- Os alvos por pessoa somam exatamente o alvo total, sem centavo perdido, e há
  teste provando para valores com resto ímpar.
- O modo privacidade mascara todo valor novo das duas telas; os percentuais
  continuam visíveis, por decisão de produto.
- O tema claro funciona em todas as telas novas, e nenhuma cor literal foi
  adicionada ao CSS.
