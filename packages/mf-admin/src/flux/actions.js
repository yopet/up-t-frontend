// src/flux/actions.js
//
// Action Creators de Up-T. Son la única capa autorizada para hablar con
// Supabase. Cada función aquí: (1) ejecuta el efecto en Supabase (o lee
// datos), y (2) despacha una acción con el resultado. Las Vistas nunca
// llaman a Supabase directamente: llaman a una función de este archivo.

import { supabase } from "../lib/supabase";
import { dispatcher } from "./Dispatcher";

const ACCENT_COLORS = ["#00c9ff", "#ff6b6b", "#1db954", "#ff99c8", "#ffcc00", "#a78bfa", "#ff4d00", "#00ffd0"];

const parseDurationString = (value) => {
  if (!value) return 0;
  if (typeof value === "number") return value;
  const parts = String(value).split(":").map(Number);
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(parts[0]) || 0;
};

const formatDurationText = (seconds) => {
  const total = Number(seconds) || 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = String(minutes).padStart(hours ? 2 : 1, "0");
  const ss = String(secs).padStart(2, "0");
  return hours ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
};

const normalizeQueueItem = (item) => {
  const song = item.songs_repository || {};
  const youtubeId = song.youtube_id || item.youtube_id;
  const rawDuration = typeof song.duration === "number" ? song.duration : parseDurationString(song.duration);

  return {
    id: youtubeId,
    queueRowId: item.id,
    title: song.title || "Desconocida",
    artist: song.artist || "Desconocido",
    duration: rawDuration ? formatDurationText(rawDuration) : "",
    color: song.color || ACCENT_COLORS[0],
    isApproved: item.is_approved,
    is_cliente: item.is_cliente,
    img: song.img_url || "https://picsum.photos/seed/default/600/600",
    youtubeId,
    created_at: item.requested_at,
    mesa: item.mesa,
  };
};

export const Actions = {
  // ─── Carga inicial ──────────────────────────────────────────────────
  async loadEstablishments() {
    const { data } = await supabase.from("establishments").select("*").order("name");
    if (!data || data.length === 0) return null;

    const params = new URLSearchParams(window.location.search);
    const urlId = params.get("est");
    const selected = data.find((e) => e.id === urlId) || data[0];

    dispatcher.dispatch({
      type: "ESTABLISHMENTS_LOADED",
      payload: {
        establishments: data,
        selectedEstId: selected.id,
        credits: selected.credits || 0,
      },
    });
    return selected.id;
  },

  async loadPlaybackState(estId) {
    const { data } = await supabase
      .from("app_state")
      .select("*")
      .eq("id", `config-${estId}`)
      .maybeSingle();

    dispatcher.dispatch({
      type: "PLAYBACK_STATE_LOADED",
      payload: { volume: data?.volume, autoPlay: data?.auto_play },
    });
    if (data?.current_idx !== undefined) {
      dispatcher.dispatch({ type: "CURRENT_IDX_CHANGED", payload: { idx: data.current_idx ?? 0 } });
    }
  },

  async loadQueue(estId) {
    if (!estId) return;
    const { data } = await supabase
      .from("queue")
      .select("*, songs_repository(*)")
      .eq("establishment_id", estId)
      .order("is_cliente", { ascending: false })
      .order("approved_at", { ascending: true, nullsFirst: false })
      .order("requested_at", { ascending: true });

    if (!data) return;
    dispatcher.dispatch({ type: "QUEUE_LOADED", payload: { queue: data.map(normalizeQueueItem) } });
  },

  async loadAds(estId) {
    if (!estId) return;
    const { data } = await supabase.from("promociones").select("*").eq("establishment_id", estId).eq("active", true);
    if (data) dispatcher.dispatch({ type: "ADS_LOADED", payload: { ads: data } });
  },

  // ─── Reproducción ───────────────────────────────────────────────────
  async play(estId, idx) {
    dispatcher.dispatch({ type: "CURRENT_IDX_CHANGED", payload: { idx } });
    await supabase.from("app_state").upsert(
      { id: `config-${estId}`, establishment_id: estId, current_idx: idx },
      { onConflict: "id" }
    );
  },

  async setVolume(estId, volume) {
    dispatcher.dispatch({ type: "VOLUME_CHANGED", payload: { volume } });
    await supabase.from("app_state").upsert(
      { id: `config-${estId}`, establishment_id: estId, volume },
      { onConflict: "id" }
    );
  },

  async toggleAutoPlay(estId, autoPlay) {
    dispatcher.dispatch({ type: "AUTOPLAY_TOGGLED", payload: { autoPlay } });
    await supabase.from("app_state").upsert(
      { id: `config-${estId}`, establishment_id: estId, auto_play: autoPlay },
      { onConflict: "id" }
    );
  },

  // ─── Cola / moderación ──────────────────────────────────────────────
  async removeSong(rowId) {
    const { error } = await supabase.from("queue").delete().eq("id", rowId);
    if (!error) dispatcher.dispatch({ type: "SONG_REMOVED_LOCAL", payload: { rowId } });
  },

  async approveSong(rowId, estId) {
    const { error } = await supabase.rpc("approve_and_subtract_credit", {
      p_request_id: rowId,
      p_establishment_id: estId,
    });
    if (error) throw error;
    await supabase.from("queue").update({ approved_at: new Date().toISOString() }).eq("id", rowId);
  },

  async requestSong(estId, song, forceApprove = false, autoPlay = true) {
    const { data: repoSong } = await supabase
      .from("songs_repository")
      .upsert(
        { youtube_id: song.id || song.youtubeId, title: song.title, artist: song.artist, img_url: song.img || song.img_url },
        { onConflict: "youtube_id" }
      )
      .select()
      .single();

    const isApproved = forceApprove || autoPlay;
    const { data: newQueueItem, error } = await supabase
      .from("queue")
      .insert({
        establishment_id: estId,
        song_id: repoSong.id,
        is_approved: isApproved,
        is_cliente: song.is_cliente || false,
        mesa: song.mesa || null,
        approved_at: isApproved ? new Date().toISOString() : null,
      })
      .select("id")
      .single();

    if (error) throw error;
    return newQueueItem.id;
  },

  async rejectSongOnVideoError(rowId) {
    if (!rowId) return;
    await supabase.from("queue").update({ is_approved: false }).eq("id", rowId);
    dispatcher.dispatch({ type: "SONG_REJECTED_LOCAL", payload: { rowId } });
  },

  async clearQueue(estId) {
    await supabase.from("queue").delete().eq("establishment_id", estId);
    dispatcher.dispatch({ type: "QUEUE_CLEARED" });
    await supabase.from("app_state").upsert(
      { id: `config-${estId}`, establishment_id: estId, current_idx: 0 },
      { onConflict: "id" }
    );
  },

  showScreenMessage(text, author) {
    dispatcher.dispatch({ type: "SCREEN_MESSAGE_SHOWN", payload: { text, author } });
    setTimeout(() => dispatcher.dispatch({ type: "SCREEN_MESSAGE_CLEARED" }), 1000);
  },
};

export { normalizeQueueItem };
