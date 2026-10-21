# Fase 4 — Integração com investimentos e patrimônio unificado

> **Para o agente:** leia [`00-plano-mestre.md`](00-plano-mestre.md) antes desta
> fase. Este documento é a fonte de verdade da fase 4. As decisões D03, D14, D17,
> D19 e D24 e os riscos R-02, R-03, R-04 e R-07 valem integralmente aqui e não
> podem ser reinterpretados. Esta é a fase que **muda o significado do número
> mais visível do app** — o patrimônio total. Nada aqui pode ser feito em
> silêncio.

- **Depende de:** fases 0 e 1
- **Habilita:** fase 5
- **Entregável:** registrar uma compra de cripto ou de B3 debita automaticamente
  a conta bancária escolhida, uma venda credita de volta, e o app passa a exibir
  um patrimônio único que soma contas, caixinhas e investimentos, desconta a
  dívida de cartão, marca no histórico o dia em que o controle de caixa começou e
  avisa quando o mesmo dinheiro está sendo contado duas vezes.
- **Decisões aplicadas:** D01, D03, D14, D17, D19, D20, D21, D24, D26, D28

## Escopo

**Entra:** coluna `operations.account_id`, tabela de vínculo entre operação e
transferência, conta padrão configurável, débito/crédito automático em transação
única, ação explícita "vincular a uma conta" para operações antigas, serviço de
patrimônio unificado com classes novas namespaceadas, passivo de cartão, versão
no `payload` do snapshot, degrau marcado no gráfico de histórico, aviso de dupla
contagem com caminho de correção em um clique, e uma tela de patrimônio com dois
recortes (só banco / banco + investimentos).

**Não entra:** caixinhas e rendimento CDI (fase 5) — a classe
`ledger:goals` já nasce aqui, valendo zero até lá; conversão das tabelas antigas
de investimento para centavos (D19 as mantém em `REAL` para sempre); qualquer
recálculo retroativo de snapshot (D14); qualquer migração em massa das operações
já existentes; multimoeda no livro-caixa (o livro é BRL, a conversão de operação
em USD acontece na fronteira descrita na Task 2).

### Duas decisões que esta fase precisa registrar

**1. A dívida de cartão reduz o patrimônio.** É representada como a classe
`ledger:credit_card`, sempre **negativa**, entrando na soma do total. O motivo é
que a alternativa é pior: se a fatura não fosse passivo, o patrimônio ficaria
inflado o mês inteiro e desabaria no dia do pagamento, sem nenhum evento
econômico correspondente — o dinheiro já tinha sido gasto na compra. O valor
usado é o **total devido** de 6.1 (tudo, inclusive parcelas futuras), não só a
fatura corrente; a tela mostra os dois números lado a lado para que o efeito das
parcelas longas fique visível em vez de escondido dentro de um total.

**2. As contas de `kind='investment'` não entram no patrimônio.** Elas existem
para que o dinheiro que saiu do banco tenha destino e o saldo bancário fique
certo — mas o mesmo dinheiro já aparece no patrimônio como valor de mercado das
carteiras cripto e B3. Somar as duas pontas seria contar duas vezes. O serviço de
patrimônio ignora `kind='investment'` **incondicionalmente**, independentemente
do valor de `include_in_net_worth`, e há teste provando.

---

### Task 1: Esquema do vínculo entre operação e livro

**Files:**
- Create: `packages/db/src/migrations/005-investment-link.ts`
- Modify: `packages/db/src/migrations/index.ts`
- Create: `packages/db/src/migrations/005-investment-link.test.ts`

**Steps:**

1. O número da migração é a **próxima versão livre** no momento da
   implementação — o runner da fase 0 rejeita versões duplicadas e buracos na
   sequência. `005` assume que as fases 2 e 3 já ocuparam `003` e `004`; se a
   fase 4 for implementada antes delas, renumerar o arquivo para a versão livre
   e nada mais muda.
2. `ALTER TABLE operations ADD COLUMN account_id INTEGER REFERENCES accounts(id)`.
   O SQLite aceita `REFERENCES` num `ADD COLUMN` porque o default é `NULL`.
   **Somente isto** é feito em `operations` (R-02): a coluna `portfolio` tem
   `CHECK(portfolio IN ('crypto','b3'))` e ampliá-la exigiria `rebuildTable` de
   uma tabela que é o coração do módulo antigo. Nenhuma fase toca nesse `CHECK`.
3. Criar o índice `CREATE INDEX IF NOT EXISTS idx_operations_account ON
   operations(account_id)`.
4. Criar a tabela de vínculo, que é o que permite saber em uma consulta quais
   operações têm movimento de caixa:

   ```
   operation_transfers
     operation_id INTEGER PRIMARY KEY REFERENCES operations(id),
     transfer_id  INTEGER NOT NULL UNIQUE REFERENCES transfers(id),
     created_at   TEXT NOT NULL
   ```

   Tabela separada em vez de coluna em `transfers`: `transfers` pertence ao livro
   novo e não deve conhecer o módulo antigo, e a cardinalidade 1–1 fica declarada
   pelas duas chaves únicas em vez de por convenção.
5. Semear as duas contas de destino, **só se ainda não existirem**, seguindo o
   padrão de semeadura idempotente da fase 1: `Corretora cripto` e `Corretora
   B3`, ambas com `kind='investment'`, `person_id` da pessoa `Conjunto`,
   `opening_balance_cents = 0` e `include_in_net_worth = 0`. O flag em zero é
   documentação; a garantia de verdade está na Task 5.
6. Semear as chaves de configuração na tabela `settings` já existente, com o
   prefixo `investment.` para não colidir com nada: `investment.auto_debit`
   (`'1'`), `investment.default_account_id` (`''`, o usuário escolhe),
   `investment.crypto_account_id` e `investment.b3_account_id` (ids das contas
   semeadas no passo 5).
7. Testes: a coluna `account_id` existe e aceita `NULL`; operações inseridas
   antes da migração continuam com `account_id` nulo; o índice existe
   (`PRAGMA index_list`); inserir em `operation_transfers` um `operation_id`
   repetido falha; e — o teste que protege R-02 — ler
   `SELECT sql FROM sqlite_master WHERE name='operations'` e afirmar que o texto
   ainda contém exatamente `CHECK(portfolio IN ('crypto','b3'))`, de modo que
   qualquer rebuild acidental desta tabela em qualquer fase futura quebre o
   teste.
8. Commit: `feat(db): link investment operations to ledger accounts`

---

### Task 2: Serviço de débito automático

**Files:**
- Create: `apps/api/src/services/investment-cash-service.ts`
- Create: `apps/api/src/services/investment-cash-service.test.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/contracts/src/index.ts`

**Steps:**

1. Em `packages/db/src/index.ts`, o repositório `operations` passa a ler e
   gravar `account_id` (`SELECT ... account_id AS accountId`) em `list`, `create`
   e `update`, sem mudar mais nada — `total` e `quantity` continuam `REAL`
   (D19). Acrescentar o repositório `operationLinks` com `get(operationId)`,
   `set(operationId, transferId)`, `remove(operationId)` e
   `listByOperations(ids)`, e registrá-lo no objeto devolvido por
   `createDatabase()`.
2. No contrato, `operationSchema` ganha
   `accountId: z.number().int().positive().nullable().optional()`. Nenhum campo
   monetário da operação vira centavos.
3. **A fronteira entre `REAL` e centavos desta parte é a função
   `toLedgerCents(operation, usdBrl)` de `investment-cash-service.ts`, e nenhum
   outro lugar do código converte.** Ela calcula
   `toCents(operation.total * (operation.currency === 'USD' ? usdBrl : 1))` com o
   `toCents` de `packages/finance` (fase 0, Task 2). A cotação usada vem de
   `db.prices.get("USDBRL")`; se não houver cotação e a operação for em USD, a
   função lança — melhor recusar do que gravar um débito errado. A cotação
   aplicada é registrada em `entries.notes` das duas pontas, no formato
   `USDBRL 5,4321 em 2026-09-21`, para que o número seja auditável depois.
4. `registerOperation(db, input)` roda tudo dentro de **uma** `db.transaction()`,
   exatamente como `apps/api/src/import/import-service.ts` faz:
   cria a operação, e — se `investment.auto_debit` estiver ligado e houver
   `accountId` — cria a transferência com `db.entries.createTransfer` (fase 1,
   Task 4) e grava o vínculo em `operation_transfers`. Uma falha em qualquer
   ponto desfaz a operação também; nunca sobra operação sem transferência nem
   transferência sem operação.
5. Direção do dinheiro: `type='buy'` transfere da conta bancária escolhida para
   a conta de investimento da carteira (`investment.crypto_account_id` ou
   `investment.b3_account_id`); `type='sell'` transfere no sentido inverso,
   creditando o banco. Em ambos, `purpose='investment'`, `category_id` nulo nas
   duas pontas (D21), `status='cleared'`, `date` igual à data da operação e
   descrição gerada no padrão `Compra BTC 0,015` / `Venda PETR4 100`.
6. `updateOperation(db, id, input)`, também em uma transação: atualiza a
   operação e, quando existe vínculo, recalcula valor e data e atualiza as duas
   pontas via `db.entries.update`, que já mantém o par consistente. Se a conta
   bancária mudou, a ponta bancária muda de `account_id`. Se antes não havia
   vínculo e agora veio `accountId`, cria o vínculo — este é o mesmo caminho
   usado pela ação "vincular a uma conta". Se antes havia e agora veio
   `accountId: null`, desfaz pelo caminho do passo 8.
7. `removeOperation(db, id)`: se qualquer uma das duas pontas da transferência
   vinculada estiver com `status='reconciled'`, **recusa** com um erro tipado
   `ReconciledLinkError` e não apaga nada — deixar a transferência órfã ou apagar
   um lançamento já conciliado são as duas piores saídas possíveis. Caso
   contrário, apaga vínculo, transferência, as duas `entries` e a operação numa
   transação só.
8. `unlinkOperation(db, id)`: remove a transferência e o vínculo e zera
   `operations.account_id`, com a mesma recusa do passo 7 quando houver ponta
   conciliada. É a saída para quem quer excluir uma operação travada, e é
   explícita.
9. `listOperationsWithLinks(db, portfolio)`: devolve cada operação com
   `accountId`, `accountName`, `transferId` e `transferStatus` (`null` quando não
   há vínculo). A interface da Task 4 depende disso para não ter que adivinhar.
10. Testes com `createDatabase(":memory:")`: uma compra em BRL cria duas
    `entries` e uma linha em `transfers` com `purpose='investment'`, e o saldo da
    conta bancária cai exatamente o valor em centavos; uma venda credita de
    volta; uma compra em USD converte pela cotação e grava a cotação na nota;
    operação em USD sem cotação lança e não grava nada; editar o total ajusta as
    duas pontas e o saldo; editar a conta move só a ponta bancária; excluir
    remove os quatro registros; excluir com ponta `reconciled` lança e — o ponto
    do teste — o `SELECT COUNT(*)` de `operations`, `entries`, `transfers` e
    `operation_transfers` continua idêntico ao de antes da tentativa; com
    `investment.auto_debit` desligado a operação é criada sem nenhuma `entry`.
11. Commit: `feat(api): debit bank account on investment operations`

---

### Task 3: Rotas de operação, configuração e a regra do alvo

**Files:**
- Modify: `apps/api/src/routes/operations.routes.ts`
- Create: `apps/api/src/routes/investment-cash.routes.ts`
- Modify: `apps/api/src/routes/index.ts`
- Create: `apps/api/src/routes/investment-cash.routes.test.ts`
- Modify: `packages/db/src/repositories/entries.test.ts`

**Steps:**

1. `POST /api/operations` e `PUT /api/operations/:id` passam a aceitar
   `accountId` e a chamar `registerOperation` / `updateOperation` em vez de
   `db.operations.create` / `.update`. A resposta mantém a convenção do app
   (mutação devolve o agregado recalculado) e ganha `balances` junto de
   `portfolios`, para o frontend atualizar a carteira e o saldo da conta em uma
   ida só.
2. `DELETE /api/operations/:id` responde **409** quando o serviço lança
   `ReconciledLinkError`, com a mensagem em português **sem acento**, como no
   resto de `apps/api`: `Operacao vinculada a um lancamento ja conciliado.
   Desvincule antes de excluir.`
3. `GET /api/operations` passa a devolver os campos de vínculo do passo 9 da
   Task 2.
4. `POST /api/operations/:id/link` com corpo `{ accountId }` cria a
   transferência de uma operação antiga; `DELETE /api/operations/:id/link`
   desvincula. **Não existe endpoint de vínculo em massa** — operações
   anteriores a esta fase não são migradas (ver Task 4, passo 5).
5. `DELETE /api/operations` (limpar carteira inteira, que já existe) passa a
   recusar com 409 se **qualquer** operação da carteira tiver ponta conciliada,
   informando quantas; caso contrário remove tudo junto com os vínculos, numa
   transação.
6. `investment-cash.routes.ts`: `GET /api/investments/cash-settings` e
   `PUT /api/investments/cash-settings` com corpo
   `{ autoDebit, defaultAccountId, cryptoAccountId, b3AccountId }`, validado por
   Zod e persistido nas chaves `investment.*` da Task 1. O `PUT` recusa conta de
   destino que não seja `kind='investment'` e conta padrão que seja
   `credit_card` — comprar ação no cartão não é um caso que este app modela.
7. Regra 6.4 do plano mestre, verificação e teste: transferência com
   `purpose='investment'` **não conta** para o alvo de gastos. Acrescentar em
   `entries.test.ts` um teste afirmando que as duas pontas criadas por
   `createTransfer` com `purpose='investment'` nascem com
   `counts_toward_target = 0`, e que as de `purpose='goal_deposit'` nascem com
   `1`. O teste fica no repositório de propósito: ele vale mesmo antes da fase 2
   existir e é o que impede uma regressão silenciosa no número que o casal olha.
8. Testes com `app.inject`: `POST` com `accountId` devolve `balances` com o saldo
   já debitado; `POST` sem `accountId` e com auto-débito ligado devolve a
   operação sem vínculo; `DELETE` de operação conciliada devolve 409 com a
   mensagem exata; `POST /:id/link` cria o vínculo de uma operação antiga;
   `PUT /api/investments/cash-settings` com conta de destino `checking` devolve
   400.
9. Commit: `feat(api): add investment cash link routes and settings`

---

### Task 4: Conta na operação e visibilidade do vínculo

**Files:**
- Create: `apps/web/src/components/finance/AccountSelect.tsx`
- Create: `apps/web/src/components/finance/LinkOperationDrawer.tsx`
- Modify: `apps/web/src/pages/Portfolio.tsx`
- Create: `apps/web/src/pages/Portfolio.test.tsx`
- Modify: `apps/web/src/pages/finance/Accounts.tsx`
- Modify: `apps/web/src/styles/index.css`

**Steps:**

1. `AccountSelect.tsx`: `<select>` agrupado por pessoa com `<optgroup>`,
   mostrando nome da conta e saldo atual, carregado por `api<Account[]>()`.
   Recebe `allowNone` para oferecer a opção "Não movimentar caixa". A fase 5
   reaproveita este componente.
2. No `OperationDrawer` de `Portfolio.tsx`, acrescentar o campo **"Debitar de"**
   (ou "Creditar em", quando o tipo é venda), pré-preenchido com
   `investment.default_account_id` e **alterável no próprio momento da
   operação** (D03). O campo fica junto do valor, não escondido num avançado.
3. Logo abaixo do campo, mostrar em texto pequeno o valor que será movimentado
   em BRL. Para operação em USD, mostrar o convertido e a cotação usada
   (`US$ 1.000,00 · USDBRL 5,4321 · R$ 5.432,10`), usando `money`/`fx` de
   `format.ts` — assim o usuário confere antes de salvar em vez de descobrir
   depois no extrato.
4. Na tabela de operações, uma coluna nova com `Tag`: tom positivo
   **"Vinculada"** quando há `transferId`, tom neutro **"Sem caixa"** quando não
   há. A diferença entre as operações antigas e as novas fica na cara, que é
   exatamente o ponto: nada de fingir que o passado foi importado.
5. No menu de cada linha sem vínculo, a ação **"Vincular a uma conta"** abre
   `LinkOperationDrawer`, que pede a conta e a data do movimento e chama
   `POST /api/operations/:id/link`. **Uma operação por vez, por escolha
   explícita.** Não existe botão de vincular todas: criar dezenas de
   transferências retroativas de uma vez desbalancearia saldos passados sem que
   ninguém conseguisse revisar o resultado.
6. Ao receber 409 no `DELETE`, exibir a mensagem do servidor no `toast` e abrir
   o `confirm` oferecendo "Desvincular e excluir", que chama
   `DELETE /api/operations/:id/link` e repete o `DELETE`. Se a ponta estiver
   conciliada, o desvínculo também é recusado e a mensagem explica que é preciso
   tirar a conciliação do lançamento primeiro.
7. Em `Accounts.tsx`, acrescentar um `Panel` **"Débito automático de
   investimentos"** com o interruptor de liga/desliga, a conta padrão e as duas
   contas de destino, salvando em `PUT /api/investments/cash-settings`. É
   configuração de finanças, então vive na tela de contas, não escondida numa
   página de ajustes.
8. Estilos novos só com o prefixo `fin-` e exclusivamente com tokens de `:root`;
   nenhuma cor literal, tema claro e escuro funcionando.
9. Teste em `Portfolio.test.tsx`, no padrão de `App.test.tsx` (jsdom,
   `@testing-library/react`, `fetch` stubado): a tabela mostra "Sem caixa" para
   operação com `transferId: null` e "Vinculada" para operação com vínculo.
10. Commit: `feat(web): pick a bank account when registering an operation`

---

### Task 5: Patrimônio unificado

**Files:**
- Create: `apps/api/src/services/net-worth-service.ts`
- Create: `apps/api/src/services/net-worth-service.test.ts`
- Modify: `apps/api/src/services/portfolio-service.ts`
- Modify: `packages/db/src/repositories/balances.ts`
- Modify: `apps/web/src/pages/Allocation.tsx`
- Modify: `apps/web/src/app/App.tsx`

**Steps:**

1. **Namespace das classes novas.** Já existem dois vocabulários rivais: as
   chaves inglesas do dashboard (`crypto`, `b3`, `dollar`, `cash`, `reserve`,
   `fixed_income`, `global`) e os apelidos portugueses das metas de alocação
   (`bitcoin`, `shitcoins`, `dolar`, `caixa_br`, `bolsa_brasil`, `renda_fixa`,
   `acoes_globais`), ligados por `aliasToCategory` em `Allocation.tsx`. As
   classes desta fase recebem um **prefixo `ledger:`**, com dois-pontos:
   `ledger:bank`, `ledger:cash`, `ledger:voucher`, `ledger:goals` e
   `ledger:credit_card`. Nenhuma chave existente contém `:`, o que torna a
   colisão impossível por construção, e as categorias de despesa — o terceiro
   vocabulário — **nunca aparecem como chave de classe**, porque são
   identificadas por id numérico e vivem em outro agregado. Documentar essa
   regra em comentário no topo de `net-worth-service.ts`.
2. `buildNetWorth(db, now)` devolve:
   `{ schemaVersion: 2, classes, investmentsBrl, bankBrl, liabilitiesBrl,
   totalBrl, bankOnlyBrl, investableBrl, cashControlStartedOn, doubleCounting }`.
   `classes` contém as sete chaves antigas (calculadas exatamente como hoje, sem
   mudança de comportamento) mais as cinco `ledger:*`. `totalBrl` é a soma de
   **todos** os valores de `classes`, e como `ledger:credit_card` é negativo, o
   passivo desconta naturalmente.
3. `bankOnlyBrl` é a soma das classes `ledger:*` (portanto já líquida do
   passivo); `investmentsBrl` é a soma das sete classes antigas; `bankBrl` é a
   soma das `ledger:*` positivas; `liabilitiesBrl` é o valor absoluto de
   `ledger:credit_card`. Os dois recortes da Task 7 saem daqui prontos — a UI não
   soma nada.
4. **A fronteira entre centavos e `REAL` desta parte é `net-worth-service.ts`, e
   nenhum outro lugar converte.** O livro devolve centavos por `SUM` (D24), e é
   ao montar cada entrada de `classes` que se aplica `fromCents` de
   `packages/finance`. Do serviço para fora — dashboard, snapshot, gráfico, tela
   — tudo é `REAL` em BRL, como sempre foi.
5. Em `balances.ts`, acrescentar `byKind()`, que devolve o saldo consolidado
   agrupado por `accounts.kind`, respeitando 6.1: só `status IN
   ('cleared','reconciled')`, só `date <= hoje`, só contas com
   `include_in_net_worth = 1`, e derivando tudo por `SUM`. Acrescentar também
   `creditCardDebt()`, devolvendo os dois números de 6.1 — fatura atual e total
   devido — em centavos e positivos; quem inverte o sinal é o serviço de
   patrimônio.
6. Mapeamento: `checking` + `savings` → `ledger:bank`; `cash` → `ledger:cash`;
   `meal_voucher` → `ledger:voucher`; `goal` → `ledger:goals`; `credit_card` →
   `ledger:credit_card`, negativo, usando o **total devido**. Contas
   `kind='investment'` são **descartadas incondicionalmente**, mesmo que
   `include_in_net_worth = 1`, pelo motivo registrado no topo deste documento.
7. `doubleCounting` (R-07): `{ active, manualPositions, ledgerBalanceBrl }`.
   É `active` quando existem posições manuais de `category IN ('cash','reserve')`
   com `currentValue > 0` **e** o saldo somado das contas do livro é diferente de
   zero. `manualPositions` traz id, nome, categoria e valor de cada uma, para a
   tela poder oferecer a correção por posição.
8. `buildDashboard` passa a chamar `buildNetWorth` e a devolver `categories =
   netWorth.classes` e `totalBrl = netWorth.totalBrl`, mais os campos novos
   `bankOnlyBrl`, `investableBrl`, `cashControlStartedOn`, `doubleCounting` e
   `payloadVersion`. `reserveBrl` continua sendo `classes.reserve ?? 0`, sem
   mudança, para não mexer no que a alocação já faz.
9. **Correção obrigatória na alocação.** Hoje `Allocation.tsx` e `App.tsx`
   calculam `investable = dashboard.totalBrl - dashboard.reserveBrl`. Com caixa
   no total, essa conta passaria a incluir dinheiro de conta corrente nos pesos
   da carteira e distorceria todas as metas. Os dois passam a usar
   `dashboard.investableBrl` (= `investmentsBrl − reserveBrl`), que mede só o
   módulo de investimentos, como antes. Acrescentar em `actualValue()` uma
   guarda que ignora qualquer chave iniciada por `ledger:`.
10. Em `format.ts`, acrescentar a `categoryLabels` os rótulos pt-BR das classes
    novas: `ledger:bank` → "Contas bancárias", `ledger:cash` → "Dinheiro vivo",
    `ledger:voucher` → "Vale-refeição", `ledger:goals` → "Caixinhas",
    `ledger:credit_card` → "Cartão (dívida)".
11. Testes: uma conta corrente com saldo entra em `ledger:bank` e o `totalBrl`
    sobe exatamente o valor convertido; uma conta `kind='investment'` com saldo
    **não** altera `totalBrl` nem com `include_in_net_worth = 1`; um cartão com
    fatura deixa `ledger:credit_card` negativo e reduz o total; conta arquivada e
    conta com `include_in_net_worth = 0` ficam de fora; lançamento `pending` não
    entra; **nenhuma chave `ledger:*` coincide com uma chave antiga nem com um
    valor de `aliasToCategory`** (lista das duas escrita no teste, interseção
    vazia); `doubleCounting.active` é verdadeiro com posição manual de `cash` e
    conta com saldo, e falso quando só um dos dois existe.
12. Commit: `feat(api): unify net worth across ledger and investments`

---

### Task 6: Snapshot versionado e degrau no histórico

**Files:**
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/src/snapshots.test.ts`
- Modify: `apps/api/src/services/portfolio-service.ts`
- Modify: `apps/api/src/services/portfolio-service.test.ts`
- Modify: `apps/api/src/jobs/scheduler.ts`
- Modify: `apps/web/src/components/charts.tsx`
- Modify: `apps/web/src/pages/History.tsx`
- Modify: `apps/web/src/pages/Dashboard.tsx`

**Steps:**

1. **Versionar o `payload`** (R-03). A coluna `payload` da tabela `snapshots`
   continua sendo TEXT com JSON; muda a forma do JSON:
   - **v1 (legado, escrito até esta fase):** um objeto plano de números,
     `{"crypto": 1234.5, "b3": 987.6, ...}`, sem nenhuma chave de metadado.
   - **v2 (a partir desta fase):**
     `{"version": 2, "classes": {...}, "totals": {"investments": n, "bank": n, "liabilities": n}}`.

   A regra de detecção é a **presença da chave `version`**, nunca uma heurística
   sobre os nomes das outras chaves. Nenhuma linha v1 é reescrita, convertida ou
   completada — o passado não tinha caixa e continuará não tendo.
2. `snapshots.list()` normaliza na leitura e devolve
   `{ date, totalBrl, payloadVersion, classes, totals, priceTimes }`, com
   `payloadVersion: 1` e `totals: null` para as linhas antigas. `snapshots.upsert`
   passa a receber o objeto v2 já montado. Nenhum consumidor volta a ler
   `payload` cru.
3. `createDailySnapshot(db, date)` passa a montar o payload v2 a partir de
   `buildNetWorth`. Na primeira gravação em que exista alguma classe `ledger:*`
   diferente de zero, gravar `settings.set('networth.cash_started_on', date)`
   **se a chave ainda estiver vazia** — é essa data que vira o degrau. O cron das
   23:59 em `scheduler.ts` não muda de horário nem de forma; só passa a gravar o
   payload novo.
4. **`annualReturn` fica honesto.** Hoje ele compara `totalBrl` de hoje com o
   primeiro snapshot do ano. Se esse primeiro snapshot for v1 e o de hoje for v2,
   a comparação é entre grandezas diferentes: passa a devolver `null` em vez de
   um número errado. O tipo vira `number | null` e `Dashboard.tsx` exibe `—` com
   a explicação "sem base comparável antes do controle de caixa" no lugar da
   variação.
5. `buildDashboard` devolve `cashControlStartedOn` para a interface.
6. Em `charts.tsx`, `AreaTrend` ganha a prop opcional
   `marker?: { date: string; label: string }`, renderizada com
   `<ReferenceLine>` do recharts (já é dependência) em `strokeDasharray`, com
   `colors.grid`/`colors.axis` do tema — **nenhuma cor literal**.
7. `History.tsx` passa
   `marker={{ date: cashControlStartedOn, label: "início do controle de caixa" }}`
   quando a data existir e cair dentro do intervalo selecionado. Além do
   marcador: o "Pico histórico" passa a ser calculado **só sobre os snapshots da
   mesma versão do último**, e quando o intervalo escolhido atravessa a data do
   degrau, a "Variação no período" ganha uma nota discreta ao lado —
   "o período atravessa o início do controle de caixa" — em vez de apresentar
   um percentual que mistura duas definições de patrimônio.
8. Testes: gravar à mão uma linha com payload plano e ler com `list()`
   devolvendo `payloadVersion: 1` sem lançar; `createDailySnapshot` grava
   `version: 2` e as classes; gravar um snapshot novo em outra data **não altera
   o `payload` da linha antiga** (comparar a string antes e depois); com uma
   linha v1 no início do ano e um patrimônio v2 hoje, `annualReturn` é `null`;
   `networth.cash_started_on` é gravada uma única vez e não muda no dia seguinte.
9. Commit: `feat(api): version snapshot payload and mark the cash step`

---

### Task 7: Tela de patrimônio

**Files:**
- Create: `apps/web/src/pages/finance/NetWorth.tsx`
- Create: `apps/web/src/pages/finance/NetWorth.test.tsx`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/styles/index.css`

**Steps:**

1. Em `App.tsx`, estender o union `Page` com `"networth"` e acrescentar
   **"Patrimônio"** ao grupo "Finanças" do array `nav` criado na fase 1, com
   ícone do `lucide-react` (`Scale` ou `Landmark`). Sem router, seguindo o padrão
   existente.
2. No topo da tela, um `Segmented` com os dois recortes pedidos: **"Só banco"**
   (`bankOnlyBrl`) e **"Banco + investimentos"** (`totalBrl`). O layout é o mesmo
   nos dois; o que muda é o conjunto de classes listado e o número grande. Valor
   principal em `Kpi` com `AnimatedNumber` e `money`.
3. Abaixo, um `Donut` com as classes **positivas** e um `Panel` "Composição" com
   a tabela `data-table` de classe, valor e percentual, usando `categoryLabel`
   para os rótulos. O passivo do cartão fica **fora da rosca** — rosca não
   representa número negativo — e aparece como uma linha própria, em tom
   negativo, com os dois números de 6.1: *fatura atual* e *total devido*, e um
   `Tag` explicando que é o total devido que entra no patrimônio.
4. `Stat`/`Delta` com a variação desde o último snapshot, e um aviso discreto
   quando `cashControlStartedOn` for hoje ou dos últimos 7 dias, explicando o
   degrau e apontando para o histórico.
5. **Aviso de dupla contagem (R-07):** quando `doubleCounting.active`, um `Panel`
   em tom de alerta no topo da tela — não no rodapé — dizendo que as posições
   manuais de caixa/reserva e as contas do livro podem estar contando o mesmo
   dinheiro, listando cada posição manual com nome e valor. Cada linha tem o
   botão **"Zerar posição manual"**, que passa por `useConfirm` e chama
   `PUT /api/positions/:id` com `currentValue: 0` mantendo os demais campos,
   recarregando o dashboard em seguida. Um clique e uma confirmação, como pedido;
   excluir a posição continua disponível como ação secundária na tela
   "Caixa e renda fixa". O aviso desaparece sozinho quando a condição deixa de
   valer — nada de "não mostrar de novo", que esconderia um erro real de
   contabilidade.
6. Todo valor passa pelos formatadores de `format.ts`, que já honram a máscara do
   modo privacidade (R-04); nada de `toLocaleString` direto na tela.
7. Estilos com prefixo `fin-` e só tokens de `:root`; conferir a tela nos temas
   claro e escuro.
8. Testes em `NetWorth.test.tsx`, no padrão de `App.test.tsx`: os dois recortes
   mostram números diferentes a partir do mesmo payload; o aviso de dupla
   contagem aparece quando `doubleCounting.active` e some quando não; com o modo
   privacidade ligado, nenhum valor em reais aparece no DOM (R-04).
9. Commit: `feat(web): add unified net worth screen`

---

## Critérios de aceite

- `npm test`, `npm run typecheck`, `npm run lint` e `npm run build` passam.
- Registrar uma compra de cripto ou de B3 com conta escolhida cria a operação e
  a transferência `purpose='investment'` juntas, e o saldo da conta bancária cai
  exatamente o valor da compra; uma venda credita de volta.
- A conta vem pré-preenchida com a padrão configurada e pode ser trocada na hora
  da operação.
- Desligar o débito automático faz a operação ser registrada sem nenhum
  lançamento no livro, e nada quebra.
- Excluir uma operação cujo lançamento vinculado está conciliado é **recusado**
  com mensagem clara, e nenhuma linha some do banco.
- `SELECT sql FROM sqlite_master WHERE name='operations'` continua contendo
  `CHECK(portfolio IN ('crypto','b3'))` — a fase só adicionou coluna (R-02).
- Operações anteriores à fase aparecem marcadas como "Sem caixa", nenhuma foi
  vinculada automaticamente, e a ação "Vincular a uma conta" funciona uma a uma.
- Transferência com `purpose='investment'` não conta para o alvo de gastos, e há
  teste provando (6.4).
- O patrimônio total passa a incluir contas, dinheiro vivo, vale-refeição e
  caixinhas, e a descontar a dívida de cartão.
- Uma conta `kind='investment'` com saldo não altera o patrimônio total, mesmo
  com `include_in_net_worth = 1`.
- O gráfico de histórico mostra o degrau com o marcador "início do controle de
  caixa"; nenhum snapshot anterior foi alterado, e há teste comparando o
  `payload` antigo antes e depois.
- Um snapshot gravado antes desta fase é lido como versão 1 e um novo como
  versão 2, e os dois convivem na mesma lista.
- `annualReturn` devolve `null` quando a base do ano é v1 e o valor de hoje é v2,
  e a tela mostra `—` em vez de um percentual inventado.
- Nenhuma chave `ledger:*` colide com as chaves do dashboard nem com os apelidos
  de `aliasToCategory`, e a tela de alocação continua medindo só o módulo de
  investimentos.
- Com posições manuais de caixa/reserva e contas do livro com saldo, a tela de
  patrimônio mostra o aviso de dupla contagem e o botão zera a posição manual em
  um clique.
- A tela de patrimônio mostra o saldo nos dois recortes: só banco, e banco mais
  investimentos.
- O modo privacidade mascara todos os valores novos, e há teste provando.
- O tema claro funciona em todas as telas novas.
