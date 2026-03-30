import { useState, useCallback, useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { supabase } from "./lib/supabase";
import TvView from "./TvView";
import CustomerView from "./CustomerView";
import AdminView from "./AdminView";

const ACCENT_COLORS = ["#00c9ff", "#ff6b6b", "#1db954", "#ff99c8", "#ffcc00", "#a78bfa", "#ff4d00", "#00ffd0"];

// Detectar la URL base del despliegue automáticamente
const SCAN_URL = typeof window !== "undefined" ? `${window.location.origin}/scan` : "/scan";

const parseDurationString = (value) => {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number") return value;
  const parts = String(value).split(":").map((part) => Number(part));
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
  // --- ESTADOS ---
  const [queue, setQueue] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [volume, setVolume] = useState(50);
  const [currentMessage, setCurrentMessage] = useState(null);
  const [messageAuthor, setMessageAuthor] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const normalizeQueueItem = useCallback((item) => {
    const song = item.songs_repository || item.song || {};
    const youtubeId = song.youtubeId ?? song.youtube_id ?? song.id ?? item.youtubeId ?? item.song_id ?? item.id;
    const rawDuration = typeof song.duration === "number"
      ? song.duration
      : parseDurationString(song.duration ?? item.duration);
    return {
      id: youtubeId,
      queueRowId: item.id,
      title: song.title ?? item.title ?? "Canción desconocida",
      artist: song.artist ?? item.artist ?? "Artista desconocido",
      duration: rawDuration ? formatDurationText(rawDuration) : "",
      color: song.color ?? item.color ?? ACCENT_COLORS[item.id % ACCENT_COLORS.length],
      img: song.img ?? song.img_url ?? item.img ?? item.img_url ?? "https://picsum.photos/seed/default/600/600",
      album: song.album ?? item.album ?? "Single",
      qr: song.qr ?? item.qr ?? SCAN_URL,
      youtubeId,
    };
  }, []);

  // Mover updateAppState aquí arriba para que esté disponible para los useEffect
  const updateAppState = useCallback(async (updates) => {
    const { error } = await supabase
      .from("app_state")
      .upsert({ id: "main-config", ...updates }, { onConflict: "id" });

    if (error) {
      console.error("Error actualizando app_state en Supabase:", error);
    }
  }, []);

  const fetchQueue = useCallback(async () => {
    const { data, error } = await supabase
      .from("queue")
      .select("*, songs_repository(*)")
      .order("requested_at", { ascending: true })
      .order("id", { ascending: true });

    if (error) {
      console.warn("No se pudo cargar queue desde Supabase:", error);
      return;
    }
    if (data) {
      setQueue(data.map(normalizeQueueItem));
    }
  }, [normalizeQueueItem]);

  const persistSongRepository = useCallback(async (song) => {
    const youtubeId = song.youtubeId || song.id;
    if (!youtubeId) return null;

    const { data: existing, error: selectError } = await supabase
      .from("songs_repository")
      .select("id")
      .eq("youtube_id", youtubeId)
      .maybeSingle();

    if (selectError) {
      console.error("Error consultando songs_repository:", selectError);
      return null;
    }
    if (existing?.id) return existing.id;

    const insertPayload = {
      youtube_id: youtubeId,
      title: song.title,
      artist: song.artist,
      duration: typeof song.duration === "number" ? song.duration : parseDurationString(song.duration),
      color: song.color,
      img_url: song.img ?? song.img_url,
      album: song.album,
      qr: song.qr,
    };

    const { data: inserted, error: insertError } = await supabase
      .from("songs_repository")
      .insert(insertPayload)
      .select("id")
      .maybeSingle();

    if (insertError) {
      console.error("Error insertando en songs_repository:", insertError);
      return null;
    }
    return inserted?.id ?? null;
  }, []);

  const addQueueRow = useCallback(async (song) => {
    const repositoryId = await persistSongRepository(song);
    if (!repositoryId) return null;

    const { data, error } = await supabase
      .from("queue")
      .insert({ song_id: repositoryId, requested_at: new Date().toISOString() })
      .select("*, songs_repository(*)")
      .maybeSingle();

    if (error) {
      console.error("Error agregando a queue:", error);
      return null;
    }
    return data ? normalizeQueueItem(data) : null;
  }, [persistSongRepository]);

  useEffect(() => {
    const loadData = async () => {
      const appStatePromise = supabase
        .from("app_state")
        .select("volume,current_idx,is_playing,current_message,message_author")
        .eq("id", "main-config")
        .maybeSingle();

      const [appStateResult] = await Promise.all([appStatePromise, fetchQueue()]);

      if (appStateResult.error) {
        console.warn("No se pudo cargar app_state desde Supabase:", appStateResult.error);
      } else if (appStateResult.data) {
        const data = appStateResult.data;
        if (data.volume !== undefined) setVolume(data.volume);
        if (data.current_idx !== undefined) setCurrentIdx(data.current_idx);
        if (data.is_playing !== undefined) setIsPlaying(data.is_playing);
        if (data.current_message !== undefined) setCurrentMessage(data.current_message);
        if (data.message_author !== undefined) setMessageAuthor(data.message_author);
      } else {
        // Si no existe el registro principal, lo creamos para que realtime funcione.
        const { data: created, error: createError } = await supabase
          .from("app_state")
          .insert({ id: "main-config", volume: 50, current_idx: 0, is_playing: false })
          .maybeSingle();
        if (createError) {
          console.error("Error creando app_state inicial:", createError);
        } else if (created) {
          setVolume(created.volume ?? 50);
          setCurrentIdx(created.current_idx ?? 0);
          setIsPlaying(created.is_playing ?? false);
        }
      }
    };

    loadData();
    console.log("[Supabase] iniciando realtime channels");

    const appStateChannel = supabase
      .channel("app-state-channel")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "app_state", filter: "id=eq.main-config" },
        (payload) => {
          console.log("[Supabase] app_state payload", payload);
          const record = payload.new;
          if (!record) return;
          if (typeof record.volume === "number") setVolume(record.volume);
          if (typeof record.current_idx === "number") setCurrentIdx(record.current_idx);
          if (typeof record.is_playing === "boolean") setIsPlaying(record.is_playing);
          if (record.current_message !== undefined) setCurrentMessage(record.current_message);
          if (record.message_author !== undefined) setMessageAuthor(record.message_author);
        }
      )
      .subscribe();

    console.log("[Supabase] appStateChannel created", appStateChannel);

    const queueChannel = supabase.channel("queue-channel")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "queue" },
        async (payload) => {
          console.log("[Supabase] queue INSERT payload", payload);
          await fetchQueue();
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "queue" },
        async (payload) => {
          console.log("[Supabase] queue UPDATE payload", payload);
          await fetchQueue();
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "queue" },
        async (payload) => {
          console.log("[Supabase] queue DELETE payload", payload);
          await fetchQueue();
        }
      )
      .subscribe();

    console.log("[Supabase] queueChannel created", queueChannel);

    return () => {
      supabase.removeChannel(appStateChannel);
      supabase.removeChannel(queueChannel);
    };
  }, [fetchQueue]);

  // Efecto para limpiar el mensaje de la DB después de 10 segundos
  useEffect(() => {
    if (currentMessage) {
      const timer = setTimeout(() => {
       updateAppState({ current_message: null, message_author: null }); // Limpiamos ambos en DB
      setMessageAuthor(null); // Limpiamos local
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [currentMessage, updateAppState]);

  const handleSongRequest = useCallback(async (song) => {
    if (queue.some((s) => s.id === song.id)) return;

    const newEntry = await addQueueRow(song);
    if (!newEntry) return;

    setQueue((prev) => {
      if (prev.some((s) => s.id === newEntry.id)) return prev;
      return [...prev, newEntry];
    });
  }, [addQueueRow, queue]);

  const handleRemoveFromQueue = useCallback(async (idx) => {
    let removedItem = null;
    setQueue((prev) => {
      removedItem = prev[idx];
      return prev.filter((_, i) => i !== idx);
    });

    if (removedItem?.queueRowId) {
      const { error } = await supabase.from("queue").delete().eq("id", removedItem.queueRowId);
      if (error) console.error("Error eliminando item de queue:", error);
    }

    if (currentIdx >= idx && currentIdx > 0) setCurrentIdx((prev) => prev - 1);
  }, [currentIdx]);

  const handleClearQueue = useCallback(async () => {
    const { error } = await supabase.from("queue").delete().neq("id", -1);
    if (error) {
      console.error("Error vaciando la cola:", error);
    } else {
      setQueue([]);
      updateAppState({ current_idx: 0 });
    }
  }, [updateAppState]);

  const handlePlayNow = useCallback((idx) => {
    setCurrentIdx(idx);
    updateAppState({ current_idx: idx });
  }, [updateAppState]);

  const handleVolumeChange = useCallback((value) => {
    setVolume(value);
    updateAppState({ volume: value });
  }, [updateAppState]);

  const handleTrackEnd = useCallback(() => {
    // En lugar de mover el estado local, actualizamos la DB. 
    // Realtime se encargará de propagar el cambio a todos los componentes.
    const nextIdx = currentIdx + 1;
    if (nextIdx < queue.length) {
      updateAppState({ current_idx: nextIdx });
    }
  }, [currentIdx, queue.length, updateAppState]);

  return (
    <BrowserRouter>
      <Routes>
        {/* Pasamos el volumen a la TV para que lo aplique al reproductor */}
        <Route 
          path="/tv" 
          element={
            <TvView 
              queue={queue} 
              currentIdx={currentIdx} 
              onTrackEnd={handleTrackEnd} 
              onTrackChange={handlePlayNow}
              volume={volume} 
              currentMessage={currentMessage}
              message_author={messageAuthor}
            />
          } 
        />
        
        {/* Pasamos volumen y la función setVolume al Admin */}
        <Route 
          path="/admin" 
          element={
            <AdminView 
              queue={queue} 
              currentIdx={currentIdx} 
              onRemove={handleRemoveFromQueue} 
              onPlay={handlePlayNow} 
              onAddSong={handleSongRequest}
              onClearQueue={handleClearQueue}
              volume={volume}
              onVolumeChange={handleVolumeChange}
            />
          } 
        />

        <Route path="/scan" element={<CustomerView onSongRequest={handleSongRequest} queue={queue} currentIdx={currentIdx} />} />
        <Route path="/" element={<CustomerView onSongRequest={handleSongRequest} queue={queue} currentIdx={currentIdx} />} />
      </Routes>
    </BrowserRouter>
  );
}