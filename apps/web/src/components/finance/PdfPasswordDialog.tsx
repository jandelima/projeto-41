import { Lock } from "lucide-react";
import { useState } from "react";
import { Modal } from "../dialog.js";
import { Button, Field } from "../ui.js";

/**
 * Pede a senha de um PDF cifrado.
 *
 * A senha vive so no estado deste componente durante a requisicao: nao vai
 * para `localStorage`, nao entra em URL nem em formulario persistido, e o
 * componente desmonta (levando a senha) ao fechar.
 */
export function PdfPasswordDialog({
  fileName,
  incorrect,
  busy,
  onSubmit,
  onClose
}: {
  fileName: string;
  /** A ultima tentativa errou: mostra o aviso e deixa tentar de novo. */
  incorrect: boolean;
  busy: boolean;
  onSubmit: (password: string) => void;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  return (
    <Modal title="PDF com senha" onClose={onClose} width={440}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (password) onSubmit(password);
        }}
      >
        <p className="fin-callout">
          <strong>{fileName}</strong> está protegido por senha. Extratos enviados por e-mail costumam
          usar dígitos do CPF; o PDF baixado do app do banco geralmente não tem senha. A senha é usada
          só para abrir este arquivo e não é guardada.
        </p>
        {incorrect && <p className="fin-callout warning">Senha incorreta. Tente de novo.</p>}
        <Field label="Senha do PDF">
          <input
            type="password"
            autoComplete="off"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-label="Senha do PDF"
          />
        </Field>
        <div className="dialog-actions">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" icon={Lock} disabled={!password || busy}>
            {busy ? "Abrindo…" : "Abrir PDF"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
