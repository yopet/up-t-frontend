// src/flux/Dispatcher.js
//
// Dispatcher central de Up-T.
// Es el único punto de entrada para toda mutación de estado: ninguna Vista
// ni ningún Store escriben estado por fuera de un action object despachado
// aquí. Esto es lo que hace el flujo unidireccional auditable: cualquier
// cambio de estado puede rastrearse hasta un `dispatch({ type, payload })`.

class Dispatcher {
  constructor() {
    this._callbacks = new Map();
    this._nextId = 1;
  }

  /**
   * Un Store se registra pasando un callback que recibe cada acción
   * despachada. Devuelve un id útil solo para debugging/unregister.
   */
  register(callback) {
    const id = this._nextId++;
    this._callbacks.set(id, callback);
    return id;
  }

  unregister(id) {
    this._callbacks.delete(id);
  }

  /**
   * Punto único de entrada de acciones. Los Action Creators (actions.js)
   * son los únicos que deberían llamar a esto.
   */
  dispatch(action) {
    if (!action || !action.type) {
      throw new Error("Dispatcher: toda acción debe tener 'type'.");
    }
    if (import.meta.env?.DEV) {
      // Trazabilidad: en dev, cada acción queda visible en consola con su payload.
      console.log("[Flux:dispatch]", action.type, action.payload);
    }
    this._callbacks.forEach((callback) => callback(action));
  }
}

export const dispatcher = new Dispatcher();
