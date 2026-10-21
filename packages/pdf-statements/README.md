# @projeto41/pdf-statements — runbook de manutenção

Lê extrato e fatura em PDF e entrega linhas para o **mesmo** pipeline de
importação do OFX/CSV (staging, deduplicação de 6.7, regras, revisão). Não tem
caminho de importação próprio.

## Expectativa honesta

- Um adapter bem ajustado acerta de **90% a 97%** das linhas. Por isso toda
  linha de PDF entra como `needs_review`, com confiança abaixo de 1, e **nada**
  é gravado em lote — nem com regra "sempre automático", nem com a soma batendo.
- Cada banco muda o layout **mais ou menos uma vez por ano**. Quando mudar, um
  teste de saída dourada fica vermelho. É assim que deve ser: regressão
  detectada por teste, não por saldo errado semanas depois.
- PDF é o caminho de reserva. Se o banco exporta Excel, CSV ou OFX, use isso.

## Adapters

| id | banco | layout | fixture |
| --- | --- | --- | --- |
| `btg-extrato` | BTG Pactual, extrato de conta corrente | `2026-10` | `__fixtures__/btg-extrato/2026-10.pdf` (sintética) |

Só entram adapters de bancos usados de verdade. Cada um é manutenção anual.

### Notas do BTG

- Toda saída vem com `-R$`; entrada vem sem sinal. O sinal sai do layout, e a
  conciliação por dia confere essa premissa.
- O "Saldo Diário" fecha cada dia; a diferença entre dois saldos seguidos é o
  movimento declarado daquele dia. O primeiro dia não tem saldo anterior e
  fica sem conferência (aviso, nunca suposição).
- O próprio BTG imprime saldos diários que às vezes divergem 1 centavo da soma
  dos lançamentos do dia (visto em 02/10, 05/10 e 06/10/2026, provavelmente
  rendimento fracionário da conta). A tolerância é zero, então esses dias
  aparecem como diferença de R$ 0,01 na faixa de conciliação. Isso é o
  documento sendo honesto, não erro de leitura: a planilha `.xls` do mesmo
  extrato tem exatamente as mesmas linhas.

## Como adicionar um banco

1. Extraia os itens com coordenadas de um PDF real (`readTextLayer`) e anote
   colunas, rótulos fixos, cabeçalho e rodapé de página.
2. Crie `src/adapters/<banco>.ts` implementando `StatementAdapter`:
   - `detect`: marcas estáveis (nome da instituição, rótulos fixos), nunca
     número de página, coordenada exata ou hash do arquivo;
   - contexto de referência (período, vencimento) — sem ele, falhe; nunca
     assuma o ano corrente (`parseDateBR` resolve a virada de ano com ele);
   - totais declarados (`declaredTotals`), que alimentam a conciliação;
   - colunas por `detectColumns` + `assignToColumns`, células quebradas por
     `mergeContinuationLines`.
3. Gere uma fixture **sintética** com `src/testing/pdf-writer.ts`, copiando as
   coordenadas do layout real com dado fictício (veja `testing/btg-fixture.ts`
   e `scripts/build-btg-fixture.ts`). Se precisar de PDF real, siga a lista de
   anonimização em `__fixtures__/README.md`.
4. Escreva o `<layoutVersion>.golden.json` a partir da saída do adapter **lendo
   cada linha** contra o PDF.
5. Registre o adapter em `src/registry.ts`.

## Como consertar um layout quebrado

1. Reproduza com uma fixture nova em `__fixtures__/<adapterId>/<nova-versao>.pdf`.
2. Faça o adapter reconhecer os dois layouts. A fixture antiga **continua** e
   continua verde: PDFs velhos ainda são importados.
3. Suba `layoutVersion`.
4. Nunca sobrescreva um golden sem ler o diff. Não existe flag de regravar.

## Anonimização

O repositório tem remoto no GitHub. A lista completa está em
`__fixtures__/README.md`; o teste de cada fixture falha se achar um CPF no
texto extraído.

## Bibliotecas proibidas

- `pdf-parse` — depende do nativo `@napi-rs/canvas` e não devolve coordenadas.
- `pdf-lib` — sem manutenção desde 2021 e serve para escrever PDF, não ler.

A leitura usa `unpdf` (PDF.js empacotado, JavaScript puro, sem binário nativo).
