import { useState, useEffect, useRef } from "react";

// ─── CONFIG ─────────────────────────────────────────────────────────────────
const STREAM_API_URL = import.meta.env.VITE_STREAM_API_URL || "http://localhost:3000";
// ─────────────────────────────────────────────────────────────────────────────

const SCAN_URL = typeof window !== "undefined" ? `${window.location.origin}/scan` : "/scan";

const EMPTY_TRACK = {
  id: "empty",
  title: "Esperando canción",
  artist: "Pide una canción desde el panel de cliente",
  album: "Up-T",
  duration: 180,
  color: "#1db954",
  img: "https://picsum.photos/seed/placeholder/600/600",
  qr: SCAN_URL,
  youtubeId: "",
};

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function QRCode({ url, color, size = 150 }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!canvasRef.current || !window.QRCode) return;
    window.QRCode.toCanvas(canvasRef.current, url, {
      width: size * window.devicePixelRatio,
      margin: 1,
      color: { dark: "#ffffff", light: "#00000000" },
    }).catch(() => {});
  }, [url, size]);
  return <canvas ref={canvasRef} style={{ width: size, height: size, borderRadius: 10, display: "block" }} />;
}

function SpectrumBars({ color, tick }) {
  const bars = 52;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 48, width: "100%" }}>
      {Array.from({ length: bars }).map((_, i) => {
        const t = tick / 8 + i * 0.38;
        const h = Math.abs(Math.sin(t) * 0.5 + Math.sin(t * 1.9 + 1) * 0.3 + Math.sin(t * 0.4) * 0.2);
        return (
          <div key={i} style={{
            flex: 1, background: color, borderRadius: 2,
            height: `${Math.max(8, h * 100)}%`,
            opacity: 0.5 + h * 0.5,
            transition: "height 0.12s ease, opacity 0.12s ease",
          }} />
        );
      })}
    </div>
  );
}

const parseDuration = (value) => {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return 0;
  const parts = value.split(":").map((part) => Number(part));
  if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2 && parts.every((n) => !Number.isNaN(n))) {
    return parts[0] * 60 + parts[1];
  }
  return Number(value) || 0;
};

export default function TvView({ queue = [], currentIdx = 0, onTrackEnd, onTrackChange, volume = 50, currentMessage, message_author }) {
  const hasQueue = queue.length > 0;
  const safeIdx = hasQueue ? Math.min(currentIdx, queue.length - 1) : 0;
  const track = hasQueue ? queue[safeIdx] : EMPTY_TRACK;
  const visibleTracks = hasQueue ? queue.slice(safeIdx, safeIdx + 4) : [EMPTY_TRACK];

  const [progress, setProgress] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const [tick, setTick] = useState(0);
  const [qrReady, setQrReady] = useState(false);
  const [isStarted, setIsStarted] = useState(false);
  const [error, setError] = useState(null);
  
  const audioRef = useRef(null);
  const nextAudioRef = useRef(null); // Ref para precarga
  const [preloadedId, setPreloadedId] = useState(null); // Control de qué ID se precargó

  const trackDuration = parseDuration(track.duration);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume / 100;
      audioRef.current.muted = volume === 0;
    }
  }, [volume]);

  useEffect(() => {
    setProgress(0);
  }, [queue]);

  useEffect(() => {
    if (window.QRCode) { setQrReady(true); return; }
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/qrcode/build/qrcode.min.js";
    s.onload = () => setQrReady(true);
    document.head.appendChild(s);
  }, []);

  const startPlayback = async () => {
    if (!audioRef.current || !track.youtubeId) return;
    const audio = audioRef.current;
    setError(null);
    audio.pause();
    audio.muted = true;
    audio.src = `${STREAM_API_URL}/api/stream?v=${track.youtubeId}`;
    audio.load();
    try {
      await audio.play();
      audio.muted = volume === 0;
      audio.volume = Math.max(0, Math.min(1, volume / 100));
      setIsStarted(true);
    } catch (e) {
      setError("Toca para iniciar la reproducción");
      setIsStarted(false);
    }
  };

  useEffect(() => {
    if (!isStarted || !audioRef.current) return;
    const audio = audioRef.current;
    setError(null);

    // Si la canción ya estaba precargada, simplemente la movemos al audio principal
    // Para simplificar en este componente, reiniciamos el src pero podrías intercambiar refs
    audio.pause();
    audio.muted = true;
    audio.src = `${STREAM_API_URL}/api/stream?v=${track.youtubeId}`;
    audio.load();
    
    let retryId = null;
    const play = async () => {
      try {
        await audio.play();
        audio.muted = volume === 0;
        audio.volume = Math.max(0, Math.min(1, volume / 100));
        setError(null);
        setPreloadedId(null); // Reset precarga al cambiar de canción
      } catch {
        retryId = setTimeout(async () => {
          try { 
            await audio.play(); 
            audio.muted = volume === 0; 
            audio.volume = Math.max(0, Math.min(1, volume / 100));
          }
          catch { setError("Error de conexión con el servidor"); }
        }, 1500);
      }
    };
    play();
    return () => { if (retryId) clearTimeout(retryId); };
  }, [safeIdx, isStarted]);

  useEffect(() => {
    if (!isStarted) return;
    const id = setInterval(() => {
      setTick((t) => t + 1);
    }, 100);
    return () => clearInterval(id);
  }, [isStarted]);

  const handleTimeUpdate = () => {
    if (audioRef.current && trackDuration > 0) {
      const currentTime = audioRef.current.currentTime;
      const currentProgress = (currentTime / trackDuration) * 100;
      setProgress(Math.min(100, currentProgress));

      // LÓGICA DE PRECARGA: Si faltan 30 seg y hay una siguiente canción
      const remainingTime = trackDuration - currentTime;
      if (remainingTime < 30 && queue[safeIdx + 1] && preloadedId !== queue[safeIdx + 1].youtubeId) {
        const nextTrack = queue[safeIdx + 1];
        console.log("Precargando:", nextTrack.title);
        setPreloadedId(nextTrack.youtubeId);
        if (nextAudioRef.current) {
          nextAudioRef.current.src = `${STREAM_API_URL}/api/stream?v=${nextTrack.youtubeId}`;
          nextAudioRef.current.load();
        }
      }
    }
  };

  const handleEnded = () => {
    if (onTrackEnd) onTrackEnd();
  };

  const elapsed = Math.floor((progress / 100) * (trackDuration || 200));
  const bg = "#000";

  return (
    <div style={{ 
      height: "100vh", 
      background: bg, 
      overflow: "hidden", 
      position: "fixed", 
      inset: 0, 
      fontFamily: "system-ui, -apple-system, sans-serif" 
    }}>

      <div style={{
        position: "fixed", inset: "-60px",
        backgroundImage: `url(${track.img})`,
        backgroundSize: "cover", backgroundPosition: "center",
        filter: "blur(55px) saturate(1.4) brightness(0.35)",
        transition: "background-image 1.2s ease",
        zIndex: 0,
      }} />
      <div style={{ position: "fixed", inset: 0, background: "radial-gradient(ellipse at center, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.7) 100%)", zIndex: 1 }} />
      <div style={{ position: "fixed", inset: 0, background: "linear-gradient(to right, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 40%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.55) 100%)", zIndex: 1 }} />
      <div style={{ position: "fixed", inset: 0, background: "#000", opacity: transitioning ? 1 : 0, transition: "opacity 0.6s", zIndex: 200, pointerEvents: "none" }} />

      <div style={{
        position: "relative", zIndex: 10, minHeight: "100vh",
        display: "grid", gridTemplateColumns: "auto 1fr auto",
        gap: "4vw", alignItems: "center", padding: "4vh 4vw",
      }}>

        {/* IZQUIERDA — Portada */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1.5rem" }}>
          <div style={{
            width: "clamp(260px, 28vw, 440px)", aspectRatio: "1",
            borderRadius: 16, overflow: "hidden",
            boxShadow: `0 30px 80px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.06), 0 0 60px ${track.color}33`,
            transition: "box-shadow 1.5s ease", flexShrink: 0,
          }}>
            <img src={track.img} alt={track.title} key={track.id}
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", animation: "fadeIn 0.8s ease" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: 0.5 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill={track.color}>
              <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
            </svg>
            <span style={{ fontSize: 12, color: "#fff", letterSpacing: "0.08em", fontWeight: 600 }}>YOUTUBE</span>
          </div>
        </div>

        {/* CENTRO — Info de canción */}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: "1.8rem", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: track.color, animation: "pulse 1.4s ease-in-out infinite" }} />
            <span style={{ fontSize: 12, color: track.color, letterSpacing: "0.18em", fontWeight: 600, textTransform: "uppercase" }}>Now Playing</span>
          </div>

          <div key={track.id} style={{ animation: "slideUp 0.6s ease" }}>
            <div style={{
              fontSize: "clamp(2.2rem, 5.5vw, 4.5rem)", fontWeight: 800, color: "#fff",
              lineHeight: 1, letterSpacing: "-0.03em",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              textShadow: "0 2px 30px rgba(0,0,0,0.5)",
            }}>
              {track.title}
            </div>
            <div style={{ fontSize: "clamp(1rem, 2.2vw, 1.6rem)", color: "rgba(255,255,255,0.55)", fontWeight: 400, marginTop: "0.5rem" }}>
              {track.artist}
            </div>
            {track.album && (
              <div style={{ fontSize: "clamp(0.8rem, 1.4vw, 1rem)", color: "rgba(255,255,255,0.3)", fontWeight: 400, marginTop: "0.25rem", letterSpacing: "0.08em" }}>
                {track.album}
              </div>
            )}
          </div>

          <div>
            <div style={{ position: "relative", height: 4, background: "rgba(255,255,255,0.12)", borderRadius: 99, overflow: "hidden" }}>
              <div style={{
                position: "absolute", left: 0, top: 0, bottom: 0,
                width: `${progress}%`, borderRadius: 99,
                background: `linear-gradient(to right, ${track.color}88, ${track.color})`,
                transition: "width 0.1s linear",
                boxShadow: `0 0 12px ${track.color}88`,
              }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontFamily: "monospace", fontSize: 13, color: "rgba(255,255,255,0.35)" }}>
              <span>{fmt(elapsed)}</span>
              <span>{fmt(trackDuration || 0)}</span>
            </div>
          </div>

          <SpectrumBars color={track.color} tick={tick} />
        </div>

        {/* DERECHA — Cola + QR */}
        <div style={{
          display: "flex", flexDirection: "column", gap: "2rem",
          width: "clamp(180px, 20vw, 280px)", flexShrink: 0,
          maxHeight: "calc(100vh - 8vh)", overflowY: "auto",
        }}>

          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.2em" }}>
                {queue.length > 0 ? "PEDIDAS POR CLIENTES" : "NEXT UP"}
              </div>
              {queue.length > 0 && (
                <div style={{
                  background: "rgba(29,185,84,0.15)", border: "1px solid rgba(29,185,84,0.3)",
                  borderRadius: 99, padding: "2px 8px", fontSize: 10, color: "#1db954", fontWeight: 700,
                }}>
                  {queue.length}
                </div>
              )}
            </div>

            {queue.length === 0 && (
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", lineHeight: 1.5, padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)", marginBottom: 8 }}>
                Esperando solicitudes de clientes…
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {visibleTracks.map((t, i) => {
                const globalIndex = safeIdx + i;
                const active = globalIndex === safeIdx;
                const past = globalIndex < safeIdx;
                const isRequested = queue.length > 0;
                return (
                  <div key={t.id + globalIndex} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "8px 0",
                    borderBottom: "1px solid rgba(255,255,255,0.05)",
                    opacity: past ? 0.2 : active ? 1 : 0.55,
                    transition: "opacity 0.8s",
                    cursor: isRequested && !active ? "pointer" : "default",
                  }}
                    onClick={() => { if (onTrackChange && !active) onTrackChange(globalIndex); }}
                  >
                    <div style={{
                      width: 40, height: 40, borderRadius: 6, flexShrink: 0,
                      overflow: "hidden",
                      boxShadow: active ? `0 0 12px ${t.color}66` : "none",
                      border: active ? `1px solid ${t.color}55` : "1px solid rgba(255,255,255,0.06)",
                      position: "relative",
                    }}>
                      <img src={t.img} alt={t.title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                      {isRequested && !active && !past && (
                        <div style={{ position: "absolute", bottom: 2, right: 2, width: 10, height: 10, borderRadius: "50%", background: "#1db954", boxShadow: "0 0 6px #1db954" }} />
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: active ? "#fff" : "rgba(255,255,255,0.8)", fontWeight: active ? 600 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {t.title}
                      </div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {t.artist}
                      </div>
                    </div>
                    {active && (
                      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 16, flexShrink: 0 }}>
                        {[0, 1, 2].map((j) => (
                          <div key={j} style={{ width: 3, background: t.color, borderRadius: 2, animation: `eq${j} ${0.5 + j * 0.15}s ease-in-out infinite alternate` }} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{
            background: "rgba(0,0,0,0.5)", borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.08)",
            padding: "1rem", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem",
            backdropFilter: "blur(10px)",
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.18em" }}>PIDE TU CANCIÓN</div>
            <div style={{
              background: "rgba(255,255,255,0.06)", borderRadius: 14, padding: 14,
              border: `1px solid ${track.color}33`, transition: "border-color 1s",
            }}>
              {qrReady && <QRCode url={track.qr || SCAN_URL} color={track.color} size={150} key={track.id} />}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill={track.color}>
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
              </svg>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Escanea con tu móvil</span>
            </div>
          </div>
        </div>
      </div>

     {/* OVERLAY DE MENSAJES ESTILO PANTALLA COMPLETA — UP-T */}
      {currentMessage && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 2000,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          background: "rgba(0,0,0,0.92)", backdropFilter: "blur(25px)",
          animation: "fadeIn 0.6s ease-out", textAlign: "center", padding: "5vw"
        }}>
          {/* Cabecera */}
          <div style={{ 
            fontSize: "clamp(0.8rem, 2vw, 1.2rem)", 
            color: track.color, 
            fontWeight: 800, 
            letterSpacing: "0.5em", 
            marginBottom: "3vh", 
            textTransform: "uppercase", 
            opacity: 0.9
          }}>
            ✨ Pedido Especial ✨
          </div>

          {/* El Mensaje Principal */}
          <div style={{ 
            fontSize: "clamp(2.5rem, 6vw, 5.5rem)", 
            fontWeight: 900, 
            color: "#fff", 
            lineHeight: 1.1,
            textShadow: `0 0 50px ${track.color}66`,
            maxWidth: "85vw", 
            animation: "slideUp 0.8s cubic-bezier(0.2, 0.8, 0.2, 1)"
          }}>
            {currentMessage}
          </div>

          {/* Autor del Mensaje — Lógica Dinámica */}
          <div style={{ 
            marginTop: "3vh",
            fontSize: "clamp(1.2rem, 3vw, 2.2rem)",
            color: track.color, 
            fontWeight: 600,
            fontStyle: "italic",
            animation: "fadeIn 1.2s ease",
            opacity: 0.9
          }}>
            — {message_author ? `De: ${message_author}` : "De: Un cliente especial"}
          </div>

          {/* Separador */}
          <div style={{ 
            marginTop: "5vh", 
            height: "2px", 
            width: "150px", 
            background: `linear-gradient(to right, transparent, ${track.color}, transparent)`, 
            borderRadius: "99px" 
          }} />

          {/* Miniatura de la canción actual */}
          <div style={{ marginTop: "6vh", display: "flex", alignItems: "center", gap: 15, opacity: 0.5 }}>
            <img src={track.img} style={{ width: 45, height: 45, borderRadius: 8, boxShadow: `0 0 20px ${track.color}44` }} alt="" />
            <div style={{ textAlign: "left" }}>
              <div style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>{track.title}</div>
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 11 }}>{track.artist}</div>
            </div>
          </div>
        </div>
      )}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, height: 3, zIndex: 20,
        background: `linear-gradient(to right, transparent 0%, ${track.color}88 20%, ${track.color} 50%, ${track.color}88 80%, transparent 100%)`,
        transition: "background 1.5s ease",
      }} />

      {!isStarted && (
        <div style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.45)" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <button type="button" onClick={startPlayback} style={{
              padding: "0.95rem 1.4rem", background: "rgba(255,255,255,0.12)",
              border: "1px solid rgba(255,255,255,0.22)", color: "#fff",
              borderRadius: 999, fontSize: "0.95rem", fontWeight: 700,
              cursor: "pointer", backdropFilter: "blur(10px)",
              fontFamily: "inherit",
            }}>
              Toca para iniciar el audio
            </button>
            {error && <div style={{ color: "#ff8888", fontSize: 12, textAlign: "center", maxWidth: 300 }}>{error}</div>}
          </div>
        </div>
      )}

      {/* REPRODUCTOR PRINCIPAL */}
      <audio 
        ref={audioRef} 
        style={{ display: "none" }} 
        preload="auto" 
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
      />

      {/* REPRODUCTOR DE PRECARGA (OCULTO) */}
      <audio 
        ref={nextAudioRef} 
        style={{ display: "none" }} 
        preload="auto" 
        muted={true}
      />

      <style>{`
        ::-webkit-scrollbar { display: none; }
        * { -ms-overflow-style: none; scrollbar-width: none; }
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(16px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1) } 50% { opacity: 0.5; transform: scale(0.8) } }
        @keyframes eq0 { from { height: 4px } to { height: 16px } }
        @keyframes eq1 { from { height: 8px } to { height: 12px } }
        @keyframes eq2 { from { height: 3px } to { height: 16px } }
      `}</style>
    </div>
  );
}