import { useState, useEffect, useRef, useMemo } from "react";
import { supabase } from "./lib/supabase";

// ─── YOUTUBE CONFIG ──────────────────────────────────────────────────────────
const API_KEYS = [
  import.meta.env.VITE_YT_KEY_1,
  import.meta.env.VITE_YT_KEY_2,
  import.meta.env.VITE_YT_KEY_3,
  import.meta.env.VITE_YT_KEY_4,
  import.meta.env.VITE_YT_KEY_5,
].filter(Boolean);

const EXHAUSTED_KEY = "yt_exhausted_keys";
const EXHAUSTED_UNTIL_KEY = "yt_exhausted_until";
const COOLDOWN_MINUTES = 2;
const PIN_SESSION_KEY = "up_t_pin_verified"; // { estId, until }
const PIN_SESSION_HOURS = 1; // La sesión dura 1h — al cerrar el local se invalida sola

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
// Instancias ordenadas por confiabilidad — rota automáticamente si una falla
const INVIDIOUS_INSTANCES = [
  "https://yewtu.be",
  "https://invidious.privacydev.net",
  "https://inv.tux.pizza",
];
const INVIDIOUS_TIMEOUT_MS = 3000; // Si tarda más de 3s, cae a YouTube

// Normaliza un resultado de Invidious al mismo formato que usa la app
function normalizeInvidious(item) {
  const totalSecs = item.lengthSeconds || 0;
  const m = Math.floor(totalSecs / 60);
  const s = String(totalSecs % 60).padStart(2, "0");
  const duration = totalSecs > 0 ? `${m}:${s}` : "";

  const thumb =
    item.videoThumbnails?.find((t) => t.quality === "medium")?.url ||
    item.videoThumbnails?.[0]?.url ||
    "";

  return {
    id: item.videoId,
    title: item.title,
    artist: (item.author || "").replace(/ - Topic$| Music$/i, ""),
    img: thumb.startsWith("http") ? thumb : `https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg`,
    duration,
    videoId: item.videoId,
  };
}

// Normaliza un resultado de YouTube al mismo formato
function normalizeYouTube(item, durationMap = {}) {
  return {
    id: item.id.videoId,
    title: item.snippet.title,
    artist: (item.snippet.channelTitle || "").replace(/ - Topic$| Music$/i, ""),
    img: item.snippet.thumbnails.medium?.url || "",
    duration: durationMap[item.id.videoId] || "",
    videoId: item.id.videoId,
  };
}

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

// ─── BÚSQUEDA CON FALLBACK ───────────────────────────────────────────────────

// 1. Intenta buscar en Invidious rotando instancias
async function searchInvidious(term, signal) {
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), INVIDIOUS_TIMEOUT_MS);
      // Si el signal externo aborta, también abortamos esta petición
      signal?.addEventListener("abort", () => controller.abort());

      const res = await fetch(
        `${instance}/api/v1/search?q=${encodeURIComponent(term)}&type=video&fields=videoId,title,author,lengthSeconds,videoThumbnails&page=1`,
        { signal: controller.signal }
      );
      clearTimeout(timeoutId);

      if (!res.ok) continue; // Prueba con la siguiente instancia
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) continue;

      // Éxito — retorna los primeros 5 resultados normalizados
      return data.slice(0, 5).map(normalizeInvidious);
    } catch {
      // Timeout o error de red — prueba con la siguiente instancia
      continue;
    }
  }
  return null; // Todas las instancias fallaron
}

// 2. Fallback: busca en YouTube con rotación de API keys
async function searchYouTube(term, signal) {
  let currentKey = getAvailableKey();
  if (!currentKey) return { results: null, exhausted: true };

  const searchWithKey = async (key) => {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=5&q=${encodeURIComponent(term)}&key=${key}`,
      { signal }
    );
    return res.json();
  };

  try {
    let data = await searchWithKey(currentKey);

    while (isQuotaError(data)) {
      markKeyExhausted(currentKey);
      currentKey = getAvailableKey();
      if (!currentKey) return { results: null, exhausted: true };
      data = await searchWithKey(currentKey);
    }

    const items = data.items || [];
    if (!items.length) return { results: [], exhausted: false };

    // Obtiene duración de los videos
    const videoIds = items.map((i) => i.id.videoId).join(",");
    const detailRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${videoIds}&key=${currentKey}`,
      { signal }
    );
    const detailData = await detailRes.json();
    const durationMap = {};
    (detailData.items || []).forEach((v) => {
      durationMap[v.id] = formatDuration(v.contentDetails.duration);
    });

    return {
      results: items.map((item) => normalizeYouTube(item, durationMap)),
      exhausted: false,
    };
  } catch (e) {
    if (e.name === "AbortError") throw e;
    return { results: null, exhausted: false };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

const MOCK_NOW = {
  title: "Esperando canción...",
  artist: "Up-T Gastrobar",
  img: "https://picsum.photos/seed/nowplay/80/80",
};

const parseDurationString = (value) => {
  if (!value) return 0;
  const parts = String(value).split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
};

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

// ─── COMPONENTE PRINCIPAL ────────────────────────────────────────────────────

export default function CustomerView({ onSongRequest, queue = [], currentIdx = 0, establishmentId }) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [results, setResults] = useState([]);
  const [toast, setToast] = useState("");
  const [searching, setSearching] = useState(false);
  const [added, setAdded] = useState(new Set());
  const [error, setError] = useState("");
  // Indica si la búsqueda vino de Invidious o YouTube (para debug/logs)
  const [searchSource, setSearchSource] = useState(null);
  const [lastAddedSongId, setLastAddedSongId] = useState(null); // To track the last song added by this client

  const [showMsgModal, setShowMsgModal] = useState(false);
  const [msgText, setMsgText] = useState("");
  const [msgAuthor, setMsgAuthor] = useState("");
  const [sendingMsg, setSendingMsg] = useState(false);

  // ─── STATE PEDIDOS ────────────────────────────────────────────────────────
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [selectedMesa, setSelectedMesa] = useState(() => {
    return localStorage.getItem("up_t_selected_mesa") || null;
  });
  const [cart, setCart] = useState([]);
  const [showMesaError, setShowMesaError] = useState(false);
  const [recentOrders, setRecentOrders] = useState([]);
  const [myOrders, setMyOrders] = useState([]);
  const [tableOrders, setTableOrders] = useState([]);
  const [pendingSongAfterMesa, setPendingSongAfterMesa] = useState(null);
  const [pendingMsgAfterMesa, setPendingMsgAfterMesa] = useState(false);

  useEffect(() => {
    const savedRecent = localStorage.getItem("up_t_recent_orders");
    if (savedRecent) setRecentOrders(JSON.parse(savedRecent));
    
    const savedIds = JSON.parse(localStorage.getItem("up_t_my_order_ids") || "[]");
    if (savedIds.length > 0) {
      fetchMyOrders(savedIds);
      subscribeToMyOrders(savedIds);
    }
  }, [establishmentId]);

  useEffect(() => {
    if (selectedMesa) {
      localStorage.setItem("up_t_selected_mesa", selectedMesa);
    }
  }, [selectedMesa]);

  useEffect(() => {
    if (selectedMesa && establishmentId) {
      fetchTableOrders();
      const channel = supabase.channel(`table-orders-${selectedMesa}`)
        .on('postgres_changes', { 
          event: '*', 
          schema: 'public', 
          table: 'drink_orders',
          filter: `mesa=eq.${selectedMesa}`
        }, () => fetchTableOrders())
        .subscribe();
      return () => supabase.removeChannel(channel);
    }
  }, [selectedMesa, establishmentId]);

  const fetchTableOrders = async () => {
    const { data } = await supabase.from('drink_orders')
      .select('*')
      .eq('mesa', selectedMesa)
      .eq('establishment_id', establishmentId)
      .order('created_at', { ascending: false });
    if (data) setTableOrders(data);
  };

  const fetchMyOrders = async (ids) => {
    const { data } = await supabase.from('drink_orders').select('*').in('id', ids).order('created_at', { ascending: false });
    if (data) setMyOrders(data);
  };

  const subscribeToMyOrders = (ids) => {
    const channel = supabase.channel('my-orders-status')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'drink_orders' }, payload => {
        if (ids.includes(payload.new.id)) {
          setMyOrders(prev => prev.map(o => o.id === payload.new.id ? payload.new : o));
        }
      }).subscribe();
    return () => supabase.removeChannel(channel);
  };

  // ─── PIN GATE ────────────────────────────────────────────────────────────
  const [pinVerified, setPinVerified] = useState(false);

  useEffect(() => {
    if (!establishmentId) return;
    try {
      const stored = JSON.parse(localStorage.getItem(PIN_SESSION_KEY) || "null");
      if (stored && stored.estId === String(establishmentId) && Date.now() < stored.until) {
        setPinVerified(true);
      }
    } catch { }
  }, [establishmentId]);
  const [pinInput, setPinInput] = useState(["", "", "", ""]);
  const [pinError, setPinError] = useState("");
  const [pinLoading, setPinLoading] = useState(false);
  const pinRefs = [useRef(null), useRef(null), useRef(null), useRef(null)];

  const handlePinDigit = (val, idx) => {
    const digit = val.replace(/\D/g, "").slice(-1);
    const next = [...pinInput];
    next[idx] = digit;
    setPinInput(next);
    setPinError("");
    if (digit && idx < 3) pinRefs[idx + 1].current?.focus();
    if (!digit && idx > 0) pinRefs[idx - 1].current?.focus();
  };

  const handlePinKeyDown = (e, idx) => {
    if (e.key === "Backspace" && !pinInput[idx] && idx > 0) {
      pinRefs[idx - 1].current?.focus();
    }
  };

  const validatePin = async () => {
    const entered = pinInput.join("");
    if (entered.length < 4) { setPinError("Ingresa los 4 dígitos"); return; }
    setPinLoading(true);
    setPinError("");
    try {
      const { data, error } = await supabase
        .from("app_state")
        .select("pin, pin_expires_at")
        .eq("establishment_id", establishmentId)
        .maybeSingle();

      if (error || !data?.pin) { setPinError("Error al verificar. Intenta de nuevo."); return; }

      const expired = data.pin_expires_at && new Date(data.pin_expires_at) < new Date();
      if (expired) { setPinError("El PIN expiró. Pide el nuevo al staff."); return; }

      if (data.pin !== entered) {
        setPinError("PIN incorrecto");
        setPinInput(["", "", "", ""]);
        setTimeout(() => pinRefs[0].current?.focus(), 50);
        return;
      }

      // PIN correcto — guarda sesión por PIN_SESSION_HOURS
      localStorage.setItem(PIN_SESSION_KEY, JSON.stringify({
        estId: String(establishmentId),
        until: Date.now() + PIN_SESSION_HOURS * 60 * 60 * 1000,
      }));
      setPinVerified(true);
    } catch {
      setPinError("Error de conexión");
    } finally {
      setPinLoading(false);
    }
  };
  // ─────────────────────────────────────────────────────────────────────────

  const inputRef = useRef(null);

  const safeCurrentIdx = Math.min(Math.max(0, currentIdx), Math.max(0, queue.length - 1));
  const currentTrack = queue[safeCurrentIdx] || null;

  const queueHash = useMemo(() => queue.map((s) => s.id).join(","), [queue]);
  useEffect(() => {
    setAdded(new Set(queue.map((song) => song.id)));
  }, [queueHash]);

  // Sugerencias de búsqueda (Google Suggest)
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) { setSuggestions([]); return; }

    const timeout = setTimeout(() => {
      const cbName = "googleSuggestCb_" + Math.random().toString(36).substr(2, 9);
      window[cbName] = (data) => {
        if (data?.[1]) setSuggestions(data[1].map((item) => item[0]));
        delete window[cbName];
        document.getElementById(cbName)?.remove();
      };
      const s = document.createElement("script");
      s.id = cbName;
      s.src = `https://suggestqueries.google.com/complete/search?client=youtube&ds=yt&q=${encodeURIComponent(q)}&callback=${cbName}`;
      document.body.appendChild(s);
    }, 300);

    return () => clearTimeout(timeout);
  }, [query]);

  // ─── BÚSQUEDA CON FALLBACK EN CASCADA ───────────────────────────────────
  const performSearch = async (term) => {
    if (!term.trim()) return;
    setQuery(term);
    setSuggestions([]);
    setSearching(true);
    setError("");
    setSearchSource(null);

    const ctrl = new AbortController();

    try {
      // 1. Intenta Invidious primero
      const invidiousResults = await searchInvidious(term, ctrl.signal);

      if (invidiousResults && invidiousResults.length > 0) {
        setResults(invidiousResults);
        setSearchSource("invidious");
        return;
      }

      // 2. Invidious falló o no devolvió resultados → cae a YouTube
      console.warn("[Up-T] Invidious sin resultados, usando YouTube API...");
      const { results: ytResults, exhausted } = await searchYouTube(term, ctrl.signal);

      if (exhausted) {
        setError("Cuota agotada. Intenta mañana.");
        return;
      }

      if (!ytResults || ytResults.length === 0) {
        setResults([]);
        return;
      }

      setResults(ytResults);
      setSearchSource("youtube");
    } catch (e) {
      if (e.name !== "AbortError") setError("Error de conexión");
    } finally {
      setSearching(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────

  const addToQueue = async (track, forcedMesa = null) => {
    if (added.has(track.id)) return;

    const currentMesa = forcedMesa || selectedMesa;

    if (!currentMesa) {
      setPendingSongAfterMesa(track);
      setShowOrderModal(true);
      setToast("📍 Selecciona tu mesa para pedir la canción");
      return;
    }

    const lastRequest = localStorage.getItem("last_song_request");
    const now = Date.now();
    const cooldownMs = COOLDOWN_MINUTES * 60 * 1000;

    if (lastRequest && now - parseInt(lastRequest) < cooldownMs) {
      const remainingMin = Math.ceil((cooldownMs - (now - parseInt(lastRequest))) / 60000);
      setToast(`⏳ Espera ${remainingMin} min para pedir otra`);
      return;
    }

    const seconds = parseDurationString(track.duration);
    if (seconds > 480) {
      setToast("⚠️ Canción demasiado larga (máx. 8 min)");
      return;
    }

    // Optimistic update for added state
    setAdded((s) => new Set([...s, track.id]));
    setToast(`"${track.title}" agregada a la cola`);

    // Call onSongRequest and store the returned queueRowId
    try {
      const queueRowId = await onSongRequest({ ...track, is_cliente: true, mesa: currentMesa });
      localStorage.setItem("last_song_request", now.toString());
      setLastAddedSongId(queueRowId); // Store the ID to find its position later
    } catch (err) {
      console.error("Error adding song:", err);
      setError("Error al agregar canción.");
      setAdded(prev => { // Revert added state if error
        const newSet = new Set(prev);
        newSet.delete(track.id);
        return newSet;
      });
    }
  };

  // Effect to show toast with position after queue updates
  useEffect(() => {
    if (lastAddedSongId && queue.length > 0) {
      const approvedQueue = queue.filter(s => s.isApproved);
      const newSongIndex = approvedQueue.findIndex(s => s.queueRowId === lastAddedSongId);
      if (newSongIndex !== -1) {
        const absolutePosition = newSongIndex + 1;
        const relativePosition = absolutePosition - (currentIdx + 1);
        let message = `Tu canción fue añadida.`;
        if (relativePosition > 0) {
          message += ` Estás en el puesto #${relativePosition} de la fila.`;
        } else if (relativePosition === 0) {
          message += ` ¡Es la siguiente en sonar!`;
        } else {
          // This case should ideally not happen for a newly added song
          message += ` Ya está sonando o ha pasado.`;
        }
        setToast(message);
        setLastAddedSongId(null); // Reset to avoid re-triggering
      }
    }
  }, [queue, lastAddedSongId, currentIdx]);

  const handleSendMsg = async (forcedMesa = null) => {
    if (!msgText.trim()) return;

    const currentMesa = forcedMesa || selectedMesa;

    const lastMsg = localStorage.getItem("last_message_sent");
    const now = Date.now();
    const cooldownMs = COOLDOWN_MINUTES * 60 * 1000;

    if (lastMsg && now - parseInt(lastMsg) < cooldownMs) {
      const remainingMin = Math.ceil((cooldownMs - (now - parseInt(lastMsg))) / 60000);
      setToast(`⏳ Espera ${remainingMin} min para enviar otro`);
      return;
    }

    if (!currentMesa) {
      setPendingMsgAfterMesa(true);
      setShowOrderModal(true);
      setToast("📍 Selecciona tu mesa para enviar el mensaje");
      return;
    }

    setSendingMsg(true);
    try {
      const { error } = await supabase.from("screen_messages").insert([{
        text: msgText,
        author: msgAuthor || "Invitado",
        establishment_id: establishmentId,
        status: "pending",
        mesa: currentMesa,
      }]);
      if (error) throw error;
      setToast("Mensaje enviado a moderación ✨");
      localStorage.setItem("last_message_sent", now.toString());
      setMsgText("");
      setShowMsgModal(false);
    } catch {
      setToast("Error al enviar mensaje");
    } finally {
      setSendingMsg(false);
    }
  };

  const addToCart = (drink) => setCart([...cart, drink]);
  const cartTotal = cart.reduce((acc, curr) => acc + curr.price, 0);
  const handleEnviarPedido = async () => {
    if (!selectedMesa) { setShowMesaError(true); return; }
    if (cart.length === 0) { setToast("🛒 Carrito vacío"); return; }

    const orderData = {
      mesa: selectedMesa,
      items: cart.map(item => ({ id: item.id, name: item.name, price: item.price })),
      total: cartTotal,
      establishment_id: establishmentId,
      status: 'pending'
    };

    try {
      const { data: newOrder, error } = await supabase.from('drink_orders').insert([orderData]).select().single();
      if (error) throw error;
      
      // Guardar ID para seguimiento
      const savedIds = JSON.parse(localStorage.getItem("up_t_my_order_ids") || "[]");
      const updatedIds = [newOrder.id, ...savedIds].slice(0, 10);
      localStorage.setItem("up_t_my_order_ids", JSON.stringify(updatedIds));
      setMyOrders(prev => [newOrder, ...prev]);

      const updatedRecent = [orderData, ...recentOrders].slice(0, 5);
      setRecentOrders(updatedRecent);
      localStorage.setItem("up_t_recent_orders", JSON.stringify(updatedRecent));

      setToast(`Pedido enviado a la Mesa ${selectedMesa} ✨`);
      setShowOrderModal(false);
      setCart([]);
      setSelectedMesa(null);
    } catch (err) {
      console.error("Error sending order:", err);
      setToast("Error al enviar pedido");
    }
  };

  const repeatOrder = (order) => {
    setCart(order.items);
    setSelectedMesa(order.mesa);
    setToast("🛒 Carrito restaurado");
  };

  const drinks = [
    { id: 1, name: "Cerveza Club Colombia", price: 8000, img: "https://images.unsplash.com/photo-1535958636474-b021ee887b13?w=400&q=80" },
    { id: 2, name: "Aguardiente Antioqueño", price: 95000, img: "https://images.unsplash.com/photo-1569701813229-33284b643e3c?w=400&q=80" },
    { id: 3, name: "Ron Medellín 8 Años", price: 85000, img: "https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=400&q=80" },
    { id: 4, name: "Vodka Absolut", price: 120000, img: "https://images.unsplash.com/photo-1550985543-575662704043?w=400&q=80" },
    { id: 5, name: "Vino Tinto Reserva", price: 110000, img: "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=400&q=80" },
    { id: 6, name: "Agua Manantial", price: 5000, img: "https://images.unsplash.com/photo-1559839914-17aae19cea9e?w=400&q=80" },
  ];

  const bg = "#0a0a0a";
  const surface = "#161616";
  const surface2 = "#1c1c1c";
  const border = "rgba(255,255,255,0.07)";
  const muted = "rgba(255,255,255,0.35)";
  const muted2 = "rgba(255,255,255,0.18)";

  // ─── PIN GATE — bloquea todo el contenido hasta verificar ────────────────
  if (!pinVerified) {
    return (
      <div style={{
        minHeight: "100vh", background: bg, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", padding: "2rem",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}>
        <div style={{
          width: "100%", maxWidth: 340, display: "flex", flexDirection: "column",
          alignItems: "center", gap: 32, animation: "modalIn 0.4s ease",
        }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", letterSpacing: "0.22em", textTransform: "uppercase", marginBottom: 10 }}>
              Up-T · Gastrobar
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", marginBottom: 6 }}>
              Ingresa el PIN
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", lineHeight: 1.5 }}>
              Encuéntralo en la pantalla del local
            </div>
          </div>

          {/* 4 cajas de dígito */}
          <div style={{ display: "flex", gap: 12 }}>
            {pinInput.map((digit, i) => (
              <input
                key={i}
                ref={pinRefs[i]}
                type="tel"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handlePinDigit(e.target.value, i)}
                onKeyDown={(e) => handlePinKeyDown(e, i)}
                style={{
                  width: 56, height: 68, textAlign: "center", fontSize: 28,
                  fontWeight: 700, fontFamily: "'Courier New', monospace",
                  background: digit ? "rgba(29,185,84,0.1)" : "#161616",
                  border: `1.5px solid ${digit ? "rgba(29,185,84,0.5)" : "rgba(255,255,255,0.1)"}`,
                  borderRadius: 12, color: "#fff", outline: "none",
                  transition: "all 0.15s ease", caretColor: "transparent",
                }}
              />
            ))}
          </div>

          {/* Error */}
          {pinError && (
            <div style={{
              fontSize: 13, color: "rgba(255,100,100,0.9)", textAlign: "center",
              background: "rgba(255,60,60,0.08)", border: "1px solid rgba(255,60,60,0.2)",
              borderRadius: 10, padding: "10px 16px", width: "100%", boxSizing: "border-box",
              animation: "shake 0.3s ease",
            }}>
              {pinError}
            </div>
          )}

          {/* Botón */}
          <button
            onClick={validatePin}
            disabled={pinInput.join("").length < 4 || pinLoading}
            style={{
              width: "100%", padding: "14px", borderRadius: 30, border: "none",
              background: pinInput.join("").length === 4 ? "#1db954" : "rgba(255,255,255,0.08)",
              color: pinInput.join("").length === 4 ? "#000" : "rgba(255,255,255,0.3)",
              fontSize: 15, fontWeight: 700, cursor: pinInput.join("").length === 4 ? "pointer" : "default",
              transition: "all 0.2s ease", fontFamily: "inherit",
            }}
          >
            {pinLoading
              ? <span style={{ display: "inline-block", width: 18, height: 18, border: "2px solid rgba(0,0,0,0.3)", borderTopColor: "#000", borderRadius: "50%", animation: "spin 0.7s linear infinite", verticalAlign: "middle" }} />
              : "Entrar"
            }
          </button>
        </div>

        <style>{`
          @keyframes modalIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
          @keyframes shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-6px)} 75%{transform:translateX(6px)} }
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    );
  }
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div style={{
      background: bg, minHeight: "100vh", color: "#fff",
      fontFamily: "system-ui, -apple-system, sans-serif",
      maxWidth: 480, margin: "0 auto", paddingBottom: 100,
    }}>
      {toast && <Toast msg={toast} onDone={() => setToast("")} />}

      {/* HEADER + BUSCADOR */}
      <div style={{
        padding: "20px 18px 12px", position: "sticky", top: 0,
        background: bg, zIndex: 10, borderBottom: `1px solid ${border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
          <div style={{ fontSize: 10, color: muted, letterSpacing: "0.14em", fontWeight: 600 }}>GASTROBAR</div>
          {/* Indicador sutil de fuente — útil para debug, puedes quitarlo en prod */}
          {searchSource && (
            <span style={{ fontSize: 9, color: muted2, letterSpacing: "0.08em" }}>
              vía {searchSource === "invidious" ? "⚡ invidious" : "▶ youtube"}
            </span>
          )}
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#fff", marginBottom: 14 }}>Pide tu canción</div>

        <div
          style={{
            background: surface2, borderRadius: 12, display: "flex",
            alignItems: "center", gap: 10, padding: "10px 14px", border: `1px solid ${border}`,
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
            onChange={(e) => { setQuery(e.target.value); if (results.length > 0) setResults([]); }}
            onKeyDown={(e) => e.key === "Enter" && performSearch(query)}
            placeholder="Artista o canción..."
            style={{ flex: 1, background: "none", border: "none", outline: "none", color: "#fff", fontSize: 15, fontFamily: "inherit" }}
          />
          {query.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setQuery(""); setResults([]); setSuggestions([]); setSearchSource(null); }}
              style={{ background: "none", border: "none", color: muted, cursor: "pointer", display: "flex", alignItems: "center" }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* SUGERENCIAS */}
      {!searching && results.length === 0 && (
        <div style={{ margin: "0 18px" }}>
          {query.trim().length > 0 && query.trim().length < 3 ? (
            <div style={{ padding: "14px", color: muted, fontSize: 12, textAlign: "center" }}>
              Escribe al menos 3 letras...
            </div>
          ) : suggestions.length > 0 && (
            <div style={{ background: surface, borderRadius: 12, border: `1px solid ${border}`, overflow: "hidden" }}>
              {suggestions.map((tip, i) => (
                <div
                  key={i}
                  onClick={() => performSearch(tip)}
                  style={{ padding: "14px", borderBottom: i < suggestions.length - 1 ? `1px solid ${border}` : "none", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={muted} strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>
                  {tip}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ERROR */}
      {error && (
        <div style={{ margin: "14px 18px", padding: "12px 16px", background: "rgba(255,60,60,0.08)", border: "1px solid rgba(255,60,60,0.2)", borderRadius: 10, fontSize: 13, color: "rgba(255,100,100,0.9)" }}>
          {error}
        </div>
      )}

      {/* SONANDO AHORA */}
      <div style={{ margin: "14px 14px 0" }}>
        <div style={{ background: surface, borderRadius: 14, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, border: "1px solid rgba(29,185,84,0.2)" }}>
          <img src={currentTrack?.img || MOCK_NOW.img} style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover" }} alt="" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, color: "#1db954", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 2 }}>SONANDO AHORA</div>
            <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{currentTrack?.title || MOCK_NOW.title}</div>
            <div style={{ fontSize: 12, color: muted }}>{currentTrack?.artist || MOCK_NOW.artist}</div>
          </div>
          <EqBars />
        </div>
      </div>

      {/* RESULTADOS */}
      {!error && results.length > 0 && (
        <div style={{ margin: "18px 14px 0" }}>
          <div style={{ fontSize: 10, color: muted2, letterSpacing: "0.12em", fontWeight: 600, marginBottom: 10 }}>RESULTADOS</div>
          {results.map((track) => (
            <div key={track.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 10px", background: surface, borderRadius: 12, marginBottom: 4, border: `1px solid ${border}` }}>
              <img src={track.img} style={{ width: 46, height: 46, borderRadius: 8, objectFit: "cover" }} alt="" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{track.title}</div>
                <div style={{ fontSize: 11, color: muted }}>{track.artist}{track.duration ? ` · ${track.duration}` : ""}</div>
              </div>
              <button
                onClick={() => addToQueue(track)}
                style={{ width: 34, height: 34, borderRadius: "50%", border: "none", flexShrink: 0, background: added.has(track.id) ? "rgba(29,185,84,0.15)" : "#1db954", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
              >
                {added.has(track.id)
                  ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1db954" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  : <svg width="12" height="12" viewBox="0 0 10 10" fill="#000"><polygon points="3,1 9,5 3,9"/></svg>
                }
              </button>
            </div>
          ))}
        </div>
      )}

      {/* COLA */}
      {queue.length > 0 && (
        <div style={{ margin: "22px 14px 0" }}>
          <div style={{ fontSize: 10, color: muted2, fontWeight: 600, marginBottom: 10 }}>
            A CONTINUACIÓN ({Math.max(0, queue.length - (safeCurrentIdx + 1))})
          </div>
          {queue
            .map((track, i) => ({ ...track, originalIdx: i }))
            .filter((_, i) => i > safeCurrentIdx)
            .map((track) => (
              <div key={track.id + track.originalIdx} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 10px" }}>
                <div style={{ width: 22, fontSize: 12, color: muted2 }}>{track.originalIdx + 1}</div>
                <img src={track.img} style={{ width: 38, height: 38, borderRadius: 6, objectFit: "cover" }} alt="" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{track.title}</div>
                  <div style={{ fontSize: 11, color: muted }}>{track.artist}</div>
                </div>
              </div>
            ))}
          {safeCurrentIdx >= queue.length - 1 && (
            <div style={{ padding: "20px", textAlign: "center", color: muted2, fontSize: 13, border: `1px dashed ${muted2}`, borderRadius: 12 }}>
              No hay más canciones en cola. ¡Pide la tuya!
            </div>
          )}
        </div>
      )}

      {/* BOTÓN PEDIDO (BEBIDA) */}
      <button
        onClick={() => setShowOrderModal(true)}
        style={{ position: "fixed", bottom: 86, right: 20, width: 56, height: 56, borderRadius: "50%", background: "#00C853", color: "#000", border: "none", boxShadow: "0 8px 24px rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 100, fontSize: 24 }}
      >
        🍺
      </button>

      {/* BOTÓN MENSAJE */}
      <button
        onClick={() => setShowMsgModal(true)}
        style={{ position: "fixed", bottom: 20, right: 20, width: 56, height: 56, borderRadius: "50%", background: "#1db954", color: "#000", border: "none", boxShadow: "0 8px 24px rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 100 }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </button>

      {/* MODAL MENSAJE */}
      {showMsgModal && (
        <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", background: "rgba(0,0,0,0.85)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}>
          <div style={{ background: surface, width: "100%", maxWidth: 400, borderRadius: 20, padding: 24, border: `1px solid ${border}`, animation: "modalIn 0.3s ease" }}>
            <h3 style={{ marginTop: 0, fontSize: 18, color: "#1db954" }}>Enviar saludo a la Pantalla</h3>
            <input
              placeholder="Tu nombre"
              value={msgAuthor}
              onChange={(e) => setMsgAuthor(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", background: bg, border: `1px solid ${border}`, padding: "12px", borderRadius: 8, color: "#fff", marginBottom: 12, fontFamily: "inherit" }}
            />
            <textarea
              placeholder="Mensaje"
              value={msgText}
              onChange={(e) => setMsgText(e.target.value)}
              maxLength={100}
              rows={3}
              style={{ width: "100%", boxSizing: "border-box", background: bg, border: `1px solid ${border}`, padding: "12px", borderRadius: 8, color: "#fff", resize: "none", fontFamily: "inherit" }}
            />
            <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
              <button onClick={() => setShowMsgModal(false)} style={{ flex: 1, background: "transparent", color: "#fff", border: `1px solid ${border}`, padding: "12px", borderRadius: 30, cursor: "pointer", fontFamily: "inherit" }}>Cancelar</button>
              <button onClick={handleSendMsg} disabled={!msgText.trim() || sendingMsg} style={{ flex: 1, background: "#1db954", color: "#000", border: "none", padding: "12px", borderRadius: 30, fontWeight: "bold", cursor: "pointer", fontFamily: "inherit" }}>
                {sendingMsg ? "..." : "Enviar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL PEDIDOS OVERHAUL */}
      {showOrderModal && (
        <div style={{
          position: "fixed", top: 0, left: "50%", width: "100%", maxWidth: 480, height: "100%", 
          background: "#0d0d0d", zIndex: 2000, display: "flex", flexDirection: "column",
          animation: "slideUp 0.3s ease-out forwards", fontFamily: "system-ui, -apple-system, sans-serif"
        }}>
          {/* HEADER */}
          <div style={{ display: "flex", alignItems: "center", padding: "20px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
            <button onClick={() => setShowOrderModal(false)} style={{ background: "none", border: "none", color: "#fff", fontSize: 24, cursor: "pointer", marginRight: 16 }}>←</button>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 18, fontWeight: "bold", color: "#fff" }}>Mesa {selectedMesa || "..."}</div>
              <div style={{ fontSize: 12, color: muted }}>{selectedMesa ? "Gestión de pedido en curso" : "Selecciona tu mesa para comenzar"}</div>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "16px", paddingBottom: 120 }}>
            {/* SECCIÓN 1: MI PEDIDO ACTUAL */}
            {selectedMesa && (
              <div style={{ background: surface, borderRadius: 20, padding: 20, border: `1px solid ${border}`, marginBottom: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>MI PEDIDO ACTUAL</div>
                  <div style={{ fontSize: 11, color: "#1db954", background: "rgba(29,185,84,0.1)", padding: "4px 10px", borderRadius: 20 }}>EN VIVO</div>
                </div>
                
                {tableOrders.filter(o => o.status !== 'cancelled').length === 0 ? (
                  <div style={{ textAlign: "center", padding: "20px 0", color: muted, fontSize: 13 }}>No has pedido nada aún</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {tableOrders.filter(o => o.status !== 'cancelled').map(ord => (
                      <div key={ord.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {ord.items.map((it, i) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 500, color: it.status === 'completed' ? muted : '#fff', textDecoration: it.status === 'completed' ? 'line-through' : 'none' }}>
                                {it.name} <span style={{ color: "#1db954", marginLeft: 4 }}>x1</span>
                              </div>
                              <div style={{ fontSize: 10, color: muted }}>${it.price.toLocaleString()}</div>
                            </div>
                            <div style={{ 
                              fontSize: 9, fontWeight: 800, padding: "3px 8px", borderRadius: 4,
                              background: it.status === 'completed' ? 'rgba(29,185,84,0.1)' : 'rgba(239,159,39,0.1)',
                              color: it.status === 'completed' ? '#1db954' : '#EF9F27'
                            }}>
                              {it.status === 'completed' ? 'ENTREGADO' : 'PENDIENTE'}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                    <div style={{ borderTop: `1px solid ${border}`, paddingTop: 14, marginTop: 4, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>TOTAL MESA</span>
                      <span style={{ fontSize: 20, fontWeight: 900, color: "#1db954", textShadow: "0 0 15px rgba(29,185,84,0.3)" }}>
                        ${tableOrders.filter(o => o.status !== 'cancelled').reduce((acc, o) => acc + o.total, 0).toLocaleString()}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* SECCIÓN 2: AGREGAR AL PEDIDO (ACORDEÓN) */}
            <details open={!selectedMesa} style={{ marginBottom: 20 }}>
              <summary style={{ listStyle: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0" }}>
                <span style={{ fontSize: 15, fontWeight: "bold", color: "#fff" }}>➕ Agregar al pedido</span>
                <span style={{ color: muted }}>▼</span>
              </summary>
              
              <div style={{ padding: "12px 0" }}>
                {/* SELECTOR DE MESA */}
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 13, color: muted, marginBottom: 12 }}>📍 ¿En qué mesa estás?</div>
                  <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 10, scrollbarWidth: "none" }}>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(m => (
                      <div 
                        key={m}
                        onClick={() => { 
                          setSelectedMesa(m); 
                          setShowMesaError(false);
                          if (pendingSongAfterMesa) {
                            addToQueue(pendingSongAfterMesa, m);
                            setPendingSongAfterMesa(null);
                          }
                          if (pendingMsgAfterMesa) {
                            handleSendMsg(m);
                            setPendingMsgAfterMesa(false);
                          }
                        }}
                        style={{
                          flexShrink: 0, width: 80, height: 40, borderRadius: 25, 
                          display: "flex", alignItems: "center", justifyContent: "center",
                          background: selectedMesa === m ? "rgba(29,185,84,0.2)" : "rgba(255,255,255,0.05)",
                          border: `2px solid ${selectedMesa === m ? "#1db954" : "transparent"}`,
                          color: selectedMesa === m ? "#1db954" : "#fff",
                          fontWeight: 700, cursor: "pointer", transition: "0.2s"
                        }}
                      >
                        Mesa {m}
                      </div>
                    ))}
                  </div>
                  {showMesaError && <div style={{ color: "#E24B4A", fontSize: 11, marginTop: 8 }}>⚠️ Selecciona tu mesa primero</div>}
                </div>

                {/* CUADRÍCULA DE BEBIDAS */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  {drinks.map(drink => (
                    <div key={drink.id} style={{ background: surface, borderRadius: 18, overflow: "hidden", border: `1px solid ${border}` }}>
                      <div style={{ position: "relative", height: 120 }}>
                        <img src={drink.img} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" />
                        <div style={{ position: "absolute", bottom: 8, left: 8, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", padding: "4px 8px", borderRadius: 8, fontSize: 11, fontWeight: 700, color: "#fff" }}>
                          ${drink.price.toLocaleString()}
                        </div>
                      </div>
                      <div style={{ padding: 12 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", height: 32, overflow: "hidden", marginBottom: 10 }}>{drink.name}</div>
                        <button 
                          onClick={() => {
                            setCart([...cart, drink]);
                            setToast(`+ ${drink.name}`);
                          }}
                          style={{ width: "100%", padding: "8px", borderRadius: 10, border: `1px solid ${border}`, background: "transparent", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                          onMouseEnter={e => e.currentTarget.style.borderColor = "#1db954"}
                          onMouseLeave={e => e.currentTarget.style.borderColor = border}
                        >
                          + Agregar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </details>

            {/* SECCIÓN 3: HISTORIAL */}
            <details style={{ marginTop: 20 }}>
              <summary style={{ listStyle: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", opacity: 0.6 }}>
                <span style={{ fontSize: 13, fontWeight: "bold", color: "#fff" }}>📜 Historial de la noche</span>
                <span style={{ color: muted }}>▼</span>
              </summary>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
                {tableOrders.filter(o => o.status === 'completed').map(ord => (
                  <div key={ord.id} style={{ padding: 12, borderRadius: 12, background: "rgba(255,255,255,0.03)", border: `1px solid ${border}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: 10, color: muted }}>{new Date(ord.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <span style={{ fontSize: 9, color: "#1db954", fontWeight: 800 }}>COMPLETADO</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#ccc" }}>{ord.items.map(i => i.name).join(", ")}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, marginTop: 4 }}>${ord.total.toLocaleString()}</div>
                  </div>
                ))}
                {tableOrders.filter(o => o.status === 'completed').length === 0 && (
                  <div style={{ fontSize: 11, color: muted, textAlign: "center", padding: 10 }}>Sin historial disponible</div>
                )}
              </div>
            </details>
          </div>

          {/* BARRA INFERIOR FIJA */}
          {cart.length > 0 && (
            <div style={{
              position: "absolute", bottom: 0, left: 0, width: "100%", padding: "20px 24px", 
              background: "#161616", borderTop: `1px solid ${border}`, boxSizing: "border-box",
              display: "flex", justifyContent: "space-between", alignItems: "center",
              animation: "slideInUp 0.3s ease"
            }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: "bold", color: "#1db954" }}>🛒 {cart.length} ítems</div>
                <div style={{ fontSize: 16, fontWeight: "900", color: "#fff" }}>${cart.reduce((a, b) => a + b.price, 0).toLocaleString()}</div>
              </div>
              <button 
                onClick={handleEnviarPedido}
                style={{
                  background: selectedMesa ? "#1db954" : "#333", color: "#000", border: "none", 
                  padding: "14px 24px", borderRadius: 12, fontWeight: "900", fontSize: 14, 
                  cursor: selectedMesa ? "pointer" : "not-allowed"
                }}
              >
                Confirmar adición
              </button>
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes modalIn { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
        @keyframes slideUp { from { transform: translateX(-50%) translateY(100%); } to { transform: translateX(-50%) translateY(0); } }
      `}</style>
    </div>
  );
}