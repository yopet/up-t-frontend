import { useState, useCallback, useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import TvView from "./TvView";
import CustomerView from "./CustomerView";
import AdminView from "./AdminView";

const ACCENT_COLORS = ["#00c9ff", "#ff6b6b", "#1db954", "#ff99c8", "#ffcc00", "#a78bfa", "#ff4d00", "#00ffd0"];
const STORAGE_QUEUE_KEY = "up-t-queue";
const STORAGE_CURRENT_IDX_KEY = "up-t-current-idx";
const STORAGE_VOLUME_KEY = "up-t-volume"; // Nueva clave para persistencia

export default function App() {
  // --- ESTADOS ---
  const [queue, setQueue] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_QUEUE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });

  const [currentIdx, setCurrentIdx] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_CURRENT_IDX_KEY);
      return raw ? Number(raw) : 0;
    } catch { return 0; }
  });

  // NUEVO: Estado de volumen inicializado desde localStorage o al 50%
  const [volume, setVolume] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_VOLUME_KEY);
      return raw ? Number(raw) : 50;
    } catch { return 50; }
  });

  // --- PERSISTENCIA ---
  useEffect(() => { localStorage.setItem(STORAGE_QUEUE_KEY, JSON.stringify(queue)); }, [queue]);
  useEffect(() => { localStorage.setItem(STORAGE_CURRENT_IDX_KEY, String(currentIdx)); }, [currentIdx]);
  // Guardar el volumen para que no se resetee al refrescar
  useEffect(() => { localStorage.setItem(STORAGE_VOLUME_KEY, String(volume)); }, [volume]);

  // --- MANEJO DE EVENTOS ---
  const handleSongRequest = useCallback((song) => {
    setQueue((prev) => {
      if (prev.some((s) => s.id === song.id)) return prev;
      const colorIdx = prev.length % ACCENT_COLORS.length;
      return [
        ...prev,
        {
          ...song,
          color: song.color || ACCENT_COLORS[colorIdx],
          youtubeId: song.youtubeId || song.id,
          duration: typeof song.duration === 'number' ? song.duration : 180, 
          album: song.album || "Single",
          qr: "https://up-t.app/scan",
        },
      ];
    });
  }, []);

  const handleRemoveFromQueue = useCallback((idx) => {
    setQueue((prev) => prev.filter((_, i) => i !== idx));
    // Ajuste de índice si eliminamos una canción previa a la actual
    if (currentIdx >= idx && currentIdx > 0) setCurrentIdx(prev => prev - 1);
  }, [currentIdx]);

  const handlePlayNow = useCallback((idx) => {
    setCurrentIdx(idx);
  }, []);

  const handleTrackEnd = useCallback(() => {
    setCurrentIdx((i) => (queue.length > 0 ? Math.min(i + 1, queue.length - 1) : 0));
  }, [queue.length]);

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
              onTrackChange={setCurrentIdx}
              volume={volume} 
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
              volume={volume}
              onVolumeChange={setVolume}
            />
          } 
        />

        <Route path="/scan" element={<CustomerView onSongRequest={handleSongRequest} queue={queue} currentIdx={currentIdx} />} />
        <Route path="/" element={<CustomerView onSongRequest={handleSongRequest} queue={queue} currentIdx={currentIdx} />} />
      </Routes>
    </BrowserRouter>
  );
}