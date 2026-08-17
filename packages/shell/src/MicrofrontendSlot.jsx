// packages/shell/src/MicrofrontendSlot.jsx
import { useEffect, useRef } from "react";
import { loadMicrofrontend } from "./loadMicrofrontend";

export default function MicrofrontendSlot({ config, props }) {
  const containerRef = useRef(null);

  useEffect(() => {
    let cleanup;
    let cancelled = false;

    loadMicrofrontend(config, containerRef.current, props).then((unmountFn) => {
      if (cancelled) unmountFn();
      else cleanup = unmountFn;
    });

    return () => {
      cancelled = true;
      if (cleanup) cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.globalName, JSON.stringify(props)]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
