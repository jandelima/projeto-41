import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
