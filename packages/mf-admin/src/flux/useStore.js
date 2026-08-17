// src/flux/useStore.js
//
// Puente entre React y un Store de Flux. Cada componente que llame a
// useStore(store) se suscribe a sus cambios y re-renderiza automáticamente
// cuando el store notifica un cambio — sin que ninguna Vista necesite saber
// cómo se produjo ese cambio (Supabase Realtime, una acción local, etc.).

import { useEffect, useState } from "react";

export function useStore(store) {
  const [state, setState] = useState(store.getState());

  useEffect(() => {
    const unsubscribe = store.subscribe(setState);
    return unsubscribe;
  }, [store]);

  return state;
}
