import { useState, useEffect, useRef } from "react";
import { supabase } from "./lib/supabase";

const SCAN_URL =
  typeof window !== "undefined" ? `${window.location.origin}/scan` : "/scan";

const EMPTY_TRACK = {
  id: "empty",
  title: "Esperando canción",
  artist: "Pide una canción desde tu mesa",
  duration: 180,
  color: "#1db954",
  youtubeId: "",
  qr: SCAN_URL,
};

const fmt = (s) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function QRCode({ url, size = 110 }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!canvasRef.current || !window.QRCode) return;
    window.QRCode.toCanvas(canvasRef.current, url, {
      width: size * window.devicePixelRatio,
      margin: 1,
      color: { dark: "#ffffff", light: "#00000000" },
    }).catch(() => { });
  }, [url, size]);
  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size, borderRadius: 8, display: "block" }}
    />
  );
}

export default function TvViewVideo({
  queue = [],
  currentIdx = 0,
  onTrackEnd,
  volume = 50,
  ads = [],
  establishmentId,
}) {
  const hasQueue = queue.length > 0;
  const safeIdx = hasQueue ? Math.min(currentIdx, queue.length - 1) : 0;
  const track = hasQueue ? queue[safeIdx] : EMPTY_TRACK;

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
  const [pin, setPin] = useState(null);

  const onTrackEndRef = useRef(onTrackEnd);
  const volumeRef = useRef(volume);
  const startedRef = useRef(started);
  const adVideoRef = useRef(null);
  const lastVideoIdRef = useRef(null);
  const trackRef = useRef(track);
  const establishmentIdRef = useRef(establishmentId);

  useEffect(() => { onTrackEndRef.current = onTrackEnd; }, [onTrackEnd]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { startedRef.current = started; }, [started]);
  useEffect(() => { trackRef.current = track; }, [track]);
  useEffect(() => { establishmentIdRef.current = establishmentId; }, [establishmentId]);

  // --- PIN ---
  useEffect(() => {
    if (!establishmentId) return;

    const fetchPin = async () => {
      const { data } = await supabase
        .from("app_state")
        .select("pin, pin_expires_at")
        .eq("establishment_id", establishmentId)
        .maybeSingle();
      if (data?.pin) {
        const expired = data.pin_expires_at && new Date(data.pin_expires_at) < new Date();
        setPin(expired ? null : data.pin);
      }
    };
    fetchPin();

    const channel = supabase
      .channel(`pin-realtime-${establishmentId}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "app_state",
        filter: `establishment_id=eq.${establishmentId}`,
      }, (payload) => {
        const { pin: newPin, pin_expires_at } = payload.new;
        const expired = pin_expires_at && new Date(pin_expires_at) < new Date();
        setPin(newPin && !expired ? newPin : null);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [establishmentId]);

  // --- MENSAJES EN TIEMPO REAL ---
  useEffect(() => {
    if (!establishmentId) return;

    const channel = supabase
      .channel(`tv-messages-realtime-${establishmentId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "screen_messages",
          filter: `establishment_id=eq.${establishmentId}`,
        },
        (payload) => {
          const data = payload.new;
          if (!data) return;
          const isMyLocal =
            String(data.establishment_id) === String(establishmentId);
          const isApproved = data.status === "approved";

          if (isMyLocal && isApproved) {
            setMessageQueue((prev) => {
              if (prev.some((m) => m.id === data.id)) return prev;
              return [
                ...prev,
                { id: data.id, text: data.text, author: data.author || "Anónimo" },
              ];
            });
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [establishmentId]);

  useEffect(() => {
    if (!displayMessage && messageQueue.length > 0) {
      const next = messageQueue[0];
      setMessageQueue((prev) => prev.slice(1));
      setDisplayMessage(next);
    }
  }, [displayMessage, messageQueue]);

  useEffect(() => {
    if (displayMessage) {
      const timer = setTimeout(() => {
        setDisplayMessage(null);
        supabase
          .from("screen_messages")
          .update({ status: "displayed" })
          .eq("id", displayMessage.id)
          .then();
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [displayMessage]);

  // --- PUBLICIDAD ---
  useEffect(() => {
    if (ads.length > 0 && currentIdx > 0) {
      const matching = ads.filter((ad) => currentIdx % ad.frequency === 0);
      if (matching.length > 0) {
        const ad = matching[Math.floor(Math.random() * matching.length)];
        setCurrentAd(ad);
        setShowAd(true);
        if (player?.pauseVideo) player.pauseVideo();
        const timer = setTimeout(() => {
          setShowAd(false);
          setCurrentAd(null);
          if (player?.playVideo) player.playVideo();
        }, 10000);
        return () => clearTimeout(timer);
      }
    }
  }, [currentIdx, ads, player]);

  useEffect(() => {
    if (adVideoRef.current) adVideoRef.current.volume = volume / 100;
  }, [volume, showAd]);

  // --- YOUTUBE + QR ---
  useEffect(() => {
    if (!window.QRCode) {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/qrcode/build/qrcode.min.js";
      s.onload = () => setQrReady(true);
      document.head.appendChild(s);
    } else {
      setQrReady(true);
    }

    if (!window.YT) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(tag);
      window.onYouTubeIframeAPIReady = initPlayer;
    } else {
      initPlayer();
    }
  }, []);

  const initPlayer = () => {
    if (window.ytPlayerInstance) return;
    const div = document.getElementById("youtube-player");
    if (div) div.setAttribute("allow", "autoplay; encrypted-media; compute-pressure");

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
        origin: window.location.origin,
      },
      events: {
        onReady: (e) => {
          const iframe = e.target.getIframe();
          if (iframe)
            iframe.setAttribute("allow", "autoplay; encrypted-media; compute-pressure");
          setPlayer(e.target);
        },
        onStateChange: (e) => {
          if (e.data === window.YT.PlayerState.ENDED) onTrackEndRef.current();
        },
        onError: () => {
          const t = trackRef.current;
          const eid = establishmentIdRef.current;
          console.log(`Error al reproducir: "${t.title}" — Mesa: ${t.mesa || "N/A"}`);
          if (t.mesa && eid) {
            supabase.from("screen_messages").insert([{
              text: `Error al reproducir: "${t.title}", por favor intentá reproducir otra canción`,
              author: "Sistema",
              establishment_id: eid,
              status: "video_error",
              mesa: Number(t.mesa),
            }]).then(({ error }) => {
              if (error) console.error("Error notificando a la mesa:", error);
            });
          }
          if (t.queueRowId) {
            supabase.from("queue").delete().eq("id", t.queueRowId).then(() => {
              onTrackEndRef.current();
            });
          } else {
            onTrackEndRef.current();
          }
        },
      },
    });
  };

  useEffect(() => {
    if (!player || !track.youtubeId) return;
    if (lastVideoIdRef.current === track.youtubeId) return;
    try {
      lastVideoIdRef.current = track.youtubeId;
      player.mute();
      player.loadVideoById(track.youtubeId);
      player.playVideo();
      if (startedRef.current) {
        setTimeout(() => {
          player.unMute?.();
          player.setVolume(volumeRef.current);
        }, 1000);
      }
    } catch (err) {
      console.error("Error cargando video:", err);
    }
  }, [track.youtubeId, player]);

  useEffect(() => {
    if (!player?.setVolume) return;
    player.setVolume(volume);
    if (volume === 0) player.mute();
    else player.unMute();
  }, [volume, player]);

  const handleStart = () => {
    setStarted(true);
    startedRef.current = true;
    if (player?.playVideo) {
      player.unMute();
      player.setVolume(volumeRef.current);
      player.playVideo();
    }
  };

  useEffect(() => {
    const id = setInterval(() => {
      if (player?.getCurrentTime && player?.getDuration) {
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
    <div
      style={{
        height: "100vh",
        background: "#000",
        overflow: "hidden",
        position: "fixed",
        inset: 0,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {/* VIDEO FULLSCREEN */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 0,
          background: "#000",
          opacity: showAd ? 0 : 1,
          transition: "opacity 0.4s",
        }}
      >
        <div
          id="youtube-player"
          style={{ width: "100%", height: "100%", pointerEvents: "none" }}
        />
      </div>

      {/* VIÑETA SUAVE — solo en la zona del track info */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          height: "22%",
          background:
            "linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 100%)",
          zIndex: 10,
          pointerEvents: "none",
        }}
      />

      {/* PUBLICIDAD */}
      {showAd && currentAd && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            background: "#000",
          }}
        >
          {currentAd.image_url.includes(".mp4") ? (
            <video
              ref={adVideoRef}
              src={currentAd.image_url}
              autoPlay
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <img
              src={currentAd.image_url}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              alt=""
            />
          )}
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              height: 3,
              background: "rgba(255,255,255,0.6)",
              animation: "progressAd 10s linear forwards",
              zIndex: 60,
            }}
          />
        </div>
      )}

      {/* MENSAJE ESPECIAL */}
      {displayMessage && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.78)",
            backdropFilter: "blur(24px)",
            textAlign: "center",
            padding: "2rem",
            animation: "fadeIn 0.6s ease",
          }}
        >
          <div
            style={{
              fontSize: "0.6rem",
              color: "rgba(255,255,255,0.35)",
              fontWeight: 600,
              letterSpacing: "0.45em",
              marginBottom: "1.5rem",
              textTransform: "uppercase",
            }}
          >
            Pedido especial
          </div>
          <div
            style={{
              fontSize: "clamp(2rem, 7vw, 6rem)",
              fontWeight: 800,
              color: "#fff",
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
            }}
          >
            {displayMessage.text}
          </div>
          <div
            style={{
              marginTop: "1.5rem",
              fontSize: "1rem",
              color: "rgba(255,255,255,0.35)",
              fontStyle: "italic",
            }}
          >
            — {displayMessage.author}
          </div>
        </div>
      )}

      {/* QR — centrado verticalmente, pegado a la derecha */}
      <div
        style={{
          position: "fixed",
          top: "50%",
          right: 10,
          transform: "translateY(-50%)",
          zIndex: 20,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
          opacity: displayMessage ? 0 : 1,
          transition: "opacity 0.5s",
        }}
      >

        <div
          style={{
            background: "rgba(0,0,0,0.22)",
            backdropFilter: "blur(16px)",
            borderRadius: 20,
            padding: 16,
            border: "0.5px solid rgba(255,255,255,0.09)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: "white",
              textAlign: "center",
            }}
          >
            ¿Quieres escuchar algo?
            <br />
            <span style={{ fontSize: 9, color: "white", letterSpacing: "0.04em" }}>
              Escanea y elige tu canción
            </span>
          </div>
          {qrReady && (
            <QRCode url={track.qr || SCAN_URL} size={160} key={track.id} />
          )}
          {pin && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div style={{ fontSize: 7, color: "white", letterSpacing: "0.2em", textTransform: "uppercase" }}>
                e ingresa el PIN
              </div>
              <div style={{
                fontSize: 32,
                fontWeight: 900,
                color: "white",
                letterSpacing: "0.10em",
                fontFamily: "'Courier New', monospace",
                lineHeight: 1,
              }}>
                {pin.split("").join(" ")}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
                <div style={{
                  width: 5, height: 5, borderRadius: "50%",
                  background: "#1d9e75",
                  animation: "pinBlink 1.4s ease-in-out infinite",
                }} />
                <div style={{ fontSize: 7, color: "white", letterSpacing: "0.06em" }}>
                  activo hoy
                </div>
              </div>
            </div>
          )}
        </div>



      </div>

      {/* TRACK INFO — pegado abajo */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 20,
          padding: "0 24px 20px",
          opacity: displayMessage ? 0 : 1,
          transition: "opacity 0.4s",
        }}
      >
        {/* Barra de progreso */}
        <div
          style={{
            position: "relative",
            height: 1.5,
            background: "rgba(255,255,255,0.1)",
            borderRadius: 99,
            overflow: "hidden",
            marginBottom: 10,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: `${progress}%`,
              background: "rgba(255,255,255,0.4)",
              borderRadius: 99,
              transition: "width 0.2s linear",
            }}
          />
        </div>

        {/* Título + tiempo */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          <div style={{ flex: 1, minWidth: 0, paddingRight: 16 }}>
            <div
              key={track.id}
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: "rgba(255,255,255,0.55)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                animation: "slideUp 0.5s ease",
              }}
            >
              {track.title}
            </div>
            <div
              style={{
                fontSize: 9,
                color: "rgba(255,255,255,0.22)",
                marginTop: 3,
                animation: "slideUp 0.5s ease",
              }}
            >
              {track.artist}
            </div>
          </div>
          <div
            style={{
              fontFamily: "monospace",
              fontSize: 9,
              color: "rgba(255,255,255,0.18)",
              flexShrink: 0,
            }}
          >
            {fmt(currentTime)} / {fmt(duration)}
          </div>
        </div>
      </div>

      {/* PANTALLA DE INICIO */}
      {!started && (
        <div
          onClick={handleStart}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 3000,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.85)",
            backdropFilter: "blur(16px)",
            cursor: "pointer",
          }}
        >
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 32,
              marginBottom: "1.2rem",
              animation: "pulse 2.5s ease-in-out infinite",
            }}
          >
            ▶
          </div>
          <div
            style={{
              color: "rgba(255,255,255,0.6)",
              fontSize: "0.95rem",
              fontWeight: 400,
              letterSpacing: "0.05em",
            }}
          >
            Toca para iniciar
          </div>
        </div>
      )}

      <style>{`
        ::-webkit-scrollbar { display: none; }
        #youtube-player { pointer-events: none; }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 0.7; }
          50%       { transform: scale(1.06); opacity: 1; }
        }
        @keyframes progressAd {
          from { width: 0%; }
          to   { width: 100%; }
        }
        @keyframes pinBlink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}