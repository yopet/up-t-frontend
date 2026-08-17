// packages/mf-admin/src/mount.jsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AdminRoot from "./AdminRoot";
import { Actions } from "./flux/actions";
import "./index.css";
import "./App.css";

const roots = new WeakMap();

async function mount(container, props = {}) {
  let establishmentId = props.establishmentId;
  if (!establishmentId) {
    establishmentId = await Actions.loadEstablishments();
  }
  const root = createRoot(container);
  roots.set(container, root);
  root.render(
    <StrictMode>
      <AdminRoot establishmentId={establishmentId} />
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

window.__MF_ADMIN__ = { mount, unmount };

if (document.getElementById("root")) {
  const params = new URLSearchParams(window.location.search);
  mount(document.getElementById("root"), { establishmentId: params.get("est") || "" });
}
