import { AlertTriangle, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { ReactNode } from "react";
import { Button } from "./ui.js";

function useEscape(onClose: () => void) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // Uma lista aberta dentro do drawer consome o Esc (e marca o evento):
      // fechar a lista não pode fechar o formulário junto.
      if (event.key === "Escape" && !event.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
}

/**
 * Trava a rolagem da página enquanto houver um popup aberto. Sem isso a roda
 * do mouse sobre o fundo escurecido rola a tela de trás. Contador porque um
 * popup pode abrir por cima de outro (confirmação sobre o drawer): só o
 * último a fechar devolve a rolagem. A largura da barra vira padding para a
 * página não pular para o lado.
 */
let scrollLocks = 0;
function useScrollLock() {
  useEffect(() => {
    const root = document.documentElement;
    if (scrollLocks === 0) {
      const scrollbar = window.innerWidth - root.clientWidth;
      root.style.overflow = "hidden";
      if (scrollbar > 0) root.style.paddingRight = `${scrollbar}px`;
    }
    scrollLocks += 1;
    return () => {
      scrollLocks -= 1;
      if (scrollLocks === 0) {
        root.style.overflow = "";
        root.style.paddingRight = "";
      }
    };
  }, []);
}

export function Modal({
  title,
  onClose,
  children,
  width = 480
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  useEscape(onClose);
  useScrollLock();
  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" style={{ width: `min(${width}px, 100%)` }} role="dialog" aria-modal>
        <div className="dialog-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Drawer({
  title,
  subtitle,
  onClose,
  children,
  footer
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEscape(onClose);
  useScrollLock();
  return (
    <div className="overlay overlay-right" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal>
        <div className="dialog-head">
          <div>
            <h3>{title}</h3>
            {subtitle && <p className="dialog-sub">{subtitle}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </aside>
    </div>
  );
}

type ConfirmOptions = {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
};

type ConfirmContextValue = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<(value: boolean) => void>(() => {});

  const confirm = useCallback<ConfirmContextValue>((next) => {
    setOptions(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = useCallback((value: boolean) => {
    resolver.current(value);
    setOptions(null);
  }, []);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {options && (
        <Modal title={options.title} onClose={() => close(false)} width={420}>
          <div className="confirm-body">
            <div className={`confirm-icon ${options.tone ?? "primary"}`}>
              <AlertTriangle size={20} />
            </div>
            <p>{options.message}</p>
          </div>
          <div className="dialog-actions">
            <Button variant="ghost" onClick={() => close(false)}>
              {options.cancelLabel ?? "Cancelar"}
            </Button>
            <Button variant={options.tone === "danger" ? "danger" : "primary"} onClick={() => close(true)}>
              {options.confirmLabel ?? "Confirmar"}
            </Button>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error("useConfirm deve ser usado dentro de ConfirmProvider");
  return context;
}
