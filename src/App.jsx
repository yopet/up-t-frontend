import { useState, useCallback, useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { supabase } from "./lib/supabase";
import TvView from "./TvView";
import TvViewVideo from "./TvViewVideo";
import CustomerView from "./CustomerView";
import AdminView from "./AdminView";

const ACCENT_COLORS = ["#00c9ff", "#ff6b6b", "#1db954", "#ff99c8", "#ffcc00", "#a78bfa", "#ff4d00", "#00ffd0"];

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
  const [ads, setAds] = useState([]); 
  const [currentIdx, setCurrentIdx] = useState(0);
  const [currentTrackId, setCurrentTrackId] = useState(null); // NUEVO: Para no perder la canción sonando
  const [volume, setVolume] = useState(50);
  const [currentMessage, setCurrentMessage] = useState(null);
  const [messageAuthor, setMessageAuthor] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [autoPlay, setAutoPlay] = useState(true);

  // --- NORMALIZACIÓN ---
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
      color: song.color ?? item.color ?? ACCENT_COLORS[Math.abs(item.id?.split('-').length || 0) % ACCENT_COLORS.length],
      isApproved: item.is_approved ?? true,
      is_cliente: item.is_cliente ?? false,
      img: song.img ?? song.img_url ?? item.img ?? item.img_url ?? "https://picsum.photos/seed/default/600/600",
      album: song.album ?? item.album ?? "Single",
      qr: song.qr ?? item.qr ?? SCAN_URL,
      youtubeId,
    };
  }, []);

  // NUEVO: Efecto para sincronizar el índice cuando la cola cambia (prioridad clientes)
  useEffect(() => {
    if (currentTrackId && queue.length > 0) {
      const newIdx = queue.findIndex(track => track.queueRowId === currentTrackId);
      if (newIdx !== -1 && newIdx !== currentIdx) {
        setCurrentIdx(newIdx);
      }
    }
  }, [queue, currentTrackId, currentIdx]);

  const updateAppState = useCallback(async (updates) => {
    const { error } = await supabase
      .from("app_state")
      .upsert({ id: "main-config", ...updates }, { onConflict: "id" });
    if (error) console.error("Error actualizando app_state:", error);
  }, []);

  // --- LOGICA DE PUBLICIDAD (ADS) ---
  const fetchAds = useCallback(async () => {
    const { data, error } = await supabase
      .from("ads")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) console.warn("Error cargando ads:", error);
    else if (data) setAds(data);
  }, []);

  const handleAddAd = async (newAd) => {
    const { data, error } = await supabase
      .from("ads")
      .insert([{ 
        title: newAd.title, 
        image_url: newAd.image_url, 
        frequency: newAd.frequency,
        active: true 
      }])
      .select();

    if (error) console.error("Error insertando ad:", error);
    else if (data) setAds([data[0], ...ads]);
  };

  const handleRemoveAd = async (id) => {
    const { error } = await supabase.from("ads").delete().eq("id", id);
    if (error) console.error("Error eliminando ad:", error);
    else setAds(ads.filter(ad => ad.id !== id));
  };

  // --- LOGICA DE COLA (QUEUE) ---
  const fetchQueue = useCallback(async () => {
    const { data, error } = await supabase
      .from("queue")
      .select("*, songs_repository(*)")
      .order("is_cliente", { ascending: false }) 
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

    if (selectError) return null;
    if (existing?.id) return existing.id;

    const insertPayload = {
      youtube_id: youtubeId,
      title: song.title,
      artist: song.artist,
      duration: typeof song.duration === "number" ? song.duration : parseDurationString(song.duration),
      color: song.color ?? ACCENT_COLORS[Math.floor(Math.random() * ACCENT_COLORS.length)],
      img_url: song.img ?? song.img_url,
      album: song.album,
      qr: song.qr,
    };

    const { data: inserted, error: insertError } = await supabase
      .from("songs_repository")
      .insert(insertPayload)
      .select("id")
      .maybeSingle();

    if (insertError) return null;
    return inserted?.id ?? null;
  }, []);

  const addQueueRow = useCallback(async (song, forceApprove = false) => {
    const repositoryId = await persistSongRepository(song);
    if (!repositoryId) return null;

    const { data, error } = await supabase
      .from("queue")
      .insert({ 
        song_id: repositoryId, 
        requested_at: new Date().toISOString(),
        is_approved: forceApprove || autoPlay,
        is_cliente: song.is_cliente || false 
      })
      .select("*, songs_repository(*)")
      .maybeSingle();

    if (error) {
      console.error("Error insertando en queue:", error);
      return null;
    }
    
    return data ? normalizeQueueItem(data) : null;
  }, [persistSongRepository, autoPlay, normalizeQueueItem]);

  // --- EFECTO INICIAL Y REALTIME ---
  useEffect(() => {
    const loadData = async () => {
      const appStatePromise = supabase
        .from("app_state")
        .select("volume,current_idx,is_playing,auto_play")
        .eq("id", "main-config")
        .maybeSingle();

      const [appStateResult] = await Promise.all([appStatePromise, fetchQueue(), fetchAds()]);

      if (appStateResult.data) {
        const data = appStateResult.data;
        if (data.volume !== undefined) setVolume(data.volume);
        if (data.current_idx !== undefined) setCurrentIdx(data.current_idx);
        if (data.is_playing !== undefined) setIsPlaying(data.is_playing);
        if (data.auto_play !== undefined) setAutoPlay(data.auto_play);
      }
    };

    loadData();

    const appStateChannel = supabase
      .channel("app-state-channel")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "app_state", filter: "id=eq.main-config" },
        (payload) => {
          const record = payload.new;
          if (!record) return;
          if (typeof record.volume === "number") setVolume(record.volume);
          if (typeof record.current_idx === "number") setCurrentIdx(record.current_idx);
          if (typeof record.is_playing === "boolean") setIsPlaying(record.is_playing);
          if (typeof record.auto_play === "boolean") setAutoPlay(record.auto_play);
        }
      ).subscribe();

    const queueChannel = supabase.channel("queue-channel")
      .on("postgres_changes", { event: "*", schema: "public", table: "queue" }, () => fetchQueue())
      .subscribe();

    return () => {
      supabase.removeChannel(appStateChannel);
      supabase.removeChannel(queueChannel);
    };
  }, [fetchQueue, fetchAds]);

  // Temporizador para limpiar mensajes
  useEffect(() => {
    if (currentMessage) {
      const timer = setTimeout(() => {
        updateAppState({ current_message: null, message_author: null });
        setCurrentMessage(null);
        setMessageAuthor(null);
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [currentMessage, updateAppState]);

  // --- HANDLERS MODIFICADOS ---
  const handleSongRequest = useCallback(async (song, forceApprove = false) => {
    if (queue.some((s) => s.id === song.id)) return;
    const newEntry = await addQueueRow(song, forceApprove);
    if (!newEntry) return;
    setQueue((prev) => prev.some((s) => s.id === newEntry.id) ? prev : [...prev, newEntry]);
  }, [addQueueRow, queue]);

  const handlePlayNow = useCallback((idx) => {
    const song = queue[idx];
    if (song) {
      setCurrentIdx(idx);
      setCurrentTrackId(song.queueRowId); // Guardamos el ID único
      updateAppState({ current_idx: idx });
    }
  }, [queue, updateAppState]);

  const handleTrackEnd = useCallback(() => {
    const nextIdx = currentIdx + 1;
    if (nextIdx < queue.length) {
      const nextSong = queue[nextIdx];
      setCurrentIdx(nextIdx);
      setCurrentTrackId(nextSong.queueRowId); // Guardamos el ID único
      updateAppState({ current_idx: nextIdx });
    }
  }, [currentIdx, queue, updateAppState]);

  const handleRemoveFromQueue = useCallback(async (idx) => {
    let removedItem = queue[idx];
    if (removedItem?.queueRowId) {
      await supabase.from("queue").delete().eq("id", removedItem.queueRowId);
    }
  }, [queue]);

  const handleClearQueue = useCallback(async () => {
    const { error } = await supabase.from("queue").delete().not("id", "is", null);
    if (!error) {
      setQueue([]);
      updateAppState({ current_idx: 0 });
    }
  }, [updateAppState]);

  const handleApproveSong = useCallback(async (queueRowId) => {
    await supabase.from("queue").update({ is_approved: true, requested_at: new Date().toISOString() }).eq("id", queueRowId);
  }, []);

  const handleVolumeChange = useCallback((value) => {
    setVolume(value);
    updateAppState({ volume: value });
  }, [updateAppState]);

  const handleToggleAutoPlay = useCallback((val) => {
    setAutoPlay(val);
    updateAppState({ auto_play: val });
  }, [updateAppState]);

  const handleApproveMessage = useCallback(async (msg) => {
    updateAppState({ 
      current_message: msg.text, 
      message_author: msg.author 
    });
  }, [updateAppState]);

  const approvedQueue = queue.filter(s => s.isApproved);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/tv" element={
          <TvView 
            queue={approvedQueue} 
            currentIdx={currentIdx} 
            onTrackEnd={handleTrackEnd} 
            onTrackChange={handlePlayNow} 
            volume={volume} 
            currentMessage={currentMessage} 
            message_author={messageAuthor} 
          />
        } />

        <Route path="/admin" element={
          <AdminView
            queue={queue} 
            currentIdx={currentIdx} 
            onRemove={handleRemoveFromQueue} 
            onPlay={handlePlayNow}
            onAddSong={(song) => handleSongRequest(song, true)} 
            onClearQueue={handleClearQueue}
            onApprove={handleApproveSong} 
            autoPlay={autoPlay} 
            onToggleAutoPlay={handleToggleAutoPlay}
            volume={volume} 
            onVolumeChange={handleVolumeChange}
            ads={ads} 
            onAddAd={handleAddAd} 
            onRemoveAd={handleRemoveAd}
            onApproveMessage={handleApproveMessage}
          />
        } />

        <Route path="/tvVideo" element={
          <TvViewVideo 
            queue={approvedQueue} 
            currentIdx={currentIdx} 
            volume={volume} 
            onTrackEnd={handleTrackEnd} 
            currentMessage={currentMessage} 
            message_author={messageAuthor} 
            ads={ads}
          />
        } />

        <Route path="/scan" element={<CustomerView onSongRequest={handleSongRequest} queue={queue} currentIdx={currentIdx} />} />
        <Route path="/" element={<CustomerView onSongRequest={handleSongRequest} queue={queue} currentIdx={currentIdx} />} />
      </Routes>
    </BrowserRouter>
  );
}