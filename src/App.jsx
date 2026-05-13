import { useState, useCallback, useEffect, useRef } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { supabase } from "./lib/supabase";
import TvView from "./TvView";
import TvViewVideo from "./TvViewVideo";
import CustomerView from "./CustomerView";
import AdminView from "./AdminView";

const ACCENT_COLORS = ["#00c9ff", "#ff6b6b", "#1db954", "#ff99c8", "#ffcc00", "#a78bfa", "#ff4d00", "#00ffd0"];

// --- UTILIDADES ---
const parseDurationString = (value) => {
  if (!value) return 0;
  if (typeof value === "number") return value;
  const parts = String(value).split(":").map(Number);
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(parts[0]) || 0;
};

const formatDurationText = (seconds) => {
  const total = Number(seconds) || 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = String(minutes).padStart(hours ? 2 : 1, "0");
  const ss = String(secs).padStart(2, "0");
  return hours ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
};

export default function App() {
  const [establishments, setEstablishments] = useState([]);
  const [selectedEstId, setSelectedEstId] = useState("");
  const [credits, setCredits] = useState(0);

  const [queue, setQueue] = useState([]);
  const [ads, setAds] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [volume, setVolume] = useState(50);
  const [currentMessage, setCurrentMessage] = useState(null);
  const [messageAuthor, setMessageAuthor] = useState(null);
  const [autoPlay, setAutoPlay] = useState(true);

  // ─── CLAVE DEL FIX: trackear la canción actual por ID, no por posición ───
  // Cuando el queue se reordena al aprobar una canción, recalculamos currentIdx
  // buscando este rowId en el nuevo orden en lugar de mantener el número fijo.
  const currentPlayingRowIdRef = useRef(null);

  // 1. CARGA INICIAL
  useEffect(() => {
    const fetchInitialData = async () => {
      const { data, error } = await supabase.from("establishments").select("*").order("name");
      if (data && data.length > 0) {
        setEstablishments(data);
        const params = new URLSearchParams(window.location.search);
        const urlId = params.get("est");
        const selected = data.find(e => e.id === urlId) || data[0];
        setSelectedEstId(selected.id);
        setCredits(selected.credits || 0);
      }
    };
    fetchInitialData();
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

    const loadInitialState = async () => {
      const { data } = await supabase
        .from("app_state")
        .select("*")
        .eq("id", `config-${selectedEstId}`)
        .maybeSingle();

      if (data) {
        setVolume(data.volume ?? 50);
        setCurrentIdx(data.current_idx ?? 0);
        setAutoPlay(data.auto_play ?? true);
      }
      fetchQueue();
      fetchAds();
    };
    loadInitialState();

    const stateSub = supabase
      .channel(`state-${selectedEstId}`)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "app_state",
        filter: `id=eq.config-${selectedEstId}`
      }, payload => {
        const r = payload.new;
        if (r.volume !== undefined) setVolume(r.volume);
        if (r.current_idx !== undefined) {
          setCurrentIdx(r.current_idx);
          // Mantenemos el ref sincronizado con lo que dice Supabase,
          // así fetchQueue sabe qué canción anclar cuando re-ordena.
          setQueue(prev => {
            const approved = prev.filter(s => s.isApproved);
            const song = approved[r.current_idx];
            if (song) currentPlayingRowIdRef.current = song.queueRowId;
            return prev; // no mutamos el queue, solo actualizamos el ref
          });
        }
        if (r.auto_play !== undefined) setAutoPlay(r.auto_play);
      })
      .subscribe();

    const queueSub = supabase
      .channel(`queue-${selectedEstId}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "queue",
        filter: `establishment_id=eq.${selectedEstId}`
      }, () => fetchQueue())
      .subscribe();

    const estSub = supabase
      .channel(`est-update-${selectedEstId}`)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "establishments",
        filter: `id=eq.${selectedEstId}`
      }, payload => {
        if (payload.new.credits !== undefined) setCredits(payload.new.credits);
      })
      .subscribe();

    const msgSub = supabase
      .channel(`messages-tv-${selectedEstId}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "screen_messages",
        filter: `establishment_id=eq.${selectedEstId}`
      }, (payload) => {
        const data = payload.new;
        if (data && data.status === "approved") {
          setCurrentMessage(data.text);
          setMessageAuthor(data.author);
          setTimeout(() => {
            setCurrentMessage(null);
            setMessageAuthor(null);
          }, 1000);
        }
      })
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
  const approvedQueue = queue.filter(s => s.isApproved);

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
              onPlay={handlePlay}
              onClearQueue={async () => {
                await supabase.from("queue").delete().eq("establishment_id", selectedEstId);
                setQueue([]);
                currentPlayingRowIdRef.current = null;
                setCurrentIdx(0);
                updateAppState({ current_idx: 0 });
              }}
              onRemove={(idx) => {
                const item = queue[idx];
                if (item?.queueRowId) handleRemoveSong(item.queueRowId);
              }}
              onApprove={handleApproveWithCredits}
              autoPlay={autoPlay}
              onToggleAutoPlay={(val) => { setAutoPlay(val); updateAppState({ auto_play: val }); }}
              volume={volume}
              onVolumeChange={(v) => { setVolume(v); updateAppState({ volume: v }); }}
              ads={ads}
              onAddAd={fetchAds}
              onRemoveAd={fetchAds}
              onAddSong={(s) => handleSongRequest(s, true)}
            />
          }
        />
        <Route
          path="/scan"
          element={
            <CustomerView
              establishmentId={selectedEstId}
              onSongRequest={handleSongRequest}
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
              onSongRequest={handleSongRequest}
              queue={queue}
              currentIdx={currentIdx}
            />
          }
        />
      </Routes>
    </BrowserRouter>
  );
}