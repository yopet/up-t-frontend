import React, { useState, useEffect, useRef } from 'react';

// ─── CONFIGURACIÓN DE LLAVES (Rotación Automática) ──────────────────────────
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
  return data?.error?.code === 403 && (
    data?.error?.message?.toLowerCase().includes("quota") ||
    data?.error?.errors?.[0]?.reason === "quotaExceeded"
  );
}

// ─── UTILIDADES E ICONOS ─────────────────────────────────────────────────────
function formatDuration(iso) {
  if (!iso) return "";
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return "";
  const h = parseInt(match[1] || 0), m = parseInt(match[2] || 0), s = parseInt(match[3] || 0);
  const mm = String(m).padStart(h ? 2 : 1, "0"), ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const IconTrash = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>;
const IconCheck = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"></polyline></svg>;
const IconSearch = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>;
const IconVolume = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>;
const IconTv = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>;

export default function AdminView({ 
  queue = [], currentIdx = 0, onRemove, onPlay, onAddSong, onClearQueue, volume = 50, onVolumeChange 
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [approvedIds, setApprovedIds] = useState(new Set());
  const [localVol, setLocalVol] = useState(volume);
  const prevQueueLen = useRef(queue.length);

  useEffect(() => { setLocalVol(volume); }, [volume]);

  // --- BÚSQUEDA MAESTRA CON ROTACIÓN ---
  useEffect(() => {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 3) { setResults([]); setError(""); return; }
    setSearching(true); setError("");
    const ctrl = new AbortController();

    const timeout = setTimeout(async () => {
      const searchFetch = async (key) => {
        const res = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=6&q=${encodeURIComponent(trimmedQuery)}&key=${key}`, { signal: ctrl.signal });
        return res.json();
      };

      try {
        let key = getAvailableKey();
        if (!key) { setError("Límite diario alcanzado"); setSearching(false); return; }

        let data = await searchFetch(key);
        while (isQuotaError(data)) {
          markKeyExhausted(key);
          key = getAvailableKey();
          if (!key) { setError("Límite diario alcanzado"); setSearching(false); return; }
          data = await searchFetch(key);
        }

        if (data.error) throw new Error(data.error.message);

        const items = data.items || [];
        const vIds = items.map(i => i.id.videoId).join(",");
        const dRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${vIds}&key=${key}`, { signal: ctrl.signal });
        const dData = await dRes.json();
        const dMap = {};
        (dData.items || []).forEach(v => dMap[v.id] = formatDuration(v.contentDetails.duration));

        setResults(items.map(i => ({
          id: i.id.videoId,
          title: i.snippet.title,
          artist: i.snippet.channelTitle.replace(/ - Topic$| Music$/i, ""),
          img: i.snippet.thumbnails.medium?.url,
          duration: dMap[i.id.videoId] || "",
          youtubeId: i.id.videoId,
        })));
      } catch (e) { if (e.name !== "AbortError") setError("Error de conexión"); }
      finally { setSearching(false); }
    }, 600);
    return () => { clearTimeout(timeout); ctrl.abort(); };
  }, [query]);

  const panelStyle = { background: '#181818', borderRadius: '12px', padding: '20px', border: '1px solid #282828' };
  const headerStyle = { fontSize: '13px', color: '#b3b3b3', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '20px', fontWeight: '700' };

  return (
    <div style={{ height: '100vh', overflowY: 'auto', background: '#121212', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 30px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '800', margin: 0 }}>UP-T <span style={{ color: '#1DB954' }}>ADMIN</span></h1>
        
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
          <div style={{ ...panelStyle, border: '1px solid #1DB954' }}>
            <h2 style={{ ...headerStyle, color: '#1DB954' }}>BUSCADOR MAESTRO</h2>
            <div style={{ display: 'flex', background: '#282828', padding: '12px 18px', borderRadius: '30px', alignItems: 'center', gap: '12px' }}>
              <IconSearch />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Busca canciones..." style={{ flex: 1, background: 'none', border: 'none', color: '#fff', outline: 'none' }} />
              {searching && <div className="spinner" />}
            </div>
            {results.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '20px' }}>
                {results.map(t => (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px', background: '#282828', borderRadius: '8px' }}>
                    <img src={t.img} style={{ width: '40px', height: '40px', borderRadius: '4px' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '12px', fontWeight: '700', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</div>
                      <div style={{ fontSize: '10px', color: '#b3b3b3' }}>{t.artist}</div>
                    </div>
                    <button onClick={() => { onAddSong(t); setQuery(""); setResults([]); }} style={{ border: 'none', borderRadius: '50%', width: '30px', height: '30px', background: '#1DB954', cursor: 'pointer' }}>+</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={panelStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
              <h2 style={headerStyle}>COLA DE REPRODUCCIÓN ({queue.length})</h2>
              <button onClick={onClearQueue} style={{ color: '#ff4444', background: 'none', border: '1px solid #ff4444', padding: '4px 12px', borderRadius: '20px', fontSize: '10px', fontWeight: 'bold' }}>VACIAR LISTA</button>
            </div>
            {queue.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '15px', padding: '10px 0', borderBottom: '1px solid #282828' }}>
                <span style={{ width: '20px', color: i === currentIdx ? '#1DB954' : '#555' }}>{i === currentIdx ? '▶' : i + 1}</span>
                <img src={s.img} style={{ width: '35px', height: '35px', borderRadius: '4px' }} />
                <div style={{ flex: 1, fontSize: '14px', color: i === currentIdx ? '#1DB954' : '#fff' }}>{s.title}</div>
                <button onClick={() => onPlay(i)} style={{ background: 'none', border: '1px solid #444', color: '#aaa', padding: '4px 10px', borderRadius: '15px', fontSize: '10px' }}>SONAR YA</button>
                <button onClick={() => onRemove(i)} style={{ background: 'none', border: 'none', color: '#ff4444' }}><IconTrash /></button>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
          <div style={{ ...panelStyle, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '20px 20px 10px' }}><h2 style={headerStyle}>PANEL MAESTRO</h2></div>
            <div style={{ background: '#000', aspectRatio: '16/9', position: 'relative' }}>
              {queue[currentIdx] && <img src={queue[currentIdx].img} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.5 }} />}
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: '20px' }}>
                <div style={{ fontWeight: 'bold' }}>{queue[currentIdx]?.title || "EN ESPERA"}</div>
                <div style={{ color: '#1DB954', fontSize: '12px' }}>{queue[currentIdx]?.artist}</div>
              </div>
              <div style={{ position: 'absolute', top: 10, right: 10, color: '#ff4444', fontSize: '10px', fontWeight: 'bold' }}>• ON AIR</div>
            </div>
            <div style={{ padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', fontSize: '12px' }}>
                <span style={{ color: '#b3b3b3' }}><IconVolume /> VOLUMEN DEL LOCAL</span>
                <span style={{ color: '#1DB954', fontWeight: 'bold' }}>{localVol}%</span>
              </div>
              <input type="range" min="0" max="100" value={localVol} onChange={(e) => { setLocalVol(e.target.value); onVolumeChange(e.target.value); }} style={{ width: '100%', accentColor: '#1DB954' }} />
            </div>
          </div>

          <div style={panelStyle}>
            <h2 style={headerStyle}>SOLICITUDES DE CLIENTES</h2>
            {queue.slice(currentIdx + 1).length === 0 ? (
              <div style={{ color: '#555', fontSize: '12px', textAlign: 'center' }}>No hay pedidos nuevos en este momento</div>
            ) : (
              queue.slice(currentIdx + 1).map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', padding: '10px', background: '#222', borderRadius: '8px' }}>
                  <img src={s.img} style={{ width: '32px', height: '32px', borderRadius: '4px' }} />
                  <div style={{ flex: 1, fontSize: '11px', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</div>
                  <button onClick={() => setApprovedIds(new Set([...approvedIds, s.id]))} style={{ border: 'none', borderRadius: '50%', width: '28px', height: '28px', background: approvedIds.has(s.id) ? '#1DB954' : '#333', color: '#fff' }}><IconCheck /></button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      <style>{`.spinner { width: 14px; height: 14px; border: 2px solid #333; border-top-color: #1DB954; border-radius: 50%; animation: spin 0.8s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}