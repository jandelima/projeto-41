# Fixtures de PDF

Cada adapter tem pelo menos uma fixture em `<adapterId>/<layoutVersion>.pdf`,
com a saída esperada ao lado em `<layoutVersion>.golden.json`.

**Este repositório tem remoto no GitHub.** Um extrato real commitado por engano
não se apaga com `git rm`. Prefira fixture **gerada** com dado fictício (como
`btg-extrato`, montada por `scripts/build-btg-fixture.ts` a partir das
coordenadas do layout real). Se for preciso commitar um PDF de verdade, remova
antes, item a item:

- [ ] nome
- [ ] CPF/CNPJ e RG
- [ ] endereço, telefone, e-mail
- [ ] agência e número de conta
- [ ] número do cartão (no máximo os 4 últimos dígitos)
- [ ] código de barras, linha digitável e QR de pagamento

Valores e datas ficam: é o que o teste confere. O teste de cada fixture falha
se o texto extraído tiver um padrão de CPF.

O golden não tem regravação automática. Mudou a fixture ou o adapter? Edite o
`.golden.json` lendo o diff.
