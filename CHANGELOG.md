# Changelog

Todas as mudanças relevantes deste projeto são documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o
projeto adota [Versionamento Semântico](https://semver.org/lang/pt-BR/).

Mudanças ainda não lançadas ficam em **[Unreleased]**. Ao publicar, renomeie
essa seção para a nova versão com a data (ex.: `## [0.3.0] - 2026-07-01`) e abra
um novo `[Unreleased]` vazio no topo.

## [Unreleased]

### Added

- **Importação: fatura ou extrato, escolhido pelo usuário, com comparação lado a
  lado.** O usuário diz primeiro se o arquivo é extrato da conta ou fatura do
  cartão (a API recusa o envio sem isso). Lançamento que o arquivo repete — mesmo
  valor em até 3 dias, ou até R$ 1,00 / 2% de diferença quando o nome bate, e a
  parcela prevista pelo número e pelo nome — é pareado na hora, sem repetir par
  entre linhas, e vai para a revisão com os dois lados lado a lado, o que difere
  marcado e o que muda ao vincular. O sistema só propõe: nada é vinculado sem
  confirmação. Vincular assume o valor e o dia do arquivo e confirma o previsto.
- **Lucro da caixinha, automático ou lançado.** Cada caixinha escolhe: lucro
  automático (rendimento do CDI, como antes) ou manual, em que o usuário lança o
  lucro quando quiser (**Lançar lucro**) e acerta com o banco (**Ajustar lucro**,
  que lança só a diferença, para mais ou para menos). O detalhe mostra o lucro em
  reais, o % até agora (lucro sobre o capital que ficou parado) e o % ao ano
  projetado em juros compostos, com aviso quando há poucos dias de histórico.
- **Módulo de finanças pessoais** (fases 0 a 3 do plano em
  `docs/plans/2026-09-21-financas-pessoais/`), com grupo próprio na navegação:
  - **Painel** com saldo consolidado atual e previsto, resumo do mês contra o
    anterior e as barras de alvo × realizado do casal, nos três modos de divisão
    (sem divisão, proporcional à renda e bolo comum).
  - **Transações, Gastos e Entradas** — a mesma tela com um filtro fixo de tipo:
    livro com filtros combináveis, chips do filtro aplicado, foto do comprovante
    com miniatura e ampliação, e exportação em CSV do que está na tela.
  - **Contas** (corrente, poupança, dinheiro, vale-refeição e cartão) e
    **Categorias** planas com cor, orçamento mensal e etiquetas livres.
  - **Relatórios** com totais por categoria contra o orçamento, duas roscas
    (mês e ano) nas cores das categorias, comparativo com o período anterior e
    tendência de até duas categorias em 12 meses.
  - **Fatura** de cartão com ciclo real de fechamento e vencimento, os dois
    números separados (fatura atual e total devido), limite usado e disponível,
    parcelamento com plano persistido, estorno e antecipação de parcelas.
- Backup do banco pela API `backup()` do SQLite, com botão visível no livro.
- **Contas no módulo de investimentos**: uma por pessoa de Finanças (Steylor,
  Bianca…), escolhida num seletor no menu lateral. Cada conta tem os próprios
  registros — operações, caixas e renda fixa, aportes, proventos, metas de
  alocação, planejamento e histórico. Pessoa nova ganha conta sozinha, e o
  nome acompanha o da pessoa. O que já existia ficou na primeira conta, que
  continua mostrando o patrimônio com as contas do banco; o Patrimônio do
  módulo de finanças soma todas.
- **Fatura**: clicar numa compra abre o lançamento para editar ali mesmo (e, nas
  parcelas, perguntar se vale só para ela, para ela e as futuras ou para todas);
  atalhos levam à compra nas Transações ou a todas as parcelas dela; e uma lista
  de **parcelas futuras** deixa editar cada uma antes de a fatura chegar.
- **Caixa cripto** (stablecoin na corretora, em dólar) e "Reserva de
  emergência" com o nome completo no "Novo caixa".

### Changed

- Toda caixinha tem saldo próprio e fica atrelada a uma conta, como no banco:
  guardar tira do saldo da conta e resgatar devolve, e cada movimento aparece no
  livro da conta com o nome da caixinha. O tipo "Marcação" saiu; a migração 019
  converteu as marcações em caixinhas com o saldo que tinham, sem mexer no saldo
  da conta. A faixa de contas mostra "Em caixinhas" à parte, fora do saldo.
- Os cartões das caixinhas ficaram compactos (conta atrelada, saldo, alvo,
  Guardar e Resgatar); clicar no cartão abre o detalhe com impostos, aviso de
  IOF, rendimento projetado, ritmo e o extrato só daquela caixinha.
- Novo lançamento ganha o tipo **Caixinha**, para guardar ou resgatar escolhendo
  a caixinha.
- A entrada só pede a conta em que caiu: o campo "Quem recebeu" / "De quem veio"
  saiu do formulário (a pessoa é a dona da conta). Quem depositou na conjunta é
  uma transferência da conta dessa pessoa, que já conta no "Já depositou" do
  alvo do casal.
- As listas suspensas do formulário abrem por cima da gaveta, para cima ou para
  baixo conforme o espaço, sem cortar as opções nem exigir rolagem.
- Contas e pessoas, em Finanças, não mostra mais a conta "Investimentos": o
  módulo de finanças não precisa saber quanto foi aportado.
- Migrações agora são versionadas, com transação por versão e suporte a
  reconstrução de tabela para ampliar `CHECK`.
- `apps/web` consome os tipos de `@projeto41/contracts`; `src/lib/types.ts`
  deixou de existir. O bundle continua sem `zod`.
- As rotas da API saíram de `app.ts` para plugins por recurso, sem mudança de
  comportamento.

## [0.5.0] - 2026-06-17

### Added

- Página de Alocação: gráfico de rosca da meta ao lado dos controles, redesenhado
  em tempo real conforme você ajusta a meta de cada classe.

### Changed

- Rótulos do gráfico de rosca deixam de se sobrepor: os que ficariam grudados são
  reposicionados verticalmente e mantidos dentro da área do gráfico.

## [0.4.0] - 2026-06-17

### Added

- Exportação das operações de cripto em CSV pela carteira (botão "Exportar CSV"
  e endpoint `GET /api/export/operations.csv`), com uma coluna de moeda por
  operação.

### Changed

- Botão "Exportar CSV" com tratamento discreto: plano por padrão, ganhando fundo
  e borda apenas no hover, com microinteração no ícone de download.

## [0.3.0] - 2026-06-16

### Added

- Busca de criptomoedas por símbolo ou nome (CoinGecko) ao cadastrar operações,
  associando a moeda ao identificador correto usado na cotação.

### Changed

- Cotações de cripto passam a vir da CoinGecko, substituindo o provedor anterior
  configurado por `CRYPTO_PRICE_URL`. Use `COINGECKO_API_KEY` (plano Demo,
  opcional) para elevar o limite de requisições.

## [0.2.0] - 2026-06-16

### Added

- Cadastro de operação flexível: preencha dois dos três campos
  (Quantidade × Preço = Total) e o terceiro é calculado automaticamente, com o
  campo "auto" destacado.
- Carteira cripto: alterne a moeda da operação entre USD e BRL (converte para
  USD ao salvar) e opção de descontar a taxa Binance de 0,1%.
- Seletor de data próprio (calendário no tema) no drawer de operação.

### Changed

- Steppers numéricos customizados no tema, com passo em centavos para preço e
  total.

### Fixed

- Drawer de operação fixado à borda direita da tela.

## [0.1.0] - 2026-06-09

### Added

- Versão inicial: dashboard, carteiras cripto e B3, posições manuais, aportes,
  planejamento, alocação ideal e histórico patrimonial com snapshots diários.
