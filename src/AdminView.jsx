import React, { useState, useEffect, useRef } from 'react';
import { supabase } from "./lib/supabase";

// ─── CONFIGURACIÓN DE LLAVES YOUTUBE ────────────────────────────────────────
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
const IconAd = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
);const IconPlaySmall = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>;
const IconMessage = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>;

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
  queue = [], currentIdx = 0, onRemove, onPlay, onAddSong, onClearQueue, onApprove, autoPlay, onToggleAutoPlay, volume = 50, onVolumeChange,
  ads = [], onAddAd, onRemoveAd, onApproveMessage
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [lastNewTrack, setLastNewTrack] = useState(null);
  const prevQueueLen = useRef(queue.length);
  const [localVol, setLocalVol] = useState(volume);
  const [lastNonZeroVolume, setLastNonZeroVolume] = useState(volume > 0 ? volume : 50);

  // Estados para Publicidad y Mensajes
  const [showAdModal, setShowAdModal] = useState(false);
  const [newAd, setNewAd] = useState({ title: '', image_url: '', frequency: 3 });
  const [screenMessages, setScreenMessages] = useState([]);

  useEffect(() => { setLocalVol(volume); }, [volume]);

  // ─── LÓGICA DE MENSAJES EN TIEMPO REAL ────────────────────────────────────
  useEffect(() => {
    if (!supabase) return;

    const fetchMessages = async () => {
      const { data } = await supabase
        .from('screen_messages')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (data) setScreenMessages(data);
    };

    fetchMessages();

    const channel = supabase
      .channel('admin-messages-panel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'screen_messages' }, (payload) => {
        setScreenMessages(prev => [payload.new, ...prev]);
        // Notificación sonora para nuevo mensaje
        const audio = new Audio("https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3");
        audio.volume = 0.2;
        audio.play().catch(() => {});
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  const handleMessageAction = async (id, newStatus) => {
    const msg = screenMessages.find(m => m.id === id);
    setScreenMessages(prev => prev.filter(m => m.id !== id));
    if (supabase) {
      await supabase.from('screen_messages').update({ status: newStatus }).eq('id', id);
      if (newStatus === 'approved' && msg && onApproveMessage) {
        onApproveMessage(msg);
      }
    }
  };

  // NOTIFICACIÓN SONORA Y BADGE (Canciones)
  useEffect(() => {
    if (queue.length > prevQueueLen.current) {
      setLastNewTrack(queue[queue.length - 1]);
      const audio = new Audio("https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3");
      audio.volume = 0.4;
      audio.play().catch(() => {});
    }
    prevQueueLen.current = queue.length;
  }, [queue]);

  // --- LÓGICA DE BÚSQUEDA ---
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
          setError("Cuota agotada.");
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

  const approvedQueue = queue.filter(s => s.isApproved);
  const pendingRequests = queue.filter(s => !s.isApproved);
  
  const panelStyle = { background: '#181818', borderRadius: '12px', padding: '20px', border: '1px solid #282828' };
  const headerStyle = { fontSize: '11px', color: '#b3b3b3', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '15px', fontWeight: '700' };
  const actionBtn = { border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: '0.2s' };

  return (
    <div className="admin-container" style={{ height: '100vh', overflowY: 'auto', background: '#121212', color: '#fff', fontFamily: 'system-ui, sans-serif', boxSizing: 'border-box' }}>
      
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 30px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '12px', height: '12px', background: '#1DB954', borderRadius: '50%', boxShadow: '0 0 10px #1DB954' }}></div>
          <h1 style={{ fontSize: '22px', fontWeight: '800', margin: 0 }}>UP-T <span style={{ color: '#1DB954' }}>ADMIN</span></h1>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: '#1a1a1a', padding: '8px 16px', borderRadius: '30px', border: '1px solid #333' }}>
          <span style={{ fontSize: '11px', fontWeight: '700', color: autoPlay ? '#1DB954' : '#888' }}>
            {autoPlay ? 'AUTO-PLAY ON' : 'MODERACIÓN ACTIVADA'}
          </span>
          <div 
            onClick={() => onToggleAutoPlay(!autoPlay)}
            style={{ width: '36px', height: '18px', background: autoPlay ? '#1DB954' : '#444', borderRadius: '20px', position: 'relative', cursor: 'pointer', transition: '0.3s' }}
          >
            <div style={{ width: '14px', height: '14px', background: '#fff', borderRadius: '50%', position: 'absolute', top: '2px', left: autoPlay ? '20px' : '2px', transition: '0.3s' }} />
          </div>          
        </div>        

        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <div style={{ background: '#282828', padding: '6px 16px', borderRadius: '20px', fontSize: '12px', color: '#b3b3b3', border: '1px solid #333' }}>
            Bogotá • Gastrobar
          </div>
          <button onClick={() => window.open('/tvVideo', '_blank')} style={{ background: '#1DB954', color: '#000', border: 'none', padding: '8px 16px', borderRadius: '20px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <IconTv /> ABRIR TV
          </button>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '260px 2fr 1.2fr', gap: '20px', padding: '0 30px 30px' }}>
        
        {/* COLUMNA 1: ADS Y MENSAJES */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* SECCIÓN PUBLICIDAD */}
          <div style={{ ...panelStyle, borderColor: '#333' }}>
            <h2 style={{ ...headerStyle, color: '#1DB954', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <IconAd /> Publicidad (Ads)
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {ads.length === 0 ? (
                <div style={{ fontSize: '11px', color: '#555', textAlign: 'center', padding: '20px' }}>No hay anuncios activos</div>
              ) : ads.map(ad => (
                <div key={ad.id} style={{ background: '#222', borderRadius: '8px', padding: '10px', border: '1px solid #333' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <img src={ad.image_url} style={{ width: '35px', height: '35px', borderRadius: '4px', objectFit: 'cover' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '11px', fontWeight: '700', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ad.title}</div>
                      <div style={{ fontSize: '10px', color: '#1DB954' }}>x {ad.frequency} Temas</div>
                    </div>
                    <button onClick={() => onRemoveAd(ad.id)} style={{ ...actionBtn, width: 24, height: 24, background: 'transparent', color: '#ff4444', opacity: 0.6 }}><IconTrash /></button>
                  </div>
                </div>
              ))}
              <button 
                onClick={() => setShowAdModal(true)}
                style={{ width: '100%', padding: '10px', background: 'transparent', border: '1px dashed #1DB954', color: '#1DB954', borderRadius: '8px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', marginTop: '10px' }}
              >
                + AGREGAR ANUNCIO
              </button>
            </div>
          </div>

          {/* SECCIÓN MENSAJES (Insertada debajo de publicidad) */}
          <div style={{ ...panelStyle, border: '1px solid #333' }}>
            <h2 style={{ ...headerStyle, color: '#1DB954', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><IconMessage /> MENSAJES</span>
              <span style={{ background: '#1DB954', color: '#000', padding: '2px 6px', borderRadius: '4px', fontSize: '10px' }}>{screenMessages.length}</span>
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '350px', overflowY: 'auto' }}>
              {screenMessages.length === 0 ? (
                <div style={{ fontSize: '11px', color: '#555', textAlign: 'center', padding: '20px' }}>Sin mensajes nuevos</div>
              ) : screenMessages.map(msg => (
                <div key={msg.id} style={{ background: '#222', borderRadius: '10px', padding: '12px', border: '1px solid #333', borderLeft: '3px solid #1DB954' }}>
                  <div style={{ fontSize: '13px', marginBottom: '8px', fontStyle: 'italic', color: '#eee' }}>"{msg.text}"</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '10px', color: '#1DB954', fontWeight: 'bold' }}>{msg.author || 'Anon'}</span>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button onClick={() => handleMessageAction(msg.id, 'approved')} style={{ ...actionBtn, width: 26, height: 26, background: '#1DB954', color: '#000' }}><IconCheck /></button>
                      <button onClick={() => handleMessageAction(msg.id, 'rejected')} style={{ ...actionBtn, width: 26, height: 26, background: 'transparent', color: '#ff4444' }}><IconTrash /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* COLUMNA 2: BUSCADOR Y COLA REPRODUCCIÓN */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ ...panelStyle, border: '1px solid #1DB954' }}>
            <h2 style={{ ...headerStyle, color: '#1DB954' }}>Buscador Maestro</h2>
            <div style={{ display: 'flex', background: '#282828', padding: '10px 18px', borderRadius: '30px', alignItems: 'center', gap: '12px' }}>
              <IconSearch />
              <input 
                value={query} onChange={(e) => setQuery(e.target.value)} 
                placeholder="Escribe el nombre de la canción..." 
                style={{ flex: 1, background: 'none', border: 'none', color: '#fff', outline: 'none', fontSize: '14px' }} 
              />
              {query && <button onClick={() => { setQuery(""); setResults([]); }} style={{ background: "none", border: "none", color: '#b3b3b3', cursor: "pointer", fontSize: 16 }}>✕</button>}
              {searching && <div className="spinner" />}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: results.length ? '15px' : '0' }}>
              {results.map((track) => (
                <div key={track.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px', background: '#282828', borderRadius: '8px' }}>
                  <img src={track.img} style={{ width: '35px', height: '35px', borderRadius: '4px', objectFit: 'cover' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '11px', fontWeight: '700', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.title}</div>
                    <div style={{ fontSize: '9px', color: '#b3b3b3' }}>{track.artist}</div>
                  </div>
                  <button onClick={() => { onAddSong(track); setQuery(""); setResults([]); }} style={{ ...actionBtn, background: '#1DB954', color: '#000', width: 28, height: 28 }}>+</button>
                </div>
              ))}
            </div>
          </div>

          <div style={panelStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
              <h2 style={headerStyle}>Cola de Reproducción ({approvedQueue.length})</h2>
              {queue.length > 0 && (
                <button 
                  onClick={() => window.confirm("¿Vaciar todas las canciones?") && onClearQueue()} 
                  style={{ background: 'transparent', border: '1px solid #ff4444', color: '#ff4444', padding: '4px 10px', borderRadius: '20px', fontSize: '10px', fontWeight: '700', cursor: 'pointer' }}
                >
                  VACIAR LISTA
                </button>
              )}
            </div>
            {approvedQueue.map((song, idx) => (
              <div key={song.queueRowId} style={{ display: 'flex', alignItems: 'center', gap: '15px', padding: '10px 0', borderBottom: '1px solid #282828', background: idx === currentIdx ? '#1db95408' : 'transparent' }}>
                <div style={{ width: '20px', fontSize: '11px', color: idx === currentIdx ? '#1DB954' : '#555', fontWeight: 'bold' }}>{idx === currentIdx ? '▶' : idx + 1}</div>
                <img src={song.img} style={{ width: '35px', height: '35px', borderRadius: '4px' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: '600', fontSize: '13px', color: idx === currentIdx ? '#1DB954' : '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{song.title}</div>
                  <div style={{ color: '#b3b3b3', fontSize: '11px' }}>{song.artist}</div>
                </div>
                
                <div style={{ display: 'flex', gap: '6px' }}>
                    <button onClick={() => onPlay(idx)} style={{ ...actionBtn, background: '#282828', color: '#1DB954', width: 28, height: 28 }}><IconPlaySmall /></button>
                    <button onClick={() => onRemove(queue.indexOf(song))} style={{ ...actionBtn, background: 'transparent', color: '#ff4444', width: 28, height: 28 }}><IconTrash /></button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* COLUMNA 3: PREVIEW Y PENDIENTES */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ ...panelStyle, padding: 0, overflow: 'hidden' }}>
            <div style={{ background: '#000', aspectRatio: '16/9', position: 'relative' }}>
              {queue[currentIdx] ? (
                <>
                  <img src={queue[currentIdx].img} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.4 }} />
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
                      <div style={{ fontWeight: 'bold', padding: '0 10px', fontSize: '13px' }}>{queue[currentIdx].title}</div>
                      <div style={{ fontSize: '11px', color: '#1DB954' }}>{queue[currentIdx].artist}</div>
                  </div>
                </>
              ) : <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', fontSize: '11px' }}>ESPERANDO...</div>}
            </div>
            <div style={{ padding: '15px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <div onClick={toggleMute} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, cursor: 'pointer', color: localVol === 0 ? '#ff4444' : '#b3b3b3' }}>
                        <IconVolume /> {localVol === 0 ? 'MUTE' : 'VOL'}
                    </div>
                    <span style={{ color: '#1DB954', fontWeight: 'bold', fontSize: '11px' }}>{localVol}%</span>
                </div>
                <input type="range" min="0" max="100" value={localVol} onChange={handleVolChange} style={{ width: '100%', accentColor: '#1DB954' }} />
            </div>
          </div>

          <div style={{ ...panelStyle, background: '#121212', border: '1px solid #333' }}>
            <h2 style={headerStyle}>Pendientes ({pendingRequests.length})</h2>
            {pendingRequests.map((song) => (
              <div key={song.queueRowId} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', padding: '8px', background: '#1c1c1c', borderRadius: '8px' }}>
                <div style={{ flex: 1, minWidth: 0, fontSize: '10px', fontWeight: 'bold' }}>{song.title}</div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button onClick={() => onApprove(song.queueRowId)} style={{ ...actionBtn, width: 26, height: 26, background: '#1DB954' }}><IconCheck /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* MODAL AD */}
      {showAdModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, backdropFilter: 'blur(8px)' }}>
          <div style={{ ...panelStyle, width: '100%', maxWidth: '400px', boxSizing: 'border-box', border: '1px solid #1DB954', padding: '25px' }}>
            <h2 style={{ ...headerStyle, color: '#1DB954', fontSize: '14px' }}>Configurar Nueva Pauta</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div>
                <label style={{ fontSize: '11px', color: '#888' }}>Nombre de la Marca</label>
                <input type="text" placeholder="Ej: Heineken" style={{ width: '100%', boxSizing: 'border-box', background: '#282828', border: 'none', padding: '12px', borderRadius: '8px', color: '#fff', marginTop: '5px' }}
                  onChange={(e) => setNewAd({...newAd, title: e.target.value})} />
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#888' }}>URL de Imagen</label>
                <input type="text" placeholder="https://..." style={{ width: '100%', boxSizing: 'border-box', background: '#282828', border: 'none', padding: '12px', borderRadius: '8px', color: '#fff', marginTop: '5px' }}
                  onChange={(e) => setNewAd({...newAd, image_url: e.target.value})} />
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#888' }}>Frecuencia de Reproducción</label>
                <select style={{ width: '100%', boxSizing: 'border-box', background: '#282828', border: 'none', padding: '12px', borderRadius: '8px', color: '#fff', marginTop: '5px' }}
                  onChange={(e) => setNewAd({...newAd, frequency: parseInt(e.target.value)})}>
                  <option value="2">Cada 2 canciones</option>
                  <option value="3">Cada 3 canciones</option>
                  <option value="5">Cada 5 canciones</option>
                  <option value="10">Cada 10 canciones</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button onClick={() => setShowAdModal(false)} style={{ flex: 1, padding: '12px', borderRadius: '30px', background: 'transparent', border: '1px solid #444', color: '#eee', cursor: 'pointer' }}>Cancelar</button>
                <button onClick={() => { onAddAd?.(newAd); setShowAdModal(false); }} style={{ flex: 1, padding: '12px', borderRadius: '30px', background: '#1DB954', border: 'none', color: '#000', fontWeight: '700', cursor: 'pointer' }}>Guardar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {lastNewTrack && <NewBadge track={lastNewTrack} onDone={() => setLastNewTrack(null)} />}

      <style>{`
        .spinner { width: 14px; height: 14px; border: 2px solid #333; border-top-color: #1DB954; border-radius: 50%; animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes badgeIn { from { opacity: 0; transform: translateY(-12px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}