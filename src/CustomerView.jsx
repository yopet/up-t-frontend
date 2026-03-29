import { useState, useEffect, useRef } from "react";

// ─── CONFIG ─────────────────────────────────────────────────────────────────
// Pega aquí tu clave de YouTube Data API v3, o ingrésala en pantalla
const DEFAULT_API_KEY = "";
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_NOW = {
  title: "Neon Afterglow",
  artist: "Synthwave Dreams",
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
        <div
          key={i}
          style={{
            width: 3,
            background: "#1db954",
            borderRadius: 2,
            animation: `eq${i} ${0.45 + i * 0.15}s ease-in-out infinite alternate`,
          }}
        />
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
      position: "fixed", bottom: 90, left: "50%",
      transform: "translateX(-50%)",
      background: "#1db954", color: "#000", fontWeight: 700, fontSize: 13,
      padding: "10px 22px", borderRadius: 50, whiteSpace: "nowrap",
      boxShadow: "0 4px 20px rgba(0,0,0,0.5)", zIndex: 999,
      animation: "toastIn 0.25s ease",
      fontFamily: "system-ui, sans-serif",
    }}>
      {msg}
      <style>{`@keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}`}</style>
    </div>
  );
}

function ApiKeySetup({ onSave }) {
  const [val, setVal] = useState("");
  return (
    <div style={{
      minHeight: "100vh", background: "#0a0a0a", display: "flex",
      flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "0 24px", fontFamily: "system-ui, sans-serif", color: "#fff",
    }}>
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#1db954" strokeWidth="1.5" strokeLinecap="round" style={{ marginBottom: 20 }}>
        <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
      </svg>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Configura DomiLite</div>
      <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 28, textAlign: "center", lineHeight: 1.6 }}>
        Para buscar en YouTube Music necesitas<br />una YouTube Data API v3 Key
      </div>
      <div style={{
        width: "100%", maxWidth: 380, background: "#1c1c1c",
        borderRadius: 14, padding: "14px 16px",
        border: "1px solid rgba(255,255,255,0.08)",
        display: "flex", alignItems: "center", gap: 10, marginBottom: 12,
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2.5" strokeLinecap="round">
          <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="AIza..."
          type="password"
          style={{
            flex: 1, background: "none", border: "none", outline: "none",
            color: "#fff", fontSize: 14, fontFamily: "monospace",
          }}
        />
      </div>
      <button
        onClick={() => val.trim() && onSave(val.trim())}
        style={{
          width: "100%", maxWidth: 380, padding: "14px", borderRadius: 14,
          background: val.trim() ? "#1db954" : "rgba(29,185,84,0.25)",
          border: "none", color: val.trim() ? "#000" : "rgba(255,255,255,0.3)",
          fontWeight: 700, fontSize: 15, cursor: val.trim() ? "pointer" : "default",
          transition: "all 0.2s", fontFamily: "system-ui, sans-serif",
        }}
      >
        Guardar y continuar
      </button>
      <a
        href="https://console.cloud.google.com/apis/library/youtube.googleapis.com"
        target="_blank"
        rel="noreferrer"
        style={{ marginTop: 20, fontSize: 12, color: "rgba(255,255,255,0.3)", textDecoration: "underline" }}
      >
        ¿Cómo obtener mi API Key?
      </a>
    </div>
  );
}

export default function CustomerView({ onSongRequest, queue = [], currentIdx = 0 }) {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("yt_api_key") || DEFAULT_API_KEY);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [toast, setToast] = useState("");
  const [searching, setSearching] = useState(false);
  const [added, setAdded] = useState(new Set());
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  const safeCurrentIdx = Math.min(Math.max(0, currentIdx), Math.max(0, queue.length - 1));
  const currentTrack = queue[safeCurrentIdx] || null;

  const saveKey = (key) => {
    localStorage.setItem("yt_api_key", key);
    setApiKey(key);
  };

  useEffect(() => {
    setAdded(new Set(queue.map((song) => song.id)));
  }, [queue]);

  // Búsqueda YouTube
  useEffect(() => {
    if (!query.trim()) { setResults([]); setError(""); return; }
    setSearching(true);
    setError("");

    const ctrl = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        // 1. Buscar videos (categoría 10 = música)
        const searchRes = await fetch(
          `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=8&q=${encodeURIComponent(query)}&key=${apiKey}`,
          { signal: ctrl.signal }
        );
        const searchData = await searchRes.json();

        if (searchData.error) {
          setError(searchData.error.message || "Error de API");
          setSearching(false);
          return;
        }

        const items = searchData.items || [];
        if (!items.length) { setResults([]); setSearching(false); return; }

        // 2. Obtener duraciones
        const videoIds = items.map((i) => i.id.videoId).join(",");
        const detailRes = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${videoIds}&key=${apiKey}`,
          { signal: ctrl.signal }
        );
        const detailData = await detailRes.json();
        const durationMap = {};
        (detailData.items || []).forEach((v) => {
          durationMap[v.id] = formatDuration(v.contentDetails.duration);
        });

        // 3. Mapear resultados
        const tracks = items.map((item) => ({
          id: item.id.videoId,
          title: item.snippet.title,
          artist: item.snippet.channelTitle.replace(/ - Topic$| Music$/i, ""),
          img: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url,
          duration: durationMap[item.id.videoId] || "",
          videoId: item.id.videoId,
        }));

        setResults(tracks);
      } catch (e) {
        if (e.name !== "AbortError") setError("No se pudo conectar con YouTube");
      } finally {
        setSearching(false);
      }
    }, 450);

    return () => { clearTimeout(timeout); ctrl.abort(); };
  }, [query, apiKey]);

  const addToQueue = (track) => {
    if (added.has(track.id)) return;
    if (onSongRequest) onSongRequest(track);
    setAdded((s) => new Set([...s, track.id]));
    setToast(`"${track.title}" agregada a la cola`);
    // TODO: supabase.from('queue').insert({ ...track, table_id: TABLE_ID })
  };

  const bg = "#0a0a0a";
  const surface = "#161616";
  const surface2 = "#1c1c1c";
  const border = "rgba(255,255,255,0.07)";
  const muted = "rgba(255,255,255,0.35)";
  const muted2 = "rgba(255,255,255,0.18)";

  if (!apiKey) return <ApiKeySetup onSave={saveKey} />;

  return (
    <div style={{
      background: bg, minHeight: "100vh", color: "#fff",
      fontFamily: "system-ui, -apple-system, sans-serif",
      maxWidth: 480, margin: "0 auto", paddingBottom: 32,
    }}>
      {toast && <Toast msg={toast} onDone={() => setToast("")} />}

      {/* Header */}
      <div style={{
        padding: "20px 18px 12px", position: "sticky", top: 0,
        background: bg, zIndex: 10, borderBottom: `1px solid ${border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
          <div style={{ fontSize: 10, color: muted, letterSpacing: "0.14em", fontWeight: 600 }}>GASTROBAR DOMILITE</div>
          <button
            onClick={() => { localStorage.removeItem("yt_api_key"); setApiKey(""); }}
            style={{ background: "none", border: "none", color: muted2, fontSize: 10, cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.08em" }}
          >
            API KEY ✕
          </button>
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#fff", marginBottom: 14 }}>Pide tu canción</div>

        {/* Search */}
        <div
          style={{
            background: surface2, borderRadius: 12, display: "flex",
            alignItems: "center", gap: 10, padding: "10px 14px",
            border: `1px solid ${border}`,
          }}
          onClick={() => inputRef.current?.focus()}
        >
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
          {query && (
            <button onClick={() => { setQuery(""); setResults([]); }}
              style={{ background: "none", border: "none", color: muted, cursor: "pointer", padding: 0, fontSize: 16, lineHeight: 1 }}>✕
            </button>
          )}
        </div>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>

      {/* Now Playing */}
      <div style={{ margin: "14px 14px 0" }}>
        <div style={{
          background: surface, borderRadius: 14, padding: "12px 14px",
          display: "flex", alignItems: "center", gap: 12,
          border: "1px solid rgba(29,185,84,0.2)",
        }}>
          <img
            src={currentTrack?.img || MOCK_NOW.img}
            alt=""
            style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover", flexShrink: 0 }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, color: "#1db954", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 2 }}>
              SONANDO AHORA
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {currentTrack?.title || MOCK_NOW.title}
            </div>
            <div style={{ fontSize: 12, color: muted }}>
              {currentTrack?.artist || MOCK_NOW.artist}
            </div>
          </div>
          <EqBars />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ margin: "14px 14px 0", padding: "12px 14px", background: "rgba(255,60,60,0.08)", border: "1px solid rgba(255,60,60,0.2)", borderRadius: 12, fontSize: 13, color: "#ff6b6b" }}>
          ⚠ {error}
        </div>
      )}

      {/* Results */}
      {(query.trim() || searching) && !error && (
        <div style={{ margin: "18px 14px 0" }}>
          <div style={{ fontSize: 10, color: muted2, letterSpacing: "0.12em", fontWeight: 600, marginBottom: 10, paddingLeft: 4 }}>
            {searching ? "BUSCANDO EN YOUTUBE..." : results.length > 0 ? `${results.length} RESULTADOS` : "SIN RESULTADOS"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {results.map((track) => {
              const isAdded = added.has(track.id);
              return (
                <div key={track.id} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "9px 10px", background: surface, borderRadius: 12,
                  border: `1px solid ${border}`,
                }}>
                  <img src={track.img} alt="" style={{ width: 46, height: 46, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{track.title}</div>
                    <div style={{ fontSize: 11, color: muted, marginTop: 1 }}>{track.artist}{track.duration ? ` · ${track.duration}` : ""}</div>
                  </div>
                  <button
                    onClick={() => addToQueue(track)}
                    style={{
                      width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
                      cursor: isAdded ? "default" : "pointer", border: "none",
                      background: isAdded ? "rgba(29,185,84,0.15)" : "#1db954",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      transition: "background 0.2s, transform 0.1s",
                    }}
                    onMouseDown={(e) => !isAdded && (e.currentTarget.style.transform = "scale(0.92)")}
                    onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
                  >
                    {isAdded
                      ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1db954" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                      : <svg width="12" height="12" viewBox="0 0 10 10" fill="#000"><polygon points="3,1 9,5 3,9"/></svg>
                    }
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Queue */}
      {queue.length > 0 && (
        <div style={{ margin: "22px 14px 0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, paddingLeft: 4 }}>
            <span style={{ fontSize: 10, color: muted2, letterSpacing: "0.12em", fontWeight: 600 }}>EN COLA</span>
            <span style={{ fontSize: 11, color: muted2 }}>{queue.length} {queue.length === 1 ? "canción" : "canciones"}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: "28rem", overflowY: "auto", paddingRight: 4 }}>
            {queue.map((track, i) => (
              <div key={track.id + i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 10px", borderRadius: 12, opacity: 0.65 }}>
                <div style={{ width: 22, textAlign: "center", fontSize: 12, color: muted2, fontFamily: "monospace", flexShrink: 0 }}>{i + 1}</div>
                <img src={track.img} alt="" style={{ width: 38, height: 38, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{track.title}</div>
                  <div style={{ fontSize: 11, color: muted, marginTop: 1 }}>{track.artist}</div>
                </div>
                {track.duration && <div style={{ fontSize: 11, color: muted2, fontFamily: "monospace", flexShrink: 0 }}>{track.duration}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty */}
      {!query && queue.length === 0 && !error && (
        <div style={{ textAlign: "center", padding: "3rem 2rem", color: muted }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={muted} strokeWidth="1.5" strokeLinecap="round" style={{ marginBottom: 12 }}>
            <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
          </svg>
          <div style={{ fontSize: 15, fontWeight: 500, color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>¿Qué quieres escuchar?</div>
          <div style={{ fontSize: 13 }}>Busca una canción y agrégala a la cola</div>
        </div>
      )}
    </div>
  );
}