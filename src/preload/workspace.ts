import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  type AntigravityUsageSnapshot,
  type ArtifactRecord,
  type AssistantProfile,
  type JobRecord,
  type MemoryCategory,
  type MemoryRecord,
  type RoutineRecord,
  type SearchResult,
  type SessionSummary,
  type StoredMessage,
  type StoredScene,
  type WalkthroughState,
  type WalkthroughStep,
} from '../shared/types';

const api = {
  listSessions: () => ipcRenderer.invoke(IPC.listSessions) as Promise<SessionSummary[]>,
  getSession: (id: string) =>
    ipcRenderer.invoke(IPC.getSession, id) as Promise<{ session: SessionSummary; messages: StoredMessage[]; scenes: StoredScene[] } | null>,
  search: (q: string) => ipcRenderer.invoke(IPC.searchHistory, q) as Promise<SearchResult[]>,
  deleteSession: (id: string) => ipcRenderer.invoke(IPC.deleteSession, id) as Promise<boolean>,
  newSession: () => ipcRenderer.invoke(IPC.newSession) as Promise<SessionSummary>,
  loadScene: (sceneId: string) => ipcRenderer.invoke(IPC.loadScene, sceneId) as Promise<boolean>,

  // Jobs
  listJobs: () => ipcRenderer.invoke(IPC.listJobs) as Promise<JobRecord[]>,
  createJob: (title: string, goal: string, steps: { description: string; toolName?: string; toolInput?: Record<string, unknown> }[]) =>
    ipcRenderer.invoke(IPC.createJob, { title, goal, steps }) as Promise<JobRecord>,
  getJob: (jobId: string) => ipcRenderer.invoke(IPC.getJob, jobId) as Promise<JobRecord | null>,
  approveJob: (jobId: string) => ipcRenderer.invoke(IPC.approveJob, jobId) as Promise<boolean>,
  cancelJob: (jobId: string) => ipcRenderer.invoke(IPC.cancelJob, jobId) as Promise<boolean>,

  // Artifacts
  listArtifacts: () => ipcRenderer.invoke(IPC.listArtifacts) as Promise<ArtifactRecord[]>,
  getArtifact: (id: string) => ipcRenderer.invoke(IPC.getArtifact, id) as Promise<ArtifactRecord | null>,

  // Walkthroughs
  startWalkthrough: (topic: string, steps: WalkthroughStep[]) =>
    ipcRenderer.invoke(IPC.startWalkthrough, { topic, steps }) as Promise<WalkthroughState>,
  nextWalkthroughStep: () => ipcRenderer.invoke(IPC.nextWalkthroughStep) as Promise<WalkthroughState>,
  cancelWalkthrough: () => ipcRenderer.invoke(IPC.cancelWalkthrough) as Promise<WalkthroughState>,

  // Memory
  listMemories: (category?: MemoryCategory) =>
    ipcRenderer.invoke(IPC.listMemories, category) as Promise<MemoryRecord[]>,
  addMemory: (memory: { category: MemoryCategory; key: string; content: string; confidence?: number; provenance?: string }) =>
    ipcRenderer.invoke(IPC.addMemory, memory) as Promise<MemoryRecord>,
  deleteMemory: (id: string) =>
    ipcRenderer.invoke(IPC.deleteMemory, id) as Promise<boolean>,
  searchMemories: (query: string) =>
    ipcRenderer.invoke(IPC.searchMemories, query) as Promise<MemoryRecord[]>,

  // Routines
  listRoutines: () =>
    ipcRenderer.invoke(IPC.listRoutines) as Promise<RoutineRecord[]>,
  createRoutine: (routine: { title: string; prompt: string; scheduleType: 'interval' | 'daily' | 'cron'; scheduleValue: string; timezone?: string; allowedTools?: string[]; missedRunPolicy?: 'run_once_on_wake' | 'skip' }) =>
    ipcRenderer.invoke(IPC.createRoutine, routine) as Promise<RoutineRecord>,
  updateRoutine: (id: string, updates: Partial<RoutineRecord>) =>
    ipcRenderer.invoke(IPC.updateRoutine, { id, updates }) as Promise<RoutineRecord | null>,
  deleteRoutine: (id: string) =>
    ipcRenderer.invoke(IPC.deleteRoutine, id) as Promise<boolean>,
  runRoutineNow: (id: string) =>
    ipcRenderer.invoke(IPC.runRoutineNow, id) as Promise<string | null>,

  // Assistants
  listAssistants: () =>
    ipcRenderer.invoke(IPC.listAssistants) as Promise<AssistantProfile[]>,
  getActiveAssistant: () =>
    ipcRenderer.invoke(IPC.getActiveAssistant) as Promise<AssistantProfile>,
  setActiveAssistant: (id: string) =>
    ipcRenderer.invoke(IPC.setActiveAssistant, id) as Promise<boolean>,

  // Studio (Image Generation, Instant Scene Preview & Antigravity Headless CodeGen)
  generateImage: (req: {
    title?: string;
    prompt: string;
    size?: '1024x1024' | '1536x1024' | '1024x1536';
    quality?: 'low' | 'medium' | 'high' | 'auto';
  }) => ipcRenderer.invoke(IPC.generateImage, req) as Promise<ArtifactRecord>,
  previewScene: (sceneJson: string) =>
    ipcRenderer.invoke(IPC.previewScene, sceneJson) as Promise<{ ok: boolean; error?: string }>,
  getAntigravityUsage: () =>
    ipcRenderer.invoke(IPC.getAntigravityUsage) as Promise<AntigravityUsageSnapshot>,
  runHeadlessCodeGen: (req: {
    prompt: string;
    language?: 'typescript' | 'react-tsx' | 'python' | 'html-app';
  }) =>
    ipcRenderer.invoke(IPC.runHeadlessCodeGen, req) as Promise<{
      artifact: ArtifactRecord;
      summary: string;
      usage: AntigravityUsageSnapshot;
    }>,
};

export type WorkspaceApi = typeof api;
contextBridge.exposeInMainWorld('heyguyWorkspace', api);
