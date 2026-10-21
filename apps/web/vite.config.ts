import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Os pacotes do monorepo sao consumidos como `./src/index.ts`, sem build:
      // o alias do tsconfig resolve os tipos, mas o Vite precisa do seu proprio.
      "@projeto41/contracts": fileURLToPath(
        new URL("../../packages/contracts/src/index.ts", import.meta.url)
      ),
      "@projeto41/finance": fileURLToPath(
        new URL("../../packages/finance/src/index.ts", import.meta.url)
      )
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react")) return "react";
          if (id.includes("node_modules/recharts") || id.includes("node_modules/d3-")) {
            return "charts";
          }
          if (id.includes("node_modules/lucide-react")) return "icons";
        }
      }
    }
  },
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": process.env.API_TARGET ?? "http://127.0.0.1:3001"
    }
  }
});
