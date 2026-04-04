import { useState, useEffect, useRef } from "react";
import { supabase } from "./lib/supabase";

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

export default function TvViewVideo({ 
  queue = [], 
  currentIdx = 0, 
  onTrackEnd, 
  volume = 50, 
  ads = [],
  restaurantId 
}) {
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

  const [showAd, setShowAd] = useState(false);
  const [currentAd, setCurrentAd] = useState(null);

  const [displayMessage, setDisplayMessage] = useState(null);
  const [messageQueue, setMessageQueue] = useState([]);

  const onTrackEndRef = useRef(onTrackEnd);
  const volumeRef = useRef(volume);
  const startedRef = useRef(started);
  const adVideoRef = useRef(null);
  const lastVideoIdRef = useRef(null);

  useEffect(() => { onTrackEndRef.current = onTrackEnd; }, [onTrackEnd]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { startedRef.current = started; }, [started]);

  useEffect(() => {
    const channel = supabase
      .channel('screen-messages')
      .on(
        'postgres_changes', 
        { event: 'UPDATE', schema: 'public', table: 'screen_messages', filter: `status=eq.approved` }, 
        (payload) => {
            if (payload.new.restaurant_id === restaurantId) {
                const newMsg = { id: payload.new.id, text: payload.new.text, author: payload.new.author };
                setMessageQueue((prev) => [...prev, newMsg]);
            }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [restaurantId]);

  useEffect(() => {
    if (!displayMessage && messageQueue.length > 0) {
      const nextMsg = messageQueue[0];
      setMessageQueue((prev) => prev.slice(1));
      setDisplayMessage(nextMsg);
    }
  }, [displayMessage, messageQueue]);

  useEffect(() => {
    if (displayMessage) {
      const timer = setTimeout(() => {
        setDisplayMessage(null);
        supabase.from('screen_messages').update({ status: 'displayed' }).eq('id', displayMessage.id);
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [displayMessage]);

  useEffect(() => {
    if (ads.length > 0 && currentIdx > 0) {
      const matchingAds = ads.filter(ad => currentIdx % ad.frequency === 0);
      if (matchingAds.length > 0) {
        const randomIndex = Math.floor(Math.random() * matchingAds.length);
        const activeAd = matchingAds[randomIndex];
        setCurrentAd(activeAd);
        setShowAd(true);
        if (player && player.pauseVideo) player.pauseVideo();
        const timer = setTimeout(() => {
          setShowAd(false);
          setCurrentAd(null);
          if (player && player.playVideo) player.playVideo();
        }, 10000); 
        return () => clearTimeout(timer);
      }
    }
  }, [currentIdx, ads, player]);

  useEffect(() => {
    if (adVideoRef.current) { adVideoRef.current.volume = volume / 100; }
  }, [volume, showAd]);

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
    height: "100%", 
    width: "100%",
    videoId: "",
    playerVars: { 
      autoplay: 1, 
      mute: 1, 
      controls: 0, 
      disablekb: 1, 
      modestbranding: 1, 
      rel: 0,
      enablejsapi: 1,
      origin: window.location.origin
    },
    events: {
      onReady: (e) => { 
        // --- ESTO ELIMINA EL ERROR ---
        const iframe = e.target.getIframe();
        if (iframe) {
          iframe.setAttribute("allow", "autoplay; encrypted-media; compute-pressure");
        }
        setPlayer(e.target); 
      },
      onStateChange: (e) => {
        if (e.data === window.YT.PlayerState.ENDED) onTrackEndRef.current();
      },
      onError: () => { onTrackEndRef.current(); },
    },
  });
};

  useEffect(() => {
    // Si no hay player o el track no tiene ID (está vacío), paramos aquí
    if (!player || !track.youtubeId) return;

    // BLOQUEO: Solo cargar si el ID es nuevo
    if (lastVideoIdRef.current === track.youtubeId) return;

    try {
        // Marcamos el nuevo ID antes de cargar para evitar bucles
        lastVideoIdRef.current = track.youtubeId;
        
        player.mute();
        player.loadVideoById(track.youtubeId);
        player.playVideo();

        if (startedRef.current) {
          setTimeout(() => {
            if (player.unMute) {
                player.unMute();
                player.setVolume(volumeRef.current);
            }
          }, 1000);
        }
    } catch (err) { 
        console.error("Error cargando video:", err); 
    }
  }, [track.youtubeId, player]);

  useEffect(() => {
    if (player && player.setVolume) {
      player.setVolume(volume);
      if (volume === 0) player.mute();
      else player.unMute();
    }
  }, [volume, player]);

  const handleStart = () => {
    setStarted(true);
    startedRef.current = true;
    if (player && player.playVideo) {
      player.unMute();
      player.setVolume(volumeRef.current);
      player.playVideo();
    }
  };

  useEffect(() => {
    const id = setInterval(() => {
      if (player && player.getCurrentTime && player.getDuration) {
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
    <div style={{ height: "100vh", background: "#000", overflow: "hidden", position: "fixed", inset: 0, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ position: "fixed", inset: "-60px", backgroundImage: `url(${track.img})`, backgroundSize: "cover", backgroundPosition: "center", filter: "blur(55px) saturate(1.4) brightness(0.35)", zIndex: 0 }} />
      <div style={{ position: "fixed", inset: 0, background: "radial-gradient(ellipse at center, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.7) 100%)", zIndex: 1 }} />

      <div style={{ position: "relative", zIndex: 10, display: "grid", gridTemplateColumns: "1fr 210px", gap: "2vw", padding: "2vh 2vw", height: "100vh", boxSizing: "border-box" }}>
        
        <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
          <div style={{ flex: 1, minHeight: 0, borderRadius: 20, overflow: "hidden", boxShadow: `0 30px 80px rgba(0,0,0,0.8), 0 0 60px ${track.color}33`, background: "#000", position: "relative" }}>
            
            <div style={{ width: "100%", height: "100%", position: "absolute", inset: 0, opacity: (showAd || !track.youtubeId) ? 0 : 1, transition: "opacity 0.3s" }}>
               <div id="youtube-player"></div>
            </div>

            {!track.youtubeId && !showAd && (
              <div style={{ position: "absolute", inset: 0, zIndex: 10 }}>
                <img src={track.img} style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.5 }} alt="" />
              </div>
            )}

            {showAd && currentAd && (
              <div style={{ position: "absolute", inset: 0, zIndex: 50, background: "#000", animation: "slideUp 0.5s ease" }}>
                {currentAd.image_url.includes(".mp4") ? (
                    <video ref={adVideoRef} src={currentAd.image_url} autoPlay style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                    <img src={currentAd.image_url} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" />
                )}
                <div style={{ position: "absolute", bottom: 0, left: 0, height: 6, background: track.color, animation: "progressAd 10s linear", boxShadow: `0 0 15px ${track.color}`, zIndex: 60 }} />
              </div>
            )}

            {displayMessage && (
                <div style={{ 
                    position: "absolute", inset: 0, zIndex: 100, display: "flex", flexDirection: "column", 
                    alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.80)", 
                    backdropFilter: "blur(15px)", textAlign: "center", padding: "2rem", animation: "fadeIn 0.5s ease" 
                }}>
                    <div style={{ fontSize: "1rem", color: track.color, fontWeight: 800, letterSpacing: "0.5em", marginBottom: "1.5vh", textTransform: "uppercase" }}>✨ Pedido Especial ✨</div>
                    <div style={{ fontSize: "clamp(1.5rem, 8vw, 8rem)", fontWeight: 900, color: "#fff", lineHeight: 1.1 }}>{displayMessage.text}</div>
                    <div style={{ marginTop: "1.5vh", fontSize: "2rem", color: track.color, fontWeight: 600, fontStyle: "italic" }}>— {displayMessage.author}</div>
                </div>
            )}
          </div>

          <div style={{ flexShrink: 0, paddingLeft: 10, paddingTop: "0.75rem" }}>
            <div key={track.id} style={{ animation: "slideUp 0.6s ease" }}>
              <div style={{ fontWeight: 800, color: "#fff", lineHeight: 1.1, letterSpacing: "-0.02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{track.title}</div>
              <div style={{ fontSize: "0.5rem", color: "rgba(255,255,255,0.55)", marginTop: "0.3rem" }}>{track.artist}</div>
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

        <div style={{ display: "flex", flexDirection: "column", gap: "1rem", height: "100%", overflowY: "auto" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.2em" }}>{queue.length > 0 ? "PEDIDAS POR CLIENTES" : "NEXT UP"}</div>
              {queue.length > 0 && <div style={{ background: "rgba(29,185,84,0.15)", border: "1px solid rgba(29,185,84,0.3)", borderRadius: 99, padding: "2px 7px", fontSize: 9, color: "#1db954", fontWeight: 700 }}>{queue.length}</div>}
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {visibleTracks.map((t, i) => {
                const globalIndex = safeIdx + i;
                const active = globalIndex === safeIdx;
                return (
                  <div key={t.id + globalIndex} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.05)", opacity: active ? 1 : 0.55 }}>
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

          <div style={{ background: "rgba(0,0,0,0.5)", borderRadius: 14, border: "1px solid rgba(255,255,255,0.08)", padding: "0.75rem", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.6rem", backdropFilter: "blur(10px)" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.18em" }}>PIDE TU CANCIÓN</div>
            <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 12, padding: 10, border: `1px solid ${track.color}33` }}>
              {qrReady && <QRCode url={track.qr || SCAN_URL} size={130} key={track.id} />}
            </div>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>Escanea con tu móvil</span>
          </div>
        </div>
      </div>

      {!started && (
        <div onClick={handleStart} style={{ position: "fixed", inset: 0, zIndex: 3000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.80)", backdropFilter: "blur(12px)", cursor: "pointer" }}>
          <div style={{ width: 100, height: 100, borderRadius: "50%", background: track.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 44, boxShadow: `0 0 60px ${track.color}99`, marginBottom: "1.5rem", animation: "pulse 2s ease-in-out infinite" }}>▶</div>
          <div style={{ color: "#fff", fontSize: "1.6rem", fontWeight: 800 }}>Toca para iniciar</div>
        </div>
      )}

      <style>{`
        ::-webkit-scrollbar { display: none; }
        @keyframes slideUp { from { opacity: 0; transform: translateY(16px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.08); } }
        @keyframes progressAd { from { width: 0%; } to { width: 100%; } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </div>
  );
}