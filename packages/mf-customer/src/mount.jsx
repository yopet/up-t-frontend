// packages/mf-customer/src/mount.jsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import CustomerRoot from "./CustomerRoot";
import "./index.css";
import "./App.css";

const roots = new WeakMap();

function mount(container, props = {}) {
  const root = createRoot(container);
  roots.set(container, root);
  root.render(
    <StrictMode>
      <CustomerRoot {...props} />
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

window.__MF_CUSTOMER__ = { mount, unmount };

if (document.getElementById("root")) {
  const params = new URLSearchParams(window.location.search);
  mount(document.getElementById("root"), { establishmentId: params.get("est") || "" });
}
