# Projeto 41

Webapp local para gestao da carteira financeira originalmente mantida em
`Projeto 41.xlsx`.

## Requisitos

- WSL
- Node.js 22+
- npm 10+

## Configuracao

```bash
cp .env.example .env
npm install
npm run import -- --dry-run
npm run import -- --confirm
npm run dev
```

Abra `http://127.0.0.1:5173`. A API escuta somente em
`http://127.0.0.1:3001`.

O token gratuito da brapi deve ser configurado em `BRAPI_TOKEN`. A planilha,
o banco, backups e `.env` nunca sao versionados.

## Modo demonstracao

Para gravar videos sem expor dados reais:

```bash
npm run demo
```

Abra `http://127.0.0.1:5174`. Esse modo usa `data/projeto41-demo.sqlite`, API
em `127.0.0.1:3101`, patrimonio sintetico de R$ 20 mil e nao consulta
provedores externos. Cada inicializacao restaura os dados demonstrativos.
