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

export interface DisplayWorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function ensureWindowBoundsVisible(bounds: WindowBounds, displays: DisplayWorkArea[]): WindowBounds {
  const sizeOnly = { width: bounds.width, height: bounds.height };
  if (bounds.x === undefined || bounds.y === undefined || displays.length === 0) {
    return sizeOnly;
  }

  const titleBar = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: Math.min(48, bounds.height)
  };
  const isReachable = displays.some((display) => {
    const overlapWidth = Math.max(0, Math.min(titleBar.x + titleBar.width, display.x + display.width) - Math.max(titleBar.x, display.x));
    const overlapHeight = Math.max(0, Math.min(titleBar.y + titleBar.height, display.y + display.height) - Math.max(titleBar.y, display.y));
    return overlapWidth >= 120 && overlapHeight >= 24;
  });

  return isReachable ? bounds : sizeOnly;
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
