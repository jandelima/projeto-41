# Operacao Local

## Iniciar

```bash
npm run dev
```

Acesse `http://127.0.0.1:5173`. A API aceita conexoes somente em
`127.0.0.1:3001`.

## Precos

Configure `BRAPI_TOKEN` em `.env` para atualizar ativos B3. Cripto usa o
servidor existente e USD/BRL usa a PTAX do Banco Central.

- Cripto: 15 minutos.
- B3: 30 minutos durante o pregao.
- USD/BRL: 2 horas.
- Manual: botao `Atualizar precos`.

Falhas mantem o ultimo valor valido e aparecem na interface.

## Dados

O banco fica em `data/projeto41.sqlite`. A importacao inicial e idempotente:

```bash
npm run import -- --dry-run
npm run import -- --confirm
```

Antes de uma nova importacao, o banco existente e copiado para `backups/`.
Planilha, banco, backups e `.env` sao ignorados pelo Git.

## Verificacao

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

## Demonstracao

```bash
npm run demo
```

A demonstracao abre em `http://127.0.0.1:5174`, usa API em
`127.0.0.1:3101` e banco `data/projeto41-demo.sqlite`. Os dados sao
completamente sinteticos e restaurados a cada inicializacao.
