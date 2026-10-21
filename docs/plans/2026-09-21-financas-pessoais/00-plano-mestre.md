# Finanças Pessoais — Plano Mestre

> **Para o agente:** este documento é a fonte de verdade do módulo de finanças
> pessoais. Ele define decisões, modelo de dados e regras de negócio válidas
> para **todas** as fases. Cada fase tem um documento próprio com o passo a
> passo de implementação. Em caso de conflito entre um documento de fase e este
> arquivo, **este arquivo vence** — e o documento de fase deve ser corrigido.

- **Data:** 2026-09-21
- **Status:** aprovado, aguardando implementação
- **Fases:** 9 (0 a 8)
- **Escopo da primeira entrega utilizável:** fases 0, 1 e 2

---

## 1. Objetivo

Adicionar ao Projeto 41 um módulo completo de finanças pessoais — livro-caixa de
entradas e saídas — que conviva com o módulo de investimentos já existente e
compartilhe com ele o conceito de patrimônio.

O usuário é um casal (Steylor e Bianca) que divide as finanças, mantém contas
bancárias separadas e conjuntas, e quer responder três perguntas com precisão:

1. **Quanto eu tenho?** — saldo por conta, saldo consolidado, e patrimônio
   somando investimentos.
2. **Para onde foi?** — gasto por categoria, por pessoa, por período, com
   comparação contra um alvo.
3. **Estou dentro do combinado?** — comparação entre o que cada pessoa deveria
   gastar (alvo acordado entre o casal) e o que de fato gastou.

## 2. Princípios e restrições herdados do app

Estas não são escolhas do módulo; são o contexto em que ele precisa caber.

| Princípio | Consequência prática |
| --- | --- |
| Roda só em `127.0.0.1`, sem login | Nenhuma noção de usuário autenticado. "Pessoa" é um rótulo de dados, não uma conta de acesso. Nada de multi-tenancy. |
| Dados locais em `data/`, nunca versionados | Fotos, banco e cache de CDI ficam em `data/`. Backup é responsabilidade explícita do módulo (fase 1). |
| Funciona offline | Toda dependência externa (CDI) precisa de cache local e de um caminho de degradação sem internet. |
| Monorepo npm workspaces | `packages/contracts` (Zod), `packages/db`, `packages/finance` (matemática pura, zero deps), `apps/api`, `apps/web`. |
| Node 22.13+ | Confirmado no ambiente: 22.19.0. |
| Design system "Aurora" | CSS único em `apps/web/src/styles/index.css` com tokens em `:root` e tema claro/escuro via `[data-theme]`. Nada de biblioteca de UI nova. |
| Modo privacidade ("olho") | `format.ts` mascara valores via flag de módulo. **Todo formatador novo de dinheiro precisa honrar a máscara**, ou valores vazam no modo privacidade. |
| Sem react-router, sem react-query | Navegação é `type Page` + `useState` em `App.tsx`; dados via wrapper `api<T>()` e `useEffect`. Seguir o padrão existente. |
| Testes co-locados em Vitest | `*.test.ts(x)` ao lado do fonte; banco de teste com `createDatabase(":memory:")`. |
| Quarteto de verificação | `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` precisam passar ao fim de cada tarefa. |

## 3. Decisões tomadas

Cada linha foi decidida explicitamente com o usuário em 2026-09-21. **Não
revisitar sem confirmação.**

### 3.1 Produto

| # | Decisão | Motivo |
| --- | --- | --- |
| D01 | **Pessoa e Conta são entidades separadas.** Conta pertence a uma pessoa; a transação escolhe a conta e herda a pessoa, podendo sobrescrever. | Permite "quanto a Bianca gastou" somando várias contas dela, e "saldo do Nubank" isolado. Pessoa pode ser do tipo `joint` (Conjunto). |
| D02 | **Cada transação é 100% de um autor.** Não existe rateio proporcional de uma despesa entre pessoas. | Pedido explícito do usuário. O que existe é alvo de divisão (D03), não divisão da despesa. |
| D03 | **Divisão-alvo entre autores**, em dois modos: proporcional à renda ou bolo comum. Detalhado na seção 6.4. | Funcionalidade original do usuário; não existe pronta em nenhum app pesquisado. |
| D04 | **Cartão de crédito com ciclo real** (dia de fechamento e dia de vencimento). A data da compra decide em qual fatura ela cai. | Sem isso a fatura do app nunca bate com a do banco perto da virada do mês. |
| D05 | **Categorias planas** (sem subcategoria), com nome, cor livre (roda RGB) e tipo entrada/saída. **Etiquetas livres e múltiplas** cobrem cortes transversais. | Relatório por categoria fica limpo; etiquetas evitam inflar a taxonomia. |
| D06 | **Local é entidade reutilizável** com autocomplete e categoria padrão opcional. | Base do mapeamento automático da importação; evita "Assaí", "assai" e "ASSAI" como três coisas. |
| D07 | **Foto na fase 1, completa**: upload, redimensionamento, miniatura na listagem e visualização ampliada. | Anexar depois não acontece: ninguém volta em transação antiga. |
| D08 | **Status pago/pendente** em todo lançamento, habilitando saldo atual vs saldo previsto. | Campo de primeira classe nos apps brasileiros; adicionar depois exige migração dolorosa. |
| D09 | **Orçamento opcional por categoria**, exibido como `500/800` na tabela de totais, em vermelho ao estourar. | Pedido explícito. |
| D10 | **Comparativo entre períodos** por categoria, além da rosca de composição. | A rosca mostra composição; o comparativo mostra tendência. |
| D11 | **Vale-refeição é um tipo de conta próprio**, fora do saldo bancário. | Dinheiro que existe, não é saldo em banco e só gasta em certas categorias. |
| D12 | Cartão inclui **limite**, **estorno/reembolso** e **antecipação de parcelas**. **Pagamento parcial de fatura está fora.** | Escolha do usuário. |
| D13 | **Importação OFX/CSV primeiro; PDF é fase opcional posterior.** | Pesquisa: parsers de PDF abertos erram sinal, ano e parcelas, e cada banco quebra o layout ~1×/ano; o erro é silencioso. OFX traz valor, data e ID único (dedupe grátis) e cobre Nubank, Itaú, Bradesco, BB e Inter. |
| D14 | **Caixa e caixinhas entram no patrimônio total**, com degrau explícito no histórico no dia em que o controle começa. Nada é recalculado retroativamente. | Honesto: não inventa passado nem quebra a comparabilidade silenciosamente. |
| D15 | **Caixinhas rendem por CDI, com bruto e líquido estimado** (IOF nos primeiros 30 dias e IR regressivo). | É o número que se recebe ao sacar. |
| D16 | **Lançamentos recorrentes existem, em fase própria posterior** (fase 7). O modelo de série da fase 3 já nasce preparado. | Alta valor, mas fora da primeira entrega. |
| D17 | **Posições manuais de caixa/reserva coexistem** com as contas reais do novo módulo. | Escolha do usuário. Exige aviso de dupla contagem na interface (ver R-07). |
| D18 | **Ponto de partida é o saldo inicial por conta**; o histórico anterior só entra quando a importação existir (fase 6). | Escolha do usuário. |

### 3.2 Técnicas

| # | Decisão | Motivo |
| --- | --- | --- |
| D19 | **Dinheiro em centavos, como `INTEGER`**, em todas as tabelas novas. As tabelas antigas de investimento continuam em `REAL`. | Float erra R$ 100 em 3 parcelas e corrompe hash de deduplicação (`12.00000001` ≠ `12.0`). A conversão acontece só na fronteira entre os módulos. |
| D20 | **Lançamento assinado por conta + tabela de transferências** (`entries` + `transfers`), e não partidas dobradas completas nem colunas `from/to`. | Padrão do Maybe Finance. Colunas `from/to` quebram quando os dois lados têm datas e status diferentes — exatamente o caso do cartão. |
| D21 | **Transferência nunca tem categoria** e nunca entra em relatório de receita/despesa. | Senão o pagamento de fatura vira despesa e conta o gasto duas vezes. |
| D22 | **Sem tabela `invoices`.** A fatura é derivada, mas o mês de fatura fica **armazenado** em `entries.statement_month`. | Precisa ser armazenado porque a antecipação de parcelas move um lançamento de fatura explicitamente. |
| D23 | **Parcelamento é plano + N lançamentos reais** (`installment_plans` + `entries` com `installment_number`). O vínculo é persistido, nunca reconstruído por descrição/valor/data. | Lição documentada do SolverFin #662. Total e número de parcelas viram somente-leitura após a criação. |
| D24 | **Saldos são derivados por `SUM`**, nunca armazenados. Snapshot diário existe só para o gráfico de histórico. | Saldo corrente armazenado é fonte recorrente de bug no Firefly III (#11892, #12118, #9278). Consistente com o princípio do app de recalcular valores derivados. |
| D25 | **Motor de regras em dois estágios**: `pre` normaliza destinatário → local; `default` mapeia local → categoria. `raw_description` é imutável para sempre. | É o que separa o Assaí (sempre Mercado) do Lucas (varia): escreve-se a regra de estágio `default` para um e não para o outro. |
| D26 | **Sistema de migrações versionadas** antes de qualquer tabela nova. Hoje não existe: `migrate()` é um bloco único de `CREATE TABLE IF NOT EXISTS` com um helper `ensureColumn`. | Um `CHECK` não pode ser ampliado sem rebuild de tabela; o módulo vai precisar de alterações reais de esquema. |
| D27 | **Rotas Fastify modularizadas em plugins** antes da fase 1. `app.ts` já tem 261 linhas e ~30 rotas inline. | O módulo dobraria o arquivo. |
| D28 | **`apps/web` passa a importar `@projeto41/contracts`** em vez de duplicar tipos à mão em `lib/types.ts`. | O módulo é grande demais para manter duas cópias dos tipos. Quebra precedente conscientemente. |
| D29 | **Fotos**: `@fastify/multipart` em streaming → `sharp` `.autoOrient().resize(1600).webp({quality:80})` + miniatura 320px, armazenamento endereçado por conteúdo (sha256). Original é descartado por padrão. | 5.000 recibos: ~1,15 GB em vez de ~21,6 GB. `sharp` tem binário pronto para Windows; não usa node-gyp. |
| D30 | **CDI vem da série 12 do SGS do Banco Central**, com feriados ANBIMA embarcados no repositório como JSON. | API verificada ao vivo em 2026-09-21: sem chave, CORS liberado, cache de 15 min. |

## 4. Modelo de dados

Convenções: nomes de tabela e coluna em `snake_case`; SELECT devolve `camelCase`
por alias, como no resto do app. Datas são `TEXT` ISO `YYYY-MM-DD`; timestamps
são ISO-8601 completos. **Todo valor monetário é `INTEGER` em centavos e o nome
da coluna termina em `_cents`.** Chaves primárias são `INTEGER PRIMARY KEY
AUTOINCREMENT`.

### 4.1 Cadastros

```
people
  id, name UNIQUE, kind CHECK('individual','joint'), color, active, created_at

accounts
  id, person_id → people, name, kind, institution, color, icon,
  opening_balance_cents, opening_date,
  closing_day, due_day, credit_limit_cents, payment_account_id → accounts,   -- só cartão
  include_in_net_worth (default 1), archived, sort_order, created_at
  kind CHECK('checking','savings','cash','meal_voucher','credit_card','investment','goal')

categories
  id, name, kind CHECK('income','expense'), color NOT NULL, icon,
  monthly_budget_cents NULL, archived, sort_order, created_at
  UNIQUE(name, kind)

tags
  id, name UNIQUE, color

places
  id, name, normalized_name UNIQUE, default_category_id → categories,
  notes, created_at
```

`normalized_name` é `name` sem acento, minúsculo e sem pontuação — é a chave de
deduplicação e a ponte com a importação.

### 4.2 Livro

```
entries                                     -- o lançamento
  id,
  account_id → accounts NOT NULL,
  person_id → people,                       -- herdado da conta, sobrescrevível
  date NOT NULL,                            -- data do fato
  amount_cents NOT NULL,                    -- assinado: negativo = saída
  kind CHECK('expense','income','transfer','adjustment') NOT NULL,
  status CHECK('pending','cleared','reconciled') NOT NULL DEFAULT 'cleared',
  category_id → categories,                 -- NULL obrigatório se kind='transfer'
  place_id → places,
  description, notes,
  raw_description,                          -- imutável, vindo da importação
  payment_method CHECK('cash','debit','pix','credit','voucher','other'),
  statement_month,                          -- 'YYYY-MM' da fatura, só cartão
  installment_plan_id → installment_plans,
  installment_number,
  parent_entry_id → entries,                -- divisão de um lançamento
  refund_of_entry_id → entries,             -- estorno
  counts_toward_target NOT NULL DEFAULT 1,
  external_id,                              -- FITID do OFX
  import_row_id → import_rows,
  content_hash,
  created_at, updated_at

  INDEX (account_id, date), (date), (category_id, date), (person_id, date)
  UNIQUE (account_id, external_id) onde external_id NOT NULL

transfers
  id, from_entry_id UNIQUE NOT NULL, to_entry_id UNIQUE NOT NULL,
  purpose CHECK('generic','invoice_payment','investment','goal_deposit',
                'goal_withdrawal','settlement'),
  created_at
  CHECK(from_entry_id <> to_entry_id)

entry_tags
  entry_id → entries, tag_id → tags, PRIMARY KEY(entry_id, tag_id)

attachments
  id, entry_id → entries, file_path, thumb_path, content_hash UNIQUE,
  mime, byte_size, width, height, original_name, created_at

installment_plans
  id, account_id → accounts, description, purchase_date,
  total_cents, installment_count, place_id, category_id, created_at
```

**Invariantes obrigatórias, cobertas por teste:**

- `SUM(entries.amount_cents)` das parcelas de um plano = `total_cents` do plano.
  A distribuição do resto vai para a **primeira** parcela.
- Um `transfer` liga exatamente duas `entries`, de contas diferentes, com
  `amount_cents` opostos e `category_id IS NULL` nas duas.
- `entries.category_id IS NULL` sempre que `kind = 'transfer'`.
- `entries.statement_month IS NOT NULL` sempre que a conta é `credit_card`.

### 4.3 Alvos

```
budget_periods                              -- um por mês, criado sob demanda
  period PK,                                -- 'YYYY-MM'
  split_mode CHECK('none','income_proportional','pooled'),
  total_expense_target_cents,               -- teto de gasto do período inteiro;
                                            -- base do rateio nos modos 'none' e
                                            -- 'income_proportional'. Quando nulo,
                                            -- cai para a soma dos orçamentos de
                                            -- categoria.
  pooled_income_cents,                      -- modo bolo comum
  joint_expense_target_cents,               -- modo bolo comum
  created_at, updated_at

person_period_budgets
  person_id → people, period, income_override_cents, target_override_cents,
  PRIMARY KEY(person_id, period)
```

### 4.4 Importação

```
import_batches
  id, source CHECK('ofx','csv','pdf'), account_id → accounts, file_name,
  file_hash, imported_at, status, row_count, committed_count,
  adapter_id, layout_version,               -- fase 8 (021): qual adapter leu o PDF
  reconciliation_status CHECK('match','mismatch'),
  reconciliation_json                       -- eixos da conciliação e avisos do lote

import_rows
  id, batch_id → import_batches, line_no, raw_json, parsed_json,
  external_id, content_hash,
  status CHECK('new','duplicate','ignored','committed','needs_review'),
                                            -- 'needs_review' só é usado pela
                                            -- fase 8 (PDF), mas nasce no CHECK
                                            -- da fase 6 para não exigir
                                            -- rebuild de tabela depois (R-01)
  entry_id → entries, suggested_place_id, suggested_category_id,
  duplicate_of_entry_id → entries,          -- qual lançamento casou
  match_reason,                             -- 'external_id' | 'hash' | 'fuzzy'
  confidence, sign_known DEFAULT 1,         -- fase 8 (021): só linha de PDF
  source_page, source_line, warnings_json

import_column_mappings                      -- memória do mapeamento de CSV
  id, account_id → accounts, source_label, mapping_json,
  created_at, last_used_at
  UNIQUE(account_id, source_label)

rules
  id, name, stage CHECK('pre','default'), priority, active,
  mode CHECK('auto','ask'),                 -- Assaí = auto, Lucas = ask
  stop_processing, created_at

rule_conditions
  id, rule_id → rules, field, op CHECK('contains','equals','regex',
  'amount_between','account_is'), value

rule_actions
  id, rule_id → rules,
  action CHECK('set_place','set_category','set_description','set_tag',
               'set_person','ignore'), value
```

### 4.5 Caixinhas e CDI

```
goals
  id, name, mode CHECK('earmark','account'), account_id → accounts,
  target_amount_cents, target_date, cdi_percent, color, icon,
  archived, created_at

goal_allocations                            -- só modo earmark
  goal_id → goals, entry_id → entries, amount_cents

cdi_rates
  date PK, daily_rate_percent, annual_252, source, fetched_at
  -- daily_rate_percent guarda o valor da série 12 como vem: PERCENTUAL ao dia
  -- útil (0.050788 = 0,050788%), não um fator. Nomear de "factor" convidaria a
  -- multiplicar o saldo por 0,05 e perder 95% do dinheiro.

holidays
  date PK, name                             -- ANBIMA, embarcado no repositório
```

### 4.6 Infraestrutura

```
schema_migrations
  version PK, name, applied_at
```

## 5. Arquitetura

```
apps/web  ──HTTP──>  apps/api  ──>  packages/db        (repositórios, migrações)
                             ├──>  packages/finance    (matemática pura)
                             └──>  packages/contracts  (Zod, compartilhado com web)
```

- **`packages/finance`** ganha os cálculos puros do módulo: divisão de parcelas
  com resto, fator DI acumulado, IOF/IR, apuração dos alvos, agregação por
  categoria. Zero dependências, 100% testável sem banco.
- **`apps/api`** ganha plugins Fastify por recurso, registrados a partir de
  `app.ts`, que deixa de ter rotas inline.
- **`apps/web`** ganha um grupo de navegação novo ("Finanças") no array `nav` de
  `App.tsx`, com as páginas do módulo.

### Caminhos reais do frontend

Confirmados no repositório em 2026-09-21. Documento de fase que cite caminho
diferente destes está errado.

| O quê | Caminho |
| --- | --- |
| Shell, navegação, union `Page` | `apps/web/src/app/App.tsx` |
| Componentes base | `apps/web/src/components/ui.tsx` |
| Modal, Drawer, `useConfirm` | `apps/web/src/components/dialog.tsx` |
| Gráficos Recharts, `Donut` | `apps/web/src/components/charts.tsx` |
| Seletor de data | `apps/web/src/components/datepicker.tsx` |
| Wrapper de fetch | `apps/web/src/lib/api.ts` |
| Formatadores e máscara de privacidade | `apps/web/src/lib/format.ts` |
| Tema e paleta de séries | `apps/web/src/lib/theme.tsx` |
| CSS único | `apps/web/src/styles/index.css` |
| Páginas existentes | `apps/web/src/pages/*.tsx` (plano) |

As páginas e componentes do módulo ficam em subpastas próprias
(`pages/finance/`, `components/finance/`), quebrando conscientemente o padrão
plano atual: são cerca de oito telas novas contra sete existentes, e misturá-las
tornaria a pasta ilegível.

## 6. Regras de negócio críticas

Estas regras valem para todas as fases e **não podem ser reinterpretadas** pelo
documento de uma fase.

### 6.1 Saldos

- **Saldo atual** de uma conta = `opening_balance_cents` + soma dos lançamentos
  com `date <= hoje` e `status IN ('cleared','reconciled')`.
- **Saldo previsto** de uma conta no período = saldo atual + soma dos
  lançamentos `pending` com `date <= fim do período`.
- **Saldo consolidado** = soma dos saldos das contas com
  `include_in_net_worth = 1`, **excluindo** contas `credit_card`.
- **Saldo devedor do cartão** = −(soma de todos os lançamentos da conta do
  cartão). Reportado como **dois números distintos**: *fatura atual* (só o
  `statement_month` corrente) e *total devido* (tudo, inclusive parcelas
  futuras).

### 6.2 Fatura do cartão

- Cada cartão tem `closing_day` e `due_day`.
- Um lançamento com data `D` pertence à fatura cujo fechamento é a **primeira
  data de fechamento maior ou igual a `D`**. Compra no próprio dia do fechamento
  entra nessa fatura.
- `statement_month` é o mês do **vencimento** dessa fatura, em `YYYY-MM`. Se
  `due_day <= closing_day`, o vencimento é no mês seguinte ao fechamento.
- Meses sem o dia (fechamento 31 em fevereiro) usam o último dia do mês.
- `statement_month` é calculado na escrita e **pode ser sobrescrito** — é assim
  que a antecipação de parcelas funciona.
- Pagamento da fatura é um `transfer` com `purpose='invoice_payment'`, jamais
  uma despesa.

### 6.3 Parcelamento

- O usuário informa total e número de parcelas; o sistema gera N lançamentos com
  valores iguais, jogando o resto dos centavos na primeira parcela.
- Cada valor de parcela é editável individualmente; ao editar, o sistema **não**
  redistribui automaticamente, mas avisa se a soma deixou de bater com o total.
- Rótulo no livro: `3/7`. A **última** parcela recebe destaque visual discreto.
- Total e número de parcelas são somente-leitura depois de criados. Para mudar,
  exclui-se o plano (que remove as parcelas não pagas) e recria.
- Trocar o cartão de um plano atualiza o plano e todas as parcelas futuras
  **atomicamente**, numa transação só.

### 6.4 Divisão-alvo entre autores

O alvo compara **quanto cada pessoa deveria gastar** contra **quanto gastou**.
Três modos, configurados por período em `budget_periods`:

**Modo `none` (solo ou sem divisão)** — existe apenas um alvo de gasto total,
opcional, guardado em `budget_periods.total_expense_target_cents`. Quando esse
campo é nulo, o alvo do período é a soma dos orçamentos de categoria (6.5); se
não houver nenhum, a comparação alvo × realizado simplesmente não é exibida.

**Modo `income_proportional`** — cada pessoa é responsável por uma fatia dos
gastos proporcional à sua renda no período.
- Renda de cada pessoa = soma dos lançamentos `kind='income'` do período
  atribuídos a ela, **com override manual** em
  `person_period_budgets.income_override_cents` para meses atípicos.
- Percentual da pessoa = renda dela ÷ renda total do casal.
- Alvo da pessoa = percentual × `total_expense_target_cents` do período, com a
  mesma regra de fallback do modo `none`.
- Exemplo do usuário: rendas de 2.500 e 5.000 → 33,3% e 66,7%.

**Modo `pooled` (bolo comum)** — o casal junta a renda, reserva um teto para os
gastos conjuntos e divide o restante igualmente.
- `pooled_income_cents` = 7.500; `joint_expense_target_cents` = 4.000.
- Sobra = 3.500, dividida igualmente → 1.750 por pessoa.
- Os 4.000 são o teto dos gastos do autor **`joint`** (Conjunto).
- Os 1.750 são o teto dos gastos **pessoais** de cada pessoa.
- O dashboard mostra três barras: Conjunto, Steylor, Bianca.
- A sobra **zera todo mês**; não acumula.

**O que conta como realizado**, em qualquer modo:
- Conta: lançamentos `kind='expense'`.
- Conta: transferências com `purpose='goal_deposit'` — guardar em caixinha é
  consumo adiado, então entra no alvo.
- **Não conta**: transferências com `purpose='investment'` — o objetivo do alvo
  é justamente sobrar dinheiro para investir.
- Não conta: nenhuma outra transferência, nem estorno (que abate a despesa
  original).
- A coluna `entries.counts_toward_target` materializa essa derivação e permite
  exceção manual caso a caso.

### 6.5 Orçamento por categoria

- `categories.monthly_budget_cents` é opcional.
- Na tabela de totais por período, uma categoria com orçamento mostra
  `gasto/orçamento` (ex.: `500/800`); ao ultrapassar, o par inteiro fica em
  vermelho.
- Categoria sem orçamento mostra só o valor gasto. Nada de placeholder.

### 6.6 Estorno

Um estorno é um lançamento de sinal oposto com `refund_of_entry_id` apontando
para a despesa original. Ele **abate a despesa** nos relatórios de categoria e
no alvo, e **não** aparece como receita. Estorno de compra parcelada entra
integral de uma vez, enquanto as parcelas seguem correndo — o relatório precisa
tolerar isso sem ficar negativo na categoria.

### 6.7 Deduplicação na importação

Escada, nessa ordem:
1. `external_id` (FITID do OFX) único por conta — decide sozinho.
2. Hash de conteúdo sobre um subconjunto **estável**: conta, data, valor em
   centavos, descrição normalizada. **Nunca** sobre ids resolvidos (é o bug
   Firefly III #4124).
3. Mesmo valor exato dentro de ±7 dias, com a guarda de não casar duas linhas
   que carreguem `external_id` diferentes.

Toda linha marcada como duplicada registra **qual** lançamento ela casou
(`import_rows.duplicate_of_entry_id`) e **por qual regra da escada**
(`match_reason`). Sem isso, "N ignoradas como duplicadas" é uma afirmação que o
usuário não tem como conferir nem contestar.

Linhas `reconciled` são imutáveis e nunca são tocadas pela importação. O
resultado sempre informa "N ignoradas como duplicadas" com opção de forçar.

### 6.8 CDI

- Fonte: SGS do Banco Central, série **12** (CDI diário, % ao dia útil) e série
  **4389** (anualizada base 252), em
  `https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json`.
- **A série 12 já publica a taxa diária**, em percentual por dia útil
  (`0.050788` significa 0,050788% naquele dia). Logo
  `TDI_k = valor_série_12 / 100`, **sem** elevar a nada.
- A conversão `TDI_k = (1 + valor_série_4389 / 100)^(1/252) − 1` só se aplica
  quando se parte da série **4389**, que é anualizada base 252. Os dois caminhos
  precisam chegar ao mesmo número, e isso é um teste obrigatório:
  `(1 + 13,65/100)^(1/252) − 1 = 0,00050788`, exatamente o valor da série 12 no
  mesmo dia. Aplicar `^(1/252)` sobre a série 12 seria um erro silencioso que
  reduziria o rendimento a praticamente zero.
- Arredondar o TDI em 8 casas.
- `Fator = Π (1 + TDI_k × p/100)`, onde `p` é o percentual do CDI da caixinha.
  **A multiplicação pelo percentual é linear, não exponencial.**
- `Saldo bruto = principal × Fator`.
- **IOF**: resgates antes de 30 dias corridos, tabela regressiva 96%→0%,
  incidindo só sobre o rendimento.
- **IR**: 22,5% até 180 dias · 20% de 181 a 360 · 17,5% de 361 a 720 · 15% acima
  de 720, em dias corridos, sobre o rendimento já líquido de IOF.
- Fim de semana e feriado **não têm linha** na série — isso é correto, não é
  falha. O BCB publica em D+1, então hoje sempre falta.
- Rendimento projetado (repetindo o último fator conhecido) é sempre exibido
  **rotulado como projeção**, jamais somado silenciosamente ao realizado.

## 7. Fases

| Fase | Entrega | Depende de | Documento |
| --- | --- | --- | --- |
| 0 | Fundação técnica: migrações versionadas, centavos, plugins Fastify, contratos compartilhados | — | [fase-0](fase-0-fundacao-tecnica.md) |
| 1 | Núcleo do livro-caixa: pessoas, contas, categorias, etiquetas, locais, lançamentos, transferências, filtros, fotos, backup | 0 | [fase-1](fase-1-nucleo-livro-caixa.md) |
| 2 | Dashboard, relatórios, orçamento por categoria e divisão-alvo | 1 | [fase-2](fase-2-dashboard-relatorios-alvos.md) |
| 3 | Cartão de crédito, fatura, parcelamento, limite, estorno, antecipação | 1 | [fase-3](fase-3-cartao-fatura-parcelamento.md) |
| 4 | Integração com investimentos e patrimônio unificado | 1 | [fase-4](fase-4-investimentos-patrimonio.md) |
| 5 | Caixinhas com rendimento CDI | 1, 4 | [fase-5](fase-5-caixinhas-cdi.md) |
| 6 | Importação OFX/CSV com mapeamento automático | 1, 3 | [fase-6](fase-6-importacao-ofx-csv.md) |
| 7 | Lançamentos recorrentes | 3 | [fase-7](fase-7-lancamentos-recorrentes.md) |
| 8 | Importação de PDF (opcional, fallback por banco) | 6 | [fase-8](fase-8-importacao-pdf.md) |

**Primeira entrega utilizável: fases 0, 1 e 2.** A partir daí o app já serve para
o uso diário; as demais fases são incrementos independentes e podem ser
reordenadas conforme a necessidade, respeitando a coluna de dependências.

## 8. Riscos

| # | Risco | Mitigação |
| --- | --- | --- |
| R-01 | Ampliar um `CHECK` existente exige rebuild de tabela — `ensureColumn` só adiciona colunas. | Sistema de migrações da fase 0 precisa suportar o padrão rebuild: criar nova, copiar, dropar, renomear, tudo em transação. |
| R-02 | `operations.portfolio` tem `CHECK(portfolio IN ('crypto','b3'))`. A fase 4 adiciona `account_id` — só coluna, sem tocar no CHECK. | Nenhuma fase deve tentar ampliar esse CHECK. |
| R-03 | Somar caixa ao patrimônio muda o significado de todo snapshot histórico. | D14: degrau explícito, `payload` versionado, marca no gráfico. Nada retroativo. |
| R-04 | Modo privacidade é uma flag de módulo em `format.ts`; um formatador novo que a ignore vaza valores. | Teste obrigatório em cada formatador novo, verificando a saída mascarada. |
| R-05 | `sharp` pode faltar no Windows por bug de dependência opcional do npm (npm/cli#4828). | Documentar `npm install --include=optional`; o `npm ci` da instalação já cobriu o caso, mas vale nota no README. |
| R-06 | Truncamento de upload deixa arquivo parcial em disco. | `fs.unlink` em `finally` ao detectar `part.file.truncated` ou `FST_REQ_FILE_TOO_LARGE`. Limite explícito de `fileSize` — o padrão de 1 MiB corta foto de celular. |
| R-07 | D17 mantém posições manuais de caixa/reserva convivendo com contas reais: risco de contar o mesmo dinheiro duas vezes. | A tela de patrimônio da fase 4 exibe aviso quando existirem posições manuais de `cash`/`reserve` **e** contas do módulo com saldo. |
| R-08 | Aplicar regras retroativamente pode sobrescrever categorização feita à mão. | Sempre com pré-visualização desmarcável; nunca tocar em linhas `reconciled`. |
| R-09 | Série 11 (Selic) e 12 (CDI) estão idênticas hoje, mas podem divergir. | Armazenar como séries separadas; nunca usar uma como substituta da outra. |

## 9. Fora de escopo

Decidido explicitamente que **não** entra, em nenhuma fase:

- Rateio proporcional de uma despesa entre pessoas (D02) e acerto de contas
  "quem deve a quem".
- Pagamento parcial de fatura e rotativo com juros (D12).
- Mês financeiro configurável começando fora do dia 1º.
- Contas a pagar com lembrete/notificação.
- Subcategorias (D05).
- Open Finance, integração bancária automática, OCR de cupom fiscal.
- Multimoeda no livro-caixa: tudo em BRL. O módulo de investimentos segue
  cuidando de USD.
- Autenticação, multiusuário real, qualquer exposição fora de `127.0.0.1`.

## 10. Glossário

| Termo | Significado neste projeto |
| --- | --- |
| **Lançamento** (`entry`) | Uma linha assinada no livro, pertencente a exatamente uma conta. |
| **Transferência** | Par de lançamentos ligados, que move dinheiro entre contas próprias sem virar receita nem despesa. |
| **Autor / Pessoa** | Steylor, Bianca ou Conjunto. Rótulo de dados, não login. |
| **Conta** | Onde o dinheiro está: corrente, dinheiro vivo, VR, cartão, investimento ou caixinha. |
| **Fatura** (`statement`) | Conjunto de lançamentos de um cartão com o mesmo `statement_month`. Derivada, sem tabela própria. |
| **Caixinha** (`goal`) | Dinheiro separado com um objetivo, rendendo CDI. Pode ser marcação sobre uma conta ou conta de verdade. |
| **Alvo** | Quanto se pretendia gastar, por pessoa ou por categoria, no período. |
| **Realizado** | Quanto de fato foi gasto, pela regra de 6.4. |
| **Local** (`place`) | Estabelecimento ou destinatário, reutilizável e com categoria padrão. |
