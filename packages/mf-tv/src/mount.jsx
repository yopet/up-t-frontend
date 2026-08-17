// packages/mf-tv/src/mount.js
//
// Contrato estándar de microfrontend para composición en cliente:
// window.__MF_TV__ = { mount(container, props), unmount(container) }
//
// El shell carga este bundle con un <script> dinámico y, una vez presente
// el global, llama a mount() pasando el contenedor DOM y las props que
// resuelva (p. ej. establishmentId desde la URL).

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import TvRoot from "./TvRoot";
import "./index.css";
import "./App.css";

const roots = new WeakMap();

function mount(container, props = {}) {
  const root = createRoot(container);
  roots.set(container, root);
  root.render(
    <StrictMode>
      <TvRoot {...props} />
    </StrictMode>
  );
}

function unmount(container) {
  const root = roots.get(container);
  if (root) {
    root.unmount();
    roots.delete(container);
  }
}

window.__MF_TV__ = { mount, unmount };

// Modo standalone: si este bundle se sirve directo (dev server propio,
// sin shell), se auto-monta en #root usando el establishmentId de la URL.
if (document.getElementById("root")) {
  const params = new URLSearchParams(window.location.search);
  mount(document.getElementById("root"), {
    establishmentId: params.get("est") || "",
    variant: params.get("variant") || "video",
  });
}
