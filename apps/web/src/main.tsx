import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.js";
import { ConfirmProvider } from "./components/dialog.js";
import { PrivacyProvider } from "./lib/privacy.js";
import { ThemeProvider } from "./lib/theme.js";
import { ToastProvider } from "./lib/toast.js";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <PrivacyProvider>
        <ToastProvider>
          <ConfirmProvider>
            <App />
          </ConfirmProvider>
        </ToastProvider>
      </PrivacyProvider>
    </ThemeProvider>
  </StrictMode>
);
