import { FileUp, X } from "lucide-react";
import { useRef } from "react";

/**
 * Seletor de arquivo com a cara dos outros campos.
 *
 * O `<input type="file">` nativo não deixa formatar o nome escolhido (nome
 * longo de extrato vazava da coluna) e, dentro do `<label>` do Field, qualquer
 * clique na dica também abria o seletor. Aqui o input fica escondido e um
 * botão o abre; o nome aparece cortado com reticências, e dá para limpar.
 */
export function FilePicker({
  file,
  onChange,
  accept,
  label = "Escolher arquivo",
  placeholder = "Nenhum arquivo escolhido",
  "aria-label": ariaLabel
}: {
  file: File | null;
  onChange: (file: File | null) => void;
  accept?: string;
  label?: string;
  /** Texto no lugar do nome enquanto nada foi escolhido (bom para os formatos aceitos). */
  placeholder?: string;
  "aria-label"?: string;
}) {
  const input = useRef<HTMLInputElement>(null);

  return (
    <div className={`file-picker ${file ? "has-file" : ""}`}>
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(event) => {
          onChange(event.target.files?.[0] ?? null);
          // Escolher o mesmo arquivo de novo (depois de limpar) volta a disparar.
          event.target.value = "";
        }}
      />
      <button
        type="button"
        className="file-picker-button"
        onClick={() => input.current?.click()}
        aria-label={ariaLabel ?? label}
      >
        <FileUp size={15} aria-hidden />
        {file ? "Trocar" : label}
      </button>
      <span className="file-picker-name" title={file?.name}>
        {file ? file.name : placeholder}
      </span>
      {file && (
        <button
          type="button"
          className="file-picker-clear"
          onClick={() => onChange(null)}
          aria-label="Tirar o arquivo"
          title="Tirar o arquivo"
        >
          <X size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}
