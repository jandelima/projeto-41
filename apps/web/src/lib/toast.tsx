import { CheckCircle2, Info, Loader2, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

type ToastTone = "success" | "error" | "info" | "loading";
type Toast = { id: number; tone: ToastTone; message: string };

type ToastContextValue = {
  notify: (message: string, tone?: ToastTone) => number;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const icons = { success: CheckCircle2, error: XCircle, info: Info, loading: Loader2 };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (message: string, tone: ToastTone = "success") => {
      const id = (counter.current += 1);
      setToasts((current) => [...current, { id, tone, message }]);
      // Loading toasts stay until the caller dismisses them.
      if (tone !== "loading") window.setTimeout(() => dismiss(id), 4200);
      return id;
    },
    [dismiss]
  );

  const value = useMemo(() => ({ notify, dismiss }), [notify, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => {
          const Icon = icons[toast.tone];
          const loading = toast.tone === "loading";
          return (
            <div key={toast.id} className={`toast toast-${toast.tone}`}>
              <Icon size={18} className={loading ? "spin" : undefined} />
              <span>{toast.message}</span>
              {!loading && (
                <button onClick={() => dismiss(toast.id)} aria-label="Fechar">
                  <X size={15} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast deve ser usado dentro de ToastProvider");
  return context;
}
