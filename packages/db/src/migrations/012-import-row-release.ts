import type { Migration } from "./runner.js";

/**
 * Apagar um lancamento que veio de extrato solta a linha importada.
 *
 * `import_rows.entry_id` e `duplicate_of_entry_id` apontam para `entries` sem
 * cascata, entao excluir um lancamento importado falhava com erro de chave
 * estrangeira — por qualquer caminho: a tela, a serie de parcelas, a troca de
 * saida por aporte, a antecipacao desfeita.
 *
 * A linha nao e apagada: ela guarda o identificador do banco e o hash, e e
 * isso que faz a proxima importacao do mesmo arquivo reconhece-la. Quem apaga
 * um lancamento importado decidiu que nao o quer, entao a linha vira
 * `ignored` e a reimportacao a pula sozinha, em vez de oferecer de novo.
 *
 * Gatilho, e nao codigo no repositorio, porque sao quatro caminhos de DELETE
 * hoje e o quinto nao vai lembrar desta regra.
 */
export const migration012ImportRowRelease: Migration = {
  version: 12,
  name: "import-row-release",
  up: (db) => {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS entries_release_import_rows
      BEFORE DELETE ON entries
      BEGIN
        UPDATE import_rows SET entry_id = NULL, status = 'ignored' WHERE entry_id = OLD.id;
        UPDATE import_rows SET duplicate_of_entry_id = NULL WHERE duplicate_of_entry_id = OLD.id;
      END;
    `);
  }
};
