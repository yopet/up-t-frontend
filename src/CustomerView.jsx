import { useState, useEffect, useRef } from "react";
import { supabase } from "./lib/supabase"; // Importante: Asegúrate de tener la ruta correcta a tu cliente

// ─── CONFIG ─────────────────────────────────────────────────────────────────
const API_KEYS = [
  import.meta.env.VITE_YT_KEY_1,
  import.meta.env.VITE_YT_KEY_2,
  import.meta.env.VITE_YT_KEY_3,
  import.meta.env.VITE_YT_KEY_4,
  import.meta.env.VITE_YT_KEY_5,
].filter(Boolean);

const EXHAUSTED_KEY = "yt_exhausted_keys";
const EXHAUSTED_UNTIL_KEY = "yt_exhausted_until";
const COOLDOWN_MINUTES = 2; // Tiempo de espera entre canciones

function getAvailableKey() {
  const until = parseInt(localStorage.getItem(EXHAUSTED_UNTIL_KEY) || "0");
  if (Date.now() > until) {
    localStorage.removeItem(EXHAUSTED_KEY);
    localStorage.removeItem(EXHAUSTED_UNTIL_KEY);
    return API_KEYS[0];
  }
  const exhausted = JSON.parse(localStorage.getItem(EXHAUSTED_KEY) || "[]");
  return API_KEYS.find((k) => !exhausted.includes(k)) || null;
}

function markKeyExhausted(key) {
  const exhausted = JSON.parse(localStorage.getItem(EXHAUSTED_KEY) || "[]");
  if (!exhausted.includes(key)) exhausted.push(key);
  localStorage.setItem(EXHAUSTED_KEY, JSON.stringify(exhausted));
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  localStorage.setItem(EXHAUSTED_UNTIL_KEY, midnight.getTime().toString());
}

function isQuotaError(data) {
  return (
    data?.error?.code === 403 &&
    (data?.error?.message?.toLowerCase().includes("quota") ||
      data?.error?.errors?.[0]?.reason === "quotaExceeded" ||
      data?.error?.errors?.[0]?.reason === "dailyLimitExceeded")
  );
}
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_NOW = {
  title: "Esperando canción...",
  artist: "Up-T Gastrobar",
  img: "https://picsum.photos/seed/nowplay/80/80",
};

function formatDuration(iso) {
  if (!iso) return "";
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return "";
  const h = parseInt(match[1] || 0);
  const m = parseInt(match[2] || 0);
  const s = parseInt(match[3] || 0);
  const mm = String(m).padStart(h ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function EqBars() {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 16 }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{
          width: 3, background: "#1db954", borderRadius: 2,
          animation: `eq${i} ${0.45 + i * 0.15}s ease-in-out infinite alternate`,
        }} />
      ))}
      <style>{`
        @keyframes eq0{from{height:3px}to{height:14px}}
        @keyframes eq1{from{height:7px}to{height:16px}}
        @keyframes eq2{from{height:4px}to{height:11px}}
      `}</style>
    </div>
  );
}

function Toast({ msg, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2400);
    return () => clearTimeout(t);
  }, []);
  return (
    <div style={{
      position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)",
      background: "#1db954", color: "#000", fontWeight: 700, fontSize: 13,
      padding: "10px 22px", borderRadius: 50, whiteSpace: "nowrap",
      boxShadow: "0 4px 20px rgba(0,0,0,0.5)", zIndex: 9999,
      animation: "toastIn 0.25s ease", fontFamily: "system-ui, sans-serif",
    }}>
      {msg}
      <style>{`@keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}`}</style>
    </div>
  );
}
// Utilidad para convertir "04:15" o "1:20:05" a segundos totales
const parseDurationString = (value) => {
  if (!value) return 0;
  const parts = String(value).split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
};

export default function CustomerView({ onSongRequest, queue = [], currentIdx = 0 }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [toast, setToast] = useState("");
  const [searching, setSearching] = useState(false);
  const [added, setAdded] = useState(new Set());
  const [error, setError] = useState("");
  const [keysInfo, setKeysInfo] = useState("");
  const inputRef = useRef(null);

  // --- NUEVOS ESTADOS PARA MENSAJE ---
  const [showMsgModal, setShowMsgModal] = useState(false);
  const [msgText, setMsgText] = useState("");
  const [msgAuthor, setMsgAuthor] = useState("");
  const [sendingMsg, setSendingMsg] = useState(false);

  const safeCurrentIdx = Math.min(Math.max(0, currentIdx), Math.max(0, queue.length - 1));
  const currentTrack = queue[safeCurrentIdx] || null;

  useEffect(() => {
    setAdded(new Set(queue.map((song) => song.id)));
  }, [queue]);

  useEffect(() => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery || trimmedQuery.length < 3) { 
      setResults([]); 
      setError(""); 
      setKeysInfo(""); 
      setSearching(false);
      return; 
    }

    setSearching(true);
    setError("");
    const ctrl = new AbortController();

    const timeout = setTimeout(async () => {
      const searchWithKey = async (key) => {
        const res = await fetch(
          `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=5&q=${encodeURIComponent(trimmedQuery)}&key=${key}`,
          { signal: ctrl.signal }
        );
        return res.json();
      };

      try {
        let currentKey = getAvailableKey();
        if (!currentKey) {
          setError("Cuota agotada. Intenta mañana.");
          setSearching(false);
          return;
        }

        let searchData = await searchWithKey(currentKey);

        while (isQuotaError(searchData)) {
          markKeyExhausted(currentKey);
          currentKey = getAvailableKey();
          if (!currentKey) {
            setError("Cuota agotada.");
            setSearching(false);
            return;
          }
          searchData = await searchWithKey(currentKey);
        }

        const items = searchData.items || [];
        if (!items.length) { setResults([]); setSearching(false); return; }

        const videoIds = items.map((i) => i.id.videoId).join(",");
        const detailRes = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${videoIds}&key=${currentKey}`,
          { signal: ctrl.signal }
        );
        const detailData = await detailRes.json();
        const durationMap = {};
        (detailData.items || []).forEach((v) => {
          durationMap[v.id] = formatDuration(v.contentDetails.duration);
        });

        setResults(items.map((item) => ({
          id: item.id.videoId,
          title: item.snippet.title,
          artist: item.snippet.channelTitle.replace(/ - Topic$| Music$/i, ""),
          img: item.snippet.thumbnails.medium?.url,
          duration: durationMap[item.id.videoId] || "",
          videoId: item.id.videoId,
        })));

      } catch (e) {
        if (e.name !== "AbortError") setError("Error de conexión");
      } finally {
        setSearching(false);
      }
    }, 600);

    return () => { clearTimeout(timeout); ctrl.abort(); };
  }, [query]);

// ... dentro de export default function CustomerView ...

const addToQueue = (track) => {
  // 1. Evitar duplicados visuales en la sesión actual
  if (added.has(track.id)) return;

  // --- NUEVA VALIDACIÓN: COOLDOWN (Punto 1) ---
  const lastRequest = localStorage.getItem("last_song_request");
  const now = Date.now();
  const cooldownMs = COOLDOWN_MINUTES * 60 * 1000;

  if (lastRequest && (now - parseInt(lastRequest)) < cooldownMs) {
    const remainingMs = cooldownMs - (now - parseInt(lastRequest));
    const remainingMin = Math.ceil(remainingMs / 60000);
    setToast(`⏳ Espera ${remainingMin} min para pedir otra`);
    return;
  }

  // --- VALIDACIÓN DE DURACIÓN (Punto 3) ---
  const seconds = parseDurationString(track.duration);
  const MAX_SECONDS = 480; // 8 minutos

  if (seconds > MAX_SECONDS) {
    setToast("⚠️ Canción demasiado larga (máx. 8 min)");
    return;
  }

  // --- SI PASA TODAS LAS PRUEBAS ---
  if (onSongRequest) onSongRequest(track);
  
  // Guardar el momento de la petición para el cooldown
  localStorage.setItem("last_song_request", now.toString());
  
  setAdded((s) => new Set([...s, track.id]));
  setToast(`"${track.title}" agregada a la cola`);
};

  // --- FUNCIÓN PARA ENVIAR MENSAJE ---
  const handleSendMsg = async () => {
    if (!msgText.trim()) return;
    setSendingMsg(true);
    try {
      const { error } = await supabase
        .from('screen_messages')
        .insert([{ 
          text: msgText, 
          author: msgAuthor || "Invitado",
          status: 'pending' // El admin lo aprueba
        }]);
      
      if (error) throw error;
      
      setToast("Mensaje enviado a moderación ✨");
      setMsgText("");
      setShowMsgModal(false);
    } catch (e) {
      console.error(e);
      setToast("Error al enviar mensaje");
    } finally {
      setSendingMsg(false);
    }
  };

  const bg = "#0a0a0a";
  const surface = "#161616";
  const surface2 = "#1c1c1c";
  const border = "rgba(255,255,255,0.07)";
  const muted = "rgba(255,255,255,0.35)";
  const muted2 = "rgba(255,255,255,0.18)";

  return (
    <div style={{
      background: bg, minHeight: "100vh", color: "#fff",
      fontFamily: "system-ui, -apple-system, sans-serif",
      maxWidth: 480, margin: "0 auto", paddingBottom: 100, // Espacio para el botón flotante
    }}>
      {toast && <Toast msg={toast} onDone={() => setToast("")} />}

      {/* HEADER Y BUSCADOR */}
      <div style={{
        padding: "20px 18px 12px", position: "sticky", top: 0,
        background: bg, zIndex: 10, borderBottom: `1px solid ${border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
          <div style={{ fontSize: 10, color: muted, letterSpacing: "0.14em", fontWeight: 600 }}>GASTROBAR</div>
          {keysInfo && <span style={{ fontSize: 10, color: "rgba(255,185,0,0.7)" }}>⚠ {keysInfo}</span>}
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#fff", marginBottom: 14 }}>Pide tu canción</div>

        <div style={{
          background: surface2, borderRadius: 12, display: "flex",
          alignItems: "center", gap: 10, padding: "10px 14px", border: `1px solid ${border}`,
        }} onClick={() => inputRef.current?.focus()}>
          {searching
            ? <div style={{ width: 15, height: 15, border: "2px solid rgba(255,255,255,0.2)", borderTopColor: "#1db954", borderRadius: "50%", animation: "spin 0.7s linear infinite", flexShrink: 0 }} />
            : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={muted} strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>
          }
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Artista, canción o álbum..."
            style={{ flex: 1, background: "none", border: "none", outline: "none", color: "#fff", fontSize: 15, fontFamily: "inherit" }}
          />
        </div>
      </div>

      {/* BOTÓN FLOTANTE PARA MENSAJES */}
      <button 
        onClick={() => setShowMsgModal(true)}
        style={{
          position: "fixed", bottom: 20, right: 20, width: 56, height: 56,
          borderRadius: "50%", background: "#1db954", color: "#000",
          border: "none", boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", zIndex: 100, transition: "transform 0.2s"
        }}
        onMouseDown={(e) => e.currentTarget.style.transform = "scale(0.9)"}
        onMouseUp={(e) => e.currentTarget.style.transform = "scale(1)"}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
      </button>

      {/* MODAL DE MENSAJE */}
      {showMsgModal && (
        <div style={{
          position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
          background: "rgba(0,0,0,0.85)", zIndex: 1000, display: "flex",
          alignItems: "center", justifyContent: "center", padding: 20, backdropFilter: "blur(4px)"
        }}>
          <div style={{
            background: surface, width: "100%", maxWidth: 400, boxSizing: "border-box",
            borderRadius: 20, padding: 24, border: `1px solid ${border}`,
            animation: "modalIn 0.3s ease"
          }}>
            <h3 style={{ marginTop: 0, fontSize: 18, color: "#1db954" }}>Enviar saludo a la pantalla</h3>
            
            <input 
              placeholder="Tu nombre (opcional)"
              value={msgAuthor}
              onChange={(e) => setMsgAuthor(e.target.value)}
              style={{
                width: "100%", boxSizing: "border-box", background: bg, border: `1px solid ${border}`,
                padding: "12px", borderRadius: 8, color: "#fff", marginBottom: 12, outline: "none"
              }}
            />
            
            <textarea 
              placeholder="¿Qué quieres decir?"
              value={msgText}
              onChange={(e) => setMsgText(e.target.value)}
              maxLength={100}
              rows={3}
              style={{
                width: "100%", boxSizing: "border-box", background: bg, border: `1px solid ${border}`,
                padding: "12px", borderRadius: 8, color: "#fff", marginBottom: 8,
                outline: "none", resize: "none", fontFamily: "inherit"
              }}
            />
            <div style={{ fontSize: 11, color: muted, textAlign: "right", marginBottom: 20 }}>
              {msgText.length}/100 caracteres
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <button 
                onClick={() => setShowMsgModal(false)}
                style={{ flex: 1, background: "transparent", color: "#fff", border: `1px solid ${border}`, padding: "12px", borderRadius: 30, cursor: "pointer" }}
              >
                Cancelar
              </button>
              <button 
                onClick={handleSendMsg}
                disabled={!msgText.trim() || sendingMsg}
                style={{ 
                  flex: 1, 
                  background: !msgText.trim() || sendingMsg ? muted : "#1db954", 
                  color: "#000", border: "none", padding: "12px", 
                  borderRadius: 30, cursor: "pointer", fontWeight: "bold" 
                }}
              >
                {sendingMsg ? "Enviando..." : "Enviar"}
              </button>
            </div>
          </div>
          <style>{`@keyframes modalIn{from{opacity:0;transform:scale(0.9)}to{opacity:1;transform:scale(1)}}`}</style>
        </div>
      )}

      {/* SONANDO AHORA */}
      <div style={{ margin: "14px 14px 0" }}>
        <div style={{
          background: surface, borderRadius: 14, padding: "12px 14px",
          display: "flex", alignItems: "center", gap: 12,
          border: "1px solid rgba(29,185,84,0.2)",
        }}>
          <img src={currentTrack?.img || MOCK_NOW.img} style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, color: "#1db954", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 2 }}>SONANDO AHORA</div>
            <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {currentTrack?.title || MOCK_NOW.title}
            </div>
            <div style={{ fontSize: 12, color: muted }}>{currentTrack?.artist || MOCK_NOW.artist}</div>
          </div>
          <EqBars />
        </div>
      </div>

      {/* RESULTADOS Y COLA (Igual que antes) */}
      {(query.trim().length >= 3 || searching) && !error && (
        <div style={{ margin: "18px 14px 0" }}>
          <div style={{ fontSize: 10, color: muted2, letterSpacing: "0.12em", fontWeight: 600, marginBottom: 10 }}>
            {searching ? "BUSCANDO EN YOUTUBE..." : `${results.length} RESULTADOS`}
          </div>
          {results.map((track) => (
            <div key={track.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 10px", background: surface, borderRadius: 12, marginBottom: 4, border: `1px solid ${border}` }}>
              <img src={track.img} style={{ width: 46, height: 46, borderRadius: 8, objectFit: "cover" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{track.title}</div>
                <div style={{ fontSize: 11, color: muted }}>{track.artist} · {track.duration}</div>
              </div>
              <button onClick={() => addToQueue(track)} style={{
                width: 34, height: 34, borderRadius: "50%", border: "none",
                background: added.has(track.id) ? "rgba(29,185,84,0.15)" : "#1db954",
                display: "flex", alignItems: "center", justifyContent: "center"
              }}>
                {added.has(track.id) 
                  ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1db954" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  : <svg width="12" height="12" viewBox="0 0 10 10" fill="#000"><polygon points="3,1 9,5 3,9"/></svg>
                }
              </button>
            </div>
          ))}
        </div>
      )}

      {queue.length > 0 && (
        <div style={{ margin: "22px 14px 0" }}>
          <div style={{ fontSize: 10, color: muted2, fontWeight: 600, marginBottom: 10 }}>EN COLA ({queue.length})</div>
          {queue.map((track, i) => (
            <div key={track.id + i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 10px", opacity: i === safeCurrentIdx ? 1 : 0.5 }}>
              <div style={{ width: 22, fontSize: 12, color: i === safeCurrentIdx ? "#1db954" : muted2 }}>{i === safeCurrentIdx ? "▶" : i + 1}</div>
              <img src={track.img} style={{ width: 38, height: 38, borderRadius: 6, objectFit: "cover" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{track.title}</div>
                <div style={{ fontSize: 11, color: muted }}>{track.artist}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}