import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { setValuesMasked } from "./format.js";

type PrivacyContextValue = {
  hidden: boolean;
  toggle: () => void;
};

const PrivacyContext = createContext<PrivacyContextValue | null>(null);
const STORAGE_KEY = "projeto41-privacy";

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  });

  // Aplicado de forma síncrona para que os formatadores já reflitam no render atual.
  setValuesMasked(hidden);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, String(hidden));
  }, [hidden]);

  const value = useMemo(() => ({ hidden, toggle: () => setHidden((current) => !current) }), [hidden]);

  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

export function usePrivacy() {
  const context = useContext(PrivacyContext);
  if (!context) throw new Error("usePrivacy deve ser usado dentro de PrivacyProvider");
  return context;
}
