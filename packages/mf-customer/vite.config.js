import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5175, cors: true },
  build: {
    outDir: "dist",
    lib: {
      entry: "src/mount.jsx",
      name: "MfCustomer",
      formats: ["iife"],
      fileName: () => "mf-customer.js",
    },
  },
});
