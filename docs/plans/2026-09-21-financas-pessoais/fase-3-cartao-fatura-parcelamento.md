# Fase 3 — Cartão de crédito, fatura e parcelamento

> **Para o agente:** leia [`00-plano-mestre.md`](00-plano-mestre.md) antes desta
> fase. Este documento é a fonte de verdade da fase 3. As regras das seções 6.1
> (dois números do cartão), 6.2 (fatura), 6.3 (parcelamento) e 6.6 (estorno) do
> plano mestre valem integralmente aqui e **não podem ser reinterpretadas**. Em
> caso de conflito, o plano mestre vence e este documento deve ser corrigido.

- **Depende de:** fase 1
- **Habilita:** fases 6 e 7
- **Entregável:** o usuário cadastra um cartão de crédito com ciclo real, lança
  compras à vista e parceladas, navega pelas faturas passadas e futuras, vê
  limite usado e disponível, paga a fatura como transferência, registra estorno
  e antecipa parcelas para uma fatura escolhida.
- **Decisões aplicadas:** D04, D12, D19, D20, D21, D22, D23, D24, D26, D28

## Escopo

**Entra:** conta do tipo `credit_card` com `closing_day`, `due_day`,
`credit_limit_cents` e `payment_account_id`; atribuição de fatura na escrita
(`entries.statement_month`); tela de fatura navegável para trás e para frente;
os dois números do cartão (fatura atual e total devido); pagamento de fatura
como transferência `purpose='invoice_payment'`; limite usado e disponível;
parcelamento com plano e parcelas reais; rótulo `3/7` e destaque da última
parcela; diálogo de escopo de série ("só esta / esta e as futuras / todas");
estorno; antecipação de parcelas.

**Não entra:** pagamento parcial de fatura e rotativo com juros — **fora de
escopo em definitivo por D12**, não é adiamento para uma fase posterior; fatura
em outra moeda; importação de fatura (fase 6); lançamentos recorrentes (fase 7),
que vão **reutilizar** o diálogo de escopo de série construído aqui; relatórios
e dashboard (fase 2), que esta fase apenas não pode quebrar.

**Nenhum rebuild de `accounts` é necessário.** A fase 1 já criou o `CHECK` de
`accounts.kind` com os sete valores, inclusive `credit_card` (fase 1, Task 1,
passo 2), e já declarou `closing_day`, `due_day`, `credit_limit_cents` e
`payment_account_id` como colunas da tabela (seção 4.1 do plano mestre). Esta
fase **só liga a interface** a colunas que já existem. Qualquer tentativa de
reconstruir `accounts` aqui é bug, não zelo. O único `rebuildTable` da fase é o
de `entries`, previsto na fase 1, Task 1, passo 3, para dar integridade à FK
`installment_plan_id`.

**Esta é a fase com menos referência externa do plano inteiro — trate cada
regra como frágil até haver teste.** Os sistemas abertos maduros simplesmente
não modelam fatura: o Firefly III trata cartão como conta de ativo com o papel
`ccAsset` e a própria documentação diz que o papel serve apenas para a
administração do usuário; o GnuCash usa uma conta de passivo e nada mais. Não
existe implementação de referência da "fatura" brasileira com fechamento,
vencimento e parcelamento. O que está escrito em 6.2 e 6.3 do plano mestre é
design novo, então a matemática de calendário nasce isolada em
`packages/finance` com teste exaustivo (Task 2) e nenhuma outra camada pode
recalcular fatura por conta própria.

---

### Task 1: Esquema de parcelamento e índices do cartão

**Files:**
- Create: `packages/db/src/migrations/003-credit-card.ts`
- Create: `packages/db/src/migrations/003-credit-card.test.ts`
- Modify: `packages/db/src/migrations/index.ts`

**Steps:**

1. Numerar a migração como a próxima versão livre. Se a fase 2 já tiver
   consumido a versão 3, usar 4 e renomear o arquivo — o runner da fase 0
   rejeita versão duplicada e buraco na sequência (fase 0, Task 1, passo 4).
2. **Não criar tabela `invoices` nem `statements`** (D22). A fatura é derivada
   por consulta sobre `entries.statement_month`; a única coisa armazenada é o
   próprio `statement_month`, e ele é armazenado exatamente porque a antecipação
   de parcelas o sobrescreve (6.2).
3. **Não tocar em `accounts`.** Verificar no início da migração, por
   `PRAGMA table_info(accounts)`, que `closing_day`, `due_day`,
   `credit_limit_cents` e `payment_account_id` já existem, e lançar erro
   descritivo se não existirem — sinal de que a migração 002 divergiu do plano.
4. Criar `installment_plans` exatamente com as colunas da seção 4.2:
   `id`, `account_id → accounts`, `description`, `purchase_date`, `total_cents`
   `INTEGER NOT NULL`, `installment_count INTEGER NOT NULL CHECK(installment_count >= 1)`,
   `place_id → places`, `category_id → categories`, `created_at`.
5. Reconstruir `entries` **uma única vez** com o helper `rebuildTable` da fase 0,
   apenas para trocar `installment_plan_id INTEGER` solto pela FK
   `REFERENCES installment_plans(id)`, como a fase 1 deixou combinado. Copiar
   todas as colunas, preservar **todos** os `CHECK` da migração 002 palavra por
   palavra e recriar **todos** os índices dela. `import_row_id` continua solto —
   quem resolve é a fase 6. O helper roda dentro da transação da migração.
6. Criar os índices novos: `(account_id, statement_month)` para a tela de
   fatura, `(installment_plan_id, installment_number)` para a série, e
   `(refund_of_entry_id)` para o estorno.
7. Criar o índice único parcial
   `UNIQUE(installment_plan_id, installment_number) WHERE installment_plan_id IS NOT NULL`:
   duas parcelas `3/7` no mesmo plano são corrupção de dados, não um caso de uso.
8. Testes: a migração aplica e não reaplica; um banco com lançamentos criados
   antes da migração chega do outro lado com **a mesma contagem e os mesmos
   valores** em `entries`; o `sql` de `accounts` em `sqlite_master` é
   **byte a byte idêntico** antes e depois (prova de que nada foi reconstruído
   ali); todos os índices da migração 002 continuam existindo
   (`PRAGMA index_list('entries')`); `INSERT` de `entries` com
   `installment_plan_id` inexistente falha com `PRAGMA foreign_keys=ON`;
   `installment_count = 0` é rejeitado; `(plano, número)` duplicado é rejeitado.
9. Commit: `feat(db): add installment plans schema and card indexes`

---

### Task 2: Matemática da fatura em `packages/finance`

**Files:**
- Create: `packages/finance/src/statement.ts`
- Create: `packages/finance/src/statement.test.ts`
- Modify: `packages/finance/src/index.ts`

**Steps:**

1. Este arquivo é a **única** implementação da regra 6.2 em todo o repositório.
   Nem o repositório, nem a rota, nem a tela podem recalcular fatura; todos
   chamam daqui. Zero dependências, nenhum acesso a banco.
2. **Proibido usar `new Date(...)` com data local.** `new Date('2026-02-28')` é
   interpretado como UTC e `getDate()` devolve o dia anterior em fuso negativo —
   é assim que fatura vira o mês errado no dia 1º. Implementar tudo com
   aritmética inteira sobre `{ ano, mês, dia }` extraídos da string
   `YYYY-MM-DD`, ou com `Date.UTC` explícito. O teste deve garantir que nenhuma
   função devolve resultado diferente com `TZ` diferente.
3. `lastDayOfMonth(year, month)` e `clampDay(year, month, day)`: `clampDay`
   devolve o último dia do mês quando o dia pedido não existe — fechamento 31 em
   fevereiro vira 28, ou 29 em ano bissexto (6.2).
4. `closingDateFor(year, month, closingDay): string` devolve a data ISO do
   fechamento daquele mês, já com `clampDay`.
5. `statementMonthFor(date, closingDay, dueDay): string` implementa a regra
   inteira: o lançamento de data `D` pertence à fatura cujo fechamento é a
   **primeira data de fechamento maior ou igual a `D`** — compra no próprio dia
   do fechamento entra nessa fatura, compra no dia seguinte vai para a próxima.
   Do fechamento se deriva o vencimento: se `dueDay <= closingDay` o vencimento
   é no **mês seguinte** ao fechamento; caso contrário, no mesmo mês. O retorno é
   o `YYYY-MM` do **vencimento**, nunca o do fechamento.
6. `statementDatesFor(statementMonth, closingDay, dueDay)` é a inversa e devolve
   `{ closingDate, dueDate, periodStart, periodEnd }`, onde `periodStart` é o dia
   seguinte ao fechamento anterior e `periodEnd` é o fechamento desta fatura. A
   tela usa esses quatro valores no cabeçalho; ninguém os calcula de novo.
7. `statementMonthsBetween(fromMonth, toMonth)` devolve a sequência de meses,
   usada pela navegação de faturas.
8. Testes exaustivos, cada item uma asserção nomeada:
   - **Dia do fechamento**: compra em `2026-05-10` com fechamento 10 cai na
     fatura que fecha em `2026-05-10`; compra em `2026-05-11` cai na de junho.
   - **Fevereiro com fechamento 31**: `2026-02-15` fecha em `2026-02-28`;
     `2028-02-15` fecha em `2028-02-29`.
   - **Fechamento 30 e 29 em fevereiro**: mesmo comportamento, com 2027
     (não bissexto) e 2028 (bissexto) como pares.
   - **Virada de ano, vencimento depois do fechamento**: fechamento 05,
     vencimento 15, compra em `2026-12-28` → fecha `2027-01-05`, vence
     `2027-01-15`, `statement_month = '2027-01'`.
   - **Virada de ano, vencimento antes do fechamento**: fechamento 25,
     vencimento 10, compra em `2026-12-26` → fecha `2027-01-25`, vence
     `2027-02-10`, `statement_month = '2027-02'`.
   - **`due_day == closing_day`**: cai na regra `<=`, vencimento no mês seguinte.
   - **Dezembro com fechamento 31**: compra em `2026-12-31` ainda é da fatura de
     dezembro.
   - **Propriedade de ida e volta**: laço sobre todas as datas de três anos
     (2026–2028) cruzado com `closingDay` e `dueDay` de 1 a 31, conferindo que
     `periodStart <= D <= periodEnd` da fatura devolvida. Laço puro, sem
     biblioteca de teste de propriedade nova.
   - **Monotonicidade**: percorrendo dias consecutivos, o `statement_month`
     devolvido nunca retrocede.
9. Exportar tudo por `packages/finance/src/index.ts`.
10. Commit: `feat(finance): add credit card statement calendar`

---

### Task 3: Conta de cartão, limite e `statement_month` na escrita

**Files:**
- Create: `packages/contracts/src/cards.ts`
- Modify: `packages/contracts/src/ledger.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/db/src/repositories/cards.ts`
- Create: `packages/db/src/repositories/cards.test.ts`
- Modify: `packages/db/src/repositories/entries.ts`
- Modify: `packages/db/src/repositories/entries.test.ts`
- Modify: `packages/db/src/index.ts`

**Steps:**

1. Em `contracts/src/cards.ts`, seguindo a convenção `xxxSchema` +
   `export type Xxx`: `cardFieldsSchema` (`closingDay` e `dueDay` como
   `z.number().int().min(1).max(31)`, `creditLimitCents` como
   `z.number().int().nonnegative().nullable()`, `paymentAccountId` nullable),
   `cardSummarySchema`, `statementStatusSchema`
   (`z.enum(['open','closed','paid','overdue'])`), `statementSchema`,
   `installmentPlanSchema`, `createInstallmentPlanSchema`, `refundSchema`,
   `anticipationSchema` e `seriesScopeSchema`
   (`z.enum(['one','forward','all'])`). `seriesScopeSchema` mora aqui porque a
   fase 7 vai consumi-lo para recorrentes.
2. Em `accountSchema` (`contracts/src/ledger.ts`), tornar os campos de cartão
   obrigatórios **quando e somente quando** `kind === 'credit_card'`, via
   `.superRefine`: sem `closingDay`/`dueDay` não existe fatura, e um cartão sem
   eles é um registro que nunca vai fechar. `creditLimitCents` continua
   opcional. `paymentAccountId`, quando informado, não pode ser a própria conta.
3. **Não criar CRUD paralelo de cartão.** Cartão é uma linha de `accounts`
   (D04); o cadastro continua em `accounts.create/update`, que passa a aceitar e
   validar os quatro campos. O repositório novo cuida só do que é derivado.
4. `cards.ts` expõe `list(today)` e `summary(accountId, today)`, devolvendo, por
   cartão: `closingDay`, `dueDay`, `creditLimitCents`, `paymentAccountId`,
   `currentStatementMonth`, `closingDate`, `dueDate`,
   `currentStatementCents` (**fatura atual**: só o `statement_month` corrente),
   `totalOwedCents` (**total devido**: tudo, inclusive parcelas futuras),
   `usedCents` e `availableCents`. Os dois primeiros números são a regra 6.1 e
   **jamais podem ser colapsados num só** — nem aqui, nem na rota, nem na tela.
5. `currentStatementMonth` é `statementMonthFor(hoje, closingDay, dueDay)` — a
   fatura em que uma compra feita hoje cairia, ou seja, a fatura aberta. Não
   inventar outra definição de "atual" em nenhuma camada.
6. Limite: `usedCents = -SUM(entries.amount_cents)` da conta do cartão,
   **incluindo lançamentos `pending`** — o banco bloqueia limite na compra, não
   na conciliação — e incluindo parcelas futuras, que é o que o total devido já
   é. `availableCents = creditLimitCents - usedCents`, podendo ser negativo
   quando o limite estoura; a interface avisa, o cálculo não trunca. Com
   `credit_limit_cents` nulo, devolver `availableCents = null` em vez de zero.
7. Em `entries.create` e `entries.update`: quando a conta é `credit_card` e o
   chamador **não** informou `statementMonth`, calcular por
   `statementMonthFor(date, ...)` da Task 2; quando informou, **respeitar o
   valor informado** — essa sobrescrita é exatamente o mecanismo da antecipação
   (6.2) e do pagamento de fatura (Task 4).
8. Na atualização, a regra é determinística e explícita: `statementMonth`
   presente na entrada vence sempre; ausente, recalcula a partir da data nova.
   Documentar em comentário no código, porque "manter o override antigo quando a
   data muda" é a variação errada que parece razoável.
9. Garantir as invariantes da seção 4.2: `statement_month` **não nulo** sempre
   que a conta for `credit_card`, e **nulo** sempre que não for — inclusive
   quando um lançamento é movido de uma conta comum para o cartão e vice-versa.
   O banco não consegue expressar isso num `CHECK` (depende de outra tabela), e
   por isso é responsabilidade do repositório, com teste.
10. `payment_method` de lançamento em cartão nasce `'credit'` quando não
    informado.
11. Testes em `cards.test.ts` e `entries.test.ts` com `:memory:`:
    compra em cartão recebe `statement_month` calculado; compra na véspera e no
    dia do fechamento caem em faturas diferentes; `statementMonth` informado
    pelo chamador não é sobrescrito; mudar a data recalcula; mover o lançamento
    para conta comum zera `statement_month`; **fatura atual e total devido são
    diferentes quando existe parcela futura** (o teste mais importante da
    fase); limite considera `pending`; limite volta ao estornar; limite volta ao
    pagar a fatura; `availableCents` negativo quando estoura; cartão fica **fora
    do saldo consolidado** (6.1, já garantido pela fase 1 — reconfirmar aqui com
    um cartão existente no banco).
12. Commit: `feat(db): add credit card accounts with limit and statement assignment`

---

### Task 4: Fatura derivada, pagamento e antecipação de parcelas

**Files:**
- Create: `packages/db/src/repositories/statements.ts`
- Create: `packages/db/src/repositories/statements.test.ts`
- Modify: `packages/db/src/index.ts`

**Steps:**

1. `statements.list(accountId, { from, to })` devolve a lista de faturas
   navegável, cada uma com `month`, `closingDate`, `dueDate`, `purchasesCents`,
   `paymentsCents`, `totalCents`, `entryCount` e `status`. O conjunto de meses é
   a união de: todo `statement_month` distinto presente em `entries` da conta
   (**passado e futuro**), a fatura corrente, e o intervalo pedido. **Faturas
   futuras que já contêm parcelas precisam aparecer** — é a razão de a navegação
   ir para frente, e omiti-las esconderia dinheiro já comprometido.
2. `status` é derivado, nunca armazenado: `open` enquanto o fechamento não
   passou; `closed` depois do fechamento, com saldo em aberto e vencimento no
   futuro; `overdue` depois do vencimento com saldo em aberto; `paid` quando
   `totalCents` é zero e existe pelo menos um pagamento atribuído ao mês.
3. `statements.get(accountId, month)` devolve os lançamentos da fatura —
   ordenados por data e id — separando **compras** de **pagamentos**
   (`purpose='invoice_payment'`), mais os totais e as datas de fechamento e
   vencimento vindas de `statementDatesFor`. Parcelas vêm com
   `installment_number` e `installment_count` para o rótulo `3/7` da Task 9.
4. `statements.pay(accountId, month, { date, fromAccountId, amountCents })`, tudo
   dentro de **uma** `db.transaction()`:
   - usar `entries.createTransfer` da fase 1 com `purpose='invoice_payment'`,
     nunca criar as duas pontas soltas e **nunca** registrar o pagamento como
     despesa (D21, 6.2) — se virar despesa, o gasto é contado duas vezes;
   - a ponta do cartão recebe `statement_month = month` **explicitamente**. Este
     é um ponto que erra sozinho: o pagamento acontece perto do vencimento, que
     normalmente já é depois do fechamento seguinte, então o cálculo natural o
     jogaria na fatura errada;
   - `fromAccountId` cai por padrão em `accounts.payment_account_id` do cartão;
     rejeitar a própria conta do cartão e qualquer outra conta `credit_card`.
5. **Pagamento parcial está fora de escopo (D12)**: rejeitar `amountCents`
   diferente do total da fatura, com mensagem em português **sem acento**, como
   no restante de `apps/api`. Não implementar rotativo, juros nem saldo
   remanescente. Se, depois de pago, a fatura mudar (compra atrasada ou parcela
   antecipada caindo nela), o total deixa de ser zero e o status volta para
   `closed`/`overdue` — a tela mostra essa diferença como informação, e a
   correção do usuário é excluir o pagamento e refazer.
6. `statements.undoPayment(transferId)` remove as duas pontas na mesma
   transação, reaproveitando `entries.remove` da fase 1.
7. `statements.anticipate(accountId, { entryIds, targetMonth })` é a antecipação
   de parcelas: numa transação só, reescreve `statement_month = targetMonth` nos
   lançamentos informados. Validar que todos pertencem à conta, que nenhum está
   em fatura já paga, e que `targetMonth` é um mês de fatura válido para aquele
   cartão. **Não mexer em `date`** — a data do fato é a da compra e continua
   sendo; o que se move é a fatura.
8. **A antecipação é reversível, e por construção.** Como `date` não muda, o mês
   natural continua recuperável por `statementMonthFor(date, ...)`: um
   lançamento está antecipado quando o `statement_month` armazenado difere do
   natural, e `statements.restoreNatural(entryIds)` recalcula e volta tudo ao
   lugar. Não é preciso tabela de histórico nem coluna nova. O Mobills trata
   isso como gesto de arrastar e como operação irreversível; aqui é o oposto:
   confirmação antes (Task 9) e volta sempre disponível.
9. Registrar a ressalva: se o usuário mudar `closing_day` depois de antecipar, o
   mês natural muda junto e o "restaurar" leva para o novo natural, não para o
   antigo. É o comportamento correto para um valor derivado da configuração
   atual, mas precisa de teste que documente a escolha.
10. Ambas as operações devolvem `{ entryId, previousStatementMonth }[]`, que a
    rota repassa para o botão "Desfazer" do toast na interface.
11. Testes com `:memory:`:
    fatura lista meses futuros que contêm parcela; fatura vazia não aparece na
    lista, mas a corrente aparece mesmo vazia; `status` percorre
    `open → closed → overdue → paid`; pagamento cria **duas** linhas, com
    categoria nula nas duas, e não aparece em nenhum relatório de despesa;
    pagamento fica na fatura paga e não na do mês em que a data cai; pagamento
    parcial é rejeitado; desfazer o pagamento devolve o saldo devedor e o limite;
    antecipar move só o `statement_month`, deixando `date` intacto; antecipar e
    restaurar devolve exatamente o estado original; antecipar para fatura paga é
    rejeitado; parcela antecipada **sai** do total da fatura de origem e
    **entra** no da fatura de destino, com o **total devido inalterado** — esse
    par de asserções é o que prova que a antecipação não cria nem destrói
    dinheiro.
12. Commit: `feat(db): add derived statements, invoice payment and anticipation`

---

### Task 5: Parcelamento — plano e parcelas reais

**Files:**
- Create: `packages/db/src/repositories/installment-plans.ts`
- Create: `packages/db/src/repositories/installment-plans.test.ts`
- Modify: `packages/db/src/index.ts`

**Steps:**

1. `create(input)` grava a linha em `installment_plans` e **N lançamentos reais**
   em `entries`, todos numa transação só (D23). Cada parcela carrega
   `installment_plan_id` e `installment_number` de 1 a N. O vínculo é
   **persistido**; nada no sistema pode reconstruir a série por descrição, valor
   ou data — é a falha documentada do SolverFin #662, em que a interface tentou
   remontar a relação e corrompeu os dados. Escrever isso como comentário no
   topo do arquivo, para o próximo leitor não "otimizar" a coluna embora.
2. A divisão usa `splitCents(totalCents, installmentCount)` de
   `packages/finance` (fase 0, Task 2): partes iguais com **todo o resto de
   centavos na primeira parcela** (6.3). Não reimplementar a divisão aqui.
3. Datas das parcelas: a parcela 1 tem `date = purchase_date`; a parcela `k` tem
   a mesma data somada de `k-1` meses, com `clampDay` para meses curtos (compra
   em 31 de janeiro → parcela de fevereiro no dia 28). Cada parcela recebe seu
   `statement_month` pelo caminho normal da Task 3 — parcela não é exceção da
   regra de fatura.
4. `update(id, patch)` altera **apenas** descrição, categoria, local e pessoa.
   `total_cents` e `installment_count` são **somente-leitura depois de criados**
   (6.3): rejeitar a alteração com mensagem clara em vez de aceitar em silêncio.
   Para mudar, o usuário exclui e recria.
5. `changeAccount(id, newAccountId)` atualiza o plano **e todas as parcelas
   futuras atomicamente, numa transação só** (6.3): move as parcelas ainda não
   pagas para o cartão novo e **recalcula o `statement_month` de cada uma** com
   o `closing_day`/`due_day` do cartão de destino, que quase nunca é o mesmo.
   Parcelas já pagas ficam no cartão antigo, onde de fato foram cobradas. Se
   qualquer parcela falhar, nada é gravado — plano num cartão e parcelas em
   outro é o estado corrompido que esta transação existe para impedir.
6. `setInstallmentAmount(planId, number, amountCents)` edita **uma** parcela.
   O sistema **não redistribui automaticamente** (6.3): devolve
   `{ ok: true, sumMatchesTotal: boolean, differenceCents }` e quem avisa é a
   interface. Redistribuir sozinho apagaria o ajuste manual que o usuário
   acabou de fazer.
7. `remove(id)` exclui o plano e as parcelas **não pagas**
   (`status = 'pending'`). Parcelas `cleared`/`reconciled` já aconteceram:
   mantê-las, desligando `installment_plan_id`, e informar quantas
   sobreviveram. Nunca apagar histórico conciliado.
8. `list({ accountId, activeOnly })` devolve os planos com parcelas pagas,
   restantes, valor restante e o `statement_month` da última parcela — é o que a
   tela usa para escolher o que antecipar.
9. Testes com `:memory:`:
   - **soma fecha**: `SUM(amount_cents)` das parcelas = `total_cents` do plano,
     para 1 a 24 parcelas, e o resto está **na primeira** (invariante da seção
     4.2 do plano mestre);
   - `10000` em 3 parcelas gera `[3334, 3333, 3333]`;
   - compra em 31 de janeiro gera parcela de fevereiro no dia 28 e de março no
     dia 31;
   - cada parcela cai na fatura certa, com a virada de ano no meio da série;
   - editar `total_cents` ou `installment_count` é rejeitado;
   - editar uma parcela devolve `sumMatchesTotal: false` e a diferença, e **não
     altera nenhuma outra parcela**;
   - **troca de cartão é atômica**: com um erro forçado no meio, nem o plano nem
     nenhuma parcela mudaram; no caminho feliz, plano e parcelas futuras estão
     no cartão novo com `statement_month` recalculado pelo ciclo dele;
   - excluir o plano apaga as pendentes e preserva as conciliadas;
   - o vínculo sobrevive a editar a descrição de uma parcela — busca por
     `installment_plan_id` continua devolvendo a série inteira.
10. Commit: `feat(db): add installment plans repository`

---

### Task 6: Estorno

**Files:**
- Create: `packages/db/src/repositories/refunds.ts`
- Create: `packages/db/src/repositories/refunds.test.ts`
- Modify: `packages/contracts/src/ledger.ts`
- Modify: `packages/db/src/repositories/entries.ts`
- Modify: `packages/db/src/index.ts`

**Steps:**

1. Estorno é um lançamento de **sinal oposto** com `refund_of_entry_id`
   apontando para o original (6.6). Não é receita, não é transferência e não
   tem tabela própria.
2. `refunds.create(entryId, { amountCents, date, description })` cria o
   lançamento com `kind` **igual ao do original** (estorno de despesa continua
   `kind='expense'`), com valor positivo, mesma categoria, mesma conta e mesma
   pessoa do original, e `counts_toward_target` igual ao do original, para que
   ele abata o realizado do alvo pela soma natural (6.4).
3. **Ajustar o contrato**: a `superRefine` de `entrySchema` criada na fase 1
   exige sinal coerente com o tipo (`expense` negativo). Um estorno é
   `kind='expense'` com valor **positivo** e hoje seria rejeitado. Relaxar a
   regra **exclusivamente** quando `refundOfEntryId` estiver presente,
   invertendo o sinal exigido. Sem isso, nada nesta task passa pela validação.
4. Validar: o original existe, não é `kind='transfer'`, não é ele mesmo um
   estorno (nada de estorno de estorno) e a soma dos estornos não ultrapassa o
   valor do original — com a exceção do item 6, que é justamente o caso em que
   ela pode ultrapassar o valor de **uma parcela**.
5. Estorno em cartão é um lançamento do cartão como qualquer outro: recebe
   `statement_month` pela regra da Task 3, entra na fatura em que a data cai e
   **devolve limite** na hora (Task 3, passo 6).
6. **Estorno de compra parcelada chega integral de uma vez, enquanto as parcelas
   seguem correndo** (6.6). Aceitar `refunds.create` apontando para o **plano**
   (`planId`) e não para uma parcela: nesse caso o estorno é um único lançamento
   de `total_cents`, na fatura da data do estorno, e as parcelas futuras
   **continuam existindo e sendo cobradas**. Não cancelar, não apagar e não
   redistribuir parcela nenhuma — a fatura real do banco faz exatamente isso.
7. Consequência obrigatória em relatório: **uma categoria pode ficar negativa no
   mês** e isso é correto, não é bug a ser escondido. Verificar que as
   agregações por categoria e por pessoa da fase 2 somam os estornos (são
   lançamentos `expense` de valor positivo, então a soma simples já resolve) e
   **não quebram com total negativo**. O ponto frágil é o gráfico de rosca
   (`Donut` em `apps/web/src/components/charts.tsx`), que não tem significado
   com fatia negativa: omitir do gráfico as categorias com total `<= 0` e
   listá-las abaixo dele com o valor negativo visível. Omitir da rosca, nunca
   da tabela.
8. Excluir um estorno é excluir um lançamento comum; excluir o **original** de
   um estorno deve ser bloqueado enquanto o estorno existir, com mensagem
   explicando qual lançamento remover primeiro.
9. Testes com `:memory:`:
   estorno abate a categoria no período e **não** aparece como receita em
   nenhuma consulta de entrada; estorno devolve limite do cartão; estorno
   integral de plano parcelado **não** remove as parcelas futuras e o total
   devido cai pelo valor estornado; a categoria fica negativa no mês e a
   agregação devolve o número negativo sem lançar erro; a rosca omite a
   categoria negativa e a tabela a mostra; estorno de estorno é rejeitado;
   excluir o original com estorno vivo é rejeitado; o contrato aceita
   `expense` positivo **apenas** com `refundOfEntryId`.
10. Commit: `feat(db): add expense refunds`

---

### Task 7: Rotas de cartão, fatura, parcelamento e estorno

**Files:**
- Create: `apps/api/src/routes/cards.routes.ts`
- Create: `apps/api/src/routes/cards.routes.test.ts`
- Modify: `apps/api/src/routes/ledger.routes.ts`
- Modify: `apps/api/src/routes/index.ts`

**Steps:**

1. Novo plugin de rotas registrado como os demais (fase 0, Task 3), com todos os
   caminhos sob `/api/ledger`:
   - `GET /api/ledger/cards` — cartões com o resumo da Task 3, **sempre com
     `currentStatementCents` e `totalOwedCents` como campos separados**;
   - `GET /api/ledger/cards/:id/statements?from&to` — lista navegável, incluindo
     as faturas futuras com parcelas;
   - `GET /api/ledger/cards/:id/statements/:month` — compras, pagamentos e
     totais da fatura;
   - `POST /api/ledger/cards/:id/statements/:month/payment`;
   - `DELETE /api/ledger/cards/:id/statements/:month/payment/:transferId`;
   - `POST /api/ledger/cards/:id/anticipate` — `{ entryIds, targetMonth }`;
   - `POST /api/ledger/cards/:id/anticipate/undo` — `{ entryIds }`, chamando
     `restoreNatural`;
   - `GET|POST /api/ledger/installment-plans`,
     `PUT|DELETE /api/ledger/installment-plans/:id`,
     `PUT /api/ledger/installment-plans/:id/installments/:number`;
   - `POST /api/ledger/entries/:id/refund` e
     `POST /api/ledger/installment-plans/:id/refund`.
2. O cadastro do cartão **não ganha rota nova**: `POST|PUT /api/ledger/accounts`
   da fase 1 passa a aceitar os campos de cartão, validados pelo contrato da
   Task 3.
3. `PUT /api/ledger/entries/:id` ganha o parâmetro `scope`
   (`one` | `forward` | `all`), aplicado quando o lançamento pertence a um
   plano. Regra explícita: `scope` vale para campos **não monetários**
   (descrição, categoria, local, pessoa, etiquetas) e para a troca de cartão;
   **valor é sempre `one`**, porque alterar o valor de toda a série quebraria a
   invariante de soma da seção 4.2. Rejeitar `scope` diferente de `one` junto
   com `amountCents`.
4. Manter a convenção do app: mutação devolve o agregado recalculado, aqui
   `{ ok: true, balances, card }`, para o frontend atualizar numa ida só.
5. Mensagens de erro em português **sem acento**, como no restante de
   `apps/api`. O error handler global já trata `ZodError`.
6. Validar `:month` com `/^\d{4}-(0[1-9]|1[0-2])$/` antes de qualquer consulta,
   e devolver 404 para cartão inexistente ou conta que não seja `credit_card`.
7. Testes com `app.inject`:
   criar cartão pela rota de contas e listar com resumo; fatura atual e total
   devido vêm **diferentes** quando há parcela futura; navegar para uma fatura
   futura devolve as parcelas; pagar a fatura cria a transferência e zera o
   total; pagar valor diferente do total devolve 400; antecipar e desfazer
   devolvem o estado original; `scope=all` com `amountCents` devolve 400;
   `:month` malformado devolve 400; cartão inexistente devolve 404.
8. Commit: `feat(api): add credit card and installment routes`

---

### Task 8: Tela de Fatura

**Files:**
- Create: `apps/web/src/pages/finance/Invoice.tsx`
- Create: `apps/web/src/components/finance/StatementNav.tsx`
- Create: `apps/web/src/components/finance/CardLimit.tsx`
- Create: `apps/web/src/components/finance/InvoicePaymentDrawer.tsx`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/pages/finance/Accounts.tsx`
- Modify: `apps/web/src/styles/index.css`

**Steps:**

1. Em `App.tsx`, acrescentar "Fatura" ao grupo **Finanças** do array `nav`,
   estender o union `Page` e a cadeia de render, com ícone do `lucide-react` já
   presente. Sem react-router, sem react-query — dados pelo wrapper `api<T>()`
   com `useEffect`, como no resto do app.
2. Cabeçalho da tela: seletor de cartão em `Segmented` quando houver mais de um,
   e **dois `Stat` lado a lado, nunca um só** — "Fatura atual" e "Total devido
   (com parcelas futuras)" (6.1). Usar `AnimatedNumber`. Explicar a diferença
   numa linha em `--text-muted` abaixo; o usuário precisa entender por que os
   números não batem, senão vai achar que um deles está errado.
3. `StatementNav`: setas para trás e para frente mais um seletor do mês,
   mostrando "fecha em DD/MM · vence em DD/MM" e um `Tag` com o status
   (`open`, `closed`, `paid`, `overdue`) usando os tons já existentes. A
   navegação para frente **não para na fatura corrente**: vai até a última
   fatura que contém parcela, e as futuras aparecem marcadas como tal.
4. Corpo: `<table className="data-table">` dentro de `.table-scroll`, como no
   resto do app, com data, descrição, local, categoria, pessoa, rótulo de
   parcela e valor. Pagamentos aparecem em bloco separado no rodapé da tabela,
   nunca misturados às compras.
5. `CardLimit`: barra de limite com usado, disponível e percentual. No modo
   privacidade os **números** são mascarados pelos formatadores de `format.ts`;
   a barra continua desenhada, porque ela mostra proporção e não valor —
   registrar essa escolha em comentário. Ao estourar o limite, a barra usa o
   token de alerta existente e mostra o valor excedente. Nenhuma cor literal.
6. `InvoicePaymentDrawer`: usa o `Drawer` de `components/dialog.tsx`, com conta
   de origem pré-selecionada a partir de `payment_account_id`, data padrão no
   vencimento e **valor travado no total da fatura**, com nota de que pagamento
   parcial está fora de escopo (D12). Desfazer o pagamento passa por
   `useConfirm()`.
7. Evolução da fatura: `AreaTrend` de `components/charts.tsx` com o total das
   últimas doze faturas, marcando visualmente as futuras. Sem biblioteca nova.
8. Em `Accounts.tsx`, exibir os campos de cartão no formulário **apenas** quando
   `kind === 'credit_card'` (a fase 1 os escondia por completo): dia de
   fechamento, dia de vencimento, limite e conta de pagamento. Validar 1 a 31 no
   cliente e deixar a validação real no contrato. No cartão da lista, mostrar os
   dois números e o limite disponível, nunca o "saldo" de conta comum.
9. Estilos só com classes novas de prefixo `fin-` em `index.css`, usando
   exclusivamente os tokens de `:root`. Conferir tema claro **e** escuro, em
   especial a barra de limite e o destaque de fatura futura.
10. Commit: `feat(web): add credit card invoice screen`

---

### Task 9: Parcelamento, série e estorno no livro

**Files:**
- Create: `apps/web/src/components/finance/InstallmentFields.tsx`
- Create: `apps/web/src/components/finance/InstallmentBadge.tsx`
- Create: `apps/web/src/components/finance/SeriesScopeDialog.tsx`
- Create: `apps/web/src/components/finance/SeriesScopeDialog.test.tsx`
- Create: `apps/web/src/components/finance/RefundDrawer.tsx`
- Create: `apps/web/src/components/finance/AnticipateDrawer.tsx`
- Modify: `apps/web/src/components/finance/EntryDrawer.tsx`
- Modify: `apps/web/src/components/finance/EntryTable.tsx`
- Modify: `apps/web/src/styles/index.css`

**Steps:**

1. `InstallmentFields` entra no `EntryDrawer` quando a conta escolhida é cartão:
   alternador à vista/parcelado, número de parcelas e valor total, com a
   pré-visualização das N parcelas (data, fatura e valor) calculada pelo
   servidor ou pelo mesmo `splitCents` importado de `packages/finance` — nunca
   por uma divisão escrita à mão no componente.
2. Na **edição** de um plano, total e número de parcelas aparecem como texto
   somente-leitura, com a explicação de que mudar exige excluir e recriar (6.3).
   Não renderizar campo desabilitado sem explicação: o usuário tenta, não
   consegue e não entende.
3. Cada valor de parcela é editável individualmente. Quando a soma deixar de
   bater com o total, mostrar um aviso persistente com a diferença —
   **avisar, nunca redistribuir sozinho** (6.3).
4. `InstallmentBadge` renderiza o rótulo `3/7` com o `Tag` existente, na coluna
   de descrição de `EntryTable`. A **última** parcela recebe destaque visual
   discreto (borda ou ponto no token de acento, não cor chapada nem ícone
   novo) e o `title` "última parcela". Os dois pontos — rótulo e destaque —
   foram pedidos explicitamente pelo usuário; não simplificar nem unificar.
5. `SeriesScopeDialog` é o diálogo "só esta / esta e as futuras / todas",
   montado sobre `Modal` de `components/dialog.tsx` com `Segmented` para as três
   opções, mostrando **quantos lançamentos** cada escolha afeta antes de
   confirmar. A API é genérica de propósito —
   `{ open, title, counts: { one, forward, all }, onPick(scope), onCancel }` —
   e não menciona parcela em lugar nenhum: **a fase 7 vai reutilizar este mesmo
   componente para lançamentos recorrentes**, e é por isso que ele nasce em
   `components/finance/` e não dentro do drawer. O tipo `SeriesScope` vem do
   contrato da Task 3.
6. O diálogo aparece ao editar ou excluir um lançamento com
   `installment_plan_id`, e o escopo escolhido vai no parâmetro `scope` da rota.
   Quando o campo alterado é o **valor**, o diálogo não aparece: a alteração é
   sempre só daquela parcela (Task 7, passo 3).
7. `RefundDrawer`: aberto pela linha do livro ("Estornar"), com valor padrão
   igual ao do lançamento, data de hoje e a opção **"estornar a compra inteira"**
   quando a linha for parcela de um plano — deixando claro na própria tela que
   as parcelas futuras continuam sendo cobradas (6.6). A linha estornada e o
   estorno ficam visualmente ligados por um `Tag` "estorno de…".
8. `AnticipateDrawer`: lista as parcelas futuras do plano com caixa de seleção,
   seletor da fatura de destino e o resumo do efeito em duas linhas — "fatura de
   destino passa de X para Y" e "total devido não muda". Confirmar por
   `useConfirm()` antes de aplicar e oferecer "Desfazer" no toast, chamando
   `anticipate/undo`. Parcela antecipada mostra `Tag` "antecipada" com a fatura
   de origem e ação de restaurar — **nada aqui é irreversível**.
9. Todo valor novo em tela passa por `moneyFromCents` de
   `apps/web/src/lib/format.ts` (fase 1, Task 8) e **honra o modo privacidade**;
   qualquer formatador novo criado aqui precisa de teste provando a máscara
   (R-04).
10. Teste de componente para `SeriesScopeDialog` (as três opções chamam
    `onPick` com o valor certo e as contagens aparecem) — é o componente que a
    fase 7 vai herdar, então ele não pode nascer sem teste.
11. Estilos em `index.css` com prefixo `fin-`, só tokens, conferindo os dois
    temas — em especial o destaque da última parcela, que precisa ser visível no
    claro e discreto no escuro.
12. Commit: `feat(web): add installments, series scope dialog and refunds`

---

## Critérios de aceite

- `npm test`, `npm run typecheck`, `npm run lint` e `npm run build` passam.
- A tabela `accounts` não foi reconstruída: o `sql` em `sqlite_master` é idêntico
  ao da migração 002, e existe teste provando.
- Não existe tabela `invoices` nem `statements` no banco (D22).
- Uma compra feita no dia do fechamento entra na fatura que fecha naquele dia; a
  do dia seguinte entra na próxima.
- Fechamento 31 em fevereiro fecha no dia 28, ou 29 em ano bissexto, e a virada
  de ano com `due_day <= closing_day` leva o vencimento para o ano seguinte.
- A tela de fatura mostra **sempre dois números distintos**: fatura atual e total
  devido. Com parcelas futuras em aberto, eles são diferentes.
- A navegação de faturas vai para trás e para frente, e as faturas futuras que
  contêm parcelas aparecem.
- O pagamento da fatura é uma transferência com `purpose='invoice_payment'`,
  cria duas linhas sem categoria, zera a fatura e **não** aparece em nenhum
  relatório de despesa.
- Um pagamento de valor diferente do total da fatura é recusado, com mensagem
  explicando que pagamento parcial está fora de escopo (D12).
- Uma compra de R$ 100,00 em 3 parcelas gera 3 lançamentos de 33,34 / 33,33 /
  33,33, cuja soma é exatamente o total do plano.
- Total e número de parcelas não são editáveis depois de criados.
- Trocar o cartão de um plano move o plano e todas as parcelas futuras de uma
  vez, com o `statement_month` recalculado pelo ciclo do cartão novo; uma falha
  no meio não deixa plano e parcelas em cartões diferentes.
- Editar o valor de uma parcela não altera nenhuma outra e dispara o aviso de
  soma divergente.
- O livro mostra `3/7` em cada parcela e a última parcela tem destaque visual.
- O diálogo "só esta / esta e as futuras / todas" existe como componente
  compartilhado, com teste, pronto para a fase 7.
- O limite do cartão mostra usado e disponível, ambos vivos, e o disponível
  aumenta ao estornar e ao pagar a fatura.
- Um estorno abate a categoria, não aparece como receita, e o estorno integral de
  uma compra parcelada não interrompe as parcelas.
- Uma categoria com mais estorno que gasto no mês aparece negativa na tabela sem
  quebrar nenhum relatório, e é omitida da rosca.
- Antecipar parcelas muda apenas o `statement_month`: a data da compra fica
  intacta, o total devido não muda e a operação é confirmada antes e reversível
  depois.
- O modo privacidade mascara todos os valores novos, inclusive os da tela de
  fatura e da barra de limite, e há teste provando.
- O tema claro funciona em todas as telas novas.
