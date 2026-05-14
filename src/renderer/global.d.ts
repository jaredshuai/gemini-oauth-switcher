import type { GeminiSwitcherApi } from "../shared/types";

declare global {
  interface Window {
    geminiSwitcher: GeminiSwitcherApi;
  }
}

export {};
