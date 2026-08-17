// packages/mf-admin/src/AdminRoot.jsx
//
// Root del microfrontend Admin. Es el dominio con más responsabilidad:
// moderación de cola, control de reproducción, créditos y publicidad.
// Mantiene su propia copia completa del ciclo Flux (Dispatcher + 3
// stores + actions), igual que mf-tv y mf-customer, pero además es quien
// dispara la carga inicial de `establishments` (los otros dos dominios
// reciben `establishmentId` ya resuelto, típicamente desde el shell).

import { useEffect } from "react";
import { supabase } from "./lib/supabase";
import { Actions } from "./flux/actions";
import { dispatcher } from "./flux/Dispatcher";
import { queueStore } from "./flux/queueStore";
import { playbackStore } from "./flux/playbackStore";
import { sessionStore } from "./flux/sessionStore";
import { useStore } from "./flux/useStore";
import AdminView from "./AdminView";

export default function AdminRoot({ establishmentId }) {
  const { credits, ads } = useStore(sessionStore);
  const { queue, currentIdx } = useStore(queueStore);
  const { volume, autoPlay } = useStore(playbackStore);

  useEffect(() => {
    if (!establishmentId) return;

    Actions.loadPlaybackState(establishmentId);
    Actions.loadQueue(establishmentId);
    Actions.loadAds(establishmentId);

    const queueSub = supabase
      .channel(`mf-admin-queue-${establishmentId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "queue", filter: `establishment_id=eq.${establishmentId}` },
        () => Actions.loadQueue(establishmentId)
      )
      .subscribe();

    const estSub = supabase
      .channel(`mf-admin-est-${establishmentId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "establishments", filter: `id=eq.${establishmentId}` },
        (payload) => {
          if (payload.new.credits !== undefined) {
            dispatcher.dispatch({ type: "CREDITS_CHANGED", payload: { credits: payload.new.credits } });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(queueSub);
      supabase.removeChannel(estSub);
    };
  }, [establishmentId]);

  return (
    <AdminView
      establishmentId={establishmentId}
      credits={credits}
      queue={queue}
      currentIdx={currentIdx}
      onPlay={(idx) => Actions.play(establishmentId, idx)}
      onClearQueue={() => Actions.clearQueue(establishmentId)}
      onRemove={(idx) => {
        const item = queue[idx];
        if (item?.queueRowId) Actions.removeSong(item.queueRowId);
      }}
      onApprove={(rowId) => Actions.approveSong(rowId, establishmentId)}
      autoPlay={autoPlay}
      onToggleAutoPlay={(val) => Actions.toggleAutoPlay(establishmentId, val)}
      volume={volume}
      onVolumeChange={(v) => Actions.setVolume(establishmentId, v)}
      ads={ads}
      onAddAd={() => Actions.loadAds(establishmentId)}
      onRemoveAd={() => Actions.loadAds(establishmentId)}
      onAddSong={(s) => Actions.requestSong(establishmentId, s, true, autoPlay)}
    />
  );
}
