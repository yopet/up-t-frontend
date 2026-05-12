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
const IconHome = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);
const IconMusic = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
  </svg>
);
const IconMessage = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);
const IconSettings = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
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

// ─── ESTILOS Y COMPONENTES REUTILIZABLES ─────────────────────────────────────
const C = {
  bg: '#0f0f0f', panel: '#161616', panel2: '#1c1c1c', border: '#222', border2: '#2a2a2a',
  text: '#d8d8d8', muted: '#555', green: '#1DB954', amber: '#EF9F27', red: '#E24B4A', blue: '#85B7EB',
};

const styles = {
  panel: { background: C.panel, borderRadius: 10, border: `0.5px solid ${C.border}`, padding: '16px' },
  sectionLabel: { fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 },
  actionBtn: { border: 'none', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: '0.15s', flexShrink: 0 },
};

const SidebarStats = ({ queue, clientStats, approvedMessagesCount, screenMessages, ads, credits, lowCredit }) => (
  <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 12, borderBottom: `0.5px solid ${C.border}` }}>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      <div style={{ background: '#0d0d0d', padding: '10px', borderRadius: 10, border: `0.5px solid ${C.border2}` }}>
        <div style={{ fontSize: 8, color: C.muted, fontWeight: 700, letterSpacing: '0.05em' }}>CANCIONES</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: C.green, margin: '2px 0' }}>{queue.filter(s => s.isApproved).length}</div>
        <div style={{ fontSize: 8, color: C.muted }}>{clientStats.pending} pendientes</div>
      </div>
      <div style={{ background: '#0d0d0d', padding: '10px', borderRadius: 10, border: `0.5px solid ${C.border2}` }}>
        <div style={{ fontSize: 8, color: C.muted, fontWeight: 700, letterSpacing: '0.05em' }}>MENSAJES</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: C.blue, margin: '2px 0' }}>{approvedMessagesCount}</div>
        <div style={{ fontSize: 8, color: C.muted }}>{screenMessages.length} moderar</div>
      </div>
      <div style={{ background: '#0d0d0d', padding: '10px', borderRadius: 10, border: `0.5px solid ${C.border2}` }}>
        <div style={{ fontSize: 8, color: C.muted, fontWeight: 700, letterSpacing: '0.05em' }}>PUBLICIDAD</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: C.amber, margin: '2px 0' }}>{ads.length}</div>
        <div style={{ fontSize: 8, color: C.muted }}>Anuncios activos</div>
      </div>
      <div style={{ background: '#0d0d0d', padding: '10px', borderRadius: 10, border: `0.5px solid ${C.border2}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
          <div style={{ fontSize: 8, color: C.muted, fontWeight: 700, letterSpacing: '0.05em' }}>CRÉDITOS</div>
          <button
            onClick={() => window.open('https://wa.me/tu_numero', '_blank')}
            style={{ background: C.green, color: '#000', border: 'none', borderRadius: 4, padding: '2px 6px', fontSize: 7, fontWeight: 800, cursor: 'pointer' }}
          >
            RECARGAR
          </button>
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: credits <= lowCredit ? C.red : C.green, margin: '2px 0' }}>{credits}</div>
        <div style={{ fontSize: 8, color: C.muted }}>Saldo disponible</div>
      </div>
    </div>
  </div>
);

const OrderPanel = ({
  orders,
  handleOrderAction,
  selectedTableDetail,
  setSelectedTableDetail,
  updateItemStatus,
  cancelItem,
  queue = [],
  screenMessages = [],
  handleApproveSong,
  handleMessageAction,
  establishmentId
}) => {
  const [showManualOrder, setShowManualOrder] = useState(null); // table number
  const [manualCart, setManualCart] = useState([]);

  const drinks = [
    { id: 1, name: "Cerveza Club Colombia", price: 8000, img: "https://images.unsplash.com/photo-1535958636474-b021ee887b13?w=400&q=80" },
    { id: 2, name: "Aguardiente Antioqueño", price: 95000, img: "https://images.unsplash.com/photo-1569701813229-33284b643e3c?w=400&q=80" },
    { id: 3, name: "Ron Medellín 8 Años", price: 85000, img: "https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=400&q=80" },
    { id: 4, name: "Vodka Absolut", price: 120000, img: "https://images.unsplash.com/photo-1550985543-575662704043?w=400&q=80" },
    { id: 5, name: "Vino Tinto Reserva", price: 110000, img: "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=400&q=80" },
    { id: 6, name: "Agua Manantial", price: 5000, img: "https://images.unsplash.com/photo-1559839914-17aae19cea9e?w=400&q=80" },
  ];

  const handleSendManualOrder = async () => {
    if (manualCart.length === 0) return;
    const total = manualCart.reduce((a, b) => a + b.price, 0);
    const orderData = {
      mesa: String(showManualOrder),
      items: manualCart.map(it => ({ id: it.id, name: it.name, price: it.price })),
      total: total,
      establishment_id: establishmentId,
      status: 'pending'
    };
    const { error } = await supabase.from('drink_orders').insert([orderData]);
    if (!error) {
      setShowManualOrder(null);
      setManualCart([]);
    }
  };

  const activeOrders = orders.filter(o => o.status === 'pending' || o.status === 'completed');

  // Agrupar todo por mesa
  const tableGroups = {};

  const ensureMesa = (m) => {
    if (!tableGroups[m]) tableGroups[m] = { mesa: m, items: [], total: 0, orderIds: [], songs: [], messages: [] };
  };

  // 1. Pedidos de bebidas (Pendientes y Completados)
  activeOrders.forEach(curr => {
    ensureMesa(curr.mesa);
    curr.items.forEach((it, idx) => {
      tableGroups[curr.mesa].items.push({ ...it, orderId: curr.id, itemIdx: idx, type: 'drink' });
    });
    tableGroups[curr.mesa].total += curr.total;
    tableGroups[curr.mesa].orderIds.push(curr.id);
  });

  // 2. Canciones (Pendientes y Aprobadas)
  queue.filter(s => s.is_cliente && s.mesa).forEach(song => {
    ensureMesa(song.mesa);
    tableGroups[song.mesa].songs.push(song);
  });

  // 3. Mensajes (Pendientes, Aprobados y Mostrados)
  screenMessages.filter(m => (m.status === 'pending' || m.status === 'approved' || m.status === 'displayed') && m.mesa).forEach(msg => {
    ensureMesa(msg.mesa);
    tableGroups[msg.mesa].messages.push(msg);
  });

  const mesas = ["1", "2", "3", "4", "5", "6", "7", "8"];

  if (selectedTableDetail) {
    const detail = tableGroups[selectedTableDetail] || { mesa: selectedTableDetail, items: [], total: 0, orderIds: [], songs: [], messages: [] };
    return (
      <div style={{ ...styles.panel, padding: 0, overflow: 'hidden' }}>
        {/* HEADER DETALLE */}
        <div style={{ padding: '20px 24px', background: C.panel2, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 16 }}>
          <button onClick={() => setSelectedTableDetail(null)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 20, cursor: 'pointer' }}>←</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Mesa {selectedTableDetail} · Detalle del pedido</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <span style={{ fontSize: 9, fontWeight: 800, color: C.amber, background: 'rgba(239,159,39,0.1)', padding: '2px 8px', borderRadius: 4 }}>EN COCINA</span>
            </div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: C.green }}>${detail.total.toLocaleString()}</div>
        </div>

        {/* CONTENIDO DEL DETALLE */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

          {/* 1. CANCIONES */}
          {detail.songs.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 10, color: C.green, fontWeight: 700, marginBottom: 12, letterSpacing: '0.05em' }}>🎶 SOLICITUDES DE MÚSICA</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {detail.songs.map((song) => (
                  <div key={song.queueRowId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: 'rgba(29,185,84,0.05)', borderRadius: 12, border: `1px solid ${C.green}30`, opacity: song.isApproved ? 0.6 : 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <img src={song.img} style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover' }} alt="" />
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', textDecoration: song.isApproved ? 'line-through' : 'none' }}>{song.title}</div>
                        <div style={{ fontSize: 10, color: C.muted }}>{song.artist}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {!song.isApproved ? (
                        <>
                          <button onClick={() => handleApproveSong(song)} style={{ padding: '6px 12px', borderRadius: 8, background: C.green, border: 'none', color: '#000', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Aprobar</button>
                          <button onClick={() => cancelItem(null, null, song.queueRowId, 'song')} style={{ padding: '6px 12px', borderRadius: 8, background: 'transparent', border: `1px solid ${C.red}`, color: C.red, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>X</button>
                        </>
                      ) : (
                        <span style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>✓ Aprobada</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 2. MENSAJES */}
          {detail.messages.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 10, color: '#00c9ff', fontWeight: 700, marginBottom: 12, letterSpacing: '0.05em' }}>✉️ MENSAJES DEDICATORIAS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {detail.messages.map((msg) => (
                  <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px', background: 'rgba(0,201,255,0.05)', borderRadius: 12, border: `1px solid #00c9ff30`, opacity: msg.status !== 'pending' ? 0.6 : 1 }}>
                    <div style={{ fontSize: 11, color: C.muted, fontStyle: 'italic', textDecoration: msg.status !== 'pending' ? 'line-through' : 'none' }}>"{msg.text}"</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 10, color: '#00c9ff', fontWeight: 600 }}>— {msg.author}</span>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {msg.status === 'pending' ? (
                          <>
                            <button onClick={() => handleMessageAction(msg.id, 'approved')} style={{ padding: '4px 10px', borderRadius: 6, background: '#00c9ff', border: 'none', color: '#000', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>Publicar</button>
                            <button onClick={() => handleMessageAction(msg.id, 'rejected')} style={{ padding: '4px 10px', borderRadius: 6, background: 'transparent', border: `1px solid ${C.red}`, color: C.red, fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>X</button>
                          </>
                        ) : (
                          <span style={{ fontSize: 10, color: '#00c9ff', fontWeight: 600 }}>✓ Publicado</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 3. BEBIDAS */}
          {detail.items.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 12, letterSpacing: '0.05em' }}>BEBIDAS Y PRODUCTOS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {detail.items.map((it, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: `1px solid ${C.border2}` }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: it.status === 'completed' ? C.muted : '#fff', textDecoration: it.status === 'completed' ? 'line-through' : 'none' }}>
                        {it.name} <span style={{ color: C.green, marginLeft: 4 }}>x1</span>
                      </div>
                      <div style={{ fontSize: 11, color: C.muted }}>${it.price.toLocaleString()}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {it.status !== 'completed' ? (
                        <>
                          <button onClick={() => updateItemStatus(it.orderId, it.itemIdx, 'completed')} style={{ padding: '6px 12px', borderRadius: 8, background: 'transparent', border: `1px solid ${C.green}`, color: C.green, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Entregar</button>
                          <button onClick={() => cancelItem(it.orderId, it.itemIdx)} style={{ padding: '6px 12px', borderRadius: 8, background: 'transparent', border: `1px solid ${C.red}`, color: C.red, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
                        </>
                      ) : (
                        <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>✓ Entregado</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* FOOTER TOTAL */}
        <div style={{ padding: '24px', background: 'rgba(0,0,0,0.2)', borderTop: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 14, color: C.muted }}>Total Mesa {selectedTableDetail}:</span>
            <span style={{ fontSize: 20, fontWeight: 900, color: C.green }}>${detail.total.toLocaleString()}</span>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={async () => {
                for (const id of detail.orderIds) await handleOrderAction(id, 'completed');
                setSelectedTableDetail(null);
              }}
              style={{ flex: 2, background: C.green, color: '#000', border: 'none', borderRadius: 10, padding: '14px', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}
            >
              Entregar mesa completa
            </button>
            <button
              onClick={async () => {
                if (confirm('¿Cancelar pedido completo?')) {
                  for (const id of detail.orderIds) await handleOrderAction(id, 'cancelled');
                  setSelectedTableDetail(null);
                }
              }}
              style={{ flex: 1, background: 'transparent', color: C.red, border: `1px solid ${C.red}`, borderRadius: 10, padding: '14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
            >
              Cancelar pedido
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.panel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ ...styles.sectionLabel, color: C.green, marginBottom: 0 }}>Gestión de Mesas</div>
        <div style={{ fontSize: 11, color: C.muted }}>{mesas.filter(m => tableGroups[m]?.items.some(it => it.status === 'pending')).length} mesas activas</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
        {mesas.map(m => {
          const group = tableGroups[m] || { items: [], songs: [], messages: [], total: 0 };
          const pendingItems = group.items.filter(it => it.status === 'pending');
          const hasActivity = group.items.length > 0 || group.songs.length > 0 || group.messages.length > 0;

          return (
            <div
              key={m}
              onClick={() => hasActivity && setSelectedTableDetail(m)}
              style={{
                background: C.panel2,
                borderRadius: 14,
                border: `1px solid ${hasActivity ? C.green + '40' : C.border}`,
                padding: 16,
                cursor: hasActivity ? 'pointer' : 'default',
                transition: '0.2s',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                minHeight: 140,
                boxShadow: hasActivity ? `0 4px 20px ${C.green}10` : 'none'
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: hasActivity ? C.green : C.panel, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: hasActivity ? '#000' : C.muted, fontSize: 12 }}>{m}</div>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>MESA {m}</span>
                  </div>
                  {hasActivity && <div style={{ width: 6, height: 6, background: C.green, borderRadius: '50%', boxShadow: `0 0 8px ${C.green}` }} />}
                </div>

                {hasActivity ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ fontSize: 11, color: C.muted }}>{pendingItems.length} pendientes</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                      {group.songs.length > 0 && <span style={{ fontSize: 11 }}>🎶{group.songs.length}</span>}
                      {group.messages.length > 0 && <span style={{ fontSize: 11 }}>✉️{group.messages.length}</span>}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: C.green, marginTop: 4 }}>${group.total.toLocaleString()}</div>
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: C.muted, fontStyle: 'italic', marginTop: 8 }}>Mesa libre</div>
                )}
              </div>

              <button
                onClick={(e) => { e.stopPropagation(); setShowManualOrder(m); }}
                style={{
                  marginTop: 14,
                  width: '100%',
                  padding: '8px',
                  borderRadius: 8,
                  background: hasActivity ? 'rgba(255,255,255,0.05)' : C.green,
                  color: hasActivity ? C.text : '#000',
                  border: 'none',
                  fontSize: 10,
                  fontWeight: 800,
                  cursor: 'pointer',
                  transition: '0.2s'
                }}
              >
                {hasActivity ? '+ AGREGAR' : 'NUEVO PEDIDO'}
              </button>
            </div>
          );
        })}
      </div>


      {/* MODAL PEDIDO MANUAL */}
      {showManualOrder && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: C.panel, width: '100%', maxWidth: 450, maxHeight: '90vh', borderRadius: 20, padding: 24, border: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <span style={{ ...styles.sectionLabel, color: C.green, marginBottom: 0 }}>Nuevo Pedido - Mesa {showManualOrder}</span>
              <button onClick={() => { setShowManualOrder(null); setManualCart([]); }} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 24, cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, paddingBottom: 20 }}>
              {drinks.map(d => {
                const count = manualCart.filter(it => it.id === d.id).length;
                return (
                  <div
                    key={d.id}
                    style={{ background: C.panel2, borderRadius: 12, padding: 10, border: `1px solid ${count > 0 ? C.green + '50' : C.border2}`, transition: '0.2s' }}

                  >
                    <img src={d.img} style={{ width: '100%', height: 80, objectFit: 'cover', borderRadius: 8, marginBottom: 8, opacity: count > 0 ? 1 : 0.5 }} />
                    <div style={{ fontSize: 11, fontWeight: 600, height: 26, overflow: 'hidden' }}>{d.name}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: C.green }}>${d.price.toLocaleString()}</div>
                      {count === 0 ? (
                        <button
                          onClick={() => setManualCart([...manualCart, d])}
                          style={{ background: C.green, color: '#000', border: 'none', borderRadius: 20, padding: '4px 12px', fontSize: 10, fontWeight: 800, cursor: 'pointer' }}
                        >
                          AGREGAR
                        </button>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(0,0,0,0.2)', borderRadius: 20, padding: '2px 6px', border: `1px solid ${C.green}50` }}>
                          <button
                            onClick={() => {
                              const idx = manualCart.findLastIndex(it => it.id === d.id);
                              if (idx !== -1) {
                                const next = [...manualCart];
                                next.splice(idx, 1);
                                setManualCart(next);
                              }
                            }}
                            style={{ background: 'none', border: 'none', color: '#fff', fontSize: 16, cursor: 'pointer', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                          >-</button>
                          <span style={{ fontSize: 12, fontWeight: 800, minWidth: 14, textAlign: 'center', color: C.green }}>{count}</span>
                          <button
                            onClick={() => setManualCart([...manualCart, d])}
                            style={{ background: 'none', border: 'none', color: C.green, fontSize: 16, cursor: 'pointer', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                          >+</button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {manualCart.length > 0 && (
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 12, color: C.muted }}>{manualCart.length} productos</div>
                    <div style={{ fontSize: 20, fontWeight: 900, color: '#fff' }}>${manualCart.reduce((a, b) => a + b.price, 0).toLocaleString()}</div>
                  </div>
                  <button onClick={() => setManualCart([])} style={{ background: 'none', border: 'none', color: C.red, fontSize: 12, fontWeight: 600 }}>Vaciar</button>
                </div>
                <button
                  onClick={handleSendManualOrder}
                  style={{ width: '100%', padding: '14px', borderRadius: 12, background: C.green, color: '#000', border: 'none', fontWeight: 900, cursor: 'pointer' }}
                >
                  CONFIRMAR PEDIDO
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const AdPanel = ({ ads, handleRemoveAdInternal, setShowAdModal }) => (
  <div style={styles.panel}>
    <div style={styles.sectionLabel}><IconAd /><span style={{ color: C.green }}>Publicidad</span></div>
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
            <button onClick={() => handleRemoveAdInternal(ad.id)} style={{ ...styles.actionBtn, background: 'transparent', color: C.red, opacity: 0.5 }}>
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
);

const SearchPanel = ({ query, setQuery, performSearch, results, searchSource, onAddSong, setResults, searching, suggestions, setSuggestions }) => (
  <div style={{ ...styles.panel, border: `0.5px solid ${C.green}30`, position: 'relative' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
      <div style={{ ...styles.sectionLabel, color: C.green, marginBottom: 0 }}>Buscador maestro</div>
      {searchSource && <span style={{ fontSize: 9, color: C.muted }}>vía {searchSource}</span>}
    </div>
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', background: C.panel2, padding: '9px 14px', borderRadius: 7, alignItems: 'center', gap: 10, border: `0.5px solid ${C.border}`, position: 'relative' }}>
        <IconSearch />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && performSearch(query)}
          placeholder="Escribe el nombre de la canción..."
          style={{ flex: 1, background: 'none', border: 'none', color: C.text, outline: 'none', fontSize: 13 }}
        />
        {searching && (
          <div style={{ width: 14, height: 14, border: `2px solid ${C.green}30`, borderTop: `2px solid ${C.green}`, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        )}
      </div>

      {suggestions.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: C.panel2, border: `0.5px solid ${C.border}`, borderRadius: '0 0 7px 7px', zIndex: 100, boxShadow: '0 10px 30px rgba(0,0,0,0.5)', marginTop: -1 }}>
          {suggestions.map((s, i) => (
            <div
              key={i}
              onClick={() => { setQuery(s); performSearch(s); setSuggestions([]); }}
              style={{ padding: '10px 14px', fontSize: 12, cursor: 'pointer', borderBottom: i === suggestions.length - 1 ? 'none' : `0.5px solid ${C.border}`, color: '#fff' }}
              onMouseEnter={e => e.target.style.background = 'rgba(255,255,255,0.05)'}
              onMouseLeave={e => e.target.style.background = 'transparent'}
            >
              {s}
            </div>
          ))}
        </div>
      )}
    </div>

    {results.length > 0 && (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14 }}>
        {results.map(track => (
          <div key={track.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', background: C.panel2, borderRadius: 7, border: `0.5px solid ${C.border}` }}>
            <img src={track.img} style={{ width: 32, height: 32, borderRadius: 4 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.title}</div>
              <div style={{ fontSize: 9, color: C.muted }}>{track.artist}</div>
            </div>
            <button onClick={() => { onAddSong(track); setQuery(""); setResults([]); }} style={{ ...styles.actionBtn, background: C.green, color: '#000', width: 26, height: 26 }}>+</button>
          </div>
        ))}
      </div>
    )}
  </div>
);

const QueuePanel = ({ approvedQueue, currentIdx, onPlay, onRemove, queue, onClearQueue }) => (
  <div style={styles.panel}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
      <span style={styles.sectionLabel}>Cola aprobada ({approvedQueue.length})</span>
      {queue.length > 0 && (
        <button onClick={onClearQueue} style={{ background: 'transparent', border: `1px solid ${C.red}60`, color: C.red, padding: '4px 12px', borderRadius: 6, fontSize: 10, cursor: 'pointer' }}>Vaciar lista</button>
      )}
    </div>
    {approvedQueue.length === 0 ? <div style={{ fontSize: 11, color: '#333', textAlign: 'center', padding: '20px 0' }}>Cola vacía</div> : approvedQueue.map((song, idx) => (
      <div key={song.queueRowId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 6px', borderBottom: `0.5px solid ${C.border}` }}>
        <div style={{ width: 16, fontSize: 10, color: idx === currentIdx ? C.green : C.muted }}>{idx === currentIdx ? '▶' : idx + 1}</div>
        <img src={song.img} style={{ width: 32, height: 32, borderRadius: 4 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: idx === currentIdx ? C.green : C.text }}>{song.title}</div>
          <div style={{ fontSize: 10, color: C.muted }}>{song.artist}</div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => onPlay(idx)} style={{ ...styles.actionBtn, background: C.panel2, width: 24, height: 24 }}><IconPlaySmall /></button>
          <button onClick={() => onRemove(queue.indexOf(song))} style={{ ...styles.actionBtn, background: 'transparent', color: C.red, width: 24, height: 24 }}><IconTrash /></button>
        </div>
      </div>
    ))}
  </div>
);


const SidebarItem = ({ icon: Icon, label, tabId, activeTab, setActiveTab }) => {
  const active = activeTab === tabId;
  return (
    <div
      onClick={() => setActiveTab(tabId)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 10,
        cursor: 'pointer', background: active ? 'rgba(29,185,84,0.1)' : 'transparent',
        color: active ? C.green : C.text, transition: '0.2s', marginBottom: 4,
        border: active ? `0.5px solid ${C.green}30` : '0.5px solid transparent'
      }}
    >
      <Icon />
      <span style={{ fontSize: 13, fontWeight: active ? 600 : 400 }}>{label}</span>
    </div>
  );
};

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
  const [selectedTableDetail, setSelectedTableDetail] = useState(null);

  const updateItemStatus = async (orderId, itemIndex, newStatus) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    const newItems = [...order.items];
    newItems[itemIndex] = { ...newItems[itemIndex], status: newStatus };

    // Si todos los items están completados, marcar orden como completada
    const allDone = newItems.every(i => i.status === 'completed');

    const { error } = await supabase.from('drink_orders').update({
      items: newItems,
      status: allDone ? 'completed' : 'pending'
    }).eq('id', orderId);

    if (error) console.error("Error actualizando item:", error);
  };

  const cancelItem = async (orderId, itemIndex, songId, type) => {
    if (type === 'song') {
      await supabase.from('queue').delete().eq('id', songId);
      return;
    }
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    const newItems = order.items.filter((_, i) => i !== itemIndex);

    if (newItems.length === 0) {
      await handleOrderAction(orderId, 'cancelled');
    } else {
      const newTotal = newItems.reduce((acc, i) => acc + i.price, 0);
      await supabase.from('drink_orders').update({ items: newItems, total: newTotal }).eq('id', orderId);
    }
  };
  const [showAdModal, setShowAdModal] = useState(false);
  const [newAd, setNewAd] = useState({ title: '', image_url: '', frequency: 1 });
  const [adFile, setAdFile] = useState(null);
  const [uploadingAd, setUploadingAd] = useState(false);
  const [screenMessages, setScreenMessages] = useState([]);
  const [pendingFilter, setPendingFilter] = useState('all'); // ← NUEVO
  const [searchSource, setSearchSource] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [orders, setOrders] = useState([]); // ← NUEVO

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
          audio.play().catch(() => { });
        }
      }).subscribe();
    return () => supabase.removeChannel(channel);
  }, [establishmentId]);

  // ─── Pedidos de bebidas en tiempo real ─────────────────────────────────────
  useEffect(() => {
    if (!supabase || !establishmentId) return;
    const fetchOrders = async () => {
      const { data } = await supabase
        .from('drink_orders').select('*')
        .eq('establishment_id', establishmentId)
        .order('created_at', { ascending: false });
      if (data) setOrders(data);
    };
    fetchOrders();
    const channel = supabase
      .channel('admin-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drink_orders' }, (payload) => {
        if (payload.new && payload.new.establishment_id === establishmentId) {
          if (payload.eventType === 'INSERT') {
            setOrders(prev => [payload.new, ...prev]);
            new Audio("https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3").play().catch(() => { });
          } else if (payload.eventType === 'UPDATE') {
            setOrders(prev => prev.map(o => o.id === payload.new.id ? payload.new : o));
          } else if (payload.eventType === 'DELETE') {
            setOrders(prev => prev.filter(o => o.id !== payload.old.id));
          }
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
      audio.play().catch(() => { });
    }
  };

  // ─── Acciones de Pedidos ──────────────────────────────────────────────────
  const handleOrderAction = async (id, status) => {
    try {
      const { error } = await supabase.from('drink_orders').update({ status }).eq('id', id);
      if (error) throw error;
    } catch (err) {
      alert("Error al actualizar pedido: " + err.message);
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
        audio.play().catch(() => { });
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


  return (
    <div style={{ display: 'flex', height: '100vh', background: C.bg, color: C.text, fontFamily: 'system-ui, sans-serif', overflow: 'hidden' }}>

      {/* ── SIDEBAR ────────────────────────────────────────────────────────── */}
      <aside style={{ width: 240, background: C.panel, borderRight: `0.5px solid ${C.border}`, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '24px', borderBottom: `0.5px solid ${C.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <div style={{ width: 10, height: 10, background: C.green, borderRadius: '50%', boxShadow: `0 0 10px ${C.green}60` }} />
            <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.04em' }}>
              Up-Track
            </span>
          </div>
          <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, letterSpacing: '0.1em' }}>PRO MANAGEMENT</div>
        </div>

        <SidebarStats
          queue={queue}
          clientStats={clientStats}
          approvedMessagesCount={approvedMessagesCount}
          screenMessages={screenMessages}
          ads={ads}
          credits={credits}
          lowCredit={lowCredit}
        />

        <nav style={{ flex: 1, padding: '20px 12px', overflowY: 'auto' }}>
          <SidebarItem icon={IconHome} label="Pedidos" tabId="dashboard" activeTab={activeTab} setActiveTab={setActiveTab} />
          <SidebarItem icon={IconMusic} label="Reproducción" tabId="queue" activeTab={activeTab} setActiveTab={setActiveTab} />
          <SidebarItem icon={IconAd} label="Publicidad" tabId="ads" activeTab={activeTab} setActiveTab={setActiveTab} />
          <div style={{ margin: '16px 16px 8px', fontSize: 10, color: C.muted, fontWeight: 600, letterSpacing: '0.1em' }}>SISTEMA</div>
          <SidebarItem icon={IconSettings} label="Configuración" tabId="settings" activeTab={activeTab} setActiveTab={setActiveTab} />
        </nav>

        <div style={{ padding: '16px 20px', borderTop: `0.5px solid ${C.border}`, background: '#0d0d0d' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: C.panel2, border: `0.5px solid ${C.border2}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
              🏢
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {establishmentName || 'Local Bogotá'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                <div style={{ width: 5, height: 5, background: C.green, borderRadius: '50%', boxShadow: `0 0 6px ${C.green}` }} />
                <div style={{ fontSize: 9, color: C.muted, fontWeight: 600, letterSpacing: '0.01em' }}>Suscripción Premium</div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* ── CONTENIDO PRINCIPAL ────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {lastNewTrack && <NewBadge track={lastNewTrack} onDone={() => setLastNewTrack(null)} />}

        {/* ── HEADER ──────────────────────────────────────────────────────────── */}
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 24px', borderBottom: `0.5px solid ${C.border}`, background: C.panel }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
              {activeTab === 'dashboard' ? 'Pedidos del Establecimiento' : activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
              {establishmentName && <span style={{ marginLeft: 8, color: C.muted, fontWeight: 400 }}>· {establishmentName}</span>}
            </h2>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {/* Créditos */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: credits <= lowCredit ? 'rgba(226,75,74,0.08)' : '#0d0d0d', padding: '6px 14px', borderRadius: 10, border: `0.5px solid ${credits <= lowCredit ? C.red : C.border2}` }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 8, color: C.muted, fontWeight: 600 }}>SALDO UP-T</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: credits <= lowCredit ? C.red : C.green }}>
                  {credits} <span style={{ fontSize: 9, fontWeight: 400, color: C.muted }}>Créditos</span>
                </div>
              </div>
              <button
                onClick={() => window.open('https://wa.me/tu_numero', '_blank')}
                style={{ background: credits <= lowCredit ? C.red : C.panel2, color: credits <= lowCredit ? '#000' : C.text, border: 'none', padding: '6px 10px', borderRadius: 6, fontSize: 9, fontWeight: 700, cursor: 'pointer' }}
              >
                RECARGAR
              </button>
            </div>

            {/* Toggle auto-play */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#0d0d0d', padding: '8px 14px', borderRadius: 10, border: `0.5px solid ${C.border2}` }}>
              <span style={{ fontSize: 11, color: autoPlay ? C.green : C.muted, fontWeight: 500 }}>{autoPlay ? 'Auto-play' : 'Moderación'}</span>
              <div onClick={() => onToggleAutoPlay(!autoPlay)} style={{ width: 34, height: 18, background: autoPlay ? C.green : '#333', borderRadius: 10, position: 'relative', cursor: 'pointer', transition: '0.3s' }}>
                <div style={{ width: 14, height: 14, background: '#fff', borderRadius: '50%', position: 'absolute', top: 2, left: autoPlay ? 18 : 2, transition: '0.2s', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }} />
              </div>
            </div>

            {/* Abrir TV */}
            <button
              onClick={() => window.open('/tvVideo', '_blank')}
              style={{ background: C.green, color: '#000', border: 'none', padding: '8px 16px', borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, boxShadow: `0 4px 14px ${C.green}30` }}
            >
              <IconTv /> Abrir TV
            </button>
          </div>
        </header>

        {/* ── CONTENIDO SCROLLABLE ───────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px', boxSizing: 'border-box', background: '#080808' }}>

          {/* DASHBOARD VIEW - PEDIDOS */}
          {activeTab === 'dashboard' && (
            <div style={{ maxWidth: 1000, margin: '0 auto' }}>
              <OrderPanel
                orders={orders}
                handleOrderAction={handleOrderAction}
                selectedTableDetail={selectedTableDetail}
                setSelectedTableDetail={setSelectedTableDetail}
                updateItemStatus={updateItemStatus}
                cancelItem={cancelItem}
                queue={queue}
                screenMessages={screenMessages}
                handleApproveSong={handleApproveSong}
                handleMessageAction={handleMessageAction}
                establishmentId={establishmentId}
              />
            </div>
          )}

          {/* REPRODUCCIÓN VIEW */}
          {activeTab === 'queue' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <SearchPanel
                query={query}
                setQuery={setQuery}
                performSearch={performSearch}
                results={results}
                searchSource={searchSource}
                onAddSong={onAddSong}
                setResults={setResults}
                searching={searching}
                suggestions={suggestions}
                setSuggestions={setSuggestions}
              />
              <QueuePanel
                approvedQueue={approvedQueue}
                currentIdx={currentIdx}
                onPlay={onPlay}
                onRemove={onRemove}
                queue={queue}
                onClearQueue={onClearQueue}
              />
            </div>
          )}

          {/* PUBLICIDAD VIEW */}
          {activeTab === 'ads' && (
            <div style={{ maxWidth: 600, margin: '0 auto' }}>
              <AdPanel ads={ads} handleRemoveAdInternal={handleRemoveAdInternal} setShowAdModal={setShowAdModal} />
            </div>
          )}

          {/* CONFIGURACIÓN VIEW */}
          {activeTab === 'settings' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60%', color: C.muted, flexDirection: 'column', gap: 12 }}>
              <IconSettings />
              <div style={{ fontSize: 14 }}>Ajustes del Sistema</div>
              <div style={{ fontSize: 11, opacity: 0.5 }}>Próximamente: Personalización de TV y Límites de pedidos</div>
            </div>
          )}

        </div>
      </div>

      {/* ── MODAL NUEVO ANUNCIO ──────────────────────────────────────────────── */}
      {showAdModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.80)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ ...panel, width: '100%', maxWidth: 400, boxSizing: 'border-box', border: `0.5px solid ${C.green}50`, padding: 24 }}>
            <div style={{ ...sectionLabel, color: C.green, marginBottom: 18 }}>Nueva pauta publicitaria</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <input
                type="text" placeholder="Nombre de la marca"
                value={newAd.title}
                style={{ width: '100%', boxSizing: 'border-box', background: C.panel2, border: `0.5px solid ${C.border2}`, padding: '10px 12px', borderRadius: 7, color: C.text, fontSize: 13 }}
                onChange={e => setNewAd({ ...newAd, title: e.target.value })}
              />
              <input
                type="file" accept="image/*"
                style={{ width: '100%', boxSizing: 'border-box', background: C.panel2, border: `0.5px solid ${C.border2}`, padding: '10px 12px', borderRadius: 7, color: C.text, fontSize: 12 }}
                onChange={e => setAdFile(e.target.files[0])}
              />
              <select
                value={newAd.frequency}
                style={{ width: '100%', boxSizing: 'border-box', background: C.panel2, border: `0.5px solid ${C.border2}`, padding: '10px 12px', borderRadius: 7, color: C.text, fontSize: 13 }}
                onChange={e => setNewAd({ ...newAd, frequency: parseInt(e.target.value) })}
              >
                <option value="1">Cada 1 canciones</option>
                <option value="3">Cada 3 canciones</option>
                <option value="5">Cada 5 canciones</option>
              </select>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setShowAdModal(false)} style={{ flex: 1, padding: '10px', borderRadius: 7, background: 'transparent', border: `0.5px solid ${C.border2}`, color: C.muted }}>Cancelar</button>
                <button onClick={handleSaveAdInternal} disabled={uploadingAd} style={{ flex: 1, padding: '10px', borderRadius: 7, background: C.green, color: '#000', fontWeight: 600 }}>{uploadingAd ? "..." : "Guardar"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}