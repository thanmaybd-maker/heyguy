// Narrow, typed bridge between the overlay renderer and main.
import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type NotchAction, type NotchState, type CursorUpdate, type Envelope, type HotkeyCommand, type PublicSettings, type SceneSelection, type SpatialSelection } from '../shared/types';

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  onEvent: (cb: (e: Envelope) => void) => on(IPC.event, cb),
  onCursor: (cb: (c: CursorUpdate) => void) => on(IPC.cursor, cb),
  onCommand: (cb: (c: HotkeyCommand) => void) => on(IPC.command, cb),
  onHideForCapture: (cb: () => void) => on(IPC.hideForCapture, cb),
  onShowAfterCapture: (cb: () => void) => on(IPC.showAfterCapture, cb),
  onSettingsChanged: (cb: (s: PublicSettings) => void) => on(IPC.settingsChanged, cb),
  hiddenForCapture: () => ipcRenderer.send(IPC.hiddenForCapture),
  setInteractive: (v: boolean) => ipcRenderer.send(IPC.setInteractive, v),
  setFocusable: (v: boolean) => ipcRenderer.send(IPC.setFocusable, v),
  ask: (question: string, selection: SceneSelection | null, spatialSelection?: SpatialSelection | null) =>
    ipcRenderer.send(IPC.ask, { question, selection, spatialSelection }),
  sendAudio: (wav: Uint8Array, selection: SceneSelection | null, spatialSelection?: SpatialSelection | null) =>
    ipcRenderer.send(IPC.audio, { wav, selection, spatialSelection }),
  listeningStarted: () => ipcRenderer.send(IPC.listeningStarted),
  sceneClosed: () => ipcRenderer.send(IPC.sceneClosed),
  cancel: () => ipcRenderer.send(IPC.cancel),
  openSettings: () => ipcRenderer.send(IPC.openSettings),
  openWorkspace: () => ipcRenderer.send(IPC.openWorkspace),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings) as Promise<PublicSettings>,
  onNotchState: (cb: (s: NotchState) => void) => on(IPC.notchState, cb),
  getNotchState: () => ipcRenderer.invoke(IPC.getNotchState) as Promise<NotchState>,
  notchAction: (kind: NotchAction) => ipcRenderer.invoke(IPC.notchAction, kind) as Promise<{ ok: boolean; message: string }>,
};

export type OverlayApi = typeof api;
contextBridge.exposeInMainWorld('heyguy', api);
