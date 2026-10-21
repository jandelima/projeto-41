# Fase 7 — Lançamentos recorrentes

> **Para o agente:** leia [`00-plano-mestre.md`](00-plano-mestre.md) antes desta
> fase. Este documento é a fonte de verdade da fase 7. As regras das seções 6.1
> (saldos), 6.2 (fatura do cartão) e 6.4 (divisão-alvo) do plano mestre valem
> integralmente aqui e não podem ser reinterpretadas. Esta fase **não** cria um
> segundo conceito de série nem um segundo diálogo de escopo de edição: ela
> reaproveita os da fase 3.

- **Depende de:** fase 3
- **Habilita:** nada — é uma fase folha, opcional e independente das demais
- **Entregável:** o usuário cadastra uma vez o aluguel, a Netflix e a academia
  com uma frequência, e o sistema materializa os lançamentos futuros sozinho,
  já pendentes, já na fatura certa do cartão, com valor estimado confirmável e
  com a opção de pular um mês sem desfazer a série.
- **Decisões aplicadas:** D04, D08, D16, D19, D22, D23, D24

## Por que esta fase existe e por que ela é barata

D16 adiou os recorrentes para uma fase própria com a promessa explícita de que
**o modelo de série da fase 3 já nasceria preparado**. Esta fase cobra essa
promessa e precisa confirmá-la: nenhuma tabela criada pela fase 3 é alterada,
nenhum `CHECK` é ampliado, nenhum `rebuildTable` é necessário (R-01 não é
acionado). O custo total de esquema é uma tabela de modelo, uma tabela de
exceções e quatro colunas novas em `entries` adicionadas por `ALTER TABLE ADD
COLUMN` — que o SQLite aceita com cláusula `REFERENCES` desde que o default
seja `NULL`.

**Recorrência não é parcelamento.** A distinção é o eixo desta fase inteira:

| | Parcelamento (fase 3) | Recorrência (fase 7) |
| --- | --- | --- |
| O que se conhece na criação | o **total** e o **número de parcelas** | a **frequência**; o fim é opcional |
| Fim | sempre existe e é conhecido | data, contagem, ou **nunca** |
| Valor | dividido a partir do total, resto na primeira (6.3) | repetido a cada ocorrência, podendo ser estimado |
| Invariante | `SUM(parcelas) = total_cents` | **não existe** invariante de soma |
| Mudança de valor | recria o plano | vale das próximas ocorrências em diante |

O que as duas compartilham — e por isso é reaproveitado, não reescrito — é o
**padrão de série**: uma linha de modelo, N `entries` reais apontando para ela
por FK e um ordinal, vínculo persistido e nunca reconstruído por
descrição/valor/data (D23, lição do SolverFin #662).

## Escopo

**Entra:** modelo de recorrência com frequência semanal, mensal, anual e a cada
N meses; condição de término por data, por número de ocorrências ou nunca;
materialização em janela rolante pelo cron existente; valor estimado com
confirmação; pular uma ocorrência sem apagar a série; pausar e encerrar a série;
recorrência em conta de cartão de crédito caindo na fatura correta; painel de
próximos lançamentos; reuso do diálogo de escopo de edição da fase 3.

**Não entra:**

- **Transferência recorrente** (aporte mensal automático, depósito em caixinha
  todo mês). Exigiria materializar duas pontas ligadas por `transfers` a cada
  ocorrência, com semântica de `purpose` própria, e a regra 6.4 trata
  `goal_deposit` e `investment` de maneiras opostas. Fica para uma fase futura;
  `recurrences.kind` nasce restrito a `expense` e `income`.
- **Lembrete, notificação ou e-mail** de vencimento — fora de escopo pelo plano
  mestre §9 ("contas a pagar com lembrete/notificação").
- **Recorrência com valor que o sistema adivinha** (média dos últimos meses,
  reajuste automático por índice). O valor estimado é digitado pelo usuário.
- **Projeção calculada a partir do modelo.** Ver a Task 6: qualquer número
  futuro exibido no app vem de linha real em `entries`.

---

### Task 1: Esquema e contratos da recorrência

**Files:**
- Create: `packages/db/src/migrations/008-recurrences.ts`
- Modify: `packages/db/src/migrations/index.ts`
- Create: `packages/db/src/migrations/008-recurrences.test.ts`
- Create: `packages/contracts/src/recurrences.ts`
- Modify: `packages/contracts/src/index.ts`

**Steps:**

1. O número `008` é apenas um palpite baseado na ordem natural das fases. Os
   documentos das fases 2 a 6 propõem números que **colidem entre si**, porque
   foram escritos sem saber a ordem real de execução. Antes de criar o arquivo,
   conferir qual é a **próxima versão livre** em
   `packages/db/src/migrations/index.ts` e usar essa; o runner da fase 0
   rejeita versão duplicada e buraco na sequência.
2. Criar a tabela de modelo, seguindo as convenções da seção 4 do plano mestre
   (`snake_case`, datas `TEXT` ISO, dinheiro `INTEGER` em centavos com sufixo
   `_cents`, PK `INTEGER PRIMARY KEY AUTOINCREMENT`):

   ```
   recurrences
     id,
     account_id → accounts NOT NULL,
     person_id → people,                      -- herdado da conta, sobrescrevível (D01)
     kind CHECK('expense','income') NOT NULL,
     description NOT NULL,
     amount_cents NOT NULL,                   -- assinado, mesma convenção de entries
     amount_is_estimated NOT NULL DEFAULT 0,
     category_id → categories,
     place_id → places,
     payment_method,
     counts_toward_target NOT NULL DEFAULT 1,
     frequency CHECK('weekly','monthly','yearly','every_n_months') NOT NULL,
     interval_count NOT NULL DEFAULT 1,       -- só usado por 'every_n_months'
     anchor_date NOT NULL,                    -- data da 1ª ocorrência; define dia/mês/dia-da-semana
     end_mode CHECK('never','on_date','after_count') NOT NULL DEFAULT 'never',
     end_date,                                -- só end_mode='on_date'
     occurrence_count,                        -- só end_mode='after_count'
     status CHECK('active','paused','ended') NOT NULL DEFAULT 'active',
     generated_through,                       -- 'YYYY-MM-DD' até onde já materializou
     split_from_recurrence_id → recurrences,  -- rastro do "esta e as futuras"
     notes, created_at, updated_at
   ```

3. Criar a tabela de exceções, que é o que permite pular sem apagar a série:

   ```
   recurrence_skips
     recurrence_id → recurrences NOT NULL,
     due_date NOT NULL,
     reason,
     created_at,
     PRIMARY KEY(recurrence_id, due_date)
   ```

4. Acrescentar a `entries`, por `ALTER TABLE ADD COLUMN` (sem rebuild):
   `recurrence_id INTEGER REFERENCES recurrences(id)`,
   `recurrence_sequence INTEGER`,
   `recurrence_overridden INTEGER NOT NULL DEFAULT 0` e
   `amount_is_estimated INTEGER NOT NULL DEFAULT 0`.
   Nenhum `CHECK` de `entries` é tocado.
5. Criar o índice único parcial que é a **defesa final contra dupla
   materialização**:
   `CREATE UNIQUE INDEX ux_entries_recurrence_seq ON entries(recurrence_id, recurrence_sequence) WHERE recurrence_id IS NOT NULL`.
   Um bug no motor de geração passa a virar erro de `UNIQUE`, não linha
   duplicada silenciosa. Criar também `INDEX (recurrence_id, date)`.
6. Contratos Zod em `packages/contracts/src/recurrences.ts`, no formato do
   arquivo existente (`xxxSchema` + `export type Xxx = z.infer<...>`):
   `recurrenceFrequencySchema`, `recurrenceEndModeSchema`,
   `recurrenceStatusSchema`, `recurrenceSchema`, `recurrenceInputSchema` e
   `upcomingQuerySchema`. Dinheiro é `z.number().int()`, data é
   `z.string().date()`, cor segue o regex já usado.
   **Não** declarar um `seriesScopeSchema` aqui: ele já existe, criado pela
   fase 3 (Task 3) como `z.enum(['one','forward','all'])`, justamente para ser
   compartilhado. Esta fase o importa.
7. Regras que o banco não expressa, em `.superRefine`: `end_date` obrigatório
   se e só se `end_mode='on_date'`; `occurrence_count >= 1` se e só se
   `end_mode='after_count'`; `interval_count >= 2` se e só se
   `frequency='every_n_months'`; `amount_cents !== 0` e sinal coerente com
   `kind` (negativo em `expense`, positivo em `income`).
8. Testes: as tabelas e o índice único parcial existem (`PRAGMA index_list`);
   inserir duas `entries` com o mesmo `(recurrence_id, recurrence_sequence)`
   falha; inserir duas com `recurrence_id NULL` **não** falha; `kind='transfer'`
   em `recurrences` é rejeitado pelo `CHECK`; um banco criado antes da fase 7
   sobe e ganha as quatro colunas novas.
9. Commit: `feat(db): add recurrence schema`

---

### Task 2: Matemática pura das datas de recorrência

**Files:**
- Create: `packages/finance/src/recurrence.ts`
- Create: `packages/finance/src/recurrence.test.ts`
- Modify: `packages/finance/src/index.ts`

**Steps:**

1. Este módulo é **puro**: zero dependências, zero banco, zero rede, nenhuma
   leitura de `new Date()` sem parâmetro. Toda função recebe as datas de que
   precisa como `string` `YYYY-MM-DD` e devolve `string` `YYYY-MM-DD`.
   Nunca usar `new Date(iso)` + `getDate()`: `new Date('2026-03-01')` é
   meia-noite **UTC** e vira 28/02 em `America/Fortaleza`. Fazer a aritmética
   sobre os inteiros `{ year, month, day }` extraídos da string, ou sobre
   `Date.UTC` com leitura exclusivamente por `getUTC*`.
2. Definir o tipo do modelo, espelhando as colunas da Task 1:
   `type RecurrenceSpec = { frequency; intervalCount; anchorDate; endMode; endDate?; occurrenceCount? }`.
3. `occurrenceDate(spec, sequence): string | null` — a data da n-ésima
   ocorrência (1-based), ou `null` se a série já terminou naquele ordinal.
   É a função de base; tudo o mais deriva dela, e é ela que garante que a
   sequência é **determinística**: o mesmo modelo sempre produz as mesmas datas,
   independentemente de quando o motor rodou.
4. `occurrencesBetween(spec, from, to): { sequence: number; date: string }[]` —
   usada pela janela rolante da Task 3. Nunca iterar sem teto: interromper ao
   ultrapassar `to`, ao esgotar `occurrenceCount` ou ao passar de `end_date`.
5. Regras de calendário, cada uma com teste próprio:
   - **Mensal com dia que não existe no mês**: âncora em 31/01 produz 28/02
     (ou 29/02 em bissexto), 31/03, 30/04 — o dia é *grampeado* ao último dia do
     mês, e o mês seguinte **volta** ao dia da âncora. Nunca derivar a próxima
     data da anterior já grampeada, senão 31 vira 28 para sempre.
   - **A cada N meses**: mesma regra de grampeamento, avançando `intervalCount`
     meses por vez a partir da âncora.
   - **Anual em 29/02**: cai em 28/02 nos anos não bissextos.
   - **Semanal**: o dia da semana vem da âncora; soma de 7 dias é segura porque
     o Brasil não tem horário de verão desde 2019, mas a aritmética é feita em
     UTC mesmo assim, para não depender disso.
6. `endsAt(spec): string | null` — devolve a última data da série, ou `null`
   quando `end_mode='never'`. Usada pela interface para dizer "até 12/2027" ou
   "sem fim".
7. Não colocar aqui nada que dependa de conta, fatura ou banco. O cálculo de
   `statement_month` é da fase 3 e é chamado pela Task 3, não por este módulo.
8. Testes cobrindo, além das regras acima: série com `after_count=3` produz
   exatamente 3 datas e `occurrenceDate(spec, 4)` é `null`; série com
   `on_date` não ultrapassa a data; `occurrencesBetween` com janela fora da
   série devolve vazio; virada de ano (âncora em 15/12, janela até 15/03);
   ano bissexto; e a propriedade de determinismo — chamar duas vezes com os
   mesmos argumentos devolve exatamente o mesmo array.
9. Commit: `feat(finance): add recurrence date math`

---

### Task 3: Motor de materialização em janela rolante

**Files:**
- Create: `packages/db/src/repositories/recurrences.ts`
- Create: `packages/db/src/repositories/recurrences.test.ts`
- Create: `apps/api/src/services/recurrence-service.ts`
- Create: `apps/api/src/services/recurrence-service.test.ts`
- Modify: `packages/db/src/index.ts`

**Steps:**

1. **O modelo é um gabarito; quem vale é a linha real.** Materializar significa
   criar uma `entry` de verdade, com `status='pending'`, `recurrence_id` e
   `recurrence_sequence` preenchidos. Não existe lançamento "virtual". Esta é a
   lição do Actual Budget aplicada ao projeto e ela governa a fase inteira —
   ver a Task 6 para a consequência no saldo previsto.
2. `recurrences.ts` expõe `list`, `get`, `create`, `update`, `pause`, `resume`,
   `end`, `remove`, `skipOccurrence` e `materialize`, no padrão dos demais
   repositórios (recebe `Database`, `prepare` com parâmetros `@campo`, SELECT
   com alias `snake_case AS camelCase`).
3. `materialize(recurrenceId, { today, horizonMonths = 12 })`, tudo dentro de
   **uma** `db.transaction()`:
   - Calcula a janela `[anchor_date, today + horizonMonths]` — **janela
     rolante de 12 meses**, não "geração infinita" e não "só o próximo mês".
     12 meses é o horizonte porque é o que a tela de próximos lançamentos e o
     saldo previsto precisam ver, e porque mantém a tabela `entries` num
     tamanho honesto.
   - Pede as ocorrências à Task 2, descarta as que estão em
     `recurrence_skips`, descarta as que já existem em `entries` pelo par
     `(recurrence_id, recurrence_sequence)`, e insere o restante.
   - Atualiza `generated_through`. **`generated_through` é cache, não fonte de
     verdade**: a decisão de inserir é sempre a ausência da linha, nunca o
     valor dessa coluna. Assim rodar o motor duas vezes é inofensivo.
4. **Ocorrências passadas não materializadas são criadas com a data real e
   ficam `pending`**, aparecendo como atrasadas. O app é local e pode passar
   semanas fechado; silenciar o que venceu enquanto ele estava desligado é
   perder dado. O que o motor **nunca** faz é criar ocorrência anterior à
   `anchor_date`, nem mexer em linha já existente.
5. **Cartão de crédito**: quando `accounts.kind = 'credit_card'`, cada `entry`
   gerada calcula seu próprio `statement_month` chamando o helper da fase 3
   com a **data daquela ocorrência**, conforme 6.2 do plano mestre. Jamais
   copiar o `statement_month` da ocorrência anterior nem derivá-lo do mês da
   data: uma recorrência com âncora no dia 28 e cartão fechando dia 25 cai na
   fatura do mês seguinte, e isso muda mês a mês quando o fechamento cai em fim
   de semana ou em mês curto.
6. `person_id` é herdado da conta na criação de cada `entry`, salvo se o modelo
   trouxer um explícito (D01). `counts_toward_target` é copiado do modelo,
   preservando a regra 6.4.
7. **Regeneração ao editar o modelo** — `update(id, input, scope)`:
   - Apaga as `entries` da série que são **futuras** (`date > today`),
     **`status='pending'`** e **`recurrence_overridden = 0`**, e materializa de
     novo com os valores atuais do modelo.
   - **Nunca** toca em ocorrência `cleared` ou `reconciled`, em ocorrência com
     data passada, ou em ocorrência marcada como sobrescrita pelo usuário.
     Essas três condições são a regra inteira e precisam de teste cada uma.
   - `scope='all'` reescreve o modelo e regenera como acima.
   - `scope='forward'` **não** edita o modelo antigo: encerra-o em
     `end_mode='on_date'` com `end_date` = véspera da ocorrência escolhida,
     cria uma recorrência nova com os valores editados, âncora na ocorrência
     escolhida e `split_from_recurrence_id` apontando para a antiga, e
     materializa a nova. É assim que o histórico de "quanto o aluguel custava
     antes do reajuste" sobrevive.
   - `scope='one'` não passa por aqui: é uma edição comum da `entry`, que
     apenas marca `recurrence_overridden = 1` (Task 5).
8. `skipOccurrence(recurrenceId, dueDate)`: grava em `recurrence_skips` e
   **apaga a `entry` correspondente se ela ainda estiver `pending`**. Se a
   ocorrência já estiver `cleared` ou `reconciled`, rejeitar com erro claro —
   o que já foi pago não se pula, se estorna ou se exclui pelo livro.
9. `recurrence-service.ts` expõe `materializeAll(db, { today, horizonMonths })`,
   que percorre as recorrências `status='active'` e chama `materialize` de cada
   uma, isolando falha por série (uma recorrência quebrada não pode impedir as
   outras) e devolvendo um resumo `{ created, skipped, failed }` para log.
10. Testes com `:memory:`, todos passando `today` explicitamente (nenhum teste
    lê o relógio): mensal por 12 meses gera 12 linhas; rodar o motor **duas
    vezes seguidas** não cria nenhuma linha a mais; ocorrência pulada não
    reaparece após nova materialização; editar o valor do modelo não altera a
    parcela já `cleared` do mês passado; editar com `scope='forward'` encerra a
    antiga e cria a nova com a âncora certa; recorrência em cartão distribui
    `statement_month` corretamente ao longo de 12 meses com fechamento dia 25;
    série `after_count=3` para de gerar na terceira; série pausada não gera;
    pular ocorrência já `cleared` é rejeitado.
11. Commit: `feat(db): materialize recurring entries in a rolling window`

---

### Task 4: Rotas e agendamento

**Files:**
- Create: `apps/api/src/routes/recurrences.routes.ts`
- Create: `apps/api/src/routes/recurrences.routes.test.ts`
- Modify: `apps/api/src/routes/index.ts`
- Modify: `apps/api/src/jobs/scheduler.ts`
- Create: `apps/api/src/jobs/scheduler.test.ts`

**Steps:**

1. Plugin de rotas por recurso, no contrato `RoutePlugin` definido na fase 0:
   - `GET|POST /api/ledger/recurrences`
   - `PUT /api/ledger/recurrences/:id` com `scope` — aceita `forward` e `all`;
     `one` é rejeitado aqui, porque editar uma única ocorrência é `PUT
     /api/ledger/entries/:id` e não mexe no modelo
   - `DELETE /api/ledger/recurrences/:id` — apaga o modelo e as ocorrências
     futuras ainda `pending`; as já pagas permanecem no livro, com
     `recurrence_id` nulo. Excluir uma série jamais reescreve o passado.
   - `POST /api/ledger/recurrences/:id/pause` e `/resume`
   - `POST /api/ledger/recurrences/:id/skip` com `{ dueDate, reason? }`
   - `POST /api/ledger/recurrences/:id/materialize` — botão manual, útil quando
     o usuário acabou de criar a série e não quer esperar o cron
   - `GET /api/ledger/upcoming?from&to&accountId` — ver a Task 6
2. Validar tudo por `recurrenceInputSchema` e pelo `seriesScopeSchema` da
   fase 3; o error
   handler global já cuida de `ZodError`. Mensagens de erro em português **sem
   acento**, como no restante de `apps/api`.
3. Seguir a convenção do app: mutação devolve o agregado recalculado —
   `{ ok: true, recurrences, balances }` — para o frontend atualizar em uma
   ida só.
4. Em `scheduler.ts`, acrescentar ao array `tasks` um
   `cron.schedule("15 0 * * *", ...)` que chama `materializeAll`, no mesmo
   `timezone` (`America/Fortaleza`) dos demais jobs. 00:15 para que as
   ocorrências do dia já existam quando o usuário abrir o app.
5. Obter o "hoje" com o mesmo
   `new Intl.DateTimeFormat("en-CA", { timeZone: timezone, ... }).format(new Date())`
   que o job de snapshot já usa neste arquivo. **Não** usar
   `new Date().toISOString().slice(0, 10)`: entre 21h e meia-noite em Fortaleza
   isso devolve o dia seguinte e gera a ocorrência com a data errada.
6. Chamar `materializeAll` **uma vez imediatamente** dentro de
   `startScheduler`, antes de agendar. O app é local: ele fica dias desligado e
   o cron não roda no passado. Sem essa chamada de recuperação na subida, quem
   abre o app depois de duas semanas não vê nada.
7. Isolar a chamada em `try/catch` com log: uma falha de materialização não
   pode derrubar a subida do servidor nem parar os demais jobs.
8. Testes com `app.inject`: criar recorrência responde com o agregado; `PUT`
   com `scope` inválido é rejeitado; `skip` de data inexistente na série é
   rejeitado; `materialize` é idempotente quando chamado duas vezes;
   404 em id inexistente. No teste do scheduler, verificar que a tarefa foi
   registrada e que a função de parada devolvida também a para — sem esperar
   tempo real.
9. Commit: `feat(api): add recurrence routes and daily materialization job`

---

### Task 5: Tela de recorrências e reuso do diálogo de escopo

**Files:**
- Create: `apps/web/src/pages/finance/Recurrences.tsx`
- Create: `apps/web/src/components/finance/RecurrenceDrawer.tsx`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/components/finance/EntryTable.tsx`
- Modify: `apps/web/src/components/finance/EntryDrawer.tsx`
- Modify: `apps/web/src/styles/index.css`

**Steps:**

1. **Não construir um segundo diálogo de escopo.** O diálogo "só esta / esta e
   as futuras / todas" é entregue pela fase 3 (Task 9) em
   `apps/web/src/components/finance/SeriesScopeDialog.tsx`, já com API genérica
   de propósito — `{ open, title, counts: { one, forward, all }, onPick(scope),
   onCancel }` — e sem nenhuma menção a parcela, precisamente para esta fase.
   Esta fase **importa** esse componente e só passa `title` e `counts` próprios
   do caso recorrente. Se a fase 3 tiver entregue o arquivo com outro nome,
   corrigir **este** documento para o nome real; o que não pode existir é um
   segundo diálogo.
2. Mapeamento dos três escopos de `SeriesScope` (`'one' | 'forward' | 'all'`,
   contrato da fase 3) — é aqui que recorrência e parcelamento divergem:
   - **`one` (só esta)** — edita apenas aquela `entry` e marca
     `recurrence_overridden = 1`, protegendo-a de regeneração futura.
   - **`forward` (esta e as futuras)** — `PUT .../:id` com `scope='forward'`; a
     interface avisa em uma linha que a série será dividida em duas a partir
     daquela data.
   - **`all` (todas)** — `scope='all'`; a interface avisa que ocorrências já
     pagas não serão alteradas. Este aviso não é decorativo: sem ele o usuário
     espera que "todas" reescreva o passado.
   - **Divergência explícita da fase 3:** lá, alterar o *valor* de uma parcela
     não abre o diálogo, porque vale só daquela parcela (6.3). Aqui, alterar o
     valor é justamente o caso em que o diálogo **precisa** aparecer — reajuste
     de aluguel é `forward`, correção de um mês é `one`. `EntryDrawer` não pode
     reaproveitar a condição da fase 3 sem olhar se a linha é parcela ou
     ocorrência de recorrência.
   - `counts` é preenchido com o que a série tem de fato: 1, o número de
     ocorrências futuras ainda pendentes, e o total de ocorrências já
     materializadas.
3. Em `App.tsx`, acrescentar o item **Recorrentes** ao grupo "Finanças" do array
   `nav`, estender o union `Page` e a cadeia de render, com ícone do
   `lucide-react` já presente (`Repeat`).
4. `Recurrences.tsx`: lista em `Panel`, agrupada por conta, cada linha com
   descrição, valor (`Tag` de "estimado" quando for o caso), frequência em
   texto natural ("todo dia 10", "a cada 3 meses, dia 5", "toda segunda-feira",
   "todo ano em 15/03"), próxima data, fim ("até 12/2027" ou "sem fim") e
   estado. Ações por linha: editar, pausar/retomar, encerrar, excluir — as duas
   últimas passando pelo `useConfirm()` existente. `Empty` quando não houver
   nenhuma, `Skeleton` no carregamento.
5. `RecurrenceDrawer.tsx`: formulário no `Drawer`, que é a superfície padrão de
   formulário do app. Campos: tipo (`Segmented` entrada/saída), descrição,
   valor, "valor varia mês a mês" (checkbox que liga `amount_is_estimated`),
   conta, pessoa (já preenchida pela conta), categoria, local com autocomplete,
   forma de pagamento, frequência (`Segmented` semanal/mensal/anual/a cada N
   meses, com o campo N aparecendo só na última), data da primeira ocorrência
   (`DateField`), e término (`Segmented` nunca / em uma data / após N vezes,
   com o campo correspondente). Usar `Field` para rótulo e erro.
6. Pré-visualização dentro do drawer: as **seis próximas datas** que a série vai
   gerar, calculadas pela função pura da Task 2 importada de
   `@projeto41/finance` — o mesmo código do servidor, sem uma segunda
   implementação no cliente. É o que torna óbvio o grampeamento do dia 31 antes
   de o usuário salvar.
7. Em `EntryTable.tsx`, quando `recurrence_id` não for nulo, exibir um ícone
   discreto de repetição ao lado da descrição, com `title` nomeando a série.
   Quando `recurrence_overridden = 1`, o `title` diz que aquela ocorrência foi
   editada manualmente e não será regenerada.
8. Em `EntryDrawer.tsx`, ao salvar a edição de uma `entry` que tenha
   `recurrence_id`, abrir o `SeriesScopeDialog` antes de enviar e despachar
   conforme o item 2.
9. Estilos: apenas classes novas com prefixo `fin-` em `index.css`, usando
   exclusivamente os tokens de `:root`. Nenhuma cor literal — o tema claro e o
   escuro precisam continuar funcionando.
10. Commit: `feat(web): add recurrences screen with shared series scope dialog`

---

### Task 6: Próximos lançamentos, valor estimado e a garantia de não dupla contagem

**Files:**
- Create: `apps/web/src/components/finance/UpcomingPanel.tsx`
- Create: `apps/web/src/components/finance/ConfirmAmountDialog.tsx`
- Modify: `apps/web/src/pages/finance/Transactions.tsx`
- Modify: `packages/db/src/repositories/balances.ts`
- Modify: `packages/db/src/repositories/balances.test.ts`
- Modify: `apps/web/src/lib/format.ts`

**Steps:**

1. **A regra que esta task existe para proteger.** O Actual Budget precisou
   publicar correção porque a previsão somava o agendamento *e* a linha que
   aquele agendamento já havia lançado, contando o mesmo dinheiro duas vezes.
   Neste projeto a regra é, sem exceção: **nenhum número exibido no app é
   calculado a partir de `recurrences`.** O saldo previsto de 6.1 continua
   sendo saldo atual + `entries` `pending` até o fim do período, exatamente
   como a fase 1 o implementou. As recorrências entram nesse número apenas por
   terem materializado linhas reais. O repositório `balances.ts` **não ganha
   nenhuma fonte nova** nesta fase — se ele precisar conhecer `recurrences`,
   o desenho está errado.
2. "Próximos lançamentos" é **uma janela de exibição sobre linhas que já
   existem**, não uma projeção. `GET /api/ledger/upcoming` é literalmente um
   `SELECT` de `entries` com `status='pending'` e `date` entre hoje e o fim da
   janela, ordenado por data. Nenhum cálculo de recorrência acontece na
   consulta.
3. `UpcomingPanel.tsx`: `Panel` na tela de Transações com os pendentes dos
   próximos 30 dias, agrupados por semana, cada linha com data, descrição,
   conta, valor e as ações "confirmar", "pular" e "abrir". Item com
   `amount_is_estimated` recebe um `Tag` "estimado" e o valor aparece prefixado
   por `~`. `Empty` quando não houver nada.
4. **Valor estimado e o ciclo `pending` → `cleared`.** Uma recorrência com
   `amount_is_estimated = 1` (conta de luz) materializa `entries` com o valor
   digitado como palpite, `status='pending'` e `amount_is_estimated = 1`.
   Quando a conta chega de verdade, o usuário confirma pelo
   `ConfirmAmountDialog`: um campo de valor já preenchido com a estimativa e um
   botão "confirmar". Confirmar grava o valor corrigido, muda `status` para
   `cleared` e zera `amount_is_estimated` — a linha deixa de ser estimativa e
   passa a ser fato. Confirmar **não** altera o modelo: a estimativa do mês que
   vem continua sendo a do modelo, porque o usuário é quem sabe se o novo valor
   é a nova normalidade (e nesse caso edita a série com `scope='forward'`).
5. Confirmar uma ocorrência **não** marca `recurrence_overridden`; o que a
   protege de regeneração é já estar `cleared` (Task 3, passo 7). Corrigir o
   valor de uma ocorrência que segue `pending` — porque o boleto chegou mas só
   vence semana que vem — **marca** `recurrence_overridden = 1`, senão a
   próxima passada do cron devolveria o palpite por cima da correção. Este é o
   caso de borda mais fácil de errar da fase inteira; ele precisa de teste.
6. O valor estimado entra no saldo previsto como qualquer outro `pending`
   (6.1) e **não** entra no saldo atual. Na tabela de totais e no realizado da
   divisão-alvo (6.4), que consideram o que de fato aconteceu, ele não conta
   enquanto estiver `pending` — comportamento que já vem da fase 1 e que esta
   fase apenas não deve quebrar.
7. Em `format.ts`, qualquer formatador novo — inclusive o que prefixa `~` no
   valor estimado e o que escreve a frequência por extenso — precisa honrar a
   flag de máscara do modo privacidade, com teste provando a saída mascarada
   (R-04). Um `~R$ 340,00` vazando no modo privacidade é o mesmo vazamento de
   sempre.
8. Testes obrigatórios em `balances.test.ts`, que são o motivo desta task:
   - Uma conta com saldo inicial conhecido e **uma** recorrência mensal de
     R$ 100 materializada por 12 meses tem saldo previsto de 3 meses igual a
     saldo atual − 300, e não − 600.
   - Rodar `materializeAll` **duas vezes** e recalcular: o saldo previsto não
     muda em um centavo.
   - Uma ocorrência confirmada (`cleared`) entra no saldo atual e **deixa** de
     ser somada de novo no previsto.
   - Uma ocorrência pulada desaparece dos dois saldos.
   - `GET /api/ledger/upcoming` e o saldo previsto do mesmo período somam
     exatamente o mesmo conjunto de linhas — comparar os ids, não só o total.
9. Commit: `feat(web): add upcoming entries panel with estimated amount confirmation`

---

## Critérios de aceite

- `npm test`, `npm run typecheck`, `npm run lint` e `npm run build` passam.
- Nenhuma tabela da fase 3 foi alterada e nenhum `rebuildTable` foi necessário —
  a promessa de D16 se confirma.
- Existe **um** diálogo de escopo de série no código, o da fase 3, importado
  por esta fase. Uma busca por "só esta" / "esta e as futuras" encontra um único
  componente.
- Cadastrar o aluguel como mensal, sem fim, gera 12 ocorrências pendentes e o
  saldo previsto do mês que vem cai exatamente uma vez o valor do aluguel.
- Rodar a materialização duas vezes seguidas não cria nenhuma linha nova e não
  altera nenhum saldo; o índice único parcial em
  `(recurrence_id, recurrence_sequence)` existe e é exercido por teste.
- Uma recorrência em conta de cartão distribui `statement_month` conforme 6.2,
  verificada ao longo de 12 meses com fechamento no dia 25 e com meses curtos.
- Editar o valor de uma série com "esta e as futuras" divide a série, preserva
  as ocorrências já pagas e reflete o valor novo apenas da data escolhida em
  diante.
- Editar com "todas" não altera nenhuma ocorrência `cleared`, `reconciled` ou
  com data passada.
- Pular a academia de um mês remove aquela ocorrência pendente, mantém a série
  ativa e a ocorrência **não** reaparece após nova materialização.
- Uma recorrência de valor estimado mostra `~` e o rótulo "estimado", e
  confirmá-la com outro valor grava o valor corrigido, muda para `cleared` e não
  altera o modelo.
- Abrir o app depois de duas semanas desligado materializa as ocorrências
  vencidas nesse intervalo, com a data real e como pendentes atrasadas.
- Nenhum número da interface é calculado a partir da tabela `recurrences`;
  `balances.ts` continua sem conhecê-la.
- O modo privacidade mascara todos os valores novos, inclusive os estimados, e
  há teste provando.
- O tema claro funciona na tela de recorrentes e no painel de próximos.
