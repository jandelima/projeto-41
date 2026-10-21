# Fase 8 — Importação de PDF (opcional)

> **Para o agente:** leia [`00-plano-mestre.md`](00-plano-mestre.md) antes desta
> fase. Este documento é a fonte de verdade da fase 8. A escada de deduplicação
> da seção 6.7 e o motor de regras de D25 valem integralmente aqui e não podem
> ser reinterpretados. **Antes de escrever qualquer linha de código, leia a
> seção "Quando pular esta fase inteira" abaixo e confirme com o usuário que ela
> deve mesmo ser feita.**

- **Depende de:** fase 6
- **Habilita:** nada — é a última fase, folha e opcional
- **Entregável:** o usuário envia o PDF de um extrato ou fatura de um banco que
  **não** exporta OFX, o sistema extrai as linhas, confere a soma contra o total
  que o próprio documento declara, e entrega tudo na mesma tela de revisão da
  fase 6 para conferência manual antes de virar lançamento.
- **Decisões aplicadas:** D06, D13, D19, D24, D25, D26

## Esta fase é deliberadamente a última e deliberadamente opcional

D13 decidiu OFX/CSV primeiro e PDF depois, e a ordem não é cronograma: é
avaliação de risco. O caminho principal já está entregue pela fase 6 e cobre,
com precisão perto de 100%, Nubank, Itaú, Bradesco, Banco do Brasil e Inter —
o OFX traz valor, data e um identificador único por transação, o que torna a
deduplicação de 6.7 exata em vez de heurística. O PDF existe **só** para o que
não exporta OFX. No caso concreto deste usuário, isso hoje significa
essencialmente o **C6 pessoa física**, que só oferece PDF.

**O modo de falha do PDF é silencioso e caro.** Ele não lança exceção: ele
registra o valor errado, com a data errada, na conta certa, e o usuário só
descobre semanas depois, quando o saldo não bate e não há mais como saber qual
linha mentiu. Isso é qualitativamente pior do que uma importação que falha.
Falhas documentadas em parsers brasileiros abertos e reais:

- **Sinal ausente.** O texto extraído de vários layouts não carrega marcador
  confiável de crédito ou débito. O parser de Santander mais maduro resolve
  isso marcando a linha como `[A VERIFICAR]` e instruindo o usuário a conferir
  contra os totais que o próprio banco declara. A honestidade dessa solução é o
  que esta fase copia.
- **Ano ausente.** O PDF do Nubank **não contém o ano** em nenhum lugar da
  linha de transação. Parsers assumem o ano corrente e quebram em janeiro, ao
  ler a fatura de dezembro: toda compra vai para o ano errado.
- **IOF separado.** O IOF aparece como item de linha próprio, em linha
  diferente da compra que o originou, e precisa ser mesclado de volta ao
  lançamento-pai; quem não mescla infla a contagem de transações e erra a
  conciliação.

**Maturidade do que existe**, levantada e verificada:

| Projeto | Stack | Situação |
| --- | --- | --- |
| `jeanvieir4/conversor-pdf-para-ofx` | Python, `pdfplumber`, 11 bancos | o mais completo do ecossistema; referência de layout, não dependência |
| `turicas/nubank-to-csv` | Python | um banco, escopo pequeno e antigo |
| `ultrahub-matheusmuniz/extrator-transacoes-pdf-bancario` | JS, 6 bancos | só Santander marcado como plenamente funcional |
| `@americofreitasjr/statement-parser` | TypeScript, npm | única tentativa em TS; o próprio README chama o ecossistema de "scripts descartáveis" e o pacote depende de `pdf-parse@1.1.1`, abandonado. **Não depender dele.** |

**Expectativa realista:** um adapter bem ajustado para um banco específico
acerta de **90% a 97%** dos itens de linha, e **cada banco muda o layout mais ou
menos uma vez por ano**. Isso não é trabalho de uma vez: é manutenção
permanente, e precisa ser orçado como tal. A arquitetura desta fase existe
sobretudo para que essa manutenção seja detectada por um teste vermelho em vez
de por dado corrompido no livro.

### Quando pular esta fase inteira

Pular, sem culpa, se **qualquer** destas for verdadeira:

1. **Todas** as contas e cartões em uso exportam OFX, CSV ou Excel. A fase 6 já
   resolve 100% do problema real; esta fase seria complexidade sem usuário.
2. O único banco sem OFX gera poucas transações por mês. Digitar à mão, ou
   importar por CSV montado à mão, é mais barato e mais confiável do que manter
   um adapter e seu conjunto de fixtures.
3. Não há disposição de manter os adapters ao longo do tempo. Um adapter
   desatualizado é pior do que adapter nenhum, porque continua "funcionando" e
   entregando dado errado.
4. O PDF em questão é digitalizado (imagem). OCR está fora de escopo pelo plano
   mestre §9; o caminho correto é rejeitar com mensagem clara.

Se a fase for feita, implementar **apenas os adapters dos bancos efetivamente
usados hoje**. Nunca "os 11 bancos". Cada adapter é um passivo de manutenção
anual.

## Escopo

**Entra:** pacote dedicado de parsing de PDF; extração de texto **com
coordenadas**; detecção e rejeição de PDF sem camada de texto; reconstrução de
tabela a partir de x/y; parsers puros de valor e data em pt-BR; contrato comum
de adapter por banco com fixtures anonimizadas e testes de saída dourada; o
adapter do C6 pessoa física como caso de referência; **conciliação obrigatória**
contra o total declarado pelo documento; suporte a PDF criptografado com senha;
ligação com o pipeline de importação da fase 6 **sem caminho próprio**;
confiança menor e revisão sempre obrigatória; runbook de manutenção.

**Não entra:** OCR de qualquer espécie; cupom fiscal; adapter para banco que já
exporta OFX; commit automático de qualquer linha vinda de PDF; detecção
automática de layout novo ou "aprendizado" de formato; escrita de PDF; qualquer
alteração no motor de regras (D25), na escada de deduplicação (6.7), na tela de
revisão ou no staging da fase 6 — esta fase **consome** tudo isso como está.

---

### Task 1: Pacote de parsing e camada de texto com coordenadas

**Files:**
- Create: `packages/pdf-statements/package.json`
- Create: `packages/pdf-statements/tsconfig.json`
- Create: `packages/pdf-statements/src/index.ts`
- Create: `packages/pdf-statements/src/text-layer.ts`
- Create: `packages/pdf-statements/src/text-layer.test.ts`
- Create: `packages/pdf-statements/src/errors.ts`
- Modify: `package.json` (raiz, workspaces)
- Modify: `tsconfig.base.json`

**Steps:**

1. Criar o workspace `packages/pdf-statements` seguindo exatamente a forma dos
   pacotes existentes (consumido como `./src/index.ts`, sem build próprio, com
   alias de path em `tsconfig.base.json`). Ele **não** vai em
   `packages/finance`, que é declaradamente zero-dependências: é o único pacote
   do módulo com uma dependência pesada.
2. **Escolha de biblioteca.** Usar `unpdf` **1.8.1** (publicado em 2026-08-13):
   zero dependências, ~2 MB, empacota o PDF.js e expõe a API dele. A
   alternativa equivalente é `pdfjs-dist` **6.3.289** (2026-08-29), usada
   diretamente. Ambas são JavaScript puro, **sem binário nativo**, o que
   importa num app que roda em Windows sem toolchain de compilação.
   `pdfjs-dist` é ESM-only e exige Node ≥ 22.13 — este projeto roda 22.19, está
   dentro. Registrar no topo de `text-layer.ts`, em comentário, as duas
   bibliotecas **proibidas** e o porquê:
   - `pdf-parse` — depende do nativo `@napi-rs/canvas` e **não devolve
     coordenadas**; sem coordenadas não há como reconstruir coluna.
   - `pdf-lib` — sem manutenção desde 2021 e serve para **escrever** PDF, não
     para ler texto.
3. Implementar
   `readTextLayer(data: Uint8Array, opts?: { password?: string }): Promise<PdfPage[]>`
   sobre `getDocument({ data, password })` + `page.getTextContent()`.
4. **Preservar geometria.** Cada item de `getTextContent()` carrega
   `transform: [a, b, c, d, x, y]`, `width` e `height`. Converter cada item em
   `{ text, x: transform[4], y: transform[5], width, height, fontHeight: transform[3] }`
   e devolvê-los assim, por página, com `pageWidth`/`pageHeight`. **Não** usar
   nenhum atalho de "extrair texto puro": concatenar `item.str` perde x e y, e
   é exatamente a informação que separa a coluna de data da coluna de valor num
   extrato. Um extrator sem coordenadas não serve para esta fase.
5. Normalizar a origem: o PDF mede y de baixo para cima. Converter para
   `yTop = pageHeight - y` na saída, para que "linha de cima" seja o menor
   número e a ordenação fique legível no resto do código.
6. **PDF criptografado.** Extratos e faturas do Bradesco, Itaú e Banco do Brasil
   chegam por e-mail cifrados com senha de usuário derivada do CPF (no Bradesco,
   dígitos do RG + dígitos do CPF + ano de nascimento). Passar `password` para
   `getDocument` quando houver, e registrar o callback `onPassword`: responder
   com erro tipado `PdfPasswordRequiredError` em
   `PasswordResponses.NEED_PASSWORD` e `PdfPasswordIncorrectError` em
   `PasswordResponses.INCORRECT_PASSWORD`. A senha **nunca** é gravada em disco,
   em banco, em log ou em mensagem de erro — chega por parâmetro, é usada e é
   descartada (Task 7).
7. **Detecção de PDF digitalizado.** Se qualquer página devolver zero itens de
   texto, lançar `ScannedPdfError` com mensagem em português explicando que o
   documento é imagem e que o app não faz OCR. Extratos brasileiros são
   baseados em texto em praticamente todos os casos; o escaneado é a exceção e
   deve ser **recusado com clareza**, jamais adivinhado. Adivinhar aqui é
   produzir exatamente o dado errado silencioso que esta fase inteira tenta
   evitar.
8. Definir em `errors.ts` a hierarquia (`PdfParseError` como base) com um
   `code` estável por erro, para a API mapear em status HTTP sem inspecionar
   mensagem.
9. Testes: um PDF mínimo gerado no próprio teste, ou uma fixture de duas linhas,
   devolve itens com x e y plausíveis; PDF de uma página sem texto lança
   `ScannedPdfError`; PDF cifrado sem senha lança `PdfPasswordRequiredError`;
   com senha errada lança `PdfPasswordIncorrectError`; com a senha certa
   extrai. Nenhum teste acessa a rede.
10. Commit: `feat(pdf): add coordinate-preserving pdf text layer reader`

---

### Task 2: Reconstrução de tabela e parsers puros pt-BR

**Files:**
- Create: `packages/pdf-statements/src/layout.ts`
- Create: `packages/pdf-statements/src/layout.test.ts`
- Create: `packages/pdf-statements/src/parse-br.ts`
- Create: `packages/pdf-statements/src/parse-br.test.ts`

**Steps:**

1. Tudo nestes dois arquivos é **puro**: entra array de itens `{text, x, yTop,
   width}` ou `string`, sai estrutura. Sem I/O, sem banco, sem rede, sem
   `new Date()` sem parâmetro. É a parte do parsing que se pode testar sem
   nenhum PDF.
2. `groupIntoLines(items, tolerance)`: agrupa itens por `yTop` com tolerância
   proporcional à altura da fonte (não um valor fixo em pontos — fonte menor no
   rodapé quebra tolerância fixa), e ordena cada linha por `x`.
3. `detectColumns(lines)`: infere as faixas de x das colunas pela densidade das
   bordas esquerda e direita dos itens ao longo da página. Valores monetários
   são alinhados à **direita**; datas e descrições, à esquerda. Guardar, para
   cada coluna, o alinhamento inferido — é ele que permite dizer "este número
   está na coluna de valor" em vez de "este número parece um valor".
4. `assignToColumns(line, columns)`: devolve a linha como `Record<columnKey,
   string>`. Item que cai entre duas colunas vai para aquela com maior
   sobreposição, e a linha é marcada como `ambiguous` — nunca chutada em
   silêncio.
5. `mergeContinuationLines(rows, isChild)`: mescla linhas-filhas na
   linha-pai. Dois casos obrigatórios:
   - **IOF** lançado como item separado logo abaixo da compra internacional
     que o gerou — soma-se ao valor do pai e anota-se na descrição, em vez de
     virar uma transação a mais.
   - **Descrição quebrada em duas linhas**, com a segunda sem data e sem valor.
6. Em `parse-br.ts`, `parseAmountBR(text): { cents: number; signKnown: boolean }`:
   - Converte `1.234,56`, `1234,56`, `R$ 1.234,56`, `1.234,56 D`, `(1.234,56)`,
     `-1.234,56`, `1.234,56-` para **centavos inteiros** (D19), nunca para
     `number` decimal. Arredondar por string, não por `parseFloat`.
   - Devolve `signKnown: false` quando o texto **não** carrega marcador de
     crédito/débito. Essa flag é obrigatória e sobe até o topo do pipeline: é o
     equivalente do `[A VERIFICAR]` que o parser de Santander de referência
     adotou. Linha com `signKnown: false` nunca é comitada automaticamente.
7. `parseDateBR(text, context): string | null` — resolve `DD/MM`, `DD/MM/AA`,
   `DD/MM/AAAA` e `DD MMM` (com os meses abreviados em pt-BR) para ISO
   `YYYY-MM-DD`.
   **O problema do ano ausente é resolvido aqui, e explicitamente.** Quando o
   texto não traz ano, o ano **não** é o ano corrente: é derivado do
   `context: { statementYear, statementMonth }` que o adapter extrai do
   cabeçalho do documento (mês de referência, vencimento, período do extrato).
   Se a data resolvida ficar mais de 2 meses à frente do mês de referência,
   subtrair um ano — é assim que a fatura de dezembro, lida em janeiro, não
   manda tudo para o ano errado. Se o documento não declarar mês de referência
   em nenhum lugar, devolver `null` e deixar o adapter falhar de forma visível
   em vez de inventar o ano.
8. `parseInstallment(description): { current: number; total: number } | null` —
   reconhece as formas reais: `PARCELA 3/7`, `PARC 03/07`, `3/7`, `3 DE 7`,
   `(3/7)`. Devolve os dois números para que a Task 6 possa preencher os campos
   de parcelamento da fase 3 na linha de staging.
9. `normalizeDescription(text)` reutiliza o **mesmo** helper de normalização
   extraído na fase 1 (sem acento, minúsculo, sem pontuação) — o mesmo que
   alimenta `places.normalized_name` (D06) e o hash de conteúdo de 6.7. Não
   escrever uma segunda normalização aqui; divergir dela quebra a deduplicação.
10. Testes de tabela para cada função, com casos reais de formatação: valor com
    sufixo `D`/`C`, valor entre parênteses, valor com sinal à direita, milhar
    com ponto, `0,00`, valor sem sinal (`signKnown: false`); `31/12` lido com
    referência `2026-01` devolvendo `2025-12-31`; `05/01` com referência
    `2026-01` devolvendo `2026-01-05`; ano ausente sem contexto devolvendo
    `null`; mesclagem de IOF somando ao pai e não criando linha; descrição
    quebrada em duas linhas; coluna ambígua marcada.
11. Commit: `feat(pdf): add table reconstruction and pt-BR amount and date parsers`

---

### Task 3: Contrato de adapter, fixtures anonimizadas e testes de saída dourada

**Files:**
- Create: `packages/pdf-statements/src/adapter.ts`
- Create: `packages/pdf-statements/src/registry.ts`
- Create: `packages/pdf-statements/src/registry.test.ts`
- Create: `packages/pdf-statements/__fixtures__/README.md`
- Create: `packages/pdf-statements/__fixtures__/.gitattributes`
- Create: `packages/pdf-statements/src/golden.ts`

**Steps:**

1. Definir a interface única atrás da qual **todo** banco vive:

   ```ts
   type StatementAdapter = {
     id: string;                     // 'c6-fatura', 'santander-extrato'
     label: string;                  // exibido na interface
     kind: 'statement' | 'invoice';  // extrato de conta ou fatura de cartão
     layoutVersion: string;          // '2026-09' — muda quando o banco muda
     detect(pages: PdfPage[]): number;              // confiança 0..1
     parse(pages: PdfPage[]): ParsedStatement;
   };

   type ParsedStatement = {
     adapterId: string;
     layoutVersion: string;
     reference: { year: number; month: number } | null;
     declaredTotals: DeclaredTotal[];   // o que o documento afirma — Task 5
     rows: ParsedRow[];
     warnings: ParseWarning[];
   };

   type ParsedRow = {
     date: string;                       // ISO
     rawDescription: string;             // imutável para sempre (D25)
     amountCents: number;                // inteiro assinado (D19)
     signKnown: boolean;
     installment: { current: number; total: number } | null;
     confidence: number;                 // 0..1
     sourcePage: number;
     sourceLine: number;
   };
   ```

2. `registry.ts` mantém a lista de adapters e expõe
   `detectAdapter(pages): { adapter, confidence }[]` ordenado. Se o melhor
   candidato ficar abaixo de um limiar, **não** escolher o menos ruim: devolver
   "layout não reconhecido" e oferecer ao usuário a escolha manual do banco.
   Adivinhar adapter é a maneira mais rápida de importar a fatura de um banco
   com o parser de outro.
3. **Fixtures são obrigatórias e precisam ser anonimizadas.** Cada adapter
   commita pelo menos um PDF real em `__fixtures__/<adapterId>/<layoutVersion>.pdf`.
   O `__fixtures__/README.md` traz a lista de remoção obrigatória, a ser conferida
   item a item antes de cada commit: **nome, CPF/CNPJ, RG, endereço, telefone,
   e-mail, agência, número de conta, número completo do cartão (manter no
   máximo os 4 últimos dígitos), código de barras e linha digitável, QR de
   pagamento**. Valores e datas podem e devem ser preservados — é o que o teste
   verifica. Este repositório tem remoto no GitHub: um extrato real commitado
   por engano não se apaga com um `git rm`.
4. O `.gitattributes` da pasta marca `*.pdf` como `binary` para o diff não
   tentar tratá-los como texto.
5. `golden.ts` implementa o mecanismo de saída dourada: para cada fixture existe
   um `<layoutVersion>.golden.json` com a `ParsedStatement` esperada, e o teste
   compara a saída atual contra ele campo a campo. Atualizar o golden exige
   edição explícita do arquivo — **nunca** criar uma flag "regravar goldens" que
   se possa rodar sem pensar, porque ela transforma regressão em commit
   silencioso.
6. O golden inclui a contagem de linhas, a soma em centavos e cada linha
   individual. A soma no golden é a segunda barreira contra layout quebrado,
   depois da conciliação da Task 5.
7. **Quando o banco muda o layout**, o procedimento é: o teste fica vermelho →
   adiciona-se a fixture nova com `layoutVersion` novo → o adapter passa a
   reconhecer os dois → a fixture antiga **permanece** e continua verde, porque
   o usuário ainda vai importar PDFs velhos. Nunca substituir a fixture antiga.
8. Testes: `detectAdapter` escolhe o adapter certo entre todos os registrados
   para cada fixture; confiança abaixo do limiar devolve lista vazia; dois
   adapters nunca compartilham `id`; toda fixture tem golden e todo golden tem
   fixture (teste de consistência da pasta, que impede adapter sem cobertura).
9. Commit: `feat(pdf): add per-bank adapter contract with golden fixture tests`

---

### Task 4: Adapter do C6 pessoa física

**Files:**
- Create: `packages/pdf-statements/src/adapters/c6.ts`
- Create: `packages/pdf-statements/src/adapters/c6.test.ts`
- Create: `packages/pdf-statements/__fixtures__/c6-fatura/2026-09.pdf`
- Create: `packages/pdf-statements/__fixtures__/c6-fatura/2026-09.golden.json`
- Modify: `packages/pdf-statements/src/registry.ts`

**Steps:**

1. O C6 pessoa física é o motivo concreto desta fase existir: é PDF-only, sem
   OFX. Implementá-lo primeiro e completo serve de referência para qualquer
   adapter futuro — este arquivo é o exemplo que o próximo banco copia.
2. `detect`: procurar marcas estáveis do documento (nome da instituição,
   rótulos fixos de cabeçalho e rodapé) em posições relativas, não absolutas.
   Nunca casar por número de página, por coordenada exata em pontos ou por
   hash do arquivo — qualquer um dos três quebra na próxima emissão.
3. Extrair o **contexto de referência** do cabeçalho — mês/ano de vencimento e
   período coberto — e entregá-lo a `parseDateBR` (Task 2). Sem esse contexto
   o adapter deve falhar, não assumir o ano corrente.
4. Extrair os **totais declarados** que o documento traz: total da fatura,
   total de pagamentos/créditos, e o total por portador quando houver cartão
   adicional. Eles alimentam a Task 5 e são a única coisa no documento que se
   pode conferir contra a soma das linhas.
5. Separar as seções do documento: lançamentos nacionais, internacionais (com
   IOF em linha própria, mesclado pela Task 2), pagamentos e estornos, encargos.
   Estorno vira linha de sinal oposto e é sinalizado em `warnings` para que a
   revisão da fase 6 possa ligá-lo à despesa original conforme 6.6 — o adapter
   **não** tenta descobrir sozinho a qual compra o estorno se refere.
6. Preencher `installment` quando `parseInstallment` reconhecer a descrição, e
   registrar em `warnings` quando encontrar parcela sem plano correspondente —
   a decisão de criar `installment_plans` é da fase 3, tomada na revisão, nunca
   pelo parser.
7. Definir a confiança por linha: sai de 1.0 e é reduzida por linha ambígua,
   por `signKnown: false`, por data inferida sem ano explícito e por descrição
   mesclada. Nenhuma linha de PDF chega a 1.0 no final — ver Task 6.
8. Anonimizar a fixture conforme a lista do `__fixtures__/README.md` **antes** de
   commitá-la, e conferir abrindo o PDF resultante e buscando por CPF e por
   nome no texto extraído. Registrar no teste uma asserção que falha se o texto
   extraído contiver um padrão de CPF — assim o próprio teste impede que uma
   fixture futura entre com dado pessoal.
9. Testes: a fixture produz exatamente o golden; o total declarado bate com a
   soma das linhas; uma compra parcelada é reconhecida com `current`/`total`
   corretos; o IOF não aparece como transação separada; a virada de ano é
   resolvida com o contexto do cabeçalho; nenhum CPF sobrevive no texto
   extraído.
10. Commit: `feat(pdf): add C6 personal invoice adapter`

---

### Task 5: Conciliação obrigatória contra o total declarado

**Files:**
- Create: `packages/pdf-statements/src/reconcile.ts`
- Create: `packages/pdf-statements/src/reconcile.test.ts`
- Modify: `packages/pdf-statements/src/index.ts`

**Steps:**

1. **Esta é a salvaguarda mais importante da fase, e é um passo de primeira
   classe do pipeline — não uma checagem de cortesia.** Como o PDF erra em
   silêncio, a única defesa genérica é comparar o que foi extraído com o que o
   próprio documento afirma. Se a soma das linhas não bate com o total
   declarado, alguma linha foi perdida, duplicada ou lida com sinal errado — e
   nenhuma delas pode seguir sem olho humano.
2. `reconcile(parsed: ParsedStatement): ReconciliationResult` devolve, para cada
   `DeclaredTotal`:
   `{ label, declaredCents, parsedCents, differenceCents, status }` com
   `status` em `'match' | 'mismatch' | 'unavailable'`.
3. A comparação é em **centavos inteiros** (D19) e a tolerância é **zero**.
   Tolerância em dinheiro é como se perde um centavo por mês e se descobre um
   ano depois. Se um arredondamento legítimo existir em algum layout, ele vira
   uma linha explícita de ajuste no adapter, com rótulo próprio — nunca uma
   folga na comparação.
4. `status='unavailable'` quando o adapter não conseguiu extrair o total
   declarado. **`unavailable` é tratado como `mismatch`** para efeito de
   bloqueio: documento sem total conferível não tem caminho automático. Não
   silenciar, não assumir que está certo.
5. Conciliar em mais de um eixo quando o documento permitir: total geral, total
   de débitos, total de créditos, total por portador. Três conferências que
   batem dão muito mais confiança do que uma; e quando só uma falha, ela aponta
   onde está o erro.
6. O resultado da conciliação é **persistido** junto do lote de importação
   (Task 6) e exibido na tela de revisão (Task 7). Ele não é um `console.warn`
   nem um detalhe de log: é um dado do lote, consultável depois, que responde
   "este lote foi conferido?".
7. **Regra dura:** `mismatch` em qualquer eixo **bloqueia o caminho
   automático** do lote inteiro. O lote ainda pode ser revisado e comitado
   linha a linha pelo usuário, com o aviso visível do valor da diferença, mas
   nenhuma sugestão é aplicada em massa e nenhuma linha é pré-marcada para
   commit.
8. Testes: soma batendo devolve `match`; uma linha faltando devolve `mismatch`
   com a diferença exata em centavos; uma linha com sinal invertido devolve
   `mismatch` com o dobro do valor da linha (caso clássico, que o teste deve
   nomear); total ausente devolve `unavailable`; múltiplos eixos com apenas um
   falhando são reportados individualmente.
9. Commit: `feat(pdf): add mandatory reconciliation against declared totals`

---

### Task 6: Ligação com o pipeline de importação da fase 6

**Files:**
- Create: `apps/api/src/import/pdf/pdf-import-service.ts`
- Create: `apps/api/src/import/pdf/pdf-import-service.test.ts`
- Create: `packages/db/src/migrations/009-pdf-import.ts`
- Modify: `packages/db/src/migrations/index.ts`
- Create: `packages/db/src/migrations/009-pdf-import.test.ts`
- Modify: `apps/api/src/routes/ledger-import.routes.ts`

**Steps:**

1. **O adapter de PDF só produz linhas. Ele não tem caminho de importação
   próprio.** Tudo o que vem do PDF entra no **mesmo** staging
   `import_batches` / `import_rows` da fase 6, passa pela **mesma** escada de
   deduplicação de 6.7, pelo **mesmo** motor de regras de D25 e pela **mesma**
   tela de revisão. Se esta task se pegar reimplementando qualquer uma dessas
   quatro coisas, a implementação está errada e deve parar. Um segundo caminho
   de importação significa duas deduplicações divergentes e dois lugares para
   corrigir cada bug.
2. `import_batches.source` já aceita `'pdf'` no `CHECK`, porque a fase 6 o
   incluiu de propósito para esta fase (fase 6, Task 1, passo 2) — nenhuma
   ampliação de `CHECK` é necessária nesse ponto e R-01 não é acionado aqui.
3. A migração `009` — o número é palpite; conferir antes qual é a **próxima
   versão livre** em `packages/db/src/migrations/index.ts`, já que as fases
   anteriores propõem números que colidem entre si — acrescenta:
   - em `import_batches`, por `ADD COLUMN`: `adapter_id`, `layout_version`,
     `reconciliation_status` e `reconciliation_json`;
   - em `import_rows`, por `ADD COLUMN`: `confidence REAL`,
     `sign_known INTEGER NOT NULL DEFAULT 1`, `source_page`, `source_line` e
     `warnings_json`;
   - a ampliação do `CHECK` de `import_rows.status` para incluir
     `'needs_review'`, que **exige** `rebuildTable` do helper da fase 0 — este é
     o único ponto da fase que aciona R-01, e precisa de teste provando que os
     dados sobreviveram à reconstrução. Ao reconstruir, recriar os índices
     lendo `sqlite_master`, como a fase 6 estabeleceu, em vez de escrevê-los à
     mão.
   **Registrar essas colunas na seção 4.4 do plano mestre** — o plano mestre é
   a fonte de verdade do modelo e não pode ficar defasado, mesma disciplina que
   a fase 6 aplicou.
4. `pdf-import-service.ts` orquestra, nesta ordem, e para no primeiro erro:
   ler o arquivo → `readTextLayer` (com senha, se houver) → `detectAdapter` →
   `parse` → `reconcile` → gravar `import_batches` + `import_rows`. Só depois
   disso o pipeline da fase 6 é invocado, **sem alteração**, sobre as linhas
   gravadas.
5. **Deduplicação.** Linha de PDF **não tem `external_id`** — não existe FITID.
   Ela entra na escada de 6.7 pelo degrau 2 (hash de conteúdo sobre conta, data,
   valor em centavos e descrição normalizada) e pelo degrau 3 (mesmo valor em
   ±7 dias). Por isso a normalização da descrição **precisa** ser a mesma da
   fase 6 (Task 2, passo 9): descrição normalizada diferente é hash diferente, e
   a mesma compra importada por OFX e por PDF entraria duas vezes. Testar
   exatamente esse cenário: importar o OFX de um mês e depois o PDF do mesmo
   mês deve marcar as linhas como duplicadas, não criá-las de novo.
6. Linhas `reconciled` continuam imutáveis e nunca são tocadas (6.7). A
   aplicação de regras continua com pré-visualização desmarcável (R-08).
7. **Confiança e revisão obrigatória.** Toda linha vinda de PDF entra com
   `confidence` estritamente menor que a de uma linha de OFX e com
   `status='needs_review'`. **Nenhuma linha de PDF é comitada automaticamente,
   em nenhuma circunstância**, mesmo com conciliação perfeita e confiança alta.
   Não existe caminho de código que comite uma linha de `source='pdf'` sem
   passar por confirmação explícita do usuário — escrever o teste que prova
   isso, chamando o serviço com todas as condições favoráveis e verificando que
   nada foi gravado em `entries`.
8. **Parcelas.** Quando `installment` vier preenchido, gravar os números na
   linha de staging e propor, na revisão, a criação do plano da fase 3. O
   serviço **não** cria `installment_plans` sozinho: D23 exige vínculo
   persistido e deliberado, e adivinhar o plano a partir de uma fatura no meio
   da série (a parcela 3 de 7) geraria um plano com total e data de compra
   errados.
9. **Ano.** Se o adapter não conseguiu o contexto de referência, o serviço
   recusa o arquivo com erro claro em vez de gravar linhas com ano assumido.
10. **Rota: nenhuma rota nova de upload.** A fase 6 já expõe
    `POST /api/ledger/imports` recebendo multipart com `file`, `accountId` e
    `source`; esta fase apenas faz `source='pdf'` ser um valor aceito e
    despachar para `pdf-import-service`. O único acréscimo é o campo opcional
    `password` no multipart. Criar um endpoint próprio de PDF seria o começo
    do segundo caminho de importação que o passo 1 proíbe.
    O `@fastify/multipart` **já foi registrado na fase 1** com `fileSize`
    explícito (R-06): reaproveitar essa configuração, incluindo a limpeza do
    temporário em `finally` e o 413 em truncamento. Validar o tipo real por
    magic bytes (`%PDF-`) com o `file-type` já adicionado na fase 1. Mensagens
    de erro em português sem acento, como no restante de `apps/api`.
11. Testes com `:memory:` e `app.inject`: a fixture do C6 gera N linhas em
    staging e zero em `entries`; conciliação `mismatch` grava o lote com o
    bloqueio registrado e nenhuma sugestão aplicada em massa; reimportar o mesmo
    PDF marca tudo como duplicado; OFX e PDF do mesmo mês não duplicam; PDF
    escaneado responde 422 com mensagem sobre OCR; PDF sem senha responde 401
    com o código que a interface usa para pedir a senha; `rebuildTable` do
    `CHECK` preservou as linhas existentes.
12. Commit: `feat(api): route pdf statements through the phase 6 import pipeline`

---

### Task 7: Interface de importação de PDF e runbook de manutenção

**Files:**
- Create: `apps/web/src/components/finance/PdfPasswordDialog.tsx`
- Modify: `apps/web/src/pages/finance/Import.tsx`
- Modify: `apps/web/src/pages/finance/import-help.ts`
- Modify: `apps/web/src/components/finance/ImportDropzone.tsx`
- Modify: `apps/web/src/components/finance/ImportReview.tsx`
- Modify: `apps/web/src/styles/index.css`
- Create: `packages/pdf-statements/README.md`

**Steps:**

1. Na tela de importação da fase 6, acrescentar o PDF como **terceira opção,
   visivelmente secundária**, com uma linha de texto explicando que OFX e CSV
   são o caminho recomendado e que o PDF existe para bancos que não exportam.
   A hierarquia visual aqui é conteúdo, não estética: ela evita que o usuário
   escolha o caminho pior por engano.
2. Após o envio, mostrar o adapter detectado e permitir trocá-lo manualmente
   quando a detecção ficar abaixo do limiar, listando os adapters disponíveis
   por rótulo.
3. `PdfPasswordDialog.tsx`: ao receber o código de senha necessária, abrir um
   `Modal` (`components/dialog.tsx`) com um `<input type="password">`, o texto
   explicando a convenção do banco quando conhecida (no Bradesco, dígitos do RG
   + dígitos do CPF + ano de nascimento), e o tratamento de senha incorreta com
   nova tentativa. **A senha vive apenas no estado do componente durante a
   requisição**: não vai para `localStorage`, não vira campo de formulário
   persistido, não entra em URL nem em query string, não é logada no servidor e
   não é guardada no banco. Limpar o estado ao fechar o diálogo.
4. **Faixa de conciliação no topo da revisão**, antes da tabela de linhas:
   verde com "soma confere: R$ X em N lançamentos" ou vermelha com "diferença
   de R$ Y — confira antes de importar", mostrando cada eixo conferido. Em
   `mismatch`, as ações de aplicar sugestões em massa e de marcar tudo ficam
   desabilitadas, com o motivo em texto ao lado — desabilitar sem explicar
   parece bug.
5. Marcar visualmente, na tabela de revisão, as linhas com `sign_known = 0` com
   um `Tag` "conferir sinal", e as de confiança baixa com um indicador discreto.
   Ordenar por padrão as linhas que precisam de atenção primeiro; ninguém revisa
   200 linhas procurando as 6 duvidosas.
6. Deixar claro na interface que **importação de PDF sempre exige revisão**, e
   não oferecer nenhum botão de "importar tudo automaticamente" nessa origem.
7. Reusar exclusivamente os componentes existentes (`Card`, `Panel`, `Button`,
   `IconButton`, `Tag`, `Empty`, `Skeleton`, `Segmented`, `Field`, `Modal`,
   `Drawer`, `useConfirm`) e o wrapper `api<T>()`. Nenhuma biblioteca de UI
   nova. Classes novas com prefixo `fin-` em `index.css`, só com tokens de
   `:root`, tema claro e escuro funcionando. Todo valor exibido passa pelos
   formatadores de centavos que honram o modo privacidade (R-04).
8. `packages/pdf-statements/README.md` é o **runbook de manutenção**, e faz
   parte da entrega desta fase:
   - a expectativa de 90–97% de acerto e de uma quebra de layout por banco por
     ano, escrita de forma que o usuário futuro não se surpreenda;
   - passo a passo para adicionar um banco novo: implementar `detect`, extrair
     contexto de referência, extrair totais declarados, mapear seções,
     anonimizar a fixture, gerar o golden, registrar no `registry`;
   - passo a passo para consertar um layout quebrado: reproduzir com a fixture
     nova, manter a antiga verde, subir `layoutVersion`, nunca sobrescrever
     golden sem ler o diff;
   - a lista de anonimização, com o aviso de que o repositório tem remoto
     público;
   - o registro explícito de que `pdf-parse` e `pdf-lib` são proibidos e por quê.
9. Commit: `feat(web): add pdf statement import with password prompt and reconciliation banner`

---

## Critérios de aceite

- `npm test`, `npm run typecheck`, `npm run lint` e `npm run build` passam.
- A decisão de fazer esta fase foi confirmada com o usuário à luz da seção
  "Quando pular esta fase inteira", e só os adapters dos bancos efetivamente
  usados foram implementados.
- O extrator devolve coordenadas por item; não existe no código nenhum caminho
  que use extração de texto plano para parsing. `pdf-parse` e `pdf-lib` não
  aparecem em nenhum `package.json`.
- Um PDF sem camada de texto é recusado com mensagem clara sobre OCR, e nunca
  produz linha alguma.
- Um PDF criptografado pede a senha, aceita a correta, rejeita a errada com
  mensagem própria, e a senha não aparece em log, em disco, em URL nem no banco.
- A fatura de dezembro importada em janeiro registra as compras em **dezembro**,
  provado por teste.
- O IOF não vira transação separada e a compra internacional que o gerou fica
  com o valor somado.
- Uma compra parcelada é reconhecida como `3/7` e **nenhum** plano de
  parcelamento é criado automaticamente.
- Toda fixture é anonimizada, tem golden correspondente, e o teste que busca
  padrão de CPF no texto extraído passa.
- Alterar um pixel do parser quebra um teste de saída dourada — a regressão é
  detectada por teste vermelho, não por dado errado no livro.
- A conciliação roda em **todo** parse, é persistida no lote e exibida na
  revisão; um `mismatch` bloqueia o caminho automático e a tolerância é zero
  centavos.
- Não existe caminho de código que comite uma linha de `source='pdf'` sem
  confirmação explícita do usuário, e há teste provando que mesmo com
  conciliação perfeita nada é gravado em `entries` sem revisão.
- O PDF usa o mesmo staging, a mesma escada de deduplicação de 6.7, o mesmo
  motor de regras e a mesma tela de revisão da fase 6; importar o OFX e o PDF do
  mesmo mês não duplica nenhum lançamento.
- O `rebuildTable` que amplia o `CHECK` de `import_rows.status` tem teste
  provando que preservou os dados (R-01).
- O modo privacidade mascara todos os valores da tela de importação e revisão.
- O tema claro funciona em todas as telas novas.
- O runbook de manutenção existe e descreve como adicionar um banco e como
  consertar um layout quebrado.
