import { useState, useEffect, useRef } from "react";

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

function QRCode({ url, size = 150 }) {
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

export default function TvViewVideo({ queue = [], currentIdx = 0, onTrackEnd, volume = 50, currentMessage, message_author }) {
  const hasQueue = queue.length > 0;
  const safeIdx = hasQueue ? Math.min(currentIdx, queue.length - 1) : 0;
  const track = hasQueue ? queue[safeIdx] : EMPTY_TRACK;
  const visibleTracks = hasQueue ? queue.slice(safeIdx, safeIdx + 6) : [EMPTY_TRACK];

  const [player, setPlayer] = useState(null);
  const [progress, setProgress] = useState(0);
  const [qrReady, setQrReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [started, setStarted] = useState(false);

  const onTrackEndRef = useRef(onTrackEnd);
  const volumeRef = useRef(volume);
  const startedRef = useRef(started);

  useEffect(() => { onTrackEndRef.current = onTrackEnd; }, [onTrackEnd]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { startedRef.current = started; }, [started]);

  useEffect(() => {
    if (!window.QRCode) {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/qrcode/build/qrcode.min.js";
      s.onload = () => setQrReady(true);
      document.head.appendChild(s);
    } else { setQrReady(true); }

    if (!window.YT) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(tag);
      window.onYouTubeIframeAPIReady = initPlayer;
    } else { initPlayer(); }
  }, []);

  const initPlayer = () => {
    if (window.ytPlayerInstance) return;
    window.ytPlayerInstance = new window.YT.Player("youtube-player", {
      height: "100%", width: "100%",
      videoId: "",
      playerVars: { autoplay: 1, mute: 1, controls: 0, disablekb: 1, modestbranding: 1, rel: 0 },
      events: {
        onReady: (e) => { setPlayer(e.target); },
        onStateChange: (e) => {
          if (e.data === window.YT.PlayerState.ENDED) onTrackEndRef.current();
        },
        onError: () => { onTrackEndRef.current(); },
      },
    });
  };

  useEffect(() => {
    if (!player || !track.youtubeId) return;
    player.mute();
    player.loadVideoById(track.youtubeId);
    player.playVideo();
    if (startedRef.current) {
      const timer = setTimeout(() => {
        player.unMute();
        player.setVolume(volumeRef.current);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [track.youtubeId, player, safeIdx]);

  // Sincronizar volumen del reproductor de YouTube con el prop 'volume'
  useEffect(() => {
    if (player) {
      player.setVolume(volume); // La API de YouTube usa un rango de 0-100 directamente
      if (volume === 0) {
        player.mute();
      } else {
        player.unMute();
      }
    }
  }, [volume, player]);

  const handleStart = () => {
    setStarted(true);
    startedRef.current = true;
    if (player) {
      player.unMute();
      player.setVolume(volumeRef.current);
      player.playVideo();
    }
  };

  useEffect(() => {
    const id = setInterval(() => {
      if (player && player.getCurrentTime) {
        const curr = player.getCurrentTime();
        const dur = player.getDuration();
        setCurrentTime(curr);
        setDuration(dur);
        if (dur > 0) setProgress((curr / dur) * 100);
      }
    }, 500);
    return () => clearInterval(id);
  }, [player]);

  return (
    <div style={{
      height: "100vh", background: "#000", overflow: "hidden",
      position: "fixed", inset: 0,
      fontFamily: "system-ui, -apple-system, sans-serif"
    }}>

      {/* FONDO BLUR */}
      <div style={{ position: "fixed", inset: "-60px", backgroundImage: `url(${track.img})`, backgroundSize: "cover", backgroundPosition: "center", filter: "blur(55px) saturate(1.4) brightness(0.35)", zIndex: 0 }} />
      <div style={{ position: "fixed", inset: 0, background: "radial-gradient(ellipse at center, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.7) 100%)", zIndex: 1 }} />

      {/* ── LAYOUT PRINCIPAL ── */}
      <div style={{
        position: "relative", zIndex: 10,
        display: "grid",
        // 👇 Panel derecho fijo angosto, video toma todo lo demás
        gridTemplateColumns: "1fr 210px",
        gap: "2vw",
        padding: "2vh 2vw",
        height: "100vh",
        boxSizing: "border-box",
      }}>

        {/* ── IZQUIERDA: VIDEO + INFO ── */}
        <div style={{
          display: "flex", flexDirection: "column",
          // 👇 ocupa toda la altura disponible sin desbordarse
          height: "100%", minHeight: 0,
        }}>

          {/* Contenedor del video — flex:1 para llenar el espacio */}
          <div style={{
            flex: 1, minHeight: 0,
            borderRadius: 20, overflow: "hidden",
            boxShadow: `0 30px 80px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.06), 0 0 60px ${track.color}33`,
            background: "#000",
          }}>
            <div id="youtube-player" style={{ width: "100%", height: "100%" }} />
          </div>

          {/* Info debajo del video */}
          <div style={{ flexShrink: 0, paddingLeft: 10, paddingTop: "0.75rem", paddingBottom: "0.5rem" }}>
            <div key={track.id} style={{ animation: "slideUp 0.6s ease" }}>
              <div style={{ fontSize: "clamp(1.2rem, 2.5vw, 2rem)", fontWeight: 800, color: "#fff", lineHeight: 1.1, letterSpacing: "-0.02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {track.title}
              </div>
              <div style={{ fontSize: "0.95rem", color: "rgba(255,255,255,0.55)", marginTop: "0.3rem" }}>
                {track.artist}
              </div>
            </div>
            <div style={{ marginTop: "0.75rem" }}>
              <div style={{ position: "relative", height: 4, background: "rgba(255,255,255,0.12)", borderRadius: 99, overflow: "hidden" }}>
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${progress}%`, background: track.color, transition: "width 0.1s linear" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontFamily: "monospace", fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
                <span>{fmt(currentTime)}</span>
                <span>{fmt(duration)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── DERECHA: COLA + QR ── */}
        <div style={{
          display: "flex", flexDirection: "column", gap: "1rem",
          height: "100%", overflowY: "auto",
        }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.2em" }}>
                {queue.length > 0 ? "PEDIDAS POR CLIENTES" : "NEXT UP"}
              </div>
              {queue.length > 0 && (
                <div style={{ background: "rgba(29,185,84,0.15)", border: "1px solid rgba(29,185,84,0.3)", borderRadius: 99, padding: "2px 7px", fontSize: 9, color: "#1db954", fontWeight: 700 }}>
                  {queue.length}
                </div>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {visibleTracks.map((t, i) => {
                const globalIndex = safeIdx + i;
                const active = globalIndex === safeIdx;
                const past = globalIndex < safeIdx;
                return (
                  <div key={t.id + globalIndex} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.05)", opacity: past ? 0.2 : active ? 1 : 0.55, transition: "opacity 0.8s" }}>
                    <div style={{ width: 36, height: 36, borderRadius: 5, flexShrink: 0, overflow: "hidden", border: active ? `1px solid ${t.color}55` : "1px solid rgba(255,255,255,0.06)" }}>
                      <img src={t.img} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: active ? "#fff" : "rgba(255,255,255,0.8)", fontWeight: active ? 600 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.artist}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* QR */}
          <div style={{ background: "rgba(0,0,0,0.5)", borderRadius: 14, border: "1px solid rgba(255,255,255,0.08)", padding: "0.75rem", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.6rem", backdropFilter: "blur(10px)" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.18em" }}>PIDE TU CANCIÓN</div>
            <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 12, padding: 10, border: `1px solid ${track.color}33` }}>
              {qrReady && <QRCode url={track.qr || SCAN_URL} size={130} key={track.id} />}
            </div>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>Escanea con tu móvil</span>
          </div>
        </div>
      </div>

      {/* OVERLAY INICIAL */}
      {!started && (
        <div onClick={handleStart} style={{ position: "fixed", inset: 0, zIndex: 3000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.80)", backdropFilter: "blur(12px)", cursor: "pointer" }}>
          <div style={{ width: 100, height: 100, borderRadius: "50%", background: track.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 44, boxShadow: `0 0 60px ${track.color}99`, marginBottom: "1.5rem", animation: "pulse 2s ease-in-out infinite" }}>▶</div>
          <div style={{ color: "#fff", fontSize: "1.6rem", fontWeight: 800 }}>Toca para iniciar</div>
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.95rem", marginTop: "0.6rem" }}>El audio se activará automáticamente</div>
        </div>
      )}

      {/* OVERLAY MENSAJES */}
      {currentMessage && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.92)", backdropFilter: "blur(25px)", textAlign: "center", padding: "5vw" }}>
          <div style={{ fontSize: "1.2rem", color: track.color, fontWeight: 800, letterSpacing: "0.5em", marginBottom: "3vh", textTransform: "uppercase" }}>✨ Pedido Especial ✨</div>
          <div style={{ fontSize: "clamp(2.5rem, 6vw, 5.5rem)", fontWeight: 900, color: "#fff", lineHeight: 1.1 }}>{currentMessage}</div>
          <div style={{ marginTop: "3vh", fontSize: "2.2rem", color: track.color, fontWeight: 600, fontStyle: "italic" }}>— {message_author || "Un cliente especial"}</div>
        </div>
      )}

      <style>{`
        ::-webkit-scrollbar { display: none; }
        @keyframes slideUp { from { opacity: 0; transform: translateY(16px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.08); } }
      `}</style>
    </div>
  );
}