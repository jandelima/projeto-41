# Fase 5 — Caixinhas com rendimento CDI

> **Para o agente:** leia [`00-plano-mestre.md`](00-plano-mestre.md) antes desta
> fase. Este documento é a fonte de verdade da fase 5. As regras das seções 4.5
> (modelo de caixinhas, CDI e feriados), 6.1 (saldos), 6.4 (o que conta como
> realizado) e 6.8 (CDI) do plano mestre valem integralmente aqui e **não podem
> ser reinterpretadas**. Onde este documento acrescenta detalhe, ele detalha —
> nunca contradiz.

- **Depende de:** fases 1 e 4
- **Habilita:** nenhuma fase posterior depende desta; é folha na árvore de
  dependências da seção 7 do plano mestre.
- **Entregável:** o usuário cria caixinhas com objetivo e prazo, deposita e
  saca por transferência, acompanha o progresso e a projeção de quando vai
  chegar ao alvo, vê o rendimento CDI realizado e o projetado separados, vê o
  valor bruto e o líquido estimado depois de IOF e IR, consulta o extrato de
  cada caixinha e identifica os movimentos de caixinha dentro do livro
  principal — tudo funcionando sem internet.
- **Decisões aplicadas:** D14, D15, D19, D20, D21, D24, D30
- **Riscos endereçados:** R-04 (máscara do modo privacidade), R-09 (série 11 ≠
  série 12)

## Escopo

**Entra:** tabelas `goals`, `goal_allocations`, `cdi_rates` e `holidays`;
calendário de dias úteis ANBIMA embarcado no repositório; motor puro de
rendimento CDI em `packages/finance`; IOF e IR regressivos; serviço de coleta
da série 12 do SGS com cache local, ETag e agendamento; rotas de caixinhas e de
status do CDI; tela de caixinhas com progresso e projeção; extrato próprio de
cada caixinha; destaque visual dos movimentos de caixinha no livro principal.

**Não entra:** caixinha em moeda estrangeira; caixinha com rendimento que não
seja percentual do CDI (prefixado, IPCA+); come-cotas (é de fundo, não se
aplica — ver Task 4); resgate programado automático; qualquer alteração no
módulo de investimentos, que continua responsável por renda fixa de verdade.

### Os dois modos, e por que existem

`goals.mode` é escolhido na criação e **nunca pode ser convertido depois**. Não
existe rota, tela nem caminho de migração que troque o modo de uma caixinha
existente; para mudar, cria-se outra e transfere-se o dinheiro.

- **`earmark`** — marcação contábil sobre o saldo de uma conta que já existe. O
  dinheiro continua na conta corrente; `goal_allocations` amarra a caixinha aos
  lançamentos que a compõem. Não movimenta saldo, não aparece duas vezes no
  patrimônio e **não rende**.
- **`account`** — conta de verdade, `accounts.kind='goal'`, com o dinheiro
  dentro dela. Depósito e saque são transferências reais.

**Regra dura: caixinha que rende tem obrigatoriamente `mode='account'`.** O
motivo é estrutural, não estético: o rendimento é creditado como um lançamento
comum (`entries.kind='income'`) numa conta, e marcação contábil não tem conta
onde creditar. As "piggy banks" do Firefly III são exatamente marcações puras e,
por isso, não conseguem render — essa limitação é a razão de o modo `account`
existir aqui. O banco recusa `cdi_percent` preenchido com `mode='earmark'` via
`CHECK`, a interface esconde a opção de rendimento quando o modo é marcação, e
há teste dos dois lados.

---

### Task 1: Esquema de caixinhas, CDI e feriados

**Files:**
- Create: `packages/db/src/migrations/006-goals-cdi.ts`
- Modify: `packages/db/src/migrations/index.ts`
- Create: `packages/db/src/migrations/006-goals-cdi.test.ts`

**Steps:**

1. O número `006` assume que as fases 2, 3 e 4 consumiram `003`, `004` e `005`.
   Antes de criar o arquivo, conferir a maior versão registrada em
   `migrations/index.ts` e usar **a próxima livre** — o runner da fase 0 rejeita
   versão duplicada e buraco na sequência.
2. Criar `goals` exatamente com as colunas de 4.5, mais as invariantes que o
   banco consegue expressar:

   ```sql
   CREATE TABLE goals (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     mode TEXT NOT NULL CHECK (mode IN ('earmark','account')),
     account_id INTEGER REFERENCES accounts(id),
     target_amount_cents INTEGER,
     target_date TEXT,
     cdi_percent REAL,
     color TEXT NOT NULL,
     icon TEXT,
     archived INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL,
     CHECK (mode = 'earmark' OR account_id IS NOT NULL),
     CHECK (cdi_percent IS NULL OR mode = 'account'),
     CHECK (cdi_percent IS NULL OR cdi_percent > 0),
     CHECK (target_amount_cents IS NULL OR target_amount_cents > 0)
   );
   ```

   O terceiro `CHECK` é a regra dura da seção "Os dois modos" acima, gravada no
   esquema para que nenhuma rota futura consiga furá-la.
3. Índice único parcial `UNIQUE(account_id) WHERE mode='account'`: uma conta
   `kind='goal'` pertence a no máximo uma caixinha. Sem isso, duas caixinhas
   apontando para a mesma conta contam o mesmo dinheiro duas vezes.
4. Criar `goal_allocations` com `PRIMARY KEY (goal_id, entry_id)`,
   `amount_cents INTEGER NOT NULL`, `ON DELETE CASCADE` nas duas FKs e índice em
   `entry_id`. A invariante de que `SUM(amount_cents)` nunca ultrapassa o saldo
   da conta **não** é expressável em `CHECK` (depende de outra tabela) e é
   responsabilidade do repositório da Task 6.
5. Criar `cdi_rates`:

   ```sql
   CREATE TABLE cdi_rates (
     date TEXT PRIMARY KEY,
     daily_factor REAL NOT NULL,
     annual_252 REAL,
     source TEXT NOT NULL CHECK (source IN ('sgs-12','seed')),
     fetched_at TEXT NOT NULL
   );
   ```

   **Armadilha de nome, documentar em comentário no topo do arquivo:** a coluna
   se chama `daily_factor` por herança de 4.5, mas guarda o **percentual ao dia
   útil publicado pela série 12** (`0.050788`), não um fator. Quem multiplicar
   essa coluna direto pelo principal erra por três ordens de grandeza. O SELECT
   do repositório usa o alias `dailyRatePercent` justamente para tornar o erro
   impossível de cometer por distração. `annual_252` guarda a série 4389 e é
   nula quando só a série 12 foi coletada.
6. **R-09:** `cdi_rates` só recebe série 12 (e 4389 em `annual_252`). A série 11
   (Selic) hoje devolve valores byte a byte idênticos, mas **nunca** pode ser
   gravada aqui nem usada como substituta. Se algum dia for necessária, ganha
   tabela própria. Registrar isso como comentário no esquema.
7. Criar `holidays (date TEXT PRIMARY KEY, name TEXT NOT NULL)`.
8. Semear `holidays` e `cdi_rates` a partir dos JSON commitados da Task 2, **só
   quando as tabelas estiverem vazias**, com `INSERT OR IGNORE`, dentro da
   transação da migração.
9. Testes: as quatro tabelas e os índices existem (`PRAGMA index_list`);
   `INSERT` de caixinha `earmark` com `cdi_percent` falha; `INSERT` de caixinha
   `account` sem `account_id` falha; duas caixinhas `account` na mesma conta
   falham; `source='sgs-11'` falha; a semeadura é idempotente ao rodar a
   migração duas vezes no mesmo banco.
10. Commit: `feat(db): add goals, cdi rates and holidays schema`

---

### Task 2: Calendário de dias úteis ANBIMA e semente offline do CDI

**Files:**
- Create: `scripts/build-reference-data.mjs`
- Create: `packages/db/src/migrations/data/feriados-anbima.json`
- Create: `packages/db/src/migrations/data/cdi-sgs12-seed.json`
- Create: `packages/db/src/migrations/data/reference-data.test.ts`
- Create: `packages/finance/src/business-days.ts`
- Create: `packages/finance/src/business-days.test.ts`
- Modify: `packages/finance/src/index.ts`

**Steps:**

1. **Nenhum pacote npm traz o calendário autoritativo.** `date-holidays` é
   derivado da Wikipédia e não serve para cálculo de dinheiro: não é a lista da
   ANBIMA, que é a que os bancos usam. **Não adicionar dependência de runtime
   para feriados.** O calendário vira JSON commitado, gerado uma única vez em
   tempo de desenvolvimento.
2. `scripts/build-reference-data.mjs` é um script de desenvolvimento, rodado à
   mão (`node scripts/build-reference-data.mjs`), **nunca** em runtime nem em
   teste. Ele faz duas coisas e grava os dois JSON:
   - baixa `https://www.anbima.com.br/feriados/arqs/feriados_nacionais.xls`
     (verificado acessível em 2026-09-21, ~111 KB, cobre até 2099) e converte a
     primeira coluna de datas em `[{ "date": "2026-09-07", "name":
     "Independência" }]`, ordenado por data;
   - baixa a série 12 do SGS desde `01/01/2018` até hoje, em janelas de no
     máximo 10 anos, e grava
     `[{ "date": "2026-09-18", "dailyRatePercent": 0.050788 }]`.
3. O arquivo da ANBIMA é `.xls` binário (BIFF), e o `readWorkbook` de
   `apps/api/src/import/xlsx-reader.ts` só abre `.xlsx` (é zip + XML). Para não
   sujar o `package.json` com uma dependência que só serve uma vez, instalar o
   SheetJS temporariamente e sem gravar
   (`npm i --no-save https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`),
   rodar o script e desinstalar. Se o download ou o parse falhar, o script sai
   com código diferente de zero e aceita o caminho manual
   `node scripts/build-reference-data.mjs --csv <arquivo.csv>`, com o `.xls`
   convertido à mão. **O artefato que importa é o JSON commitado**, não o
   script.
4. `reference-data.test.ts` valida os JSON commitados, porque um calendário
   errado corrompe dinheiro em silêncio: sem datas duplicadas; todas em
   `YYYY-MM-DD` e parseáveis; cobertura contínua de 1999 a 2099; presença de
   `2026-01-01`, `2026-02-16`, `2026-02-17` (Carnaval), `2026-04-03`
   (Sexta-feira Santa), `2026-09-07`, `2026-12-25`; a quantidade de feriados por
   ano fica entre 9 e 14. Para o CDI: valores estritamente positivos, nenhuma
   data em fim de semana ou feriado, e nenhum buraco maior que 5 dias corridos
   dentro de uma mesma semana útil.
5. `business-days.ts` é **puro e sem I/O**: recebe o conjunto de feriados
   injetado (`Set<string>` de datas ISO), nunca lê arquivo nem banco — é assim
   que `packages/finance` continua com zero dependências. Expor
   `isBusinessDay(date, holidays)`, `businessDaysBetween(from, to, holidays)`
   (intervalo fechado nas duas pontas), `nextBusinessDay`, `previousBusinessDay`
   e `countBusinessDays`.
6. Toda aritmética de data usa `YYYY-MM-DD` como string e `Date.UTC` por dentro.
   **Nunca** construir `new Date("2026-09-07")` e ler componentes locais: em
   `America/Fortaleza` isso volta um dia e transforma segunda-feira em domingo.
7. Testes de `business-days.ts` com um conjunto fixo de feriados de fixture:
   sábado e domingo não são dia útil; `2026-09-07` (Independência, segunda) não
   é; a semana de Carnaval de 2026 (`16` e `17/02` feriados) tem **3** dias
   úteis, não 5; `businessDaysBetween` do mesmo dia útil devolve 1; virada de
   ano e ano bissexto.
8. Commit: `feat(finance): add anbima business-day calendar and cdi seed`

---

### Task 3: Motor puro de rendimento CDI

**Files:**
- Create: `packages/finance/src/cdi.ts`
- Create: `packages/finance/src/cdi.test.ts`
- Create: `packages/finance/src/cdi.fixtures.ts`
- Modify: `packages/finance/src/index.ts`

**Steps:**

1. **Toda a matemática de CDI mora aqui**, pura, sem rede, sem banco e sem
   relógio: a data "hoje" é sempre parâmetro. A API só busca e guarda; a
   interface só desenha. Nenhum teste desta task toca a rede.
2. Fórmula da taxa diária, convenção do Índice DI da B3 / ANBIMA:

   ```
   TDI_k = arredonda((DI_k / 100 + 1) ^ (1 / 252) − 1, 8 casas)
   ```

   `DI_k` é a taxa **anualizada base 252** — a série 4389. Quando só existe a
   série 12 (o caso normal, porque é ela que o serviço coleta), o valor
   publicado **já é a taxa ao dia útil em percentual**, e vale
   `TDI_k = dailyRatePercent / 100`, sem elevar a nada: o BCB já aplicou a raiz
   252 e já arredondou em 8 casas na origem. Expor as duas portas
   (`tdiFromAnnual252` e `tdiFromDailyPercent`) e um teste provando que as duas
   chegam ao mesmo número para a mesma taxa.
3. Fator do dia, com o percentual do CDI da caixinha:

   ```
   fator_k = 1 + TDI_k × (p / 100)
   ```

   **A multiplicação pelo percentual é linear, jamais exponencial.**
   `(1 + TDI)^p` está errado e é o erro clássico: para 110% do CDI, o resultado
   diverge alguns centavos no primeiro mês e alguns reais no primeiro ano.
   Escrever isso como comentário na função e como nome de teste
   (`"110% do CDI é linear, não (1 + TDI) elevado a 1,1"`), comparando os dois
   resultados e afirmando qual é o certo.
4. Fator acumulado é o produtório dos fatores dos dias com taxa publicada:
   `Fator = Π fator_k`. `saldoBruto = principal × Fator`.
5. **Aportes são lotes, não um saldo único.** Cada depósito vira um lote
   `{ principalCents, startDate }`, porque o IR da Task 4 depende da idade de
   cada aporte. `accrueLots({ lots, rates, cdiPercent, from, to })` percorre os
   dias úteis com taxa publicada e devolve, por lote, o rendimento acumulado,
   mais os totais. Saque consome lotes em **FIFO**.
6. Arredondamento: o fator acumulado fica em `Number` de precisão plena; o
   arredondamento *half-up* para centavo inteiro (D19) acontece **uma vez por
   lote**, no fim, e o total é a soma dos lotes arredondados — assim o todo
   sempre fecha com as partes e não aparece diferença de 1 centavo na tela.
7. Convenção de ordem dentro do dia, a documentar e testar: o movimento entra no
   saldo **na própria data** e o fator do dia incide sobre o saldo já
   movimentado (aporte rende em D+0). Saque feito no dia `D` não rende em `D`.
8. **Realizado e projetado são campos separados, nunca somados.** O retorno tem
   `realizedYieldCents`, `realizedThroughDate`, `projectedYieldCents` e
   `projectedThroughDate`. Dia útil sem taxa publicada — inclusive hoje, porque
   o BCB publica em D+1 — só pode entrar na projeção, repetindo o último fator
   conhecido. Fim de semana e feriado **não têm linha e isso está certo**: não
   são buraco, não geram projeção e não disparam alerta. Uma função que devolva
   realizado contaminado por projeção é bug de teste vermelho, não detalhe.
9. `cdi.fixtures.ts` guarda as taxas fixas dos testes, com comentário da origem:

   ```ts
   export const cdiSetembro2026 = [
     { date: "2026-09-16", dailyRatePercent: 0.051660 },
     { date: "2026-09-17", dailyRatePercent: 0.050788 }
   ];
   ```

10. **Teste obrigatório — exemplo trabalhado.** R$ 10.000,00 (`1_000_000`
    centavos) a 110% do CDI em 16 e 17/09/2026:
    - fatores diários `1,000568260` e `1,000558668` (9 casas);
    - fator acumulado `1,00112725`;
    - saldo bruto `1_001_127` centavos = **R$ 10.011,27**;
    - rendimento `1_127` centavos.
    Afirmar os quatro números, não só o último.
11. **Teste obrigatório — semana com feriado.** Caixinha atravessando a semana
    de Carnaval de 2026: rende em 3 dias úteis (18, 19 e 20/02), não em 5; as
    linhas de 16 e 17/02 não existem na série e a ausência **não** vira
    projeção; o sábado 21 e o domingo 22 idem.
12. Testes adicionais: dois lotes com datas diferentes rendem cada um a partir
    da própria data; saque FIFO consome o lote mais antigo; série vazia devolve
    fator exatamente `1` e rendimento `0` (nunca `NaN`); `p = 100` reproduz o
    CDI cheio; principal zero devolve zero.
13. Commit: `feat(finance): add cdi accrual engine`

---

### Task 4: IOF e IR regressivos

**Files:**
- Create: `packages/finance/src/taxes.ts`
- Create: `packages/finance/src/taxes.test.ts`
- Modify: `packages/finance/src/index.ts`

**Steps:**

1. Implementa D15: a interface mostra **bruto e líquido estimado**. Tudo aqui é
   puro e trabalha em centavos inteiros. As duas alíquotas incidem **só sobre o
   rendimento, jamais sobre o principal** — errar isso faz o app dizer que o
   usuário perdeu dinheiro guardado.
2. **IOF** sobre resgate antes de 30 **dias corridos**, tabela regressiva
   commitada como array literal de 30 posições (dia 1 → 96%, dia 29 → 3%, dia
   30 em diante → 0%):

   ```
   96 93 90 86 83 80 76 73 70 66 63 60 56 53 50
   46 43 40 36 33 30 26 23 20 16 13 10  6  3  0
   ```

   `iofCents = arredonda(rendimento × alíquota(dias) / 100)`.
3. **IR/IRRF** regressivo, em dias corridos, sobre o rendimento **já líquido de
   IOF**: 22,5% até 180 · 20% de 181 a 360 · 17,5% de 361 a 720 · 15% acima de
   720. Os limites são inclusivos na faixa de baixo: 180 ainda é 22,5%, 181 já é
   20%.
4. Verificado em 2026-09-21: **estas alíquotas seguem em vigor**. A MP
   1.303/2025, que criaria alíquota única de 17,5%, caducou sem votação em
   08/10/2025. Registrar a data da verificação em comentário no topo do arquivo,
   para que uma futura revisão saiba o que reconferir.
5. **Come-cotas não se aplica** — é antecipação semestral de IR de fundo de
   investimento, e caixinha não é fundo. Não implementar, e deixar o comentário
   dizendo por quê, para ninguém "corrigir" isso depois.
6. Prever isenção: `taxExempt: boolean` no cálculo, para caixinha modelada sobre
   LCI/LCA ou poupança, que são **isentas de IR** para pessoa física. Isento
   zera o IR e mantém o IOF quando o produto o tiver.
7. API pública: `estimateRedemption({ lots, asOf, taxExempt })`, onde cada lote
   traz `{ principalCents, startDate, yieldCents }` vindo da Task 3. Devolve
   `{ grossCents, iofCents, irCents, netCents, byLot }`. **Lote a lote**, porque
   um aporte de ontem e um de dois anos atrás pagam alíquotas diferentes; somar
   tudo e aplicar uma alíquota média é errado.
8. **Teste obrigatório — fronteira do IOF:** rendimento de `10_000` centavos
   resgatado com 29 dias paga 3% (`300`) e com 30 dias paga `0`. Testar também
   dia 1 (96%) e dia 31 (0%).
9. **Teste obrigatório — cada fronteira do IR:** 180 → 22,5%; 181 → 20%; 360 →
   20%; 361 → 17,5%; 720 → 17,5%; 721 → 15%.
10. Testes adicionais: IOF e IR compostos no mesmo resgate (IR incide sobre o
    rendimento já líquido de IOF, não sobre o bruto); rendimento zero devolve
    imposto zero sem divisão por zero; rendimento negativo (impossível no CDI,
    mas o tipo permite) não gera imposto negativo; `taxExempt` zera só o IR;
    dois lotes de idades diferentes somam alíquotas diferentes.
11. Commit: `feat(finance): add iof and regressive income tax tables`

---

### Task 5: Coleta da série 12 no SGS, cache e agendamento

**Files:**
- Create: `apps/api/src/cdi/sgs-client.ts`
- Create: `apps/api/src/cdi/sgs-client.test.ts`
- Create: `apps/api/src/cdi/cdi-service.ts`
- Create: `apps/api/src/cdi/cdi-service.test.ts`
- Create: `apps/api/src/routes/cdi.routes.ts`
- Create: `apps/api/src/routes/cdi.routes.test.ts`
- Create: `packages/db/src/repositories/cdi.ts`
- Create: `packages/db/src/repositories/cdi.test.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `apps/api/src/routes/index.ts`
- Modify: `apps/api/src/jobs/scheduler.ts`
- Modify: `apps/api/src/server.ts`

**Steps:**

1. **Este é o único lugar do módulo que fala com a rede.** O padrão a copiar é o
   de `apps/api/src/icons/icon-service.ts`: fábrica
   `createCdiService(db, dataDir, fetcher: typeof fetch = fetch)`, leitura
   *read-through* (responde do banco e completa o que falta), **nunca lança** —
   degrada devolvendo o que já tem — e `fetcher` injetável para que o teste não
   use rede.
2. `sgs-client.ts` conhece a API e nada mais. Sem chave, CORS liberado,
   `cache-control` de 15 min, ETag suportado:

   ```
   GET https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados
       ?formato=json&dataInicial=dd/MM/yyyy&dataFinal=dd/MM/yyyy
   GET https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados/ultimos/{N}?formato=json
   ```

   Série **12** = CDI ao dia útil em percentual. Série **4389** = CDI anualizada
   base 252, e **exige intervalo de datas explícito** — sem `dataInicial` e
   `dataFinal` ela não responde. Datas do parâmetro em `dd/MM/yyyy`, nunca ISO.
3. Formato da resposta, com a armadilha principal:

   ```json
   [{ "data": "18/09/2026", "valor": "0.050788" }]
   ```

   **Os dois campos são string**, com ponto decimal no JSON e data em
   `dd/MM/yyyy`. Converter com `Number()` só depois de validar
   `/^-?\d+(\.\d+)?$/`; `parseFloat` em `"0,050788"` devolveria `0` em silêncio
   se algum dia o formato mudar.
4. Armadilhas verificadas ao vivo em 2026-09-21, todas com teste:
   - intervalo maior que **10 anos devolve HTTP 406** → fatiar qualquer pedido
     em janelas de no máximo 10 anos e concatenar;
   - `formato=xml` devolve JSON assim mesmo → sempre pedir `formato=json` e
     nunca confiar no formato declarado;
   - o front-end Azure/F5 devolve **página HTML de erro** de forma intermitente,
     com status 200 → antes de parsear, exigir `Array.isArray` e o formato de
     cada item; corpo começando com `<` é falha, não dado. Repetir com backoff
     (3 tentativas: 1s, 4s, 16s, com jitter) e, esgotadas, desistir em silêncio.
5. `cdi-service.ts` cuida do cache e da educação com o servidor:
   - `ensureRange(from, to)` só busca o que falta no banco, **respeitando que
     fim de semana e feriado não têm linha** — ausência nesses dias nunca conta
     como buraco e nunca dispara nova tentativa;
   - `fetchedAt` de `cdi_rates` e um arquivo `data/cdi/sgs-12.state.json`
     guardam `{ etag, lastFetchAt, lastDate }`; o ETag vai em `If-None-Match` e
     `304` é sucesso sem escrita;
   - **nunca mais que ~4 requisições por hora**: se `lastFetchAt` tem menos de
     15 minutos, responde do cache sem sair pela rede, inclusive quando chamado
     à mão;
   - grava com `source='sgs-12'` e nunca sobrescreve linha `source='seed'` com
     valor diferente sem registrar em log.
6. **Offline é requisito, não degradação aceitável.** Uma instalação que nunca
   viu a internet precisa calcular: a semente da Task 2 já dá anos de série, e o
   serviço parte dela. Com a rede fora, `ensureRange` devolve o que tem, o
   cálculo usa o realizado até a última data conhecida e o resto vira projeção
   rotulada (Task 3). Nada de erro na tela, nada de tela em branco.
7. `packages/db/src/repositories/cdi.ts`: `listRates(from, to)` com alias
   `daily_factor AS dailyRatePercent`, `upsertRates(rows)` em uma transação só,
   `lastRateDate()`, `missingBusinessDays(from, to)` (cruzando com `holidays`) e
   `listHolidays(from, to)`. Registrar em `createDatabase()`.
8. Rotas em `cdi.routes.ts`:
   - `GET /api/cdi/status` → `{ lastDate, rowCount, lastFetchAt, seededThrough,
     online, staleDays }`, a fonte do selo de "dados até <data>" na interface;
   - `POST /api/cdi/refresh` → força uma coleta **respeitando o limite de 15
     min**, devolvendo `{ ok: true, inserted, skipped, reason }` — `reason`
     explica por que não buscou, em vez de mentir dizendo que buscou.
   Mensagens de erro em português **sem acento**, como no resto de `apps/api`.
9. Agendamento em `scheduler.ts`, junto dos cron já existentes e com o mesmo
   `timezone`: `cron.schedule("20 9,13,19 * * 1-5", () => void
   cdiService.refresh(), { timezone })`. Três vezes por dia útil cobre a
   publicação D+1 do BCB e fica muito abaixo do teto de 4×/hora. Não agendar em
   fim de semana: não há o que publicar.
10. Testes com `fetcher` falso, **sem rede**: resposta HTML com status 200 é
    rejeitada e não grava nada; `406` em intervalo de 11 anos faz o cliente
    fatiar em duas janelas; `valor` com string inválida descarta a linha sem
    derrubar as demais; `304` não reescreve o banco; duas chamadas seguidas a
    `refresh()` só produzem uma requisição por causa do limite; com o `fetcher`
    lançando exceção o serviço devolve os dados semeados e `online: false`.
11. Commit: `feat(api): add bcb sgs cdi fetch service with offline cache`

---

### Task 6: Contratos e repositório de caixinhas

**Files:**
- Create: `packages/contracts/src/goals.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/db/src/repositories/goals.ts`
- Create: `packages/db/src/repositories/goals.test.ts`
- Create: `packages/finance/src/goals.ts`
- Create: `packages/finance/src/goals.test.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/finance/src/index.ts`

**Steps:**

1. Contratos, na convenção do pacote (`xxxSchema` + `export type Xxx =
   z.infer<...>`): `goalModeSchema`, `goalSchema`, `goalCreateSchema`,
   `goalUpdateSchema`, `goalDepositSchema`, `goalWithdrawalSchema`,
   `goalProgressSchema`. Dinheiro é `z.number().int()` com sufixo `Cents`; cor
   segue o regex de 6 dígitos da fase 1; data é `z.string().date()`.
2. `goalUpdateSchema` **não tem o campo `mode`**. O modo é imutável por
   contrato, por repositório e por esquema — três camadas, porque converter
   marcação em conta significaria criar dinheiro do nada.
3. `.superRefine` em `goalCreateSchema`: `cdiPercent` só é aceito com
   `mode === 'account'`, com mensagem explicando que caixinha que rende precisa
   de conta própria; `targetDate` não pode ser anterior a hoje na criação;
   `cdiPercent` entre 1 e 300.
4. `packages/db/src/repositories/goals.ts` — `list`, `get`, `create`, `update`,
   `archive`, `remove`:
   - `create` com `mode='account'` cria, na **mesma** `db.transaction()`, a
     conta `kind='goal'` com a cor e a pessoa informadas e `opening_balance_cents
     = 0`, e amarra o `account_id`. Nunca deixar caixinha sem conta pela metade.
   - `remove` só é permitido sem nenhum movimento; havendo movimento, arquiva —
     mesma regra dos cadastros da fase 1.
   - `update` ignora `mode` e `account_id` mesmo que cheguem no objeto.
5. Depósito e saque **são transferências** (D20, D21), criadas por
   `entries.createTransfer` da fase 1, nunca por dois lançamentos soltos:
   - `deposit`: `purpose='goal_deposit'`, saída da conta pagadora, entrada na
     conta da caixinha;
   - `withdraw`: `purpose='goal_withdrawal'`, o inverso;
   - as duas pontas com `category_id` nulo, como toda transferência.
6. **6.4, materializado em `counts_toward_target`** — guardar em caixinha é
   consumo adiado e entra no alvo; investir não entra. Conferir que a regra
   continua valendo e provar por teste:
   - depósito: `counts_toward_target = 1` na ponta que **sai** da conta
     pagadora, `0` na ponta que entra na caixinha (senão conta duas vezes);
   - saque: `1` na ponta que **entra** de volta na conta pagadora, `0` na outra
     — depositar e sacar o mesmo valor no mesmo período resulta em realizado
     líquido zero;
   - transferência `purpose='investment'`: `0` nas duas pontas.
   Se a fase 2 já tiver congelado a forma da agregação, seguir o que está
   implementado; esta fase define apenas o valor gravado na coluna.
7. Modo `earmark`: `allocate(goalId, entryId, amountCents)` e `deallocate`.
   **Invariante obrigatória, validada dentro da transação, antes do commit:**
   `SUM(goal_allocations.amount_cents)` de todas as caixinhas que marcam a mesma
   conta **nunca** pode ultrapassar o saldo atual daquela conta (6.1 e D24 — o
   saldo é derivado por `SUM`, nunca lido de coluna). Ultrapassar devolve erro
   com o valor disponível, e a transação inteira é desfeita.
8. `goals.progress(goalId, asOf)` monta o retorno consolidado, combinando banco
   e motor puro: saldo atual (`SUM` dos lançamentos da conta, ou `SUM` das
   alocações no modo marcação), `targetAmountCents`, `targetDate`,
   `realizedYieldCents`, `projectedYieldCents`, `grossCents`, `netCents`,
   `iofCents` e `irCents` de um resgate hipotético hoje, e a projeção da Task 6.9.
9. `packages/finance/src/goals.ts`, puro: `goalProgress` (percentual,
   `remainingCents`, dias até `target_date`) e `projectCompletion`. A projeção
   usa a **média de depósitos dos últimos 3 meses fechados** (ou desde o
   primeiro aporte, se for mais recente), soma o rendimento ao último fator
   conhecido e itera mês a mês até o alvo, com teto de 600 iterações. Ritmo zero
   devolve `null`, nunca `Infinity` nem data no ano 3000. O retorno traz
   `projectionBasis` (`'deposits' | 'deposits+yield' | 'none'`) para a interface
   poder dizer de onde saiu o número.
10. Lançamento do rendimento: `goals.accrue(goalId, through)` cria **um**
    lançamento `kind='income'` na conta da caixinha, com a categoria
    `Rendimentos` semeada na fase 1, `status='cleared'`,
    `counts_toward_target = 0` e descrição `Rendimento CDI · <período>`.
    Idempotência sem coluna nova: numa conta de caixinha toda entrada de dinheiro
    é `kind='transfer'`, logo o **único** `kind='income'` possível é rendimento —
    a última apuração é `MAX(date)` desses lançamentos, e `accrue` só apura dias
    posteriores a ela. **Nunca lançar dia projetado**: só entra no lançamento o
    rendimento de dias com taxa publicada.
11. Testes com `createDatabase(":memory:")`: criar caixinha `account` cria a
    conta junto; `update` não troca o modo; depósito cria duas linhas e uma
    transferência com `purpose='goal_deposit'`; `counts_toward_target` sai como
    descrito em 6; **`SUM(allocations)` acima do saldo da conta é rejeitado e a
    transação não deixa resíduo**; duas caixinhas marcando a mesma conta
    respeitam o limite somadas, não isoladamente; `accrue` duas vezes seguidas
    não duplica rendimento; `accrue` não cria lançamento quando só há dias
    projetados; projeção com ritmo zero devolve `null`.
12. Commit: `feat(db): add goals repository with deposit, withdrawal and accrual`

---

### Task 7: Rotas de caixinhas

**Files:**
- Create: `apps/api/src/routes/goals.routes.ts`
- Create: `apps/api/src/routes/goals.routes.test.ts`
- Modify: `apps/api/src/routes/index.ts`

**Steps:**

1. Endpoints, seguindo o prefixo `/api/ledger` da fase 1:
   - `GET /api/ledger/goals` — lista com o progresso já calculado de cada
     caixinha. A interface **nunca** calcula rendimento, imposto nem projeção.
   - `POST /api/ledger/goals`, `PUT /api/ledger/goals/:id`,
     `DELETE /api/ledger/goals/:id`.
   - `GET /api/ledger/goals/:id` — detalhe com progresso, série de saldo diário
     para o gráfico e o resumo de bruto/líquido.
   - `GET /api/ledger/goals/:id/entries` — extrato próprio da caixinha, paginado
     e no **mesmo formato** de `GET /api/ledger/entries`, para reaproveitar o
     componente de tabela da fase 1 sem adaptador.
   - `POST /api/ledger/goals/:id/deposit` e `POST /api/ledger/goals/:id/withdraw`
     — corpo `{ amountCents, date, fromAccountId | toAccountId, description? }`.
   - `POST /api/ledger/goals/:id/allocate` e `/deallocate` — só modo marcação;
     em caixinha `account` respondem `400` com mensagem explicando o modo.
   - `POST /api/ledger/goals/:id/accrue` — apura e lança o rendimento realizado.
2. Antes de responder qualquer rota de leitura de caixinha que renda, chamar
   `cdiService.ensureRange` para o período pedido. Como o serviço **nunca
   lança** e tem limite de 15 min, isso é barato e mantém a série quente sem
   transformar a rota em refém da rede.
3. Toda resposta que envolve rendimento traz **quatro números distintos e
   rotulados**: `realizedYieldCents`, `realizedThroughDate`,
   `projectedYieldCents` e `projectedThroughDate`. Não existe campo único de
   "rendimento" — se existisse, alguém somaria projeção com realizado na
   primeira refatoração.
4. Seguir a convenção do app: mutação devolve o agregado recalculado
   (`{ ok: true, goal, balances }`), para o frontend atualizar em uma ida só.
5. Erros em português sem acento; o error handler global já trata `ZodError`.
6. Testes com `app.inject` e rede stubada: criar caixinha `account` e depositar
   muda o saldo das duas contas; criar com `cdiPercent` em modo `earmark`
   devolve `400`; `allocate` acima do saldo devolve `400` com o disponível na
   mensagem; `PUT` tentando trocar `mode` não troca e responde `200` com o modo
   original; `GET /:id/entries` só devolve os lançamentos daquela caixinha;
   `404` em id inexistente; com o `fetcher` offline as rotas respondem `200` com
   `projectedYieldCents` preenchido e `online: false` no status.
7. Commit: `feat(api): add goals routes`

---

### Task 8: Tela de caixinhas

**Files:**
- Create: `apps/web/src/pages/finance/Goals.tsx`
- Create: `apps/web/src/components/finance/GoalCard.tsx`
- Create: `apps/web/src/components/finance/GoalDrawer.tsx`
- Create: `apps/web/src/components/finance/GoalDepositDrawer.tsx`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/lib/format.ts`
- Modify: `apps/web/src/styles/index.css`

**Steps:**

1. Em `App.tsx`, acrescentar **Caixinhas** ao grupo "Finanças" do array `nav`,
   estender o union `Page` e a cadeia de render. Ícone `PiggyBank` do
   `lucide-react` já presente. Sem react-router, sem react-query: dados pelo
   wrapper `api<T>()` com `useEffect`, como no resto do app.
2. `Goals.tsx` lista as caixinhas em `Card`/`Panel`, com uma faixa de `Kpi` no
   topo: total guardado, total rendendo, rendimento realizado no mês e
   rendimento projetado — os dois últimos **sempre em elementos separados**,
   nunca num número só.
3. `GoalCard.tsx`, por caixinha: nome, ícone e cor; `AnimatedNumber` com o saldo;
   barra de progresso `atual / target_amount_cents`; `Tag` com o modo
   (`Marcação` ou `Conta`); `Tag` com `110% do CDI` quando render; data-alvo e a
   projeção de conclusão em texto discreto ("no ritmo atual, alvo em fev/2027").
   Sem projeção calculável, escrever "sem ritmo de depósito para projetar" — não
   inventar data e não deixar em branco.
4. Bruto e líquido (D15): o card mostra o **bruto**; o líquido estimado aparece
   ao lado, menor, rotulado "líquido se sacar hoje", com tooltip detalhando IOF
   e IR. Quando o aporte mais novo tiver menos de 30 dias, avisar que há IOF
   incidindo e em que dia ele zera. Número sem rótulo aqui vira decisão errada
   de resgate.
5. Rendimento projetado é sempre visualmente distinto do realizado: tom
   `--text-muted`, sufixo "(projeção)" e a data da última taxa publicada
   (`GET /api/cdi/status`). Quando a série estiver atrasada, uma linha discreta
   informa "CDI atualizado até 18/09" — informação, não erro. Sem internet, a
   tela funciona inteira; nada de spinner infinito.
6. `GoalDrawer.tsx` (criar/editar), no `Drawer` de `components/dialog.tsx`, que é
   a superfície padrão de formulário do app: nome, cor (`ColorPicker` da fase 1),
   valor-alvo, data-alvo, modo via `Segmented` e, quando o modo for conta,
   percentual do CDI. **O `Segmented` de modo fica desabilitado na edição**, com
   texto explicando que o modo não muda depois de criado. Escolher marcação
   esconde o campo de CDI e mostra a frase de uma linha explicando que marcação
   não rende.
7. `GoalDepositDrawer.tsx`: depositar e sacar, com valor, data, conta de origem
   ou destino e descrição opcional. Ao sacar, mostrar antes de confirmar o IOF e
   o IR estimados do saque — é o número que o usuário recebe de verdade.
8. Em `format.ts`, os formatadores novos que a tela precisar (percentual do CDI,
   rendimento com sinal, fator). **Todo formatador de dinheiro novo precisa
   honrar a flag de máscara do modo privacidade e ter teste provando** — R-04 é
   exatamente o vazamento que acontece quando alguém acrescenta um formatador e
   esquece a máscara.
9. Estilos em `index.css`: apenas classes novas com prefixo `fin-goal-`, usando
   só os tokens de `:root` (`--surface`, `--border`, `--text-muted`,
   `--accent`…). **Nenhuma cor literal**, para o tema claro e o escuro
   continuarem corretos. A cor da caixinha entra por `style` inline vinda do
   banco, que é dado, não token.
10. Commit: `feat(web): add savings goals screen`

---

### Task 9: Extrato da caixinha e integração com o livro e o patrimônio

**Files:**
- Create: `apps/web/src/components/finance/GoalLedger.tsx`
- Modify: `apps/web/src/components/finance/EntryTable.tsx`
- Modify: `apps/web/src/components/finance/EntryFilters.tsx`
- Modify: `packages/db/src/repositories/entries.ts`
- Modify: `packages/contracts/src/ledger.ts`
- Modify: `apps/web/src/pages/finance/Goals.tsx`
- Modify: `apps/web/src/styles/index.css`

**Steps:**

1. `GoalLedger.tsx` é o extrato próprio da caixinha, aberto a partir do card:
   reutiliza `EntryTable` da fase 1 alimentado por
   `GET /api/ledger/goals/:id/entries`, mais um `AreaTrend` de
   `components/charts.tsx` com a evolução do saldo. Nada de tabela nova — o
   design das listagens é o mesmo em todo o módulo.
2. Cada linha do extrato mostra o tipo do movimento: depósito, saque ou
   rendimento. O lançamento de rendimento aparece com `Tag` própria e ícone
   distinto, porque não foi o usuário quem o criou.
3. Estender `entries.list` para devolver, por lançamento, `goalId`, `goalName` e
   `goalColor`, resolvidos por `LEFT JOIN`: pela `transfers.purpose IN
   ('goal_deposit','goal_withdrawal')` e a conta da contraparte no modo conta;
   por `goal_allocations.entry_id` no modo marcação. A interface não descobre
   isso sozinha.
4. No livro principal, movimento de caixinha ganha **tratamento visual
   distinto** — chip com a cor da caixinha e o ícone de cofrinho ao lado da
   descrição, na mesma linha. Continua sendo transferência: não vira receita nem
   despesa em relatório nenhum (D21).
5. Acrescentar `goalId` a `entryFilterSchema` e o filtro correspondente em
   `EntryFilters`, na mesma mecânica de chip removível dos outros filtros.
6. Conta `kind='goal'` entra no saldo consolidado como qualquer conta com
   `include_in_net_worth = 1` (6.1), e o degrau de D14 já foi tratado na fase 4 —
   **não recalcular nada retroativamente aqui**.
7. Dupla contagem no modo marcação: a conta corrente que sustenta marcações
   exibe "saldo livre" = saldo atual − `SUM(allocations)`, ao lado do saldo
   total. Sem isso o usuário soma a caixinha ao saldo da conta e conta o mesmo
   dinheiro duas vezes — é o mesmo problema de R-07, em escala menor.
8. Testes: `entries.list` traz `goalId` nos dois modos e `null` em lançamento
   comum; o filtro por `goalId` devolve só os movimentos da caixinha;
   transferência de caixinha continua fora dos totais de receita e despesa; o
   saldo livre da conta cai ao alocar e volta ao desalocar.
9. Commit: `feat(web): show goal movements in the main ledger`

---

## Critérios de aceite

- `npm test`, `npm run typecheck`, `npm run lint` e `npm run build` passam.
- É possível criar caixinha nos dois modos pela interface, e **não existe
  nenhum caminho** — rota, tela ou repositório — que converta um modo no outro.
- Tentar criar caixinha com rendimento em modo marcação é recusada pelo
  contrato, pela rota e pelo `CHECK` do banco, com mensagem explicando por quê.
- Depósito e saque criam transferência com `purpose='goal_deposit'` /
  `'goal_withdrawal'`, movem o saldo das duas contas e não aparecem como receita
  nem despesa em relatório nenhum.
- Um depósito em caixinha **conta** como realizado no alvo do período (6.4) e um
  aporte em investimento **não conta**, com teste provando os dois.
- O exemplo trabalhado fecha exato: R$ 10.000,00 a 110% do CDI em 16 e
  17/09/2026 devolve fator acumulado `1,00112725` e saldo `1_001_127` centavos
  (R$ 10.011,27).
- A multiplicação pelo percentual do CDI é linear, com teste que compara contra
  a forma exponencial e afirma qual é a correta.
- IOF de 29 dias cobra 3% do rendimento e de 30 dias cobra zero; cada fronteira
  de IR (180, 360, 720) tem teste dos dois lados; nenhum imposto incide sobre o
  principal.
- Uma caixinha que atravessa a semana de Carnaval de 2026 rende em 3 dias úteis,
  e a ausência de linha em feriado e fim de semana não é tratada como buraco nem
  vira projeção.
- `SUM(goal_allocations.amount_cents)` nunca ultrapassa o saldo da conta
  marcada, com teste provando que a tentativa é recusada e não deixa resíduo.
- Rendimento realizado e projetado aparecem em campos e elementos separados na
  API e na interface; nenhum lançamento é criado para dia sem taxa publicada.
- Com a rede desligada e o banco recém-criado, a tela de caixinhas abre, calcula
  a partir da série semeada, mostra até onde o CDI está atualizado e não exibe
  erro.
- O serviço do SGS não faz mais que ~4 requisições por hora, honra o ETag, fatia
  intervalos maiores que 10 anos e descarta página HTML de erro sem gravar nada.
- `cdi_rates` não contém nenhuma linha vinda da série 11 (R-09).
- O extrato próprio de cada caixinha abre com depósitos, saques e rendimentos, e
  os mesmos movimentos aparecem no livro principal com tratamento visual
  distinto.
- O modo privacidade mascara todos os valores novos, e há teste provando (R-04).
- O tema claro funciona em todas as telas novas.
