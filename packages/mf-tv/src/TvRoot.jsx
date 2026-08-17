// packages/mf-tv/src/TvRoot.jsx
//
// Root del microfrontend TV. Equivalente, para este dominio, a lo que
// App.jsx hacía en el monolito: monta las suscripciones Realtime propias
// del dominio y compone la vista con los stores locales.
//
// A diferencia de la Entrega 2 (Flux dentro de un único proceso), este
// microfrontend NO comparte memoria con mf-admin ni mf-customer. Su
// sincronización con lo que ocurre en AdminView (aprobar canción, cambiar
// volumen) ocurre exclusivamente a través de Supabase Realtime — el mismo
// mecanismo que antes usaba App.jsx, ahora es también el puente entre
// microfrontends.

import { useEffect } from "react";
import { supabase } from "./lib/supabase";
import { Actions } from "./flux/actions";
import { dispatcher } from "./flux/Dispatcher";
import { queueStore } from "./flux/queueStore";
import { playbackStore } from "./flux/playbackStore";
import { sessionStore } from "./flux/sessionStore";
import { useStore } from "./flux/useStore";
import TvView from "./TvView";
import TvViewVideo from "./TvViewVideo";

export default function TvRoot({ establishmentId, variant = "video" }) {
  const { currentIdx } = useStore(queueStore);
  const { volume, currentMessage, messageAuthor } = useStore(playbackStore);
  const { ads } = useStore(sessionStore);
  const approvedQueue = queueStore.getApprovedQueue();

  useEffect(() => {
    if (!establishmentId) return;

    Actions.loadPlaybackState(establishmentId);
    Actions.loadQueue(establishmentId);
    Actions.loadAds(establishmentId);

    const stateSub = supabase
      .channel(`mf-tv-state-${establishmentId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "app_state", filter: `id=eq.config-${establishmentId}` },
        (payload) => {
          const r = payload.new;
          if (r.volume !== undefined || r.auto_play !== undefined) {
            dispatcher.dispatch({ type: "PLAYBACK_STATE_LOADED", payload: { volume: r.volume, autoPlay: r.auto_play } });
          }
          if (r.current_idx !== undefined) {
            dispatcher.dispatch({ type: "CURRENT_IDX_CHANGED", payload: { idx: r.current_idx } });
          }
        }
      )
      .subscribe();

    const queueSub = supabase
      .channel(`mf-tv-queue-${establishmentId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "queue", filter: `establishment_id=eq.${establishmentId}` },
        () => Actions.loadQueue(establishmentId)
      )
      .subscribe();

    const msgSub = supabase
      .channel(`mf-tv-messages-${establishmentId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "screen_messages", filter: `establishment_id=eq.${establishmentId}` },
        (payload) => {
          const data = payload.new;
          if (data && data.status === "approved") Actions.showScreenMessage(data.text, data.author);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(stateSub);
      supabase.removeChannel(queueSub);
      supabase.removeChannel(msgSub);
    };
  }, [establishmentId]);

  const handleTrackEnd = () => {
    const nextIdx = currentIdx + 1;
    if (nextIdx < approvedQueue.length) Actions.play(establishmentId, nextIdx);
  };

  if (variant === "simple") {
    return (
      <TvView
        queue={approvedQueue}
        currentIdx={currentIdx}
        onTrackEnd={handleTrackEnd}
        volume={volume}
        currentMessage={currentMessage}
        messageAuthor={messageAuthor}
      />
    );
  }

  return (
    <TvViewVideo
      queue={approvedQueue}
      currentIdx={currentIdx}
      volume={volume}
      onTrackEnd={handleTrackEnd}
      onVideoError={(rowId) => Actions.rejectSongOnVideoError(rowId)}
      ads={ads}
      establishmentId={establishmentId}
    />
  );
}
