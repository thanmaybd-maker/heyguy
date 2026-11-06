import type { OverlayApi } from '../preload/overlay';
import type { SettingsApi } from '../preload/settings';

declare global {
  interface Window {
    heyguy: OverlayApi;
    heyguySettings: SettingsApi;
  }
}
export {};
