// src/flux/playbackStore.js
//
// playbackStore: estado de reproducción compartido entre AdminView (quien
// controla) y TvView (quien reproduce): volumen, modo auto-play, y el
// mensaje/overlay que se muestra momentáneamente en la pantalla del bar.

import { BaseStore } from "./BaseStore";
import { dispatcher } from "./Dispatcher";

class PlaybackStore extends BaseStore {
  constructor() {
    super({
      volume: 50,
      autoPlay: true,
      currentMessage: null,
      messageAuthor: null,
    });
    dispatcher.register(this._handleAction.bind(this));
  }

  _handleAction(action) {
    switch (action.type) {
      case "PLAYBACK_STATE_LOADED":
        this._setState({
          volume: action.payload.volume ?? this._state.volume,
          autoPlay: action.payload.autoPlay ?? this._state.autoPlay,
        });
        break;

      case "VOLUME_CHANGED":
        this._setState({ volume: action.payload.volume });
        break;

      case "AUTOPLAY_TOGGLED":
        this._setState({ autoPlay: action.payload.autoPlay });
        break;

      case "SCREEN_MESSAGE_SHOWN":
        this._setState({
          currentMessage: action.payload.text,
          messageAuthor: action.payload.author,
        });
        break;

      case "SCREEN_MESSAGE_CLEARED":
        this._setState({ currentMessage: null, messageAuthor: null });
        break;

      default:
        break;
    }
  }
}

export const playbackStore = new PlaybackStore();
