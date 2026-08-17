// src/flux/BaseStore.js
//
// Store base: mantiene un slice de estado inmutable y notifica a sus
// suscriptores (las Vistas, vía useStore) cuando ese estado cambia.
// Cada Store concreto (queueStore, playbackStore, sessionStore) extiende
// esto y define su propio `handleAction(action)`.

export class BaseStore {
  constructor(initialState) {
    this._state = initialState;
    this._listeners = new Set();
  }

  getState() {
    return this._state;
  }

  /** Reemplaza el estado (de forma inmutable) y notifica a la vista. */
  _setState(patch) {
    this._state = { ...this._state, ...patch };
    this._emitChange();
  }

  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _emitChange() {
    this._listeners.forEach((listener) => listener(this._state));
  }
}
