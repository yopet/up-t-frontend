import React, { useState, useEffect, useRef } from 'react';

// ─── CONFIGURACIÓN DE LLAVES (Lógica de rotación igual a Customer) ───────────
const API_KEYS = [
  import.meta.env.VITE_YT_KEY_1,
  import.meta.env.VITE_YT_KEY_2,
  import.meta.env.VITE_YT_KEY_3,
  import.meta.env.VITE_YT_KEY_4,
  import.meta.env.VITE_YT_KEY_5,
].filter(Boolean);

const EXHAUSTED_KEY = "yt_exhausted_keys";
const EXHAUSTED_UNTIL_KEY = "yt_exhausted_until";

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

// ─── UTILIDADES ──────────────────────────────────────────────────────────────
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

// ─── ICONOS ──────────────────────────────────────────────────────────────────
const IconTrash = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>;
const IconCheck = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"></polyline></svg>;
const IconSearch = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>;
const IconVolume = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>;
const IconTv = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>;

function NewBadge({ track, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4000);
    return () => clearTimeout(t);
  }, [track?.id]);
  if (!track) return null;
  return (
    <div style={{
      position: "fixed", top: 24, right: 24, zIndex: 500,
      background: "rgba(29,185,84,0.12)", border: "1px solid rgba(29,185,84,0.4)",
      backdropFilter: "blur(16px)", borderRadius: "14px",
      padding: "12px 16px", display: "flex", alignItems: "center", gap: 12,
      animation: "badgeIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
      boxShadow: "0 8px 32px rgba(0,0,0,0.5)", maxWidth: 280, color: "#fff"
    }}>
      <img src={track.img} alt="" style={{ width: 42, height: 42, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
      <div>
        <div style={{ fontSize: 10, color: "#1DB954", fontWeight: 700, letterSpacing: "0.12em", marginBottom: 3 }}>♪ NUEVA SOLICITUD</div>
        <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 200 }}>{track.title}</div>
        <div style={{ fontSize: 11, color: "#b3b3b3", marginTop: 1 }}>{track.artist}</div>
      </div>
    </div>
  );
}

export default function AdminView({ 
  queue = [], currentIdx = 0, onRemove, onPlay, onAddSong, onClearQueue, volume = 50, onVolumeChange 
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [approvedIds, setApprovedIds] = useState(new Set());
  const [lastNewTrack, setLastNewTrack] = useState(null);
  const prevQueueLen = useRef(queue.length);
  const [localVol, setLocalVol] = useState(volume);
  const [lastNonZeroVolume, setLastNonZeroVolume] = useState(volume > 0 ? volume : 50);

  useEffect(() => { setLocalVol(volume); }, [volume]);

  useEffect(() => {
    if (queue.length > prevQueueLen.current) {
      setLastNewTrack(queue[queue.length - 1]);
    }
    prevQueueLen.current = queue.length;
  }, [queue]);

  // --- LÓGICA DE BÚSQUEDA CON ROTACIÓN DE KEYS ---
  useEffect(() => {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 3) { 
      setResults([]); setError(""); setSearching(false); return; 
    }

    setSearching(true);
    setError("");
    const ctrl = new AbortController();

    const timeout = setTimeout(async () => {
      const searchWithKey = async (key) => {
        const res = await fetch(
          `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=6&q=${encodeURIComponent(trimmedQuery)}&key=${key}`,
          { signal: ctrl.signal }
        );
        return res.json();
      };

      try {
        let currentKey = getAvailableKey();
        if (!currentKey) {
          setError("Cuota agotada en todas las keys.");
          setSearching(false);
          return;
        }

        let searchData = await searchWithKey(currentKey);

        while (isQuotaError(searchData)) {
          markKeyExhausted(currentKey);
          currentKey = getAvailableKey();
          if (!currentKey) {
            setError("Cuota agotada en todas las keys.");
            setSearching(false);
            return;
          }
          searchData = await searchWithKey(currentKey);
        }

        if (searchData.error) {
          setError(searchData.error.message);
          setSearching(false);
          return;
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
          img: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url,
          duration: durationMap[item.id.videoId] || "",
          youtubeId: item.id.videoId,
        })));

      } catch (e) {
        if (e.name !== "AbortError") setError("Error de conexión");
      } finally {
        setSearching(false);
      }
    }, 600);

    return () => { clearTimeout(timeout); ctrl.abort(); };
  }, [query]);

  const handleVolChange = (e) => {
    const val = parseInt(e.target.value);
    if (val > 0) setLastNonZeroVolume(val);
    setLocalVol(val);
    if (onVolumeChange) onVolumeChange(val);
  };

  const toggleMute = () => {
    if (localVol > 0) {
      setLastNonZeroVolume(localVol);
      handleVolChange({ target: { value: 0 } });
    } else {
      handleVolChange({ target: { value: lastNonZeroVolume } });
    }
  };

  const upcomingVotes = queue.filter((_, idx) => idx > currentIdx);
  const panelStyle = { background: '#181818', borderRadius: '12px', padding: '20px', border: '1px solid #282828' };
  const headerStyle = { fontSize: '13px', color: '#b3b3b3', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '20px', fontWeight: '700' };
  const actionBtn = { border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: '0.2s' };

  return (
    <div className="admin-container" style={{ height: '100vh', overflowY: 'auto', background: '#121212', color: '#fff', fontFamily: 'system-ui, sans-serif', boxSizing: 'border-box' }}>
      
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 30px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '12px', height: '12px', background: '#1DB954', borderRadius: '50%', boxShadow: '0 0 10px #1DB954' }}></div>
          <h1 style={{ fontSize: '22px', fontWeight: '800', margin: 0 }}>UP-T <span style={{ color: '#1DB954' }}>ADMIN</span></h1>
        </div>
        {/* AQUÍ VOLVIÓ: Bogotá • Gastrobar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <div style={{ background: '#282828', padding: '6px 16px', borderRadius: '20px', fontSize: '12px', color: '#b3b3b3', border: '1px solid #333' }}>
            Bogotá • Gastrobar
          </div>
          <button onClick={() => window.open('/tv', '_blank')} style={{ background: '#1DB954', color: '#000', border: 'none', padding: '8px 16px', borderRadius: '20px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <IconTv /> ABRIR TV
          </button>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '30px', padding: '0 30px 30px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
          {/* BUSCADOR */}
          <div style={{ ...panelStyle, border: '1px solid #1DB954' }}>
            <h2 style={{ ...headerStyle, color: '#1DB954' }}>Buscador Maestro</h2>
            <div style={{ display: 'flex', background: '#282828', padding: '12px 18px', borderRadius: '30px', alignItems: 'center', gap: '12px' }}>
              <IconSearch />
              <input 
                value={query} onChange={(e) => setQuery(e.target.value)} 
                placeholder="Escribe el nombre de la canción..." 
                style={{ flex: 1, background: 'none', border: 'none', color: '#fff', outline: 'none', fontSize: '15px' }} 
              />
              {query && (
                <button onClick={() => { setQuery(""); setResults([]); }}
                  style={{ background: "none", border: "none", color: '#b3b3b3', cursor: "pointer", padding: 0, fontSize: 16, lineHeight: 1 }}>✕</button>
              )}
              {searching && <div className="spinner" />}
            </div>

            {/* NUEVO: Mensaje de ayuda visual para los 3 caracteres */}
            {query.trim().length > 0 && query.trim().length < 3 && (
              <div style={{ fontSize: '11px', color: '#1DB954', marginTop: '8px', paddingLeft: '18px', opacity: 0.8 }}>
                Escribe al menos 3 letras para buscar...
              </div>
            )}

            {error && <div style={{ color: '#ff4444', fontSize: '12px', marginTop: '10px' }}>⚠ {error}</div>}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: results.length ? '20px' : '0' }}>
              {results.map((track) => (
                <div key={track.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px', background: '#282828', borderRadius: '8px' }}>
                  <img src={track.img} style={{ width: '40px', height: '40px', borderRadius: '4px', objectFit: 'cover' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '12px', fontWeight: '700', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.title}</div>
                    <div style={{ fontSize: '10px', color: '#b3b3b3' }}>{track.artist}</div>
                  </div>
                  <button onClick={() => { onAddSong(track); setQuery(""); setResults([]); }} style={{ ...actionBtn, background: '#1DB954', color: '#000' }}>+</button>
                </div>
              ))}
            </div>
          </div>

          {/* COLA DE REPRODUCCIÓN */}
          <div style={panelStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
              <h2 style={headerStyle}>Cola de Reproducción ({queue.length})</h2>
              {queue.length > 0 && (
                <button onClick={() => window.confirm("¿Vaciar lista?") && onClearQueue()} style={{ background: 'transparent', border: '1px solid #ff4444', color: '#ff4444', padding: '6px 12px', borderRadius: '20px', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}>VACIAR LISTA</button>
              )}
            </div>
            {queue.map((song, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '15px', padding: '12px 0', borderBottom: '1px solid #282828', background: idx === currentIdx ? '#1db95408' : 'transparent' }}>
                <div style={{ width: '25px', fontSize: '12px', color: idx === currentIdx ? '#1DB954' : '#555', fontWeight: 'bold' }}>{idx === currentIdx ? '▶' : idx + 1}</div>
                <img src={song.img} style={{ width: '40px', height: '40px', borderRadius: '4px' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: '600', fontSize: '14px', color: idx === currentIdx ? '#1DB954' : '#fff' }}>{song.title}</div>
                  <div style={{ color: '#b3b3b3', fontSize: '12px' }}>{song.artist}</div>
                </div>
                {idx !== currentIdx && <button onClick={() => onPlay(idx)} style={{ background: 'transparent', border: '1px solid #444', color: '#aaa', padding: '5px 12px', borderRadius: '15px', fontSize: '10px', cursor: 'pointer' }}>SONAR YA</button>}
                <button onClick={() => onRemove(idx)} style={{ ...actionBtn, background: 'transparent', color: '#ff4444' }}><IconTrash /></button>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
          <div style={{ ...panelStyle, padding: 0, overflow: 'hidden' }}>
            <div style={{ background: '#000', aspectRatio: '16/9', position: 'relative' }}>
              {queue[currentIdx] ? (
                <>
                  <img src={queue[currentIdx].img} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.4 }} />
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
                      <div style={{ fontWeight: 'bold', padding: '0 10px' }}>{queue[currentIdx].title}</div>
                      <div style={{ fontSize: '12px', color: '#1DB954' }}>{queue[currentIdx].artist}</div>
                  </div>
                </>
              ) : <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444' }}>ESPERANDO SELECCIÓN...</div>}
            </div>
            <div style={{ padding: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                    <div onClick={toggleMute} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', color: localVol === 0 ? '#ff4444' : '#b3b3b3' }}>
                        <IconVolume /> {localVol === 0 ? 'SILENCIADO' : 'VOLUMEN'}
                    </div>
                    <span style={{ color: '#1DB954', fontWeight: 'bold' }}>{localVol}%</span>
                </div>
                <input type="range" min="0" max="100" value={localVol} onChange={handleVolChange} style={{ width: '100%', accentColor: '#1DB954', cursor: 'pointer' }} />
            </div>
          </div>

          <div style={{ ...panelStyle, background: '#121212', border: '1px solid #333' }}>
            <h2 style={headerStyle}>Solicitudes de Clientes</h2>
            {upcomingVotes.length === 0 ? <p style={{ fontSize: '12px', color: '#555', textAlign: 'center' }}>No hay pedidos nuevos</p> : 
              upcomingVotes.map((song, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', padding: '10px', background: '#1c1c1c', borderRadius: '8px' }}>
                  <img src={song.img} style={{ width: '32px', height: '32px', borderRadius: '4px' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '11px', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{song.title}</div>
                  </div>
                  {!approvedIds.has(song.id) ? (
                    <div style={{ display: 'flex', gap: '5px' }}>
                      <button onClick={() => setApprovedIds(new Set([...approvedIds, song.id]))} style={{ ...actionBtn, width: 28, height: 28, background: '#1DB954' }}><IconCheck /></button>
                      <button onClick={() => onRemove(queue.indexOf(song))} style={{ ...actionBtn, width: 28, height: 28, background: 'transparent', color: '#ff4444' }}><IconTrash /></button>
                    </div>
                  ) : <div style={{ color: '#1DB954' }}><IconCheck /></div>}
                </div>
              ))
            }
          </div>
        </div>
      </div>

      {lastNewTrack && <NewBadge track={lastNewTrack} onDone={() => setLastNewTrack(null)} />}

      <style>{`
        .spinner { width: 14px; height: 14px; border: 2px solid #333; border-top-color: #1DB954; border-radius: 50%; animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes badgeIn { from { opacity: 0; transform: translateY(-12px); } to { opacity: 1; transform: translateY(0); } }
        @media (max-width: 850px) {
          header { flex-direction: column; gap: 15px; }
          div[style*="grid-template-columns"] { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}