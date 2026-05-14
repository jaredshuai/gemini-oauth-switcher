import type { TrayBehavior, WindowBounds } from "../shared/types";

export interface WindowCloseState {
  isQuitting: boolean;
  trayBehavior: TrayBehavior;
  hasTray: boolean;
}

export interface ClosableWindow {
  getBounds(): WindowBounds;
  hide(): void;
  destroy(): void;
}

export interface PersistWindowBoundsBeforeCloseOptions {
  window: ClosableWindow;
  hideOnClose: boolean;
  saveWindowBounds: (bounds: WindowBounds) => Promise<unknown>;
}

export function shouldHideWindowOnClose(state: WindowCloseState): boolean {
  return !state.isQuitting && state.trayBehavior === "minimize_to_tray" && state.hasTray;
}

export async function persistWindowBoundsBeforeClose(options: PersistWindowBoundsBeforeCloseOptions): Promise<void> {
  try {
    await options.saveWindowBounds(options.window.getBounds());
  } finally {
    if (options.hideOnClose) {
      options.window.hide();
    } else {
      options.window.destroy();
    }
  }
}
