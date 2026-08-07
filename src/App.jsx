import { useEffect, useCallback } from "react";
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

  // 2. NORMALIZACIÓN
  const normalizeQueueItem = useCallback((item) => {
    const song = item.songs_repository || {};
    const youtubeId = song.youtube_id || item.youtube_id;
    const rawDuration = typeof song.duration === "number" ? song.duration : parseDurationString(song.duration);

    return {
      id: youtubeId,
      queueRowId: item.id,
      title: song.title || "Desconocida",
      artist: song.artist || "Desconocido",
      duration: rawDuration ? formatDurationText(rawDuration) : "",
      color: song.color || ACCENT_COLORS[0],
      isApproved: item.is_approved,
      is_cliente: item.is_cliente,
      img: song.img_url || "https://picsum.photos/seed/default/600/600",
      youtubeId,
      created_at: item.requested_at,
      mesa: item.mesa,
    };
  }, []);

  // 3. FETCHERS
  const fetchQueue = useCallback(async () => {
    console.log("Fetching queue...", selectedEstId);
    if (!selectedEstId) return;
    const { data } = await supabase
      .from("queue")
      .select("*, songs_repository(*)")
      .eq("establishment_id", selectedEstId)
      // 1. Canciones de cliente primero (is_cliente DESC)
      // 2. Entre clientes: orden de aprobación (approved_at ASC)
      // 3. Canciones del admin: al final (requested_at ASC)
      .order("is_cliente", { ascending: false })
      .order("approved_at", { ascending: true, nullsFirst: false })
      .order("requested_at", { ascending: true });

    if (!data) return;

    const normalized = data.map(normalizeQueueItem);
    const approvedNormalized = normalized.filter(s => s.isApproved);

    setQueue(normalized);

    // ─── Re-anclar el índice a la canción que estaba sonando ────────────────
    // Si tenemos un rowId de referencia, buscamos su nueva posición en la
    // approvedQueue para que currentIdx apunte a la misma canción aunque
    // se hayan insertado nuevas canciones antes o después.
    const rowId = currentPlayingRowIdRef.current;
    if (rowId) {
      const newIdx = approvedNormalized.findIndex(s => s.queueRowId === rowId);
      if (newIdx !== -1 && newIdx !== undefined) {
        setCurrentIdx(newIdx);
        // No llamamos updateAppState aquí para evitar loop —
        // solo actualizamos el estado local. El estado en BD se actualiza
        // solo cuando el operador hace una acción manual (play, skip, etc.)
      }
    }
  }, [selectedEstId, normalizeQueueItem]);

  const fetchAds = useCallback(async () => {
    if (!selectedEstId) return;
    const { data } = await supabase.from("promociones").select("*").eq("establishment_id", selectedEstId).eq("active", true);
    if (data) setAds(data);
  }, [selectedEstId]);

  const updateAppState = useCallback(async (updates) => {
    if (!selectedEstId) return;
    await supabase.from("app_state").upsert({
      id: `config-${selectedEstId}`,
      establishment_id: selectedEstId,
      ...updates
    }, { onConflict: "id" });
  }, [selectedEstId]);

  // 4. REALTIME
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
  }, [selectedEstId, fetchQueue, fetchAds]);

  // --- HANDLERS ---
  const handleRemoveSong = async (rowId) => {
    const { error } = await supabase.from("queue").delete().eq("id", rowId);
    if (!error) setQueue(prev => prev.filter(item => item.queueRowId !== rowId));
  };

  const handleApproveWithCredits = async (rowId) => {
    if (credits <= 0) return alert("⚠️ Sin saldo Up-T.");
    const { error } = await supabase.rpc("approve_and_subtract_credit", {
      p_request_id: rowId,
      p_establishment_id: selectedEstId
    });
    if (error) { alert("Error: " + error.message); return; }
    // Marca el momento exacto de aprobación para respetar el orden de prioridad
    await supabase.from("queue").update({ approved_at: new Date().toISOString() }).eq("id", rowId);
  };

  const handleSongRequest = async (song, forceApprove = false) => {
    if (!selectedEstId) return;
    const { data: repoSong } = await supabase.from("songs_repository").upsert({
      youtube_id: song.id || song.youtubeId,
      title: song.title,
      artist: song.artist,
      img_url: song.img || song.img_url
    }, { onConflict: "youtube_id" }).select().single();

    const isApproved = forceApprove || autoPlay;
    const { data: newQueueItem, error } = await supabase.from("queue").insert({
      establishment_id: selectedEstId,
      song_id: repoSong.id,
      is_approved: isApproved,
      is_cliente: song.is_cliente || false,
      mesa: song.mesa || null,
      // Si se aprueba al insertar, marcamos el momento para respetar el orden de prioridad
      approved_at: isApproved ? new Date().toISOString() : null,
    }).select('id').single(); // Select the ID of the new queue item

    if (error) {
      console.error("Error inserting song into queue:", error);
      throw error; // Propagate error
    }
    return newQueueItem.id; // Return the queueRowId
  };

  // ─── Helpers para play y skip que actualizan el rowId de referencia ───────
  const handlePlay = (idx) => {
    const song = approvedQueue[idx];
    if (song) currentPlayingRowIdRef.current = song.queueRowId;
    setCurrentIdx(idx);
    updateAppState({ current_idx: idx });
  };

  const handleTrackEnd = () => {
    const nextIdx = currentIdx + 1;
    if (nextIdx < approvedQueue.length) {
      const nextSong = approvedQueue[nextIdx];
      if (nextSong) currentPlayingRowIdRef.current = nextSong.queueRowId;
      setCurrentIdx(nextIdx);
      updateAppState({ current_idx: nextIdx });
    }
  };

  const handleVideoError = async (rowId) => {
    if (!rowId) return;
    await supabase.from("queue").update({ is_approved: false }).eq("id", rowId);
    setQueue(prev => prev.filter(item => item.queueRowId !== rowId));
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
              onVideoError={handleVideoError}
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
