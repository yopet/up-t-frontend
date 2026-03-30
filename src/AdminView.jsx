import React, { useState, useEffect, useRef } from 'react';

// --- UTILIDADES ---
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

// --- ICONOS ---
const IconTrash = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>;
const IconCheck = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"></polyline></svg>;
const IconSearch = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>;
const IconVolume = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>;
const IconTv = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>;

export default function AdminView({ 
  queue = [], 
  currentIdx = 0, 
  onRemove, 
  onPlay, 
  onAddSong, 
  volume = 50, 
  onVolumeChange 
}) {
  // --- ESTADOS ---
  const [apiKey] = useState(() => localStorage.getItem("yt_api_key") || "");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [approvedIds, setApprovedIds] = useState(new Set());
  
  // Estado local para que el volumen se mueva al instante en la UI
  const [localVol, setLocalVol] = useState(volume);

  // Sincronizar el volumen local si cambia desde afuera (otra pestaña o DB)
  useEffect(() => {
    setLocalVol(volume);
  }, [volume]);

  // --- LOGICA DE BUSQUEDA ---
  useEffect(() => {
    if (!query.trim() || !apiKey) { setResults([]); return; }
    setSearching(true);
    const ctrl = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=6&q=${encodeURIComponent(query)}&key=${apiKey}`, { signal: ctrl.signal });
        const data = await res.json();
        const items = data.items || [];
        if (!items.length) { setResults([]); setSearching(false); return; }

        const vIds = items.map(i => i.id.videoId).join(",");
        const dRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${vIds}&key=${apiKey}`, { signal: ctrl.signal });
        const dData = await dRes.json();
        const dMap = {};
        (dData.items || []).forEach(v => dMap[v.id] = formatDuration(v.contentDetails.duration));

        setResults(items.map(item => ({
          id: item.id.videoId,
          title: item.snippet.title,
          artist: item.snippet.channelTitle.replace(/ - Topic$| Music$/i, ""),
          img: item.snippet.thumbnails.medium?.url,
          duration: dMap[item.id.videoId] || "",
          youtubeId: item.id.videoId,
        })));
      } catch (e) { console.error(e); } finally { setSearching(false); }
    }, 500);
    return () => { clearTimeout(timeout); ctrl.abort(); };
  }, [query, apiKey]);

  // --- HANDLERS ---
  const handleVolChange = (e) => {
    const val = parseInt(e.target.value);
    setLocalVol(val); // Actualización visual inmediata
    if (onVolumeChange) onVolumeChange(val); // Envío al padre/DB
  };

  const upcomingVotes = queue.filter((_, idx) => idx > currentIdx);

  // --- ESTILOS ---
  const panelStyle = { background: '#181818', borderRadius: '12px', padding: '20px', border: '1px solid #282828' };
  const headerStyle = { fontSize: '13px', color: '#b3b3b3', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '20px', fontWeight: '700' };
  const actionBtn = { border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: '0.2s' };

  return (
    <div style={{ height: '100vh', overflowY: 'auto', background: '#121212', color: '#fff', fontFamily: 'system-ui, sans-serif', padding: '30px', boxSizing: 'border-box' }}>
      
      {/* 1. TOP BAR */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '12px', height: '12px', background: '#1DB954', borderRadius: '50%', boxShadow: '0 0 10px #1DB954' }}></div>
          <h1 style={{ fontSize: '22px', fontWeight: '800', margin: 0, letterSpacing: '-0.5px' }}>UP-T <span style={{ color: '#1DB954' }}>ADMIN</span></h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
             <div style={{ color: '#b3b3b3', fontSize: '12px', background: '#282828', padding: '6px 14px', borderRadius: '20px', border: '1px solid #333' }}>Bogotá • Gastrobar</div>
             <button onClick={() => window.open('/tv', '_blank')} style={{ background: '#1DB954', color: '#000', border: 'none', padding: '6px 16px', borderRadius: '20px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
               <IconTv /> ABRIR TV
             </button>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '30px', alignItems: 'start' }}>
        
        {/* COLUMNA IZQUIERDA: BUSCADOR Y LISTA */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
          
          {/* BUSCADOR */}
          <div style={{ ...panelStyle, border: '1px solid #1DB954' }}>
            <h2 style={{ ...headerStyle, color: '#1DB954' }}>Buscador Maestro</h2>
            <div style={{ display: 'flex', background: '#282828', padding: '12px 18px', borderRadius: '30px', alignItems: 'center', gap: '12px', marginBottom: results.length > 0 ? '20px' : '0' }}>
              <IconSearch />
              <input 
                value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Busca y agrega a la cola..."
                style={{ flex: 1, background: 'none', border: 'none', color: '#fff', outline: 'none', fontSize: '15px' }}
              />
              {searching && <div className="spinner" />}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {results.map((track) => (
                <div key={track.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px', background: '#282828', borderRadius: '8px' }}>
                  <img src={track.img} style={{ width: '40px', height: '40px', borderRadius: '4px', objectFit: 'cover' }} alt="" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '12px', fontWeight: '700', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.title}</div>
                    <div style={{ fontSize: '10px', color: '#b3b3b3' }}>{track.artist}</div>
                  </div>
                  <button onClick={() => { onAddSong(track); setQuery(""); setResults([]); }} style={{ ...actionBtn, background: '#1DB954', color: '#000' }}>+</button>
                </div>
              ))}
            </div>
          </div>

          {/* BIBLIOTECA COMPLETA */}
          <div style={panelStyle}>
            <h2 style={headerStyle}>Cola de Reproducción ({queue.length})</h2>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {queue.map((song, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '15px', padding: '12px 10px', borderBottom: '1px solid #282828', background: idx === currentIdx ? '#1db95408' : 'transparent' }}>
                  <div style={{ width: '25px', fontSize: '12px', color: idx === currentIdx ? '#1DB954' : '#555', fontWeight: 'bold' }}>{idx === currentIdx ? '▶' : idx + 1}</div>
                  <img src={song.img} alt="" style={{ width: '40px', height: '40px', borderRadius: '4px' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: '600', fontSize: '14px', color: idx === currentIdx ? '#1DB954' : '#fff' }}>{song.title}</div>
                    <div style={{ color: '#b3b3b3', fontSize: '12px' }}>{song.artist}</div>
                  </div>
                  {idx !== currentIdx && (
                    <button onClick={() => onPlay(idx)} style={{ background: 'transparent', border: '1px solid #444', color: '#aaa', padding: '5px 12px', borderRadius: '15px', fontSize: '10px', cursor: 'pointer' }}>SONAR YA</button>
                  )}
                  <button onClick={() => onRemove(idx)} style={{ ...actionBtn, background: 'transparent', color: '#ff4444' }}><IconTrash /></button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* COLUMNA DERECHA: TV, VOLUMEN Y PEDIDOS */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '30px', position: 'sticky', top: '20px' }}>
          
          {/* TV Y VOLUMEN */}
          <div style={{ ...panelStyle, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '15px 20px', borderBottom: '1px solid #282828', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ ...headerStyle, marginBottom: 0 }}>PANEL MAESTRO</h3>
                <span style={{ color: '#ff4444', fontSize: '10px', fontWeight: 'bold' }}>• ON AIR</span>
            </div>
            
            <div style={{ position: 'relative', aspectRatio: '16/9', background: '#000' }}>
              {queue[currentIdx] ? (
                <>
                  <img src={queue[currentIdx].img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.4 }} />
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
                      <div style={{ fontSize: '14px', fontWeight: 'bold', padding: '0 20px', marginBottom: '4px' }}>{queue[currentIdx].title}</div>
                      <div style={{ fontSize: '11px', color: '#1DB954' }}>{queue[currentIdx].artist}</div>
                  </div>
                </>
              ) : <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444' }}>ESPERANDO SELECCIÓN...</div>}
            </div>

            {/* CONTROL DE VOLUMEN (YA FUNCIONA) */}
            <div style={{ padding: '20px', background: '#1c1c1c' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 'bold', color: '#b3b3b3' }}>
                        <IconVolume /> VOLUMEN DEL LOCAL
                    </div>
                    <span style={{ color: '#1DB954', fontWeight: 'bold', fontSize: '16px' }}>{localVol}%</span>
                </div>
                <input 
                    type="range" 
                    min="0" 
                    max="100" 
                    value={localVol} 
                    onChange={handleVolChange}
                    style={{
                        width: '100%',
                        cursor: 'pointer',
                        accentColor: '#1DB954',
                        height: '6px',
                        borderRadius: '5px',
                        background: `linear-gradient(to right, #1DB954 ${localVol}%, #333 ${localVol}%)`,
                        WebkitAppearance: 'none'
                    }}
                />
            </div>
          </div>

          {/* SOLICITUDES DE CLIENTES (RECHAZAR / ACEPTAR) */}
          <div style={{ ...panelStyle, background: '#121212', border: '1px solid #333' }}>
            <h2 style={headerStyle}>Solicitudes de Clientes</h2>
            {upcomingVotes.length === 0 ? (
              <p style={{ fontSize: '12px', color: '#555', textAlign: 'center', margin: '20px 0' }}>No hay pedidos nuevos en este momento</p>
            ) : (
              upcomingVotes.map((song, idx) => {
                const realIdx = queue.indexOf(song);
                const isApproved = approvedIds.has(song.id);
                return (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', padding: '10px', background: isApproved ? '#1db95408' : '#1c1c1c', borderRadius: '8px', border: isApproved ? '1px solid #1db95455' : '1px solid transparent' }}>
                    <img src={song.img} alt="" style={{ width: '36px', height: '36px', borderRadius: '4px' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '11px', fontWeight: '700', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{song.title}</div>
                      <div style={{ fontSize: '10px', color: '#888' }}>{song.artist}</div>
                    </div>
                    {!isApproved ? (
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button onClick={() => setApprovedIds(new Set([...approvedIds, song.id]))} style={{ ...actionBtn, width: '30px', height: '30px', background: '#1DB954', color: '#000' }} title="Aprobar para la cola">
                          <IconCheck />
                        </button>
                        <button onClick={() => onRemove(realIdx)} style={{ ...actionBtn, width: '30px', height: '30px', background: 'transparent', border: '1px solid #ff4444', color: '#ff4444' }} title="Rechazar">
                          <IconTrash />
                        </button>
                      </div>
                    ) : <div style={{ color: '#1DB954', paddingRight: '10px' }}><IconCheck /></div>}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* CSS PARA SPINNER Y SLIDER */}
      <style>{`
        .spinner { width: 14px; height: 14px; border: 2px solid #333; border-top-color: #1DB954; border-radius: 50%; animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; height: 16px; width: 16px; border-radius: 50%; background: #fff; cursor: pointer; margin-top: -5px; box-shadow: 0 0 10px rgba(0,0,0,0.5); }
        input[type=range]::-webkit-slider-runnable-track { width: 100%; height: 6px; cursor: pointer; background: transparent; border-radius: 3px; }
      `}</style>
    </div>
  );
}