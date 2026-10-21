# Fase 6 — Importação OFX/CSV com mapeamento automático

> **Para o agente:** leia [`00-plano-mestre.md`](00-plano-mestre.md) antes desta
> fase. Este documento é a fonte de verdade da fase 6. As regras das seções 6.7
> (deduplicação), 6.2 (fatura), 6.3 (parcelamento) e 4.4 (modelo de importação)
> do plano mestre valem integralmente aqui e não podem ser reinterpretadas.

- **Depende de:** fases 1 e 3
- **Habilita:** fase 8
- **Entregável:** o usuário sobe o extrato ou a fatura exportada do banco, o
  sistema reconhece as linhas já mapeadas e as classifica sozinho, pergunta uma
  única vez por destinatário desconhecido — deixando o usuário escolher entre
  "sempre automático" e "perguntar sempre" —, mostra o que é duplicata e só
  então grava os lançamentos.
- **Decisões aplicadas:** D06, D13, D19, D22, D23, D25, D26, D27, D28

## Escopo

**Entra:** leitura de OFX 1.x e 2.x, leitura de CSV com mapeamento de colunas
persistido por conta, área de estágio (`import_batches` + `import_rows`), escada
de deduplicação de 6.7, motor de regras de dois estágios (D25), passo
interativo de mapeamento de destinatário → local + categoria com escolha entre
`auto` e `ask`, detecção de parcelas em fatura, atribuição de `statement_month`
nas linhas de cartão, commit transacional, tela de importação, tela de regras e
aplicação retroativa com pré-visualização.

**Não entra:** importação de PDF (fase 8), Open Finance ou qualquer conexão
automática com banco (fora de escopo, seção 9 do plano mestre), OCR de cupom,
criação de contas a partir do arquivo (a conta de destino é sempre escolhida
pelo usuário antes do envio).

**PDF não é o caminho principal (D13).** Parsers abertos brasileiros erram o
sinal (não há marcador confiável de crédito/débito no texto extraído), perdem o
ano (o PDF do Nubank não o imprime) e quebram o IOF em itens fantasma; cada
banco muda o layout mais ou menos uma vez por ano e a falha é **silenciosa** —
registra valor errado em vez de lançar erro. OFX traz valor tipado, data real e
id único por transação. Não inverter essa ordem.

**Disponibilidade por banco**, que a interface precisa explicar ao usuário
(Task 9):

| Banco | Como obter | Observação |
| --- | --- | --- |
| Nubank PF | Fatura **fechada** em PDF, OFX ou CSV | Fatura aberta não é exportável; as categorias do app não vêm no arquivo |
| Itaú | OFX pelo internet banking de desktop | — |
| Bradesco | OFX pelo internet banking de desktop | — |
| Banco do Brasil | OFX pelo internet banking de desktop | Expõe só os **últimos 60 dias** — a cadência de exportação importa |
| Inter | CSV pelo internet banking legado | Sem OFX no app novo |
| C6 PF | Só PDF | É a justificativa da fase 8 |

---

### Task 1: Esquema de importação e regras

**Files:**
- Create: `packages/db/src/migrations/006-import-rules.ts`
- Modify: `packages/db/src/migrations/index.ts`
- Create: `packages/db/src/migrations/006-import-rules.test.ts`

**Steps:**

1. Usar o **próximo número livre** da sequência de migrações; o runner da fase 0
   rejeita versão duplicada e buraco na sequência, então conferir o que as fases
   2 a 5 consumiram antes de fixar `006`.
2. Criar `import_batches`, `import_rows`, `rules`, `rule_conditions` e
   `rule_actions` com as colunas da seção 4.4 do plano mestre. Detalhar os
   `CHECK` que a seção 4.4 deixou em aberto:
   - `import_batches.source CHECK(source IN ('ofx','csv','pdf'))` — `'pdf'`
     entra **agora**, mesmo sem uso, para a fase 8 não precisar de rebuild
     (mesma disciplina que a fase 1 aplicou em `accounts.kind`, R-01).
   - `import_batches.status CHECK(status IN ('awaiting_mapping','review','committed','discarded'))`.
   - `import_rows.status CHECK(status IN ('new','duplicate','ignored','committed'))`,
     default `'new'`.
3. Acrescentar a `import_rows` duas colunas que a seção 4.4 não previu e que a
   revisão exige para explicar ao usuário *por que* uma linha foi marcada:
   `duplicate_of_entry_id INTEGER REFERENCES entries(id)` e
   `match_reason TEXT CHECK(match_reason IN ('external_id','content_hash','fuzzy_amount_date'))`.
   **Registrar esse acréscimo na seção 4.4 do plano mestre** — o plano mestre é
   a fonte de verdade do modelo e não pode ficar defasado.
4. Criar `import_column_mappings`, também ausente da seção 4.4 e também a
   registrar lá: `account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON
   DELETE CASCADE`, `delimiter`, `encoding`, `skip_lines INTEGER NOT NULL
   DEFAULT 0`, `has_header INTEGER NOT NULL DEFAULT 1`, `date_format`,
   `decimal_separator`, `sign_convention`, `mapping_json TEXT NOT NULL`,
   `updated_at`. Uma conta tem no máximo um mapeamento — é o que faz a segunda
   importação do mesmo banco ser um clique.
5. `import_rows.batch_id` com `ON DELETE CASCADE`: descartar um lote não
   commitado precisa levar as linhas junto.
6. Índices: `import_rows (batch_id, status)`, `import_rows (content_hash)`,
   `rules (active, stage, priority)`, `rule_conditions (rule_id)`,
   `rule_actions (rule_id)`.
7. A fase 1 deixou `entries.import_row_id` como `INTEGER` solto porque
   `import_rows` ainda não existia. Agora, **na mesma migração**, converter a
   coluna em chave estrangeira real com o helper `rebuildTable` da fase 0.
8. Ao reconstruir `entries`, **não** escrever a lista de índices à mão: ler
   `sqlite_master` (`SELECT sql FROM sqlite_master WHERE type='index' AND
   tbl_name='entries' AND sql IS NOT NULL`) e recriar exatamente o que existia,
   porque as fases 3 e 5 podem ter adicionado índices que este documento não
   conhece. O índice único parcial
   `UNIQUE(account_id, external_id) WHERE external_id IS NOT NULL` é o que dá a
   reimportação idempotente de graça e **precisa** sobreviver.
9. Semear as regras de estágio `pre` que valem para qualquer banco brasileiro e
   não dependem do usuário — prefixos de adquirente e de canal: `PAG*`, `PG*`,
   `COMPRA CARTAO`, `DEB AUTOMATICO`, `PIX ENVIADO`, `PIX RECEBIDO`,
   `TED `, `DOC `. São regras `mode='auto'`, `stage='pre'`, com ação
   `set_description`, semeadas **só quando `rules` estiver vazia**.
10. Testes: as tabelas e os índices existem; `CHECK` de `source`, `status` e
    `match_reason` rejeitam valor inválido; após o rebuild, inserir `entries`
    com `import_row_id` inexistente falha com `PRAGMA foreign_keys=ON`; o índice
    único parcial continua barrando dois `entries` com mesmo
    `(account_id, external_id)` e continua permitindo vários com `external_id`
    nulo; apagar um `import_batches` apaga suas `import_rows`; rodar a migração
    duas vezes não duplica a semeadura.
11. Commit: `feat(db): add import staging and rules schema`

---

### Task 2: Contratos Zod da importação

**Files:**
- Create: `packages/contracts/src/import.ts`
- Create: `packages/contracts/src/import.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Steps:**

1. Enums primeiro, na convenção do pacote (`xxxSchema` + `export type Xxx =
   z.infer<...>`): `importSourceSchema`, `importBatchStatusSchema`,
   `importRowStatusSchema`, `matchReasonSchema`, `ruleStageSchema`,
   `ruleModeSchema`, `ruleConditionOpSchema`, `ruleActionKindSchema`.
2. `parsedTransactionSchema` — a saída dos leitores das Tasks 3 e 4, o único
   formato que o resto da fase conhece:
   `{ lineNo, date, time?, amountCents, rawDescription, externalId?, trnType?, checkNum?, installment?: { number, total, uncertain } }`.
   `amountCents` é `z.number().int()`; `date` é `z.string().date()`; `time` é
   `HH:MM` opcional.
3. `importBatchSchema`, `importRowSchema` (com `suggestedPlaceId`,
   `suggestedCategoryId`, `duplicateOfEntryId`, `matchReason` e o
   `parsedTransaction` embutido) e `importPreviewSchema`, o agregado que a tela
   consome: `{ batch, rows, unmappedPayees, summary: { new, duplicate, ignored } }`.
4. `columnMappingSchema`: `{ delimiter, encoding, skipLines, hasHeader,
   dateFormat, decimalSeparator, signConvention, columns: Record<string, Field> }`,
   com `Field` no union
   `'date' | 'amount' | 'amount_in' | 'amount_out' | 'description' | 'type' | 'document' | 'ignore'`.
   Validar com `.superRefine` que existe exatamente um `date`, exatamente um
   `description` e **ou** um `amount` **ou** o par `amount_in`/`amount_out`.
5. `ruleSchema`, `ruleConditionSchema`, `ruleActionSchema` e `ruleDraftSchema` —
   o último é o que o passo interativo de mapeamento envia: destinatário
   normalizado, `placeId` ou nome de local novo, `categoryId`, `mode`.
6. `importCommitSchema`: `{ rowIds: number[], force: boolean }` — `force`
   permite gravar mesmo o que foi marcado como duplicata (6.7 exige essa saída).
7. `ruleApplySchema`: `{ entryIds: number[] }` — a aplicação retroativa **nunca**
   recebe "aplicar em tudo"; recebe a lista exata que o usuário deixou marcada
   na pré-visualização (R-08).
8. Commit: `feat(contracts): add import and rules schemas`

---

### Task 3: Leitor de OFX

**Files:**
- Create: `apps/api/src/import/ofx/decode.ts`
- Create: `apps/api/src/import/ofx/decode.test.ts`
- Create: `apps/api/src/import/ofx/ofx-reader.ts`
- Create: `apps/api/src/import/ofx/ofx-reader.test.ts`
- Create: `apps/api/src/import/__fixtures__/ofx/nubank-cartao.ofx`
- Create: `apps/api/src/import/__fixtures__/ofx/itau-corrente.ofx`
- Create: `apps/api/src/import/__fixtures__/ofx/bradesco-corrente.ofx`
- Create: `apps/api/src/import/__fixtures__/ofx/bb-corrente.ofx`
- Create: `apps/api/src/import/__fixtures__/ofx/acentos-cp1252.ofx`
- Create: `.gitattributes`
- Modify: `apps/api/package.json`

**Steps:**

1. Adicionar a dependência `ofx-js@1.1.1` (publicada em 2026-05-20, zero
   dependências, tipos TypeScript completos). Alternativa com normalização
   brasileira, caso se prove necessária: `ofx-data-extractor@1.5.0`.
   **Não usar** `node-ofx-parser` (2021, baseado em XML) nem `ofx` (2020):
   ambos abandonados.
2. Escrever no topo de `ofx-reader.ts` o aviso que evita a maior armadilha da
   fase: **os bancos brasileiros entregam OFX 1.x, que é SGML, não XML.** As
   tags de folha vêm sem fechamento (`<TRNAMT>-123.45` e nada de `</TRNAMT>`),
   então um parser XML genérico falha. O `fast-xml-parser` **já está** nas
   dependências de `apps/api` (usado pelo leitor de xlsx) e é justamente o que
   não pode ser usado aqui.
3. `decode.ts`: receber `Buffer` e devolver `string`. O cabeçalho declara
   `ENCODING:USASCII` com `CHARSET:1252`, mas os bytes são cp1252 de fato —
   decodificar com `new TextDecoder('windows-1252')`, embutido no Node, sem
   dependência nova. Sem isso, todo nome acentuado de estabelecimento vira
   lixo. Tratar as exceções: BOM UTF-8 no início e cabeçalho `ENCODING:UTF-8`
   levam ao `TextDecoder('utf-8')`.
4. `ofx-reader.ts` expõe uma função só, `readOfx(buffer): OfxStatement`, e
   nenhum detalhe da biblioteca escapa dela — trocar de parser depois não pode
   respingar no resto do código.
5. Detectar a versão pelo cabeçalho (`OFXHEADER:100` SGML × `OFXHEADER="200"` /
   `<?xml` XML) e seguir o caminho correspondente. OFX 2.x é raro no Brasil, mas
   é barato aceitar.
6. Cobrir os dois envelopes: extrato em
   `BANKMSGSRSV1 > STMTTRNRS > STMTRS > BANKTRANLIST > STMTTRN` e cartão em
   `CREDITCARDMSGSRSV1 > CCSTMTTRNRS > CCSTMTRS > BANKTRANLIST > STMTTRN`.
   Guardar qual dos dois veio: é o sinal de que a conta de destino deveria ser
   `credit_card` (Task 7 valida).
7. Campos por transação: `FITID` → `externalId`, `DTPOSTED` → `date` (+`time`),
   `TRNAMT` → `amountCents`, `MEMO`/`NAME` → `rawDescription` (concatenar quando
   os dois existirem e forem diferentes), `TRNTYPE` → `trnType`, `CHECKNUM`.
   Do envelope: `CURDEF` (recusar o que não for `BRL`, com mensagem clara),
   `BANKACCTFROM > ACCTID` / `CCACCTFROM > ACCTID`, `DTSTART`/`DTEND` e
   `LEDGERBAL > BALAMT`/`DTASOF`.
8. `TRNAMT` → centavos **sem passar por float** (D19): separar sinal, quebrar em
   parte inteira e decimal pela string, completar duas casas, concatenar e
   converter uma única vez com `Number`. `parseFloat(x) * 100` erra em valores
   como `1.005` e é exatamente o tipo de erro que corrompe hash de dedupe.
9. `DTPOSTED` vem como `YYYYMMDDHHMMSS[-3:BRT]`. Ler os componentes **como
   escritos**, por fatia de string; jamais passar por `new Date(...)`, que
   converte para UTC e muda o dia de toda compra feita à noite.
10. A hora quase sempre é sintética (`120000`). Preservá-la em
    `parsedTransaction.time` e em `import_rows.parsed_json`, exibi-la na
    revisão, e **não** criar coluna de hora em `entries` — a seção 4.2 do plano
    mestre não a prevê e inventar precisão que o arquivo não tem é pior do que
    não ter.
11. `FITID` é o id único da transação e é o que dá reimportação idempotente de
    graça: ele vira `entries.external_id`, protegido pelo índice único parcial
    que a fase 1 criou.
12. Fixtures **anonimizadas** e commitadas: uma por formato de banco (Nubank
    cartão, Itaú, Bradesco, BB) mais `acentos-cp1252.ofx`, com nomes como
    `AÇAÍ DA PRAÇA` e `PADARIA SÃO JOÃO` gravados em bytes cp1252 de verdade.
    Trocar números de conta, agência e nomes de pessoas por valores fictícios.
13. Criar `.gitattributes` com `*.ofx -text` e `*.csv -text`: sem isso o Git
    normaliza a quebra de linha e pode estragar os bytes que a fixture de
    acentuação existe justamente para provar.
14. Testes, todos a partir de arquivo, sem rede e sem banco: nome acentuado
    sobrevive à decodificação cp1252; tag de folha sem fechamento é lida
    corretamente; `FITID` é capturado em todas as linhas; `DTPOSTED` com
    `[-3:BRT]` não desloca o dia; `-1234.56` → `-123456` e `0.10` → `10`;
    envelope de cartão é reconhecido; extrato sem nenhuma `STMTTRN` devolve
    lista vazia em vez de lançar; arquivo truncado no meio de uma tag lança erro
    descritivo em português sem acento, como no resto de `apps/api`.
15. Commit: `feat(api): add brazilian OFX reader`

---

### Task 4: Leitor de CSV com mapeamento de colunas

**Files:**
- Create: `apps/api/src/import/csv/csv-rows.ts`
- Create: `apps/api/src/import/csv/csv-reader.ts`
- Create: `apps/api/src/import/csv/csv-reader.test.ts`
- Create: `apps/api/src/import/__fixtures__/csv/nubank-fatura.csv`
- Create: `apps/api/src/import/__fixtures__/csv/inter-extrato.csv`
- Create: `apps/api/src/import/__fixtures__/csv/bb-extrato.csv`
- Modify: `apps/api/src/export/operations-csv.ts`

**Steps:**

1. **CSV não tem padrão** — cada banco inventa o seu. O leitor não adivinha:
   ele propõe e o usuário confirma, e o que foi confirmado fica salvo em
   `import_column_mappings` por conta.
2. `csv-rows.ts` recebe a função `parseCsvRows` que hoje está privada em
   `apps/api/src/export/operations-csv.ts`, acrescentando o parâmetro
   `delimiter`. `operations-csv.ts` passa a importar daí — nada de segunda cópia
   de parser de CSV no repositório.
3. Detecção automática, toda ela apenas uma **sugestão** pré-preenchida na tela:
   - Codificação: BOM ou bytes UTF-8 válidos → `utf-8`; caso contrário
     `windows-1252`, reaproveitando `decode.ts` da Task 3.
   - Delimitador: contar `;`, `,` e `\t` na primeira linha não vazia e escolher
     o mais frequente. `;` é o mais comum em banco brasileiro.
   - Preâmbulo: pular as linhas iniciais até a primeira que tenha o mesmo número
     de campos das seguintes — o Inter imprime nome do titular, conta e período
     antes do cabeçalho.
   - Formato de data: `dd/mm/yyyy`, `dd/mm/yy` e `yyyy-mm-dd`.
   - Decimal: vírgula quando houver `1.234,56`; ponto quando houver `1234.56`.
4. `readCsv(buffer, mapping)` devolve a mesma `ParsedTransaction[]` da Task 3,
   com `externalId` sempre `undefined` — CSV não tem FITID, e é por isso que a
   dedupe de CSV depende inteiramente dos degraus 2 e 3 da escada.
5. Suportar as duas convenções de valor: coluna única assinada (`amount`,
   `signConvention='signed'`) e par débito/crédito (`amount_in`/`amount_out`,
   `signConvention='split_columns'`), comum em Bradesco e BB. Em coluna única
   com `signConvention='debit_positive'`, inverter o sinal.
6. Converter valor para centavos pela string, como na Task 3: remover `R$`,
   separador de milhar e espaços, trocar vírgula por ponto, e só então quebrar
   em inteiro/decimal. Nada de `Number(texto) * 100`.
7. Persistir o mapeamento confirmado em `import_column_mappings` com
   `account_id` como chave. Na importação seguinte da mesma conta, o leitor
   aplica o mapeamento salvo e o lote já nasce em `status='review'`, pulando o
   passo de mapeamento de colunas.
8. Se o cabeçalho do arquivo novo não bater com o mapeamento salvo (nomes ou
   quantidade de colunas diferentes), **não** aplicar em silêncio: voltar para
   `awaiting_mapping` avisando que o layout mudou.
9. Fixtures anonimizadas: Nubank fatura (UTF-8, vírgula, `date,title,amount`),
   Inter extrato (cp1252, `;`, com preâmbulo e coluna de saldo a ignorar), BB
   extrato (cp1252, `;`, débito e crédito em colunas separadas).
10. Testes: acentos em CSV cp1252; delimitador `;` detectado; preâmbulo do Inter
    descartado; `1.234,56` → `123456`; colunas débito/crédito separadas geram
    sinais corretos; `dd/mm/yyyy` vira ISO; mapeamento salvo é reaplicado sem
    perguntar; cabeçalho divergente derruba para `awaiting_mapping`; mapeamento
    sem coluna de data é rejeitado listando o que falta.
11. Commit: `feat(api): add csv statement reader with saved column mapping`

---

### Task 5: Normalização de descritor e motor de regras

**Files:**
- Create: `packages/finance/src/descriptor.ts`
- Create: `packages/finance/src/descriptor.test.ts`
- Modify: `packages/finance/src/index.ts`
- Create: `apps/api/src/import/rules-engine.ts`
- Create: `apps/api/src/import/rules-engine.test.ts`

**Steps:**

1. `descriptor.ts` fica em `packages/finance` porque é matemática de string
   pura, sem dependência e sem banco. Ele exporta:
   - `normalizeDescriptor(raw)`: minúsculo, sem acento (NFD), sem pontuação,
     espaços colapsados. É a mesma normalização de `places.normalized_name` da
     fase 1 — reaproveitar o helper compartilhado extraído lá, nunca escrever
     uma segunda.
   - `stripBankNoise(raw)`: remove prefixos de adquirente e canal (`PAG*`,
     `PG*`, `COMPRA CARTAO`, `DEB AUTOMATICO`) e o sufixo numérico de terminal
     (` 04`, ` - 12`), que é o que separa `PAG*SUPERM SAO LUIZ 04` de
     `SUPERM SAO LUIZ`.
   - `titleCasePtBr(text)`: `sao luiz` → `São Luiz`, mantendo `de`, `da`, `do`,
     `dos`, `e` em minúsculo.
   - `parseInstallmentLabel(raw)`: reconhece `PARCELA 3/7`, `PARC 03/07`,
     `(3/7)` e `3/7` no fim do texto, devolvendo `{ number, total, uncertain }`.
2. Guarda contra falso positivo em `parseInstallmentLabel`: aceitar `n/m` sem
   palavra-chave **só** no fim do descritor, com `m` entre 2 e 72 e `n <= m`. Se
   os dois números forem menores ou iguais a 12 e não houver palavra-chave, pode
   ser uma data (`01/07`) — devolver `uncertain: true` e deixar a decisão para o
   usuário na revisão, em vez de inventar um parcelamento.
3. `rules-engine.ts` é puro: recebe as regras já carregadas e devolve o
   resultado, sem tocar no banco. Assinatura
   `applyRules(rules: LoadedRule[], input: RuleInput): RuleOutcome`.
4. Dois estágios, nunca mais (D25):
   - `pre` normaliza o descritor cru em local/destinatário:
     `PAG*SUPERM SAO LUIZ 04` → local `São Luiz`.
   - `default` mapeia local → categoria.
   O estágio `pre` roda inteiro antes do `default`; dentro de cada estágio a
   ordem é `priority` crescente e o desempate é o `id`.
5. Condições (`rule_conditions.op`): `contains`, `equals` e `regex` sobre o
   descritor cru, `amount_between` e `account_is`. Todas as condições de uma
   regra são `AND`; "ou" se escreve como duas regras.
6. `regex` é entrada do usuário: compilar dentro de `try/catch`, limitar o
   padrão a 200 caracteres e, ao falhar a compilação, **desativar a regra e
   reportar** em vez de derrubar a importação inteira.
7. Ações (`rule_actions.action`): `set_place`, `set_category`,
   `set_description`, `set_tag`, `set_person`, `ignore`. `ignore` marca a linha
   como `'ignored'` e interrompe o processamento dela.
8. `stop_processing` interrompe o estágio corrente; o estágio seguinte ainda
   roda.
9. `rules.mode` é o que separa o Assaí do Lucas, e sai de graça dos dois
   estágios: escreve-se uma regra de estágio `default` para o supermercado e
   **simplesmente não se escreve nenhuma** para o amigo.
   - `mode='auto'`: a sugestão é aplicada em silêncio, a linha nasce pronta.
   - `mode='ask'`: a sugestão é pré-preenchida, mas a linha entra na fila do
     passo interativo e exige confirmação a cada importação.
10. `raw_description` é **imutável para sempre** (D25) e é gravado ao lado do
    local resolvido. É ele que permite reprocessar a normalização meses depois,
    quando uma regra mudar — sem ele, o descritor original se perde e a
    reclassificação vira adivinhação.
11. Testes de `descriptor.ts`: `PAG*SUPERM SAO LUIZ 04` → `São Luiz`;
    `ASSAI ATACADISTA` e `Assaí Atacadista` normalizam igual; `PARCELA 3/7` e
    `PARC 03/07` viram `{3,7}`; `UBER 01/07` devolve `uncertain: true`.
12. Testes do motor: regra `contains` casa sem depender de acento nem de caixa;
    `priority` decide entre duas regras que casam; `stop_processing` impede a
    terceira; `regex` inválida desativa só aquela regra; `ignore` encerra;
    linha sem regra alguma sai sem sugestão e entra na fila de perguntas;
    `mode='ask'` entra na fila **mesmo tendo casado**.
13. Commit: `feat(finance): add descriptor normalization and rules engine`

---

### Task 6: Deduplicação

**Files:**
- Create: `apps/api/src/import/dedupe.ts`
- Create: `apps/api/src/import/dedupe.test.ts`
- Create: `packages/db/src/repositories/dedupe-lookup.ts`
- Modify: `packages/db/src/index.ts`

**Steps:**

1. Implementar a escada de 6.7, **nessa ordem**, parando no primeiro degrau que
   decidir:
   1. `external_id` (FITID) igual na mesma conta — decide sozinho, sem consultar
      mais nada.
   2. Hash de conteúdo igual.
   3. Valor exato igual dentro de ±7 dias.
2. O hash de conteúdo cobre um subconjunto **estável** e nada além dele:
   `sha256(accountId + '|' + date + '|' + amountCents + '|' + normalizeDescriptor(rawDescription))`.
   **Nunca** incluir id resolvido de local, categoria ou pessoa: é exatamente o
   bug Firefly III #4124, em que o hash carregava um id de conta que ainda não
   existia na primeira importação e a mesma linha entrava duas vezes. Escrever
   esse motivo em comentário no arquivo, para ninguém "melhorar" o hash depois.
3. O mesmo hash é gravado em `entries.content_hash` e em
   `import_rows.content_hash`, calculado pela mesma função — duas
   implementações divergem em um mês.
4. Guarda do degrau 3 (`strictIdChecking`, do Actual Budget): duas linhas que
   **ambas** tenham `external_id` e os tenham **diferentes** nunca casam por
   aproximação. Ids diferentes são prova de transações diferentes; a
   aproximação só vale quando pelo menos um dos lados não tem id.
5. Contagem por multiconjunto, não por existência: se o arquivo traz três
   estacionamentos idênticos no mesmo dia e o banco já tem um, apenas **uma**
   linha é marcada como duplicata e as outras duas seguem como `'new'`. Casar
   por "existe pelo menos um igual" apagaria duas despesas reais.
6. Um lançamento já usado como par de uma linha do lote não pode ser reusado
   como par de outra — consumir os candidatos conforme forem casando.
7. Linhas `entries.status='reconciled'` são **imutáveis** e a importação jamais
   as altera, vincula ou apaga. Elas continuam valendo como prova de duplicata
   (para não recriar o que já foi conciliado), mas o commit nunca escreve nelas.
8. Registrar em `import_rows.match_reason` e `duplicate_of_entry_id` qual degrau
   decidiu e contra qual lançamento — o usuário precisa poder discordar com
   informação na tela.
9. **Nada é descartado em silêncio.** O resultado sempre informa
   "N ignoradas como duplicadas" com opção de forçar a importação (`force` da
   Task 2). O falso positivo de três estacionamentos iguais no mesmo dia é
   inevitável no degrau 3 — a granularidade é de data, não de hora — e a saída
   para ele é o usuário, não uma heurística mais esperta.
10. Deixar explícito no topo do arquivo: a tabela `imports` com
    `fingerprint TEXT PRIMARY KEY` que já existe em `packages/db/src/index.ts` é
    **de nível de arquivo** e serve ao importador de planilha; ela **não** serve
    aqui e não deve ser reutilizada. `import_batches.file_hash` guarda o sha256
    do arquivo apenas para **avisar** "este arquivo já foi importado em
    DD/MM" — nunca para bloquear, porque um lote parcialmente commitado precisa
    poder ser reenviado.
11. `dedupe-lookup.ts` carrega os candidatos de uma vez (conta, janela de datas
    do lote ±7 dias, com `id`, `date`, `amount_cents`, `external_id`,
    `content_hash`, `status`) para que a classificação seja uma função pura
    sobre memória, testável sem banco.
12. Testes: importar o mesmo OFX duas vezes cria lançamentos na primeira e
    **zero** na segunda; hash pega a linha repetida de um CSV sem FITID;
    ±7 dias casa em 7 e não casa em 8; duas linhas com `external_id`
    **diferentes** e mesmo valor e data não casam por aproximação; três linhas
    idênticas no mesmo dia contra uma existente resultam em 1 duplicata e 2
    novas; linha `reconciled` é reconhecida como duplicata e não sofre nenhum
    `UPDATE`; `force` grava mesmo a linha marcada.
13. Commit: `feat(api): add import deduplication ladder`

---

### Task 7: Serviço de importação em estágios

**Files:**
- Create: `packages/db/src/repositories/imports.ts`
- Create: `packages/db/src/repositories/imports.test.ts`
- Create: `packages/db/src/repositories/rules.ts`
- Create: `packages/db/src/repositories/rules.test.ts`
- Create: `apps/api/src/import/ledger-import-service.ts`
- Create: `apps/api/src/import/ledger-import-service.test.ts`
- Modify: `packages/db/src/index.ts`

**Steps:**

1. A importação é **sempre em estágios, nunca direta para o livro**. O arquivo
   vira `import_batches` + `import_rows`; o usuário revisa; só o commit cria
   `entries`. Nenhum caminho alternativo "importar direto" deve existir — é ele
   que transforma um erro de mapeamento em faxina manual de 300 linhas.
2. `imports.createBatch(input)`: grava o lote, insere as linhas com `raw_json`
   (a linha como veio) e `parsed_json` (a `ParsedTransaction`), roda o motor de
   regras (Task 5), roda a dedupe (Task 6) e devolve o `importPreview`.
3. Validar a conta antes de qualquer coisa: envelope de cartão em conta que não
   é `credit_card` (e o contrário) vira aviso claro; linha com data anterior a
   `accounts.opening_date` é aceita mas sinalizada, porque ela muda o saldo
   inicial que o usuário digitou.
4. Fila de destinatários desconhecidos: agrupar as linhas sem sugestão por
   `normalizeDescriptor(rawDescription)` e devolver **um item por
   destinatário**, com a contagem de linhas afetadas. Perguntar por linha em vez
   de por destinatário transformaria 40 compras no mesmo mercado em 40
   perguntas.
5. `imports.resolvePayee(batchId, draft)`: cria o local via
   `places.findOrCreate` (fase 1), cria a regra de estágio `pre`
   (descritor → local) e, quando houver categoria, a de estágio `default`
   (local → categoria), com o `mode` escolhido pelo usuário — `auto` para o
   Assaí, `ask` para o Lucas —, e reaplica as regras a **todas** as linhas do
   lote que casam. A regra nasce como efeito colateral da resposta; o usuário
   nunca precisa abrir a tela de regras para o caso comum.
6. `imports.commit(batchId, { rowIds, force })` roda dentro de **uma**
   `db.transaction()`:
   - cria os `entries` com `raw_description` preenchido, `external_id`,
     `content_hash`, `import_row_id` e as sugestões já resolvidas;
   - marca as `import_rows` como `'committed'` com o `entry_id`;
   - atualiza `committed_count` e `status='committed'` do lote;
   - devolve `{ ok: true, balances, committed, duplicates, ignored }`, seguindo
     a convenção do app de que mutação devolve o agregado recalculado.
   Qualquer erro no meio desfaz tudo: meio lote gravado é pior que nenhum.
7. Cartão (D22, 6.2): toda linha destinada a conta `credit_card` recebe
   `statement_month` calculado pelo helper da fase 3 a partir de `closing_day` e
   `due_day` — não recalcular a regra aqui, **importar a função**. A revisão
   mostra em qual fatura cada linha vai cair, porque é perto da virada do mês
   que o usuário percebe que exportou o arquivo errado.
8. Parcelas (D23): quando `parseInstallmentLabel` reconhecer `3/7`, oferecer na
   revisão duas saídas, ambas explícitas:
   - **vincular a um plano existente** — busca por conta + descrição
     normalizada + `installment_count`, gravando `installment_plan_id` e
     `installment_number`;
   - **criar o plano** a partir da linha, com total estimado
     (`valor × total`) marcado como estimativa editável.
   O vínculo é sempre persistido, nunca reconstruído depois por
   descrição/valor/data (lição do SolverFin #662).
9. Consequência que precisa de tratamento explícito: um plano criado hoje já
   gera os lançamentos das parcelas futuras, e o extrato do mês que vem trará a
   parcela real, com FITID novo. Por isso a revisão tem uma terceira ação de
   linha, **"vincular a lançamento existente"**, que grava `external_id`,
   `content_hash` e `import_row_id` no lançamento já existente em vez de criar
   outro. Ela é proibida em linha `reconciled`.
10. `imports.discard(batchId)` apaga o lote não commitado e suas linhas. Lote
    commitado não é apagável — o histórico de importação é auditoria.
11. `rules.ts`: `list` (com condições e ações agregadas), `get`, `create`,
    `update`, `remove`, `reorder` e `preview(ruleId, filter)`, que devolve os
    lançamentos que a regra atingiria **sem gravar nada**, já excluindo
    `status='reconciled'`.
12. `rules.applyRetroactive(ruleId, entryIds)`: aplica só nos ids recebidos,
    dentro de uma transação, pulando qualquer `reconciled` que tenha escapado, e
    devolve quantos foram alterados. É onde usuário perde dado (R-08): nenhuma
    variante "aplicar em tudo" pode existir na API.
13. Testes: lote é criado com as linhas classificadas; responder um destinatário
    cria local, regra e reclassifica todas as linhas dele; `mode='ask'` não some
    da fila na importação seguinte e `mode='auto'` some; commit cria os
    `entries` e atualiza as linhas; erro no meio do commit não deixa nada
    gravado; linha de cartão recebe `statement_month` correto na virada do mês;
    parcela `3/7` vinculada ao plano grava `installment_number`; "vincular a
    lançamento existente" não cria linha nova e é recusada em `reconciled`;
    `preview` de regra não altera nada; `applyRetroactive` altera só os ids
    marcados e nenhuma linha `reconciled`.
14. Commit: `feat(api): add staged ledger import service`

---

### Task 8: Rotas de importação e de regras

**Files:**
- Create: `apps/api/src/routes/ledger-import.routes.ts`
- Create: `apps/api/src/routes/ledger-import.routes.test.ts`
- Create: `apps/api/src/routes/rules.routes.ts`
- Create: `apps/api/src/routes/rules.routes.test.ts`
- Modify: `apps/api/src/routes/index.ts`

**Steps:**

1. Um plugin por recurso, registrado em `routes/index.ts`, na convenção fixada
   pela fase 0 (D27). Nada de rota nova em `app.ts`.
2. Upload em `POST /api/ledger/imports` (multipart: `file`, `accountId`,
   `source`). O `@fastify/multipart` já foi registrado na fase 1 para as fotos —
   **reaproveitar a configuração**, sem registrar o plugin duas vezes, e manter
   a mesma disciplina de limpeza: gravar em temporário com `pipeline`, apagar em
   `finally`, e apagar o parcial e responder 413 quando `part.file.truncated`
   ou `FST_REQ_FILE_TOO_LARGE` (R-06). Limite de 10 MB para extrato — nenhum OFX
   honesto chega perto disso.
3. O arquivo enviado **não é armazenado**: ficam só `file_name`, `file_hash` e
   as linhas em `import_rows`. Nunca usar o nome enviado pelo cliente para
   compor caminho em disco.
4. Endpoints da importação:
   - `GET /api/ledger/imports` — histórico de lotes.
   - `GET /api/ledger/imports/:id` — lote, linhas e fila de destinatários.
   - `PUT /api/ledger/imports/:id/mapping` — envia o mapeamento de colunas do
     CSV, reprocessa as linhas e leva o lote de `awaiting_mapping` a `review`.
   - `POST /api/ledger/imports/:id/payees` — resolve um destinatário (local,
     categoria, `mode`) e devolve as linhas reclassificadas.
   - `PUT /api/ledger/imports/:id/rows/:rowId` — ajuste manual de uma linha:
     local, categoria, pessoa, descrição, status `ignored`, forçar mesmo
     duplicada, ou vincular a um lançamento existente.
   - `POST /api/ledger/imports/:id/commit` — corpo validado por
     `importCommitSchema`; devolve `{ ok: true, balances, committed, duplicates, ignored }`.
   - `DELETE /api/ledger/imports/:id` — descarta lote não commitado; 409 em lote
     já commitado.
   - `GET|PUT /api/ledger/imports/column-mappings/:accountId` — mapeamento de
     CSV salvo da conta.
5. Endpoints de regras: `GET|POST /api/ledger/rules`,
   `PUT|DELETE /api/ledger/rules/:id`, `POST /api/ledger/rules/reorder`,
   `POST /api/ledger/rules/:id/preview` e `POST /api/ledger/rules/:id/apply`
   (corpo `ruleApplySchema`).
6. Mensagens de erro em português **sem acento**, como no restante de
   `apps/api`; o error handler global já trata `ZodError`.
7. Testes com `app.inject`: subir a fixture do Itaú cria o lote com as linhas
   esperadas; subir **a mesma fixture de novo** e commitar não cria nenhum
   lançamento (idempotência por FITID, ponta a ponta); CSV sem mapeamento salvo
   volta `awaiting_mapping` com o cabeçalho detectado; enviar o mapeamento leva
   a `review`; commit devolve os saldos recalculados; commit de lote já
   commitado responde 409; arquivo acima do limite responde 413 sem deixar
   arquivo em disco; `POST /rules/:id/apply` com id de lançamento `reconciled`
   não altera aquela linha.
8. Commit: `feat(api): add import and rules routes`

---

### Task 9: Tela de importação

**Files:**
- Create: `apps/web/src/pages/finance/Import.tsx`
- Create: `apps/web/src/pages/finance/import-help.ts`
- Create: `apps/web/src/components/finance/ImportDropzone.tsx`
- Create: `apps/web/src/components/finance/ColumnMapper.tsx`
- Create: `apps/web/src/components/finance/PayeeMapper.tsx`
- Create: `apps/web/src/components/finance/ImportReview.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles/index.css`

**Steps:**

1. Em `App.tsx`, acrescentar **Importar** ao grupo "Finanças" do array `nav`,
   estender o union `Page` e a cadeia de render. Ícone do `lucide-react` já
   presente. Dados pelo wrapper `api<T>()` + `useEffect` — sem react-query, sem
   react-router.
2. A tela é um assistente de quatro passos, com `Segmented` mostrando onde se
   está: **Arquivo → Colunas (só CSV) → Destinatários → Revisão**.
3. Passo 1: escolher a conta, arrastar o arquivo (`.ofx`, `.csv`), ver o
   progresso do envio e tratar o 413 com mensagem explícita sobre o limite.
   Ao lado, um painel de ajuda alimentado por `import-help.ts` com a tabela de
   disponibilidade por banco deste documento — incluindo que a fatura **aberta**
   do Nubank não é exportável e que o BB só dá 60 dias, então exportar todo mês
   não é preciosismo.
4. Passo 2 (`ColumnMapper`): tabela com as cinco primeiras linhas do arquivo e,
   no cabeçalho de cada coluna, um `select` com os campos de destino. Vem
   pré-preenchido pela detecção da Task 4. Mostra a conversão ao vivo ("
   `1.234,56` → R$ 1.234,56 ") para o usuário ver que acertou antes de
   confirmar. Confirmar salva o mapeamento na conta e o passo some nas próximas
   importações.
5. Passo 3 (`PayeeMapper`): **um destinatário por vez**, com o descritor cru em
   destaque, quantas linhas ele afeta e uma amostra delas. O usuário escolhe
   local (autocomplete de `places`, com opção de criar) e categoria, e decide
   entre **"Sempre automático"** e **"Perguntar toda vez"** num `Segmented` —
   é a diferença entre o Assaí, que é sempre Mercado, e o Lucas, para quem se
   manda valor arbitrário. Uma terceira saída, "Ignorar sempre", cria a regra
   com ação `ignore`. Botão de pular deixa a linha sem categoria em vez de
   forçar uma escolha ruim.
6. Passo 4 (`ImportReview`): `<table className="data-table">` dentro de
   `.table-scroll`, como no resto do app. Colunas: seleção, data, descritor cru
   (em fonte menor, sempre visível — é ele que o usuário reconhece), local,
   categoria, pessoa, fatura (só cartão), valor e situação. Linha duplicada vem
   desmarcada, com `Tag` explicando o motivo (`match_reason`) e link para o
   lançamento existente; marcar de novo é o "forçar importação".
7. Rodapé fixo com a contagem que 6.7 exige — "X a importar · **N ignoradas
   como duplicadas** · Y ignoradas por regra" — e o botão de commit. Depois do
   commit, mostrar o resultado e o caminho para o livro filtrado por aquele
   lote.
8. Linha reconhecida como parcela mostra o rótulo `3/7` e o seletor de plano
   (vincular a existente ou criar). Parcela com `uncertain: true` aparece como
   pergunta, nunca como fato consumado.
9. Todo valor na tela passa por `moneyFromCents` de
   `apps/web/src/lib/format.ts`, que honra a máscara do modo privacidade —
   formatador novo que a ignore vaza valor (R-04).
10. Reaproveitar `Drawer`, `Segmented`, `Button`, `Tag`, `Empty`, `Skeleton`,
    `Card` e `Panel` de `components/ui.tsx` e `components/dialog.tsx`, e
    `useConfirm()` para descartar lote. Estilos apenas como classes novas com
    prefixo `fin-` em `index.css`, usando só tokens (`--surface`, `--border`,
    `--text-muted`, `--accent`): nenhuma cor literal, para o tema claro
    continuar funcionando.
11. Commit: `feat(web): add statement import wizard`

---

### Task 10: Tela de regras e aplicação retroativa

**Files:**
- Create: `apps/web/src/pages/finance/Rules.tsx`
- Create: `apps/web/src/components/finance/RuleDrawer.tsx`
- Create: `apps/web/src/components/finance/RulePreview.tsx`
- Modify: `apps/web/src/App.tsx`

**Steps:**

1. Acrescentar **Regras** ao grupo "Finanças" do `nav` e ao union `Page`.
2. Lista em `<table className="data-table">` com estágio, nome, condições
   resumidas, ações resumidas, modo (`auto`/`ask` como `Tag`), prioridade e
   ativo. Agrupada por estágio, `pre` antes de `default`, para o usuário
   enxergar a ordem de execução como ela é.
3. `RuleDrawer`: nome, estágio, prioridade, ativo, `stop_processing`, modo, e as
   listas de condições e ações, ambas com adicionar e remover. Campo de `regex`
   mostra erro de compilação na hora, não no meio de uma importação.
4. Reordenar por prioridade com setas — nada de arrastar-e-soltar, que exigiria
   biblioteca nova.
5. `RulePreview` é obrigatório antes de qualquer aplicação retroativa (R-08):
   `POST /rules/:id/preview` devolve os lançamentos atingidos, a tabela mostra
   valor atual e valor proposto lado a lado, **tudo marcado por padrão mas cada
   linha desmarcável**, e só os ids marcados vão para `POST /rules/:id/apply`.
6. Lançamentos `reconciled` nem aparecem na pré-visualização; exibir o aviso de
   quantos foram excluídos por isso, para o usuário não achar que sumiram.
7. Confirmar a aplicação com `useConfirm()`, dizendo o número exato de
   lançamentos que serão alterados. Aplicar regra retroativamente é a operação
   mais destrutiva do módulo — ela sobrescreve categorização feita à mão.
8. Depois de aplicar, oferecer o desfazer barato: link para o livro filtrado
   pelos lançamentos alterados. Não implementar undo transacional.
9. Commit: `feat(web): add rules screen with retroactive preview`

---

## Critérios de aceite

- `npm test`, `npm run typecheck`, `npm run lint` e `npm run build` passam.
- Subir um OFX de extrato registra os lançamentos com data, valor, categoria e
  local, sem digitação, e o saldo da conta reflete o lote imediatamente.
- **Subir o mesmo arquivo duas vezes não cria nenhum lançamento na segunda vez**,
  e a tela informa quantas linhas foram ignoradas como duplicadas.
- Nome acentuado de estabelecimento aparece correto na revisão e no livro — há
  fixture cp1252 no repositório provando a decodificação.
- Um OFX 1.x com tags de folha sem fechamento é lido sem erro; nenhum parser XML
  genérico é usado no caminho do OFX.
- Destinatário desconhecido é perguntado **uma vez por destinatário**, não por
  linha, e a resposta cria local, regra e classificação das demais linhas do
  lote.
- Destinatário marcado como "Sempre automático" não é perguntado na importação
  seguinte; marcado como "Perguntar toda vez" é perguntado de novo.
- CSV de banco sem OFX é importado pelo mapeamento de colunas, e a segunda
  importação da mesma conta não pede o mapeamento outra vez.
- Duas linhas com `external_id` diferentes, mesmo valor e datas próximas **não**
  são tratadas como duplicata.
- Três lançamentos idênticos no mesmo dia contra um já existente resultam em uma
  duplicata e dois novos, e o usuário consegue forçar a importação da duplicata.
- Nenhum lançamento `reconciled` é alterado por importação ou por aplicação
  retroativa de regra, e há teste provando.
- Linha de cartão cai na fatura correta, inclusive em compra feita no dia do
  fechamento.
- Linha `PARCELA 3/7` é reconhecida e o usuário consegue vinculá-la a um plano
  existente ou criar um, com o vínculo persistido.
- Erro no meio do commit não deixa lançamento nenhum gravado.
- O modo privacidade mascara todos os valores das telas novas, e há teste
  provando.
- O tema claro funciona nas telas de importação e de regras.
