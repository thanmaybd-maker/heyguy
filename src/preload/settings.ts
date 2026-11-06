import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  type AntigravityUsageSnapshot,
  type Provider,
  type PublicSettings,
  type SettingsUpdate,
} from '../shared/types';

const api = {
  get: () => ipcRenderer.invoke(IPC.getSettings) as Promise<PublicSettings>,
  save: (u: SettingsUpdate) => ipcRenderer.invoke(IPC.saveSettings, u) as Promise<PublicSettings>,
  test: (p: Provider) => ipcRenderer.invoke(IPC.testKey, p) as Promise<{ ok: boolean; message: string }>,
  agySignIn: () => ipcRenderer.invoke(IPC.agySignIn) as Promise<{ ok: boolean; message: string }>,
  getUsage: () => ipcRenderer.invoke(IPC.getAntigravityUsage) as Promise<AntigravityUsageSnapshot>,
};

export type SettingsApi = typeof api;
contextBridge.exposeInMainWorld('heyguySettings', api);
