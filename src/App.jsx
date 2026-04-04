import { useState, useCallback, useEffect } from "react";
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
  // --- ESTADOS MULTI-ESTABLECIMIENTO ---
  const [establishments, setEstablishments] = useState([]);
  const [selectedEstId, setSelectedEstId] = useState("");
  const [credits, setCredits] = useState(0); 

  // --- ESTADOS DE LA APP ---
  const [queue, setQueue] = useState([]);
  const [ads, setAds] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [volume, setVolume] = useState(50);
  const [currentMessage, setCurrentMessage] = useState(null);
  const [messageAuthor, setMessageAuthor] = useState(null);
  const [autoPlay, setAutoPlay] = useState(true);

  // 1. CARGAR LISTA DE LOCALES Y CRÉDITOS AL INICIO
  useEffect(() => {
    const fetchInitialData = async () => {
      const { data, error } = await supabase.from("establishments").select("*").order("name");
      if (data && data.length > 0) {
        setEstablishments(data);
        const params = new URLSearchParams(window.location.search);
        const urlId = params.get("est");
        
        // Priorizar el ID de la URL o el primero de la lista
        const selected = data.find(e => e.id === urlId) || data[0];
        setSelectedEstId(selected.id);
        setCredits(selected.credits || 0);
      } else if (error) {
        console.error("Error cargando establecimientos:", error.message);
      }
    };
    fetchInitialData();
  }, []);

  // 2. NORMALIZACIÓN DE ITEMS DE COLA
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
    };
  }, []);

  // 3. FETCHERS FILTRADOS POR LOCAL
  const fetchQueue = useCallback(async () => {
    if (!selectedEstId) return;
    const { data } = await supabase
      .from("queue")
      .select("*, songs_repository(*)")
      .eq("establishment_id", selectedEstId)
      .order("is_cliente", { ascending: false })
      .order("requested_at", { ascending: true });

    if (data) setQueue(data.map(normalizeQueueItem));
  }, [selectedEstId, normalizeQueueItem]);

  const fetchAds = useCallback(async () => {
    if (!selectedEstId) return;
    const { data } = await supabase
      .from("ads")
      .select("*")
      .eq("establishment_id", selectedEstId)
      .eq("active", true);
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

  // 4. REALTIME Y SINCRONIZACIÓN TOTAL
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
        setCurrentMessage(data.current_message);
        setMessageAuthor(data.message_author);
      }
      fetchQueue();
      fetchAds();
    };

    loadInitialState();

    // CANAL: ESTADO (app_state)
    const stateSub = supabase.channel(`state-${selectedEstId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "app_state", filter: `id=eq.config-${selectedEstId}` },
        payload => {
          const r = payload.new;
          if (r.volume !== undefined) setVolume(r.volume);
          if (r.current_idx !== undefined) setCurrentIdx(r.current_idx);
          setCurrentMessage(r.current_message);
          setMessageAuthor(r.message_author);
          if (r.auto_play !== undefined) setAutoPlay(r.auto_play);
        }).subscribe();

    // CANAL: COLA (queue)
    const queueSub = supabase.channel(`queue-${selectedEstId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "queue", filter: `establishment_id=eq.${selectedEstId}` },
        () => fetchQueue()).subscribe();

    // CANAL: CRÉDITOS (establishments) - ¡ESTO QUITA EL F5!
    const estSub = supabase.channel(`est-update-${selectedEstId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "establishments", filter: `id=eq.${selectedEstId}` },
        payload => {
          if (payload.new.credits !== undefined) setCredits(payload.new.credits);
        }).subscribe();

    return () => {
      supabase.removeChannel(stateSub);
      supabase.removeChannel(queueSub);
      supabase.removeChannel(estSub);
    };
  }, [selectedEstId, fetchQueue, fetchAds]);

  // --- HANDLERS ---
  const handleSongRequest = async (song, forceApprove = false) => {
    if (!selectedEstId) return;
    const { data: repoSong } = await supabase
      .from("songs_repository")
      .upsert({
        youtube_id: song.id || song.youtubeId,
        title: song.title,
        artist: song.artist,
        img_url: song.img || song.img_url
      }, { onConflict: 'youtube_id' })
      .select().single();

    await supabase.from("queue").insert({
      establishment_id: selectedEstId,
      song_id: repoSong.id,
      is_approved: forceApprove || autoPlay,
      is_cliente: song.is_cliente || false
    });
  };

  const handleApproveWithCredits = async (rowId) => {
    if (credits <= 0) {
      alert("⚠️ Saldo insuficiente en Up-T. Recarga para aprobar más Créditos.");
      return;
    }

    const { error } = await supabase.rpc('approve_and_subtract_credit', {
      p_request_id: rowId,
      p_establishment_id: selectedEstId
    });

    if (error) {
      alert("Error: " + error.message);
    } else {
      new Audio("https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3").play().catch(() => {});
      // No hace falta actualizar créditos manualmente, el Realtime lo hará
    }
  };

  const handlePlayNow = (idx) => {
    setCurrentIdx(idx);
    updateAppState({ current_idx: idx });
  };

  const handleTrackEnd = () => {
    const next = currentIdx + 1;
    if (next < queue.length) handlePlayNow(next);
  };

  const approvedQueue = queue.filter(s => s.isApproved);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/tv" element={
          <TvView
            queue={approvedQueue}
            currentIdx={currentIdx}
            onTrackEnd={handleTrackEnd}
            volume={volume}
            currentMessage={currentMessage}
            messageAuthor={messageAuthor}
          />
        } />

        <Route path="/admin" element={
          <AdminView
            establishmentId={selectedEstId}
            credits={credits}
            queue={queue}
            currentIdx={currentIdx}
            onPlay={handlePlayNow}
            onClearQueue={async () => {
              await supabase.from("queue").delete().eq("establishment_id", selectedEstId);
              setQueue([]);
              updateAppState({ current_idx: 0 });
            }}
            onRemove={async (idx) => {
              const item = queue[idx];
              if (item?.queueRowId) await supabase.from("queue").delete().eq("id", item.queueRowId);
            }}
            onApprove={handleApproveWithCredits}
            autoPlay={autoPlay}
            onToggleAutoPlay={(val) => { setAutoPlay(val); updateAppState({ auto_play: val }); }}
            volume={volume}
            onVolumeChange={(v) => { setVolume(v); updateAppState({ volume: v }); }}
            ads={ads}
            onAddAd={fetchAds}
            onRemoveAd={fetchAds}
            onApproveMessage={(msg) => updateAppState({ current_message: msg.text, message_author: msg.author })}
            onAddSong={(s) => handleSongRequest(s, true)}
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

        <Route path="/scan" element={
          <CustomerView
            establishmentId={selectedEstId}
            onSongRequest={handleSongRequest}
            queue={queue}
            currentIdx={currentIdx}
          />
        } />

        <Route path="/" element={
           <CustomerView 
             establishmentId={selectedEstId} 
             onSongRequest={handleSongRequest} 
             queue={queue} 
             currentIdx={currentIdx}
           />
        } />
      </Routes>
    </BrowserRouter>
  );
}