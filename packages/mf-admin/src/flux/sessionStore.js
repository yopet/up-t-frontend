// src/flux/sessionStore.js
//
// sessionStore: identidad del establecimiento activo, su saldo de
// créditos Up-T y su publicidad activa. Es el equivalente al "authStore"
// descrito conceptualmente en la Entrega 1, ampliado para incluir el
// contexto del establecimiento (multi-tenant por querystring `?est=`).

import { BaseStore } from "./BaseStore";
import { dispatcher } from "./Dispatcher";

class SessionStore extends BaseStore {
  constructor() {
    super({ establishments: [], selectedEstId: "", credits: 0, ads: [] });
    dispatcher.register(this._handleAction.bind(this));
  }

  _handleAction(action) {
    switch (action.type) {
      case "ESTABLISHMENTS_LOADED":
        this._setState({
          establishments: action.payload.establishments,
          selectedEstId: action.payload.selectedEstId,
          credits: action.payload.credits,
        });
        break;

      case "CREDITS_CHANGED":
        this._setState({ credits: action.payload.credits });
        break;

      case "ADS_LOADED":
        this._setState({ ads: action.payload.ads });
        break;

      default:
        break;
    }
  }
}

export const sessionStore = new SessionStore();
