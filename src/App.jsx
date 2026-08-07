import { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { supabase } from "./lib/supabase";
import TvView from "./TvView";
import TvViewVideo from "./TvViewVideo";
import CustomerView from "./CustomerView";
import AdminView from "./AdminView";

import { Actions } from "./flux/actions";
import { dispatcher } from "./flux/Dispatcher";
import { queueStore } from "./flux/queueStore";
import { playbackStore } from "./flux/playbackStore";
import { sessionStore } from "./flux/sessionStore";
import { useStore } from "./flux/useStore";

// App.jsx ya NO contiene lógica de negocio ni llama a Supabase directamente.
// Su única responsabilidad ahora es: (1) montar las suscripciones Realtime
// que traducen cambios en Supabase a Actions, y (2) leer los stores para
// componer las rutas/vistas. Toda la lógica que antes vivía aquí como
// useState + handlers se movió a src/flux/.

export default function App() {
  const { selectedEstId, credits, ads } = useStore(sessionStore);
  const { queue, currentIdx } = useStore(queueStore);
  const { volume, autoPlay, currentMessage, messageAuthor } = useStore(playbackStore);

  const approvedQueue = queueStore.getApprovedQueue();

  // 1. CARGA INICIAL — solo una vez.
  useEffect(() => {
    Actions.loadEstablishments();
  }, []);

  // 2. REALTIME — se re-suscribe cada vez que cambia el establecimiento activo.
  useEffect(() => {
    if (!selectedEstId) return;

    Actions.loadPlaybackState(selectedEstId);
    Actions.loadQueue(selectedEstId);
    Actions.loadAds(selectedEstId);

    // Este canal escucha cambios en `app_state` originados por OTROS clientes
    // (p. ej. el AdminView de otro dispositivo). Por eso despacha directo al
    // store en vez de pasar por Actions: Actions.* escriben a Supabase, y
    // volver a escribir aquí lo que Supabase ya nos notificó crearía un loop.
    const stateSub = supabase
      .channel(`state-${selectedEstId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "app_state", filter: `id=eq.config-${selectedEstId}` },
        (payload) => {
          const r = payload.new;
          if (r.volume !== undefined || r.auto_play !== undefined) {
            dispatcher.dispatch({
              type: "PLAYBACK_STATE_LOADED",
              payload: { volume: r.volume, autoPlay: r.auto_play },
            });
          }
          if (r.current_idx !== undefined) {
            dispatcher.dispatch({ type: "CURRENT_IDX_CHANGED", payload: { idx: r.current_idx } });
          }
        }
      )
      .subscribe();

    const queueSub = supabase
      .channel(`queue-${selectedEstId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "queue", filter: `establishment_id=eq.${selectedEstId}` },
        () => Actions.loadQueue(selectedEstId)
      )
      .subscribe();

    const estSub = supabase
      .channel(`est-update-${selectedEstId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "establishments", filter: `id=eq.${selectedEstId}` },
        (payload) => {
          if (payload.new.credits !== undefined) {
            dispatcher.dispatch({ type: "CREDITS_CHANGED", payload: { credits: payload.new.credits } });
          }
        }
      )
      .subscribe();

    const msgSub = supabase
      .channel(`messages-tv-${selectedEstId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "screen_messages", filter: `establishment_id=eq.${selectedEstId}` },
        (payload) => {
          const data = payload.new;
          if (data && data.status === "approved") {
            Actions.showScreenMessage(data.text, data.author);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(stateSub);
      supabase.removeChannel(queueSub);
      supabase.removeChannel(estSub);
      supabase.removeChannel(msgSub);
    };
  }, [selectedEstId]);

  const handleTrackEnd = () => {
    const nextIdx = currentIdx + 1;
    if (nextIdx < approvedQueue.length) {
      Actions.play(selectedEstId, nextIdx);
    }
  };

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/tv"
          element={
            <TvView
              queue={approvedQueue}
              currentIdx={currentIdx}
              onTrackEnd={handleTrackEnd}
              volume={volume}
              currentMessage={currentMessage}
              messageAuthor={messageAuthor}
            />
          }
        />
        <Route
          path="/tvVideo"
          element={
            <TvViewVideo
              queue={approvedQueue}
              currentIdx={currentIdx}
              volume={volume}
              onTrackEnd={handleTrackEnd}
              onVideoError={(rowId) => Actions.rejectSongOnVideoError(rowId)}
              ads={ads}
              establishmentId={selectedEstId}
            />
          }
        />
        <Route
          path="/admin"
          element={
            <AdminView
              establishmentId={selectedEstId}
              credits={credits}
              queue={queue}
              currentIdx={currentIdx}
              onPlay={(idx) => Actions.play(selectedEstId, idx)}
              onClearQueue={() => Actions.clearQueue(selectedEstId)}
              onRemove={(idx) => {
                const item = queue[idx];
                if (item?.queueRowId) Actions.removeSong(item.queueRowId);
              }}
              onApprove={(rowId) => Actions.approveSong(rowId, selectedEstId)}
              autoPlay={autoPlay}
              onToggleAutoPlay={(val) => Actions.toggleAutoPlay(selectedEstId, val)}
              volume={volume}
              onVolumeChange={(v) => Actions.setVolume(selectedEstId, v)}
              ads={ads}
              onAddAd={() => Actions.loadAds(selectedEstId)}
              onRemoveAd={() => Actions.loadAds(selectedEstId)}
              onAddSong={(s) => Actions.requestSong(selectedEstId, s, true, autoPlay)}
            />
          }
        />
        <Route
          path="/scan"
          element={
            <CustomerView
              establishmentId={selectedEstId}
              onSongRequest={(s) => Actions.requestSong(selectedEstId, s, false, autoPlay)}
              queue={queue}
              currentIdx={currentIdx}
            />
          }
        />
        <Route
          path="/"
          element={
            <CustomerView
              establishmentId={selectedEstId}
              onSongRequest={(s) => Actions.requestSong(selectedEstId, s, false, autoPlay)}
              queue={queue}
              currentIdx={currentIdx}
            />
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
