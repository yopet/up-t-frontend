// packages/shell/src/App.jsx
//
// El shell es deliberadamente "tonto": no conoce lógica de negocio de
// ningún dominio. Su única responsabilidad es (1) resolver qué
// establecimiento está activo a partir de la URL, y (2) decidir, según
// la ruta, qué microfrontend montar. Nada de queue, credits o playback
// vive aquí — eso es responsabilidad exclusiva de cada microfrontend.

import { BrowserRouter, Routes, Route } from "react-router-dom";
import MicrofrontendSlot from "./MicrofrontendSlot";

const MF_CONFIG = {
  tv: {
    devUrl: "http://localhost:5174/src/mount.jsx",
    prodUrl: import.meta.env.VITE_MF_TV_URL || "http://localhost:5174/mf-tv.js",
    globalName: "__MF_TV__",
  },
  customer: {
    devUrl: "http://localhost:5175/src/mount.jsx",
    prodUrl: import.meta.env.VITE_MF_CUSTOMER_URL || "http://localhost:5175/mf-customer.js",
    globalName: "__MF_CUSTOMER__",
  },
  admin: {
    devUrl: "http://localhost:5176/src/mount.jsx",
    prodUrl: import.meta.env.VITE_MF_ADMIN_URL || "http://localhost:5176/mf-admin.js",
    globalName: "__MF_ADMIN__",
  },
};

function useEstablishmentId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("est") || "";
}

function FullScreenSlot({ mfKey, extraProps }) {
  const establishmentId = useEstablishmentId();
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <MicrofrontendSlot
        config={MF_CONFIG[mfKey]}
        props={{ establishmentId, ...extraProps }}
      />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/tv" element={<FullScreenSlot mfKey="tv" extraProps={{ variant: "simple" }} />} />
        <Route path="/tvVideo" element={<FullScreenSlot mfKey="tv" extraProps={{ variant: "video" }} />} />
        <Route path="/admin" element={<FullScreenSlot mfKey="admin" />} />
        <Route path="/scan" element={<FullScreenSlot mfKey="customer" />} />
        <Route path="/" element={<FullScreenSlot mfKey="customer" />} />
      </Routes>
    </BrowserRouter>
  );
}
