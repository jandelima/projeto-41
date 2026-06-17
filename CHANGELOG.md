# Changelog

Todas as mudanças relevantes deste projeto são documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o
projeto adota [Versionamento Semântico](https://semver.org/lang/pt-BR/).

Mudanças ainda não lançadas ficam em **[Unreleased]**. Ao publicar, renomeie
essa seção para a nova versão com a data (ex.: `## [0.3.0] - 2026-07-01`) e abra
um novo `[Unreleased]` vazio no topo.

## [Unreleased]

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
