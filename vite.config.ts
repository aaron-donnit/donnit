import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  base: "./",
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Named chunks for the biggest, leaf-level libraries. Everything else
        // (including small react ecosystem helpers) is left for Rollup to
        // chunk automatically — that avoids circular manual-chunk warnings.
        manualChunks: (id) => {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@radix-ui")) return "radix";
          if (id.includes("@tanstack/react-query")) return "query";
          if (id.includes("recharts") || id.includes("/d3-")) return "charts";
          if (id.includes("framer-motion")) return "motion";
          if (id.includes("@supabase")) return "supabase";
          if (id.includes("lucide-react") || id.includes("react-icons")) return "icons";
          return undefined;
        },
      },
    },
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
