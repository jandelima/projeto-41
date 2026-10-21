import { Camera, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import type { AttachmentRecord } from "@projeto41/contracts";
import { IconButton } from "../ui.js";
import { attachmentThumbUrl } from "../../lib/ledger.js";

/**
 * Campo de foto do comprovante.
 *
 * Num lancamento novo o arquivo fica em memoria ate existir um id para anexar;
 * num lancamento ja salvo o envio acontece na hora. Por isso o componente
 * trabalha com dois estados: o anexo ja gravado e o arquivo pendente.
 */
export function PhotoField({
  attachments,
  pending,
  onPick,
  onRemovePending,
  onRemoveSaved,
  uploading
}: {
  attachments: AttachmentRecord[];
  pending: File | null;
  onPick: (file: File) => void;
  onRemovePending: () => void;
  onRemoveSaved: (id: number) => void;
  uploading: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  function pick(file: File | undefined) {
    if (!file) return;
    // O object URL e revogado ao trocar ou limpar, para nao vazar memoria.
    setPreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(file);
    });
    onPick(file);
  }

  function clearPending() {
    setPreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    if (input.current) input.current.value = "";
    onRemovePending();
  }

  return (
    <div className="fin-photo-field">
      <span className="field-label">Foto do comprovante</span>
      <div className="fin-photo-row">
        {attachments.map((attachment) => (
          <figure key={attachment.id} className="fin-photo-item">
            <img src={attachmentThumbUrl(attachment.id)} alt="Comprovante" />
            <IconButton
              icon={Trash2}
              tone="danger"
              label="Remover foto"
              onClick={() => onRemoveSaved(attachment.id)}
            />
          </figure>
        ))}

        {preview && (
          <figure className="fin-photo-item">
            <img src={preview} alt="Prévia da foto selecionada" />
            <IconButton icon={Trash2} tone="danger" label="Descartar" onClick={clearPending} />
          </figure>
        )}

        <button
          type="button"
          className="fin-photo-add"
          onClick={() => input.current?.click()}
          disabled={uploading}
        >
          <Camera size={18} />
          {uploading ? "Enviando…" : pending || attachments.length > 0 ? "Trocar" : "Adicionar"}
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        hidden
        onChange={(event) => pick(event.target.files?.[0])}
      />
      <small className="field-hint">JPEG, PNG, WebP ou HEIC, até 15 MB.</small>
    </div>
  );
}
