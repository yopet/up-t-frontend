// src/flux/queueStore.js
//
// queueStore: cola activa de reproducción y solicitudes pendientes.
// Único responsable de `queue` y `currentIdx`. Ninguna Vista escribe
// directamente sobre este estado: solo reacciona a acciones despachadas
// por actions.js (que a su vez reflejan cambios en Supabase).
//
// Nota de diseño: en la versión previa (pre-Flux), el "anclaje" de qué
// canción sonaba se mantenía en un useRef dentro de App.jsx —estado
// mutable por fuera de cualquier store, invisible para el resto del
// sistema. Aquí ese anclaje (`anchorRowId`) pasa a ser parte del estado
// del store, eliminando ese punto ciego.

import { BaseStore } from "./BaseStore";
import { dispatcher } from "./Dispatcher";

class QueueStore extends BaseStore {
  constructor() {
    super({ queue: [], currentIdx: 0, anchorRowId: null });
    dispatcher.register(this._handleAction.bind(this));
  }

  _handleAction(action) {
    switch (action.type) {
      case "QUEUE_LOADED": {
        const queue = action.payload.queue;
        const approved = queue.filter((s) => s.isApproved);
        const anchorRowId = this._state.anchorRowId;
        const newIdx = anchorRowId
          ? approved.findIndex((s) => s.queueRowId === anchorRowId)
          : -1;

        this._setState({
          queue,
          currentIdx: newIdx !== -1 ? newIdx : this._state.currentIdx,
        });
        break;
      }

      case "SONG_REMOVED_LOCAL":
      case "SONG_REJECTED_LOCAL":
        this._setState({
          queue: this._state.queue.filter(
            (item) => item.queueRowId !== action.payload.rowId
          ),
        });
        break;

      case "QUEUE_CLEARED":
        this._setState({ queue: [], currentIdx: 0, anchorRowId: null });
        break;

      case "CURRENT_IDX_CHANGED": {
        const approved = this._state.queue.filter((s) => s.isApproved);
        const song = approved[action.payload.idx];
        this._setState({
          currentIdx: action.payload.idx,
          anchorRowId: song ? song.queueRowId : this._state.anchorRowId,
        });
        break;
      }

      default:
        break;
    }
  }

  getApprovedQueue() {
    return this._state.queue.filter((s) => s.isApproved);
  }
}

export const queueStore = new QueueStore();
