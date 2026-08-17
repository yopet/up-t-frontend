// packages/mf-customer/src/CustomerRoot.jsx
//
// Root del microfrontend Customer. Dominio: solicitud de canciones desde
// el celular del cliente. Su única escritura hacia el resto del sistema
// es Actions.requestSong — el resto de la sincronización (ver la cola,
// saber si su canción fue aprobada) llega vía Supabase Realtime.

import { useEffect } from "react";
import { supabase } from "./lib/supabase";
import { Actions } from "./flux/actions";
import { queueStore } from "./flux/queueStore";
import { useStore } from "./flux/useStore";
import CustomerView from "./CustomerView";

export default function CustomerRoot({ establishmentId, autoPlay = true }) {
  const { queue, currentIdx } = useStore(queueStore);

  useEffect(() => {
    if (!establishmentId) return;

    Actions.loadQueue(establishmentId);

    const queueSub = supabase
      .channel(`mf-customer-queue-${establishmentId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "queue", filter: `establishment_id=eq.${establishmentId}` },
        () => Actions.loadQueue(establishmentId)
      )
      .subscribe();

    return () => supabase.removeChannel(queueSub);
  }, [establishmentId]);

  return (
    <CustomerView
      establishmentId={establishmentId}
      onSongRequest={(song) => Actions.requestSong(establishmentId, song, false, autoPlay)}
      queue={queue}
      currentIdx={currentIdx}
    />
  );
}
