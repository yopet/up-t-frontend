import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5176, cors: true },
  build: {
    outDir: "dist",
    lib: {
      entry: "src/mount.jsx",
      name: "MfAdmin",
      formats: ["iife"],
      fileName: () => "mf-admin.js",
    },
  },
});
