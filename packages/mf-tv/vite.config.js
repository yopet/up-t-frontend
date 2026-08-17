import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Se construye como un bundle IIFE autónomo: al cargarlo con un <script>,
// se ejecuta y se adjunta a window.__MF_TV__. React queda embebido en el
// bundle (no external) porque cada microfrontend debe poder desplegarse
// de forma independiente, sin depender de que el shell exponga versiones
// compartidas en tiempo de ejecución. El costo de esto (bundles más
// grandes, posible duplicación de React entre microfrontends) es un
// trade-off documentado de la composición en cliente.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, cors: true },
  build: {
    outDir: "dist",
    lib: {
      entry: "src/mount.jsx",
      name: "MfTv",
      formats: ["iife"],
      fileName: () => "mf-tv.js",
    },
  },
});
