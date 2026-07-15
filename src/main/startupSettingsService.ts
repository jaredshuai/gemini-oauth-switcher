import type { AppSettings, SettingsReadStatus } from "../shared/types";
import type { SettingsReadResult } from "./settings";

export interface StartupSettingsService {
  load(): Promise<AppSettings>;
  getReadStatus(): SettingsReadStatus | undefined;
}

export function createStartupSettingsService(options: {
  readSettings: () => Promise<SettingsReadResult>;
}): StartupSettingsService {
  let loadPromise: Promise<AppSettings> | undefined;
  let readStatus: SettingsReadStatus | undefined;

  return {
    load() {
      if (!loadPromise) {
        loadPromise = options.readSettings()
          .then((result) => {
            readStatus = result.status;
            return result.settings;
          })
          .catch((error: unknown) => {
            loadPromise = undefined;
            throw error;
          });
      }

      return loadPromise;
    },
    getReadStatus() {
      return readStatus;
    }
  };
}
