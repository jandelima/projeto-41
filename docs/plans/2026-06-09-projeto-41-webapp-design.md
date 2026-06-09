# Projeto 41 Webapp - Design

## Objetivo

Migrar `Projeto 41.xlsx` para um webapp local com paridade funcional. A planilha
sera importada uma vez e preservada como referencia; depois da migracao, o app e
o SQLite passam a ser a unica fonte oficial de dados.

O app sera executado no WSL, acessivel somente por `127.0.0.1`, sem login. A
interface nao copiara o layout da planilha, mas cobrira suas funcionalidades:
dashboard, carteiras cripto e B3, operacoes, renda fixa, caixa e reserva,
historico, aportes, planejamento e alocacao ideal.

## Arquitetura

O projeto sera um monorepo TypeScript com:

- React e Vite no frontend;
- Fastify no backend;
- SQLite e Drizzle ORM para persistencia;
- Zod para contratos e validacao;
- Tailwind CSS e componentes acessiveis para a interface;
- Recharts para graficos;
- Vitest para testes unitarios e de integracao;
- Playwright para fluxos essenciais.

O frontend acessara somente a API local. O backend sera responsavel pelo banco,
pelas regras financeiras, pelo importador, pelos provedores externos e pelas
tarefas agendadas. Valores derivados nao serao armazenados de forma redundante:
serao recalculados por funcoes puras e testaveis.

## Modelo Funcional

Operacoes cripto e B3 serao cadastraveis, editaveis e excluiveis. Elas
recalcularao quantidade, investimento, preco medio, saldo, PnL, pesos,
alocacao e dashboard. O preco medio continuara baseado somente nas compras;
vendas nao o alteram. Em cripto, a soma recebida nas vendas sera apresentada
como `Valor vendido`, corrigindo apenas o nome usado na planilha.

Dividendos B3 permanecerao como totais acumulados editaveis por ativo. As
parcelas manuais serao posicoes nomeadas:

- Dolar: Binance, MetaMask e autocustodia;
- Caixa BR: Caixinha Nubank, saldo BTG e Aupo11;
- Reserva: Caixinha Itau, Caixinha Nubank e papel-moeda;
- Renda fixa: Tesouro Direto BB, Tesouro Direto BTG e Outros titulos.

`Outros titulos` sera uma posicao agregada. As aplicacoes internas de Tesouro
Direto BTG tambem permanecerao agregadas.

## Precos E Automacao

As fontes e frequencias serao:

- cripto: servidor `http://34.215.218.57:5000`, a cada 15 minutos;
- B3: brapi, uma requisicao por ativo, a cada 30 minutos durante o pregao;
- USD/BRL: API oficial do Banco Central;
- atualizacao manual: forca um novo ciclo de todos os provedores.

Cada cotacao guardara provedor, horario do mercado, horario da consulta e
ultimo erro. Em falhas, o app manterra o ultimo preco valido e indicara que ele
esta atrasado. O token da brapi ficara somente no backend, via `.env`.

O backend criara um snapshot patrimonial diario as `23:59` no fuso
`America/Fortaleza`, com unicidade por data. O snapshot usara o ultimo preco
valido disponivel e registrara os horarios das cotacoes utilizadas.

## Importacao E Validacao

O importador lera todas as abas, operacoes, historico e valores manuais da
planilha. A importacao sera idempotente e transacional. Antes de confirmar a
migracao, um relatorio comparara quantidades, precos medios, saldos por classe,
total patrimonial e historico entre planilha e app.

Valores embutidos em formulas serao convertidos nas posicoes nomeadas definidas
acima. A planilha original nao sera modificada. Dados financeiros nao serao
incluidos em fixtures, logs, commits ou capturas de tela.

## Interface

O MVP tera tema escuro, responsivo e otimizado primeiro para desktop. A
navegacao principal incluira Dashboard, Cripto, B3, Renda fixa e caixa,
Aportes, Planejamento, Alocacao e Historico.

O dashboard mostrara patrimonio, rentabilidade, distribuicao por classe,
reserva, evolucao historica e saude das cotacoes. Tabelas terao busca,
ordenacao, filtros e formatacao monetaria. Cadastros e edicoes usarao paineis
laterais ou dialogos. Ganhos, perdas e alertas usarao cores semanticamente, sem
depender apenas de cor para transmitir estado.

## Confiabilidade

As regras financeiras serao cobertas por testes unitarios. Importacao, banco,
API e provedores terao testes de integracao com respostas simuladas. Os fluxos
criticos de operacao, edicao manual, atualizacao de precos e dashboard terao
testes end-to-end.

O SQLite tera backup local antes de migracoes de schema e exportacao manual. O
servidor escutara explicitamente em `127.0.0.1`. Nenhum endpoint sera exposto
para a rede local.

