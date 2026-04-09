import React, { useState, useEffect, useRef } from 'react';
import { supabase } from "./lib/supabase";

// ─── CONFIGURACIÓN DE LLAVES YOUTUBE ─────────────────────────────────────────
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

// ─── INVIDIOUS CONFIG ────────────────────────────────────────────────────────
const INVIDIOUS_INSTANCES = [
  "https://iv.melmac.space",
  "https://invidious.projectsegfau.lt",
  "https://inv.tux.pizza",
  "https://invidious.no-logs.com",
];
const INVIDIOUS_TIMEOUT_MS = 3000;
const LAST_WORKING_INSTANCE_KEY = "up_t_last_invidious_instance";

function getPrioritizedInstances() {
  const lastWorking = localStorage.getItem(LAST_WORKING_INSTANCE_KEY);
  if (lastWorking && INVIDIOUS_INSTANCES.includes(lastWorking)) {
    const others = INVIDIOUS_INSTANCES.filter(i => i !== lastWorking);
    return [lastWorking, ...others];
  }
  return INVIDIOUS_INSTANCES;
}

function normalizeInvidious(item) {
  const totalSecs = item.lengthSeconds || 0;
  const m = Math.floor(totalSecs / 60);
  const s = String(totalSecs % 60).padStart(2, "0");
  const duration = totalSecs > 0 ? `${m}:${s}` : "";
  const thumb = item.videoThumbnails?.find((t) => t.quality === "medium")?.url || item.videoThumbnails?.[0]?.url || "";
  return {
    id: item.videoId,
    title: item.title,
    artist: (item.author || "").replace(/ - Topic$| Music$/i, ""),
    img: thumb.startsWith("http") ? thumb : `https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg`,
    duration,
    youtubeId: item.videoId,
  };
}

function normalizeYouTube(item, durationMap = {}) {
  return {
    id: item.id.videoId,
    title: item.snippet.title,
    artist: item.snippet.channelTitle.replace(/ - Topic$| Music$/i, ""),
    img: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url,
    duration: durationMap[item.id.videoId] || "",
    youtubeId: item.id.videoId,
  };
}

// ─── UTILIDADES ───────────────────────────────────────────────────────────────
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

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (diff < 60) return `hace ${diff}s`;
  if (diff < 3600) return `hace ${Math.floor(diff / 60)}min`;
  return `hace ${Math.floor(diff / 3600)}h`;
}

// ─── ICONOS ───────────────────────────────────────────────────────────────────
const IconTrash = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);
const IconCheck = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const IconSearch = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" />
  </svg>
);
const IconTv = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);
const IconAd = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
);
const IconPlaySmall = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5v14l11-7z" />
  </svg>
);

// ─── BADGE DE NUEVA CANCIÓN ───────────────────────────────────────────────────
function NewBadge({ track, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4000);
    return () => clearTimeout(t);
  }, [track?.id]);
  if (!track) return null;
  return (
    <div style={{
      position: "fixed", top: 24, right: 24, zIndex: 500,
      background: "rgba(29,185,84,0.10)", border: "0.5px solid rgba(29,185,84,0.35)",
      borderRadius: "12px", padding: "12px 16px",
      display: "flex", alignItems: "center", gap: 12,
      animation: "badgeIn 0.4s cubic-bezier(0.34,1.56,0.64,1)",
      maxWidth: 280, color: "#fff"
    }}>
      <img src={track.img} alt="" style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
      <div>
        <div style={{ fontSize: 9, color: "#1DB954", fontWeight: 700, letterSpacing: "0.12em", marginBottom: 3 }}>♪ NUEVA SOLICITUD</div>
        <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 190 }}>{track.title}</div>
        <div style={{ fontSize: 11, color: "#777", marginTop: 2 }}>{track.artist}</div>
      </div>
    </div>
  );
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────
export default function AdminView({
  queue = [], currentIdx = 0, onRemove, onPlay, onAddSong, onClearQueue, onApprove,
  autoPlay, onToggleAutoPlay, volume = 50, onVolumeChange,
  ads = [], onAddAd, onRemoveAd, onApproveMessage
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [lastNewTrack, setLastNewTrack] = useState(null);
  const prevQueueLen = useRef(queue.length);
  const [localVol, setLocalVol] = useState(volume);
  const [lastNonZeroVolume, setLastNonZeroVolume] = useState(volume > 0 ? volume : 50);
  const [rejectedCount, setRejectedCount] = useState(0);
  const [rejectedMessagesCount, setRejectedMessagesCount] = useState(0);
  const [approvedMessagesCount, setApprovedMessagesCount] = useState(0);
  const [showAdModal, setShowAdModal] = useState(false);
  const [newAd, setNewAd] = useState({ title: '', image_url: '', frequency: 1 });
  const [adFile, setAdFile] = useState(null);
  const [uploadingAd, setUploadingAd] = useState(false);
  const [screenMessages, setScreenMessages] = useState([]);
  const [pendingFilter, setPendingFilter] = useState('all'); // ← NUEVO
  const [searchSource, setSearchSource] = useState(null);

  // --- LÓGICA DE CRÉDITOS UP-T ---
  const [credits, setCredits] = useState(0);
  const [lowCredit, setLowCredit] = useState(10);
  const [establishmentId, setEstablishmentId] = useState(null);
  const [establishmentName, setEstablishmentName] = useState("");

  useEffect(() => { setLocalVol(volume); }, [volume]);

  // ─── Cargar créditos, establecimiento y contadores reales desde BD ────────
  useEffect(() => {
    const fetchEstDetails = async () => {
      const { data } = await supabase.from('establishments').select('*').single();
      if (data) {
        setCredits(data.credits);
        setLowCredit(data.low_credit_threshold);
        setEstablishmentId(data.id);
        setEstablishmentName(data.name);

        // FIX: contadores persistentes — se leen de Supabase, no de estado local
        const { count: approvedCount } = await supabase
          .from('screen_messages')
          .select('*', { count: 'exact', head: true })
          .eq('establishment_id', data.id)
          .in('status', ['approved', 'displayed']);

        const { count: rejectedCount } = await supabase
          .from('screen_messages')
          .select('*', { count: 'exact', head: true })
          .eq('establishment_id', data.id)
          .eq('status', 'rejected');

        setApprovedMessagesCount(approvedCount || 0);
        setRejectedMessagesCount(rejectedCount || 0);
      }
    };
    fetchEstDetails();

    const channel = supabase.channel('est-updates')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'establishments' },
        payload => setCredits(payload.new.credits))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  // ─── Mensajes en tiempo real ──────────────────────────────────────────────
  useEffect(() => {
    if (!supabase || !establishmentId) return;
    const fetchMessages = async () => {
      const { data } = await supabase
        .from('screen_messages').select('*')
        .eq('establishment_id', establishmentId)
        .eq('status', 'pending').order('created_at', { ascending: false });
      if (data) setScreenMessages(data);
    };
    fetchMessages();
    const channel = supabase
      .channel('admin-messages-panel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'screen_messages' }, (payload) => {
        if (payload.new.establishment_id === establishmentId) {
          setScreenMessages(prev => [payload.new, ...prev]);
          const audio = new Audio("https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3");
          audio.volume = 0.2;
          audio.play().catch(() => {});
        }
      }).subscribe();
    return () => supabase.removeChannel(channel);
  }, [establishmentId]);

  // ─── Aprobar canción con crédito ──────────────────────────────────────────
  const handleApproveSong = async (song) => {
    if (credits <= 0) {
      alert("⚠️ Saldo insuficiente en Up-T. Recarga para aprobar más Creditos.");
      return;
    }
    const { error } = await supabase.rpc('approve_and_subtract_credit', {
      p_request_id: song.queueRowId,
      p_establishment_id: establishmentId
    });
    if (error) {
      alert("Error: " + error.message);
    } else {
      const audio = new Audio("https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3");
      audio.play().catch(() => {});
    }
  };

  // ─── Aprobar / rechazar mensaje ───────────────────────────────────────────
  const handleMessageAction = async (id, newStatus) => {
    const msg = screenMessages.find(m => m.id === id);
    if (!msg) return;

    if (newStatus === 'approved' && credits <= 0) {
      alert("⚠️ Saldo insuficiente en Up-T. Recarga para aprobar más mensajes.");
      return;
    }

    try {
      if (newStatus === 'approved') {
        const { error } = await supabase.rpc('approve_and_subtract_credit', {
          p_request_id: id,
          p_establishment_id: establishmentId
        });
        if (error) throw error;
        setApprovedMessagesCount(prev => prev + 1);
        if (onApproveMessage) onApproveMessage(msg);
      } else {
        const { error } = await supabase
          .from('screen_messages')
          .update({ status: newStatus })
          .eq('id', id);
        if (error) throw error;
        if (newStatus === 'rejected') setRejectedMessagesCount(prev => prev + 1);
      }
      setScreenMessages(prev => prev.filter(m => m.id !== id));
    } catch (err) {
      console.error("Error en acción de mensaje:", err);
      alert("No se pudo procesar la acción: " + (err.message || "Error de conexión"));
    }
  };

  const handleRemoveWithStats = (idx) => {
    const track = queue[idx];
    if (track?.is_cliente) setRejectedCount(prev => prev + 1);
    onRemove(idx);
  };

  // ─── Notificación nueva canción ───────────────────────────────────────────
  useEffect(() => {
    if (queue.length > prevQueueLen.current) {
      const newTrack = queue[queue.length - 1];
      if (newTrack?.is_cliente) {
        setLastNewTrack(newTrack);
        const audio = new Audio("https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3");
        audio.volume = 0.4;
        audio.play().catch(() => {});
      }
    }
    prevQueueLen.current = queue.length;
  }, [queue]);

  // ─── Sugerencias de búsqueda ──────────────────────────────────────────────
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) { setSuggestions([]); return; }
    const timeout = setTimeout(() => {
      const cbName = 'gsc_' + Math.random().toString(36).substr(2, 9);
      window[cbName] = (data) => {
        if (data && data[1]) setSuggestions(data[1].map(i => i[0]));
        delete window[cbName];
        document.getElementById(cbName)?.remove();
      };
      const s = document.createElement('script');
      s.id = cbName;
      s.src = `https://suggestqueries.google.com/complete/search?client=youtube&ds=yt&q=${encodeURIComponent(q)}&callback=${cbName}`;
      document.body.appendChild(s);
    }, 300);
    return () => clearTimeout(timeout);
  }, [query]);

  // ─── BÚSQUEDA EN CASCADA (INVIDIOUS -> YOUTUBE) ──────────────────────────

  async function searchInvidious(term, signal) {
    const instances = getPrioritizedInstances();
    for (const instance of instances) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), INVIDIOUS_TIMEOUT_MS);
        signal?.addEventListener("abort", () => controller.abort());

        console.log(`[Up-T Admin] Probando búsqueda en: ${instance}`);
        const res = await fetch(
          `${instance}/api/v1/search?q=${encodeURIComponent(term)}&type=video&fields=videoId,title,author,lengthSeconds,videoThumbnails&page=1`,
          { signal: controller.signal, mode: 'cors' }
        );
        clearTimeout(timeoutId);

        if (!res.ok) continue;
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) continue;

        console.log(`[Up-T Admin] ¡Se logró con la instancia: ${instance}!`);
        localStorage.setItem(LAST_WORKING_INSTANCE_KEY, instance);
        return data.slice(0, 6).map(normalizeInvidious);
      } catch (err) {
        continue;
      }
    }
    return null;
  }

  const performSearch = async (searchTerm) => {
    const q = searchTerm.trim();
    if (q.length < 3) return;
    setSearching(true); setError(""); setSuggestions([]); setSearchSource(null);

    const ctrl = new AbortController();

    try {
      // 1. Intento con Invidious
      const invResults = await searchInvidious(q, ctrl.signal);
      if (invResults && invResults.length > 0) {
        setResults(invResults);
        setSearchSource("invidious");
        setSearching(false);
        return;
      }

      // 2. Fallback a YouTube API
      console.warn("[Up-T Admin] Invidious falló, usando YouTube API...");
      await searchYouTubeFallback(q, ctrl.signal);
    } catch (e) {
      if (e.name !== "AbortError") setError("Error de conexión");
      setSearching(false);
    }
  };

  const searchYouTubeFallback = async (q, signal) => {
    const searchWithKey = async (key) => {
      const r = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=6&q=${encodeURIComponent(q)}&key=${key}`, { signal });
      return r.json();
    };

    try {
      let key = getAvailableKey();
      if (!key) { setError("Cuota agotada."); return; }
      let data = await searchWithKey(key);
      while (isQuotaError(data)) {
        markKeyExhausted(key); key = getAvailableKey();
        if (!key) { setError("Cuota agotada."); return; }
        data = await searchWithKey(key);
      }
      if (data.error) { setError(data.error.message); return; }

      const items = data.items || [];
      const ids = items.map(i => i.id.videoId).join(",");
      const det = await (await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids}&key=${key}`, { signal })).json();
      const durMap = {};
      (det.items || []).forEach(v => { durMap[v.id] = formatDuration(v.contentDetails.duration); });
      
      setResults(items.map(item => normalizeYouTube(item, durMap)));
      setSearchSource("youtube");
    } catch (e) {
      if (e.name !== "AbortError") throw e;
    } finally {
      setSearching(false);
    }
  };

  // ─── Volumen ──────────────────────────────────────────────────────────────
  const handleVolChange = (e) => {
    const val = parseInt(e.target.value);
    if (val > 0) setLastNonZeroVolume(val);
    setLocalVol(val);
    if (onVolumeChange) onVolumeChange(val);
  };

  const toggleMute = () => {
    if (localVol > 0) { setLastNonZeroVolume(localVol); handleVolChange({ target: { value: 0 } }); }
    else { handleVolChange({ target: { value: lastNonZeroVolume } }); }
  };

  // ─── Anuncios ─────────────────────────────────────────────────────────────
  const handleSaveAdInternal = async () => {
    if (!newAd.title || (!adFile && !newAd.image_url)) {
      alert("Por favor completa el título y selecciona una imagen.");
      return;
    }
    setUploadingAd(true);
    try {
      let finalUrl = newAd.image_url;
      if (adFile) {
        const ext = adFile.name.split('.').pop();
        const fileName = `${Math.random().toString(36).substring(2)}.${ext}`;
        const filePath = `${fileName}`;
        const { error: upErr } = await supabase.storage.from('images').upload(filePath, adFile);
        if (upErr) throw upErr;
        const { data: urlData } = supabase.storage.from('images').getPublicUrl(filePath);
        finalUrl = urlData.publicUrl;
      }
      const adToSave = {
        title: newAd.title,
        image_url: finalUrl,
        frequency: parseInt(newAd.frequency) || 3,
        establishment_id: establishmentId,
        active: true
      };
      const { data, error: insErr } = await supabase.from('promociones').insert([adToSave]).select();
      if (insErr) throw insErr;
      if (onAddAd) await onAddAd(data[0]);
      setShowAdModal(false);
      setNewAd({ title: '', image_url: '', frequency: 1 });
      setAdFile(null);
      alert("✅ Anuncio agregado correctamente");
    } catch (err) {
      console.error("Error al guardar anuncio:", err);
      alert("Error al subir anuncio: " + (err.message || "Error desconocido"));
    } finally {
      setUploadingAd(false);
    }
  };

  const handleRemoveAdInternal = async (adId) => {
    if (!window.confirm("¿Estás seguro de eliminar este anuncio?")) return;
    try {
      const { error } = await supabase.from('promociones').delete().eq('id', adId);
      if (error) throw error;
      if (onRemoveAd) onRemoveAd(adId);
      alert("Anuncio eliminado");
    } catch (err) {
      console.error("Error al eliminar anuncio:", err);
      alert("No se pudo eliminar el anuncio de la base de datos.");
    }
  };

  // ─── Datos derivados ──────────────────────────────────────────────────────
  const approvedQueue = queue.filter(s => s.isApproved);

  const pendingRequests = queue
    .filter(s => !s.isApproved)
    .sort((a, b) => {
      if (a.is_cliente === b.is_cliente) return new Date(a.created_at) - new Date(b.created_at);
      return a.is_cliente ? -1 : 1;
    });

  // Array mixto: canciones pendientes + mensajes pendientes, ordenados por prioridad y fecha
  const allPending = [
    ...pendingRequests.map(s => ({ ...s, itemType: 'song' })),
    ...screenMessages.map(m => ({ ...m, itemType: 'msg' })),
  ].sort((a, b) => {
    const aTop = a.is_cliente || a.itemType === 'msg';
    const bTop = b.is_cliente || b.itemType === 'msg';
    if (aTop !== bTop) return aTop ? -1 : 1;
    return new Date(a.created_at) - new Date(b.created_at);
  });

  const clientStats = {
    total: queue.filter(s => s.is_cliente).length + rejectedCount,
    approved: queue.filter(s => s.is_cliente && s.isApproved).length,
    pending: queue.filter(s => s.is_cliente && !s.isApproved).length,
    rejected: rejectedCount,
  };
  const messageStats = {
    total: screenMessages.length + approvedMessagesCount + rejectedMessagesCount,
    approved: approvedMessagesCount,
    pending: screenMessages.length,
    rejected: rejectedMessagesCount,
  };

  // ─── Estilos base ─────────────────────────────────────────────────────────
  const C = {
    bg: '#0f0f0f', panel: '#161616', panel2: '#1c1c1c', border: '#222', border2: '#2a2a2a',
    text: '#d8d8d8', muted: '#555', green: '#1DB954', amber: '#EF9F27', red: '#E24B4A', blue: '#85B7EB',
  };
  const panel = {
    background: C.panel, borderRadius: 10, border: `0.5px solid ${C.border}`, padding: '16px',
  };
  const sectionLabel = {
    fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.1em',
    fontWeight: 500, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6,
  };
  const actionBtn = {
    border: 'none', borderRadius: 4, cursor: 'pointer', display: 'flex',
    alignItems: 'center', justifyContent: 'center', transition: '0.15s', flexShrink: 0,
  };

  // ─── Stats strip ──────────────────────────────────────────────────────────
  const StatsStrip = () => {
    const colStyle = () => ({ display: 'flex', flexDirection: 'column', borderRight: `0.5px solid ${C.border}` });
    const titleCell = (label, color) => (
      <div style={{ padding: '5px 14px', background: '#111', borderBottom: `0.5px solid ${C.border}`, fontSize: 9, color: color || C.muted }}>{label}</div>
    );
    const valueCell = (val, color, bg) => (
      <div style={{ padding: '10px 14px', background: bg || C.panel, fontSize: 22, fontWeight: 500, color: color || C.text }}>{val}</div>
    );
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1px 1fr', border: `0.5px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', marginBottom: 20 }}>
        <div>
          <div style={{ padding: '6px 14px', background: '#0d0d0d', borderBottom: `0.5px solid ${C.border}`, fontSize: 9, color: C.green, fontWeight: 600 }}>CANCIONES</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)' }}>
            <div style={colStyle()}>{titleCell('Total')}{valueCell(clientStats.total)}</div>
            <div style={colStyle()}>{titleCell('Aprobadas', C.green)}{valueCell(clientStats.approved, C.green)}</div>
            <div style={colStyle()}>{titleCell('Pendientes', C.amber)}{valueCell(clientStats.pending, C.amber)}</div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>{titleCell('Rechazadas', C.red)}{valueCell(clientStats.rejected, C.red)}</div>
          </div>
        </div>
        <div style={{ background: C.border2 }} />
        <div>
          <div style={{ padding: '6px 14px', background: '#0d0d0d', borderBottom: `0.5px solid ${C.border}`, fontSize: 9, color: C.blue, fontWeight: 600 }}>MENSAJES</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)' }}>
            <div style={colStyle()}>{titleCell('Total')}{valueCell(messageStats.total, C.text, '#121212')}</div>
            <div style={colStyle()}>{titleCell('Aprobados', C.blue)}{valueCell(messageStats.approved, C.blue, '#121212')}</div>
            <div style={colStyle()}>{titleCell('Pendientes', C.amber)}{valueCell(messageStats.pending, C.amber, '#121212')}</div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>{titleCell('Rechazados', C.red)}{valueCell(messageStats.rejected, C.red, '#121212')}</div>
          </div>
        </div>
      </div>
    );
  };

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', overflowY: 'auto', overflowX: 'hidden', background: C.bg, color: C.text, fontFamily: 'system-ui, sans-serif', boxSizing: 'border-box' }}>
      {lastNewTrack && <NewBadge track={lastNewTrack} onDone={() => setLastNewTrack(null)} />}

      {/* ── HEADER ──────────────────────────────────────────────────────────── */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 24px', borderBottom: `0.5px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 7, height: 7, background: C.green, borderRadius: '50%' }} />
          <span style={{ fontSize: 15, fontWeight: 500 }}>
            Up-T <span style={{ color: C.green }}>Admin</span>
            {establishmentName && <span style={{  marginLeft: 5, fontSize: 14, fontWeight: 500 }}>- {establishmentName}</span>}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* Créditos */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: credits <= lowCredit ? 'rgba(226,75,74,0.08)' : '#161616', padding: '4px 12px', borderRadius: 8, border: `0.5px solid ${credits <= lowCredit ? C.red : C.border2}` }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 8, color: C.muted, fontWeight: 600 }}>SALDO UP-T</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: credits <= lowCredit ? C.red : C.green }}>
                {credits} <span style={{ fontSize: 9, fontWeight: 400 }}>Creditos</span>
              </div>
            </div>
            <button
              onClick={() => window.open('https://wa.me/tu_numero', '_blank')}
              style={{ background: credits <= lowCredit ? C.red : C.panel2, color: credits <= lowCredit ? '#000' : C.text, border: 'none', padding: '4px 8px', borderRadius: 4, fontSize: 9, fontWeight: 700, cursor: 'pointer' }}
            >
              RECARGAR
            </button>
          </div>

          {/* Toggle auto-play */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#161616', padding: '6px 14px', borderRadius: 8, border: `0.5px solid ${C.border2}` }}>
            <span style={{ fontSize: 11, color: autoPlay ? C.green : C.muted }}>{autoPlay ? 'Auto-play activo' : 'Moderación activa'}</span>
            <div onClick={() => onToggleAutoPlay(!autoPlay)} style={{ width: 32, height: 16, background: autoPlay ? C.green : '#333', borderRadius: 10, position: 'relative', cursor: 'pointer' }}>
              <div style={{ width: 12, height: 12, background: '#fff', borderRadius: '50%', position: 'absolute', top: 2, left: autoPlay ? 18 : 2, transition: '0.25s' }} />
            </div>
          </div>

          {/* Abrir TV */}
          <button
            onClick={() => window.open('/tvVideo', '_blank')}
            style={{ background: C.green, color: '#000', border: 'none', padding: '6px 14px', borderRadius: 6, fontWeight: 500, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <IconTv /> Abrir TV
          </button>
        </div>
      </header>

      {/* ── STATS ───────────────────────────────────────────────────────────── */}
      <div style={{ padding: '16px 24px 0' }}><StatsStrip /></div>

      {/* ── GRID PRINCIPAL ──────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '240px minmax(0,1fr) 350px', gap: 14, padding: '0 24px 28px' }}>

        {/* ── COLUMNA IZQUIERDA: Publicidad ─────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <div style={panel}>
            <div style={sectionLabel}><IconAd /><span style={{ color: C.green }}>Publicidad</span></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ads.length === 0
                ? <div style={{ fontSize: 11, color: '#333', textAlign: 'center', padding: '16px 0' }}>Sin anuncios activos</div>
                : ads.map(ad => (
                  <div key={ad.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: C.panel2, borderRadius: 7, border: `0.5px solid ${C.border}` }}>
                    <img src={ad.image_url} style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'cover' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ad.title}</div>
                      <div style={{ fontSize: 9, color: C.green, marginTop: 2 }}>cada {ad.frequency} canciones</div>
                    </div>
                    <button onClick={() => handleRemoveAdInternal(ad.id)} style={{ ...actionBtn, background: 'transparent', color: C.red, opacity: 0.5 }}>
                      <IconTrash />
                    </button>
                  </div>
                ))
              }
              <button
                onClick={() => setShowAdModal(true)}
                style={{ width: '100%', padding: '8px', background: 'transparent', border: `0.5px dashed ${C.green}`, color: C.green, borderRadius: 7, fontSize: 10, cursor: 'pointer', marginTop: 4 }}
              >
                + agregar anuncio
              </button>
            </div>
          </div>
        </div>

        {/* ── COLUMNA CENTRAL: Buscador + Cola aprobada ─────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0, overflow: 'hidden' }}>

          {/* Buscador */}
          <div style={{ ...panel, border: `0.5px solid ${C.green}30`, position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ ...sectionLabel, color: C.green, marginBottom: 0 }}>Buscador maestro</div>
              {searchSource && (
                <span style={{ fontSize: 9, color: C.muted, letterSpacing: "0.05em" }}>
                  vía {searchSource === "invidious" ? "⚡ invidious" : "▶ youtube"}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', background: C.panel2, padding: '9px 14px', borderRadius: 7, alignItems: 'center', gap: 10, border: `0.5px solid ${C.border}` }}>
              <IconSearch />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && performSearch(query)}
                placeholder="Escribe el nombre de la canción..."
                style={{ flex: 1, background: 'none', border: 'none', color: C.text, outline: 'none', fontSize: 13 }}
              />
              {query && <button onClick={() => { setQuery(""); setResults([]); setSuggestions([]); }} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}>✕</button>}
              {searching && <div className="spinner" />}
            </div>

            {/* Sugerencias */}
            {suggestions.length > 0 && (
              <div style={{ position: 'absolute', top: 78, left: 16, right: 16, background: '#1a1a1a', borderRadius: 7, zIndex: 100, border: `0.5px solid ${C.border2}`, overflow: 'hidden' }}>
                {suggestions.map((s, idx) => (
                  <div key={idx} onClick={() => { setQuery(s); performSearch(s); }} style={{ padding: '9px 14px', fontSize: 12, cursor: 'pointer', borderBottom: `0.5px solid ${C.border}` }}>
                    {s}
                  </div>
                ))}
              </div>
            )}

            {/* Resultados */}
            {error && <div style={{ fontSize: 11, color: C.red, marginTop: 10 }}>{error}</div>}
            {results.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14 }}>
                {results.map(track => (
                  <div key={track.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', background: C.panel2, borderRadius: 7, border: `0.5px solid ${C.border}`, minWidth: 0 }}>
                    <img src={track.img} style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'cover' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.title}</div>
                      <div style={{ fontSize: 9, color: C.muted }}>{track.artist}</div>
                    </div>
                    <button
                    onClick={() => {
                      onAddSong(track);
                      setQuery(""); setResults([]); 
                    }}
                      style={{ ...actionBtn, background: C.green, color: '#000', width: 26, height: 26, fontSize: 16 }}
                    >
                      +
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Cola aprobada */}
          <div style={panel}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={sectionLabel}>
                Cola aprobada <span style={{ color: C.muted, marginLeft: 4 }}>({approvedQueue.length})</span>
              </span>
              {queue.length > 0 && (
                <button
                  onClick={() => window.confirm("¿Vaciar todas las canciones?") && onClearQueue()}
                  style={{ background: 'transparent', border: `1px solid ${C.red}60`, color: C.red, padding: '6px 16px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: '0.2s' }}
                >
                  Vaciar lista
                </button>
              )}
            </div>
            {approvedQueue.length === 0
              ? <div style={{ fontSize: 11, color: '#333', textAlign: 'center', padding: '20px 0' }}>Cola vacía</div>
              : approvedQueue.map((song, idx) => (
                <div key={song.queueRowId} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 6px',
                  borderBottom: `0.5px solid ${C.border}`,
                  background: idx === currentIdx ? '#1DB95408' : 'transparent',
                  borderLeft: song.is_cliente ? `2px solid ${C.green}` : '2px solid transparent',
                }}>
                  <div style={{ width: 16, fontSize: 10, color: idx === currentIdx ? C.green : C.muted, textAlign: 'center' }}>
                    {idx === currentIdx ? '▶' : idx + 1}
                  </div>
                  <img src={song.img} style={{ width: 32, height: 32, borderRadius: 4 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: idx === currentIdx ? C.green : C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {song.title}
                      </span>
                      {idx === currentIdx && (
                        <span style={{ background: C.green, color: '#000', fontSize: 8, fontWeight: 600, padding: '1px 5px', borderRadius: 3 }}>ahora</span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: C.muted }}>{song.artist}</div>
                  </div>
                  <div style={{ fontSize: 10, color: C.muted, fontFamily: 'monospace', marginRight: 4 }}>
                    {song.duration}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => onPlay(idx)} style={{ ...actionBtn, background: C.panel2, border: `0.5px solid ${C.border}`, color: C.green, width: 24, height: 24 }}>
                      <IconPlaySmall />
                    </button>
                    <button onClick={() => onRemove(queue.indexOf(song))} style={{ ...actionBtn, background: 'transparent', color: C.red, width: 24, height: 24, opacity: 0.5 }}>
                      <IconTrash />
                    </button>
                  </div>
                </div>
              ))
            }
          </div>
        </div>

        {/* ── COLUMNA DERECHA: Solicitudes Pendientes (canciones + mensajes) ── */}
        <div style={panel}>

          {/* Cabecera */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ ...sectionLabel, color: C.amber, marginBottom: 0 }}>
              <IconCheck /> Solicitudes Pendientes
            </span>
            {allPending.length > 0 && (
              <span style={{ background: C.amber, color: '#000', fontSize: 9, fontWeight: 700, padding: '1px 7px', borderRadius: 4 }}>
                {allPending.length}
              </span>
            )}
          </div>

          {/* Filtros */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            {[
              { key: 'all',  label: 'Todos' },
              { key: 'song', label: '♪ Canciones' },
              { key: 'msg',  label: '✉ Mensajes' },
            ].map(f => (
              <button
                key={f.key}
                onClick={() => setPendingFilter(f.key)}
                style={{
                  background: pendingFilter === f.key ? C.panel2 : 'transparent',
                  border: `0.5px solid ${pendingFilter === f.key ? C.border2 : C.border}`,
                  color: pendingFilter === f.key ? C.text : C.muted,
                  padding: '4px 10px', borderRadius: 5, fontSize: 10, cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Lista unificada */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {allPending.filter(item => pendingFilter === 'all' || item.itemType === pendingFilter).length === 0
              ? (
                <div style={{ fontSize: 11, color: '#333', textAlign: 'center', padding: '24px 0' }}>
                  No hay solicitudes
                </div>
              )
              : allPending
                  .filter(item => pendingFilter === 'all' || item.itemType === pendingFilter)
                  .map(item => {

                    // ── Tarjeta CANCIÓN ──────────────────────────────────────
                    if (item.itemType === 'song') {
                      return (
                        <div
                          key={item.queueRowId}
                          style={{ background: C.panel2, padding: 12, borderRadius: 8, border: `0.5px solid ${item.is_cliente ? C.green + '40' : C.border}` }}
                        >
                          {/* Badges */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', background: 'rgba(29,185,84,0.10)', color: C.green, padding: '2px 7px', borderRadius: 4 }}>
                              ♪ CANCIÓN
                            </span>
                            {item.is_cliente && (
                              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', background: 'rgba(29,185,84,0.08)', color: C.green, padding: '2px 7px', borderRadius: 4 }}>
                                CLIENTE
                              </span>
                            )}
                          </div>

                          {/* Info canción */}
                          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                            <img src={item.img} style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {item.title}
                              </div>
                              <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>
                                {item.artist} · <span style={{ color: '#444' }}>{timeAgo(item.created_at)}</span>
                              </div>
                            </div>
                          </div>

                          {/* Acciones canción */}
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              onClick={() => handleApproveSong(item)}
                              style={{ ...actionBtn, flex: 1, background: C.green, color: '#000', height: 28, fontSize: 11, fontWeight: 600 }}
                            >
                              Aprobar
                            </button>
                            <button
                              onClick={() => handleRemoveWithStats(queue.indexOf(item))}
                              style={{ ...actionBtn, background: 'transparent', border: `0.5px solid ${C.border2}`, color: C.red, width: 28, height: 28 }}
                            >
                              <IconTrash />
                            </button>
                          </div>
                        </div>
                      );
                    }

                    // ── Tarjeta MENSAJE ──────────────────────────────────────
                    return (
                      <div
                        key={item.id}
                        style={{ background: C.panel2, padding: 12, borderRadius: 8, border: `0.5px solid ${C.blue}30` }}
                      >
                        {/* Badge + tiempo */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', background: 'rgba(133,183,235,0.10)', color: C.blue, padding: '2px 7px', borderRadius: 4 }}>
                            ✉ MENSAJE
                          </span>
                          <span style={{ fontSize: 9, color: '#444' }}>{timeAgo(item.created_at)}</span>
                        </div>

                        {/* Texto del mensaje */}
                        <div style={{ fontSize: 12, fontStyle: 'italic', color: '#c0c0c0', borderLeft: `2px solid ${C.blue}40`, paddingLeft: 10, marginBottom: 10, lineHeight: 1.5 }}>
                          "{item.text}"
                        </div>

                        {/* Autor y Acciones mensaje */}
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 10, color: C.blue, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              De: {item.author || 'Anónimo'}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 6, flex: 1.5 }}>
                            <button
                              onClick={() => handleMessageAction(item.id, 'approved')}
                              style={{ ...actionBtn, flex: 1, background: C.blue, color: '#042C53', height: 28, fontSize: 11, fontWeight: 600 }}
                            >
                              Aprobar
                            </button>
                            <button
                              onClick={() => handleMessageAction(item.id, 'rejected')}
                              style={{ ...actionBtn, background: 'transparent', border: `0.5px solid ${C.border2}`, color: C.red, width: 28, height: 28 }}
                            >
                              <IconTrash />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
            }
          </div>
        </div>
      </div>

      {/* ── MODAL NUEVO ANUNCIO ──────────────────────────────────────────────── */}
      {showAdModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.80)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ ...panel, width: '100%', maxWidth: 400, boxSizing: 'border-box', border: `0.5px solid ${C.green}50`, padding: 24 }}>
            <div style={{ ...sectionLabel, color: C.green, marginBottom: 18 }}>Nueva pauta publicitaria</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 10, color: C.muted, display: 'block', marginBottom: 5 }}>Nombre de la marca</label>
                <input
                  type="text" placeholder="Ej: Heineken"
                  value={newAd.title}
                  style={{ width: '100%', boxSizing: 'border-box', background: C.panel2, border: `0.5px solid ${C.border2}`, padding: '10px 12px', borderRadius: 7, color: C.text, fontSize: 13, outline: 'none' }}
                  onChange={e => setNewAd({ ...newAd, title: e.target.value })}
                />
              </div>
              <div>
                <label style={{ fontSize: 10, color: C.muted, display: 'block', marginBottom: 5 }}>Subir imagen</label>
                <input
                  type="file" accept="image/*"
                  style={{ width: '100%', boxSizing: 'border-box', background: C.panel2, border: `0.5px solid ${C.border2}`, padding: '10px 12px', borderRadius: 7, color: C.text, fontSize: 12 }}
                  onChange={e => setAdFile(e.target.files[0])}
                />
                <div style={{ textAlign: 'center', margin: '8px 0', fontSize: 9, color: '#333' }}>— o usar URL —</div>
                <input
                  type="text" placeholder="https://..."
                  style={{ width: '100%', boxSizing: 'border-box', background: C.panel2, border: `0.5px solid ${C.border2}`, padding: '10px 12px', borderRadius: 7, color: C.text, fontSize: 13, outline: 'none' }}
                  value={newAd.image_url}
                  onChange={e => setNewAd({ ...newAd, image_url: e.target.value })}
                />
              </div>
              <div>
                <label style={{ fontSize: 10, color: C.muted, display: 'block', marginBottom: 5 }}>Frecuencia</label>
                <select
                  value={newAd.frequency}
                  style={{ width: '100%', boxSizing: 'border-box', background: C.panel2, border: `0.5px solid ${C.border2}`, padding: '10px 12px', borderRadius: 7, color: C.text, fontSize: 13 }}
                  onChange={e => setNewAd({ ...newAd, frequency: parseInt(e.target.value) })}
                >
                  <option value="1">Cada 1 canciones</option>
                  <option value="2">Cada 2 canciones</option>
                  <option value="3">Cada 3 canciones</option>
                  <option value="5">Cada 5 canciones</option>
                  <option value="10">Cada 10 canciones</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                <button
                  onClick={() => { setShowAdModal(false); setAdFile(null); }}
                  style={{ flex: 1, padding: '10px', borderRadius: 7, background: 'transparent', border: `0.5px solid ${C.border2}`, color: C.muted, cursor: 'pointer', fontSize: 12 }}
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSaveAdInternal}
                  disabled={uploadingAd}
                  style={{ flex: 1, padding: '10px', borderRadius: 7, background: uploadingAd ? '#0e6e30' : C.green, border: 'none', color: '#000', fontWeight: 500, cursor: 'pointer', fontSize: 12 }}
                >
                  {uploadingAd ? "Subiendo…" : "Guardar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}