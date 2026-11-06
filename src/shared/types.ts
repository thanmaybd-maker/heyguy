// Types and IPC channel names shared by main, preload and renderer.
import type { Scene } from './scene';

export type BuddyState = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'error';

export type Provider = 'anthropic' | 'gemini' | 'openai' | 'deepseek' | 'antigravity';

/** A point in overlay-local DIP coordinates (0,0 = top-left of the overlay window). */
export interface Pt {
  x: number;
  y: number;
}

/** Annotation kinds the model can emit, already mapped to overlay-local coordinates. */
export type Annotation =
  | { kind: 'point'; at: Pt; label: string }
  | { kind: 'circle'; center: Pt; radius: number; label: string }
  | { kind: 'box'; from: Pt; to: Pt; label: string }
  | { kind: 'arrow'; from: Pt; to: Pt; label: string }
  | { kind: 'underline'; from: Pt; to: Pt; label: string };

/** Annotation in screenshot-pixel space, as parsed from the model's text. */
export type RawAnnotation =
  | { kind: 'point'; x: number; y: number; label: string }
  | { kind: 'circle'; x: number; y: number; r: number; label: string }
  | { kind: 'box'; x1: number; y1: number; x2: number; y2: number; label: string }
  | { kind: 'arrow'; x1: number; y1: number; x2: number; y2: number; label: string }
  | { kind: 'underline'; x1: number; y: number; x2: number; label: string };

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

/** Events streamed from main to the overlay during one interaction. */
export type CompanionEvent =
  | { type: 'state'; state: BuddyState; detail?: string }
  | { type: 'user-text'; text: string }
  | { type: 'reply-start' }
  | { type: 'reply-delta'; text: string }
  | { type: 'annotation'; annotation: Annotation }
  | { type: 'reply-done'; fullText: string }
  | { type: 'error'; message: string }
  | { type: 'notice'; message: string }
  /** model started writing a scene block (show a "drawing…" hint) */
  | { type: 'scene-drawing' }
  | { type: 'scene'; scene: Scene; warnings: string[] }
  | { type: 'scene-error'; message: string }
  /** Active sentence segment for live captions and scene step sync */
  | { type: 'speech-segment'; text: string; index: number; total: number };

export const PROTOCOL_VERSION = 1;

/** Every event main sends to the overlay is wrapped with its owning turn. */
export interface Envelope {
  v: typeof PROTOCOL_VERSION;
  /** 0 = not tied to a turn (startup notices etc.) */
  turn: number;
  seq: number;
  event: CompanionEvent;
}

/** What the user clicked in a scene panel; sent as context with the next question. */
export interface SceneSelection {
  sceneId: string;
  sceneTitle: string;
  itemId: string;
  label: string;
  detail: string;
}

export type HotkeyCommand = 'talk' | 'explain' | 'type' | 'dismiss' | 'snip';

export interface PublicSettings {
  provider: Provider;
  anthropicModel: string;
  geminiModel: string;
  openaiModel: string;
  deepseekModel: string;
  antigravityModel: string;
  googleAccountEmail: string;
  userName: string;
  hasAnthropicKey: boolean;
  hasGeminiKey: boolean;
  hasOpenaiKey: boolean;
  hasDeepseekKey: boolean;
  hasAntigravityCli: boolean;
  voiceReplies: boolean;
  captionsEnabled: boolean;
  ttsVoice: string;
  ttsRate: number;
  hotkeys: Record<HotkeyCommand, string>;
  /** 'taken' = another app (e.g. HeyClicky) already owns this combination */
  hotkeyStatus: Record<HotkeyCommand, HotkeyStatus>;
  /** 'session-only' = OS encryption unavailable, keys are kept in memory and not written to disk */
  keyStorage: 'encrypted' | 'session-only';
}

export type HotkeyStatus = 'ok' | 'taken' | 'invalid';

export interface SettingsUpdate {
  provider?: Provider;
  anthropicModel?: string;
  geminiModel?: string;
  openaiModel?: string;
  deepseekModel?: string;
  antigravityModel?: string;
  googleAccountEmail?: string;
  userName?: string;
  /** undefined = keep, '' = clear, otherwise new key */
  anthropicKey?: string;
  geminiKey?: string;
  openaiKey?: string;
  deepseekKey?: string;
  voiceReplies?: boolean;
  captionsEnabled?: boolean;
  ttsVoice?: string;
  ttsRate?: number;
  hotkeys?: Partial<Record<HotkeyCommand, string>>;
}

export interface AntigravityUsageSnapshot {
  accountEmail: string;
  activeModel: string;
  cliAvailable: boolean;
  cliPath: string;
  totalRequests: number;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  lastDurationSeconds: number;
  lastConversationId: string;
  lastUpdatedAt: number;
  availableModels: string[];
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  sceneCount: number;
}

export interface StoredMessage {
  id: string;
  sessionId: string;
  turnId: number;
  role: 'user' | 'assistant';
  text: string;
  cleanText: string;
  hasScene: boolean;
  createdAt: number;
}

export interface StoredScene {
  id: string;
  sessionId: string;
  turnId: number;
  title: string;
  kind: '2d' | '3d' | 'ui';
  json: string;
  createdAt: number;
}

export interface SearchResult {
  sessionId: string;
  sessionTitle: string;
  messageId: string;
  role: 'user' | 'assistant';
  matchedSnippet: string;
  createdAt: number;
}

export type JobStatus = 'queued' | 'planning' | 'running' | 'awaiting-approval' | 'completed' | 'failed' | 'cancelled';

export interface JobStep {
  id: string;
  jobId: string;
  stepIndex: number;
  description: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: unknown;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: number;
  finishedAt?: number;
}

export interface JobApprovalRequest {
  toolName: string;
  description: string;
  params: Record<string, unknown>;
}

export interface JobRecord {
  id: string;
  title: string;
  goal: string;
  status: JobStatus;
  steps: JobStep[];
  currentStepIndex: number;
  requiresApprovalFor?: JobApprovalRequest;
  error?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface ArtifactRecord {
  id: string;
  jobId?: string;
  title: string;
  kind: 'text' | 'markdown' | 'email-draft' | 'code' | 'json' | 'image';
  content: string;
  checksum: string;
  createdAt: number;
  updatedAt: number;
}

export type ToolRisk = 'read-only' | 'reversible' | 'consequential';

export interface ToolDefinition {
  name: string;
  description: string;
  risk: ToolRisk;
  parameters: Record<string, unknown>;
}

export interface WindowInfo {
  handle: string;
  title: string;
  processName: string;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface WalkthroughStep {
  id: string;
  targetDescription: string;
  instruction: string;
  expectedOutcome: string;
  targetPoint?: Pt;
}

export interface WalkthroughState {
  active: boolean;
  topic: string;
  currentStep: number;
  totalSteps: number;
  step: WalkthroughStep | null;
  completed: boolean;
}

export type MemoryCategory = 'preference' | 'fact' | 'instruction' | 'context';

export interface MemoryRecord {
  id: string;
  category: MemoryCategory;
  key: string;
  content: string;
  confidence: number;
  provenance?: string;
  createdAt: number;
  updatedAt: number;
}

export type ScheduleType = 'interval' | 'daily' | 'cron';
export type RoutineStatus = 'active' | 'paused';
export type MissedRunPolicy = 'run_once_on_wake' | 'skip';

export interface RoutineRecord {
  id: string;
  title: string;
  prompt: string;
  scheduleType: ScheduleType;
  scheduleValue: string;
  timezone: string;
  allowedTools: string[];
  budgetTokens?: number;
  status: RoutineStatus;
  missedRunPolicy: MissedRunPolicy;
  lastRunAt?: number;
  nextRunAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface AssistantProfile {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  avatar?: string;
  color?: string;
  createdAt: number;
  updatedAt: number;
}

export interface NotificationOptions {
  title: string;
  body: string;
  silent?: boolean;
  urgency?: 'low' | 'normal' | 'critical';
}

export const IPC = {
  // main -> overlay
  event: 'companion:event',
  cursor: 'companion:cursor',
  command: 'companion:command',
  hideForCapture: 'companion:hide-for-capture',
  showAfterCapture: 'companion:show-after-capture',
  settingsChanged: 'companion:settings-changed',
  // overlay -> main
  sceneClosed: 'overlay:scene-closed',
  listeningStarted: 'overlay:listening-started',
  setInteractive: 'overlay:set-interactive',
  hiddenForCapture: 'overlay:hidden-for-capture',
  ask: 'overlay:ask',
  audio: 'overlay:audio',
  cancel: 'overlay:cancel',
  setFocusable: 'overlay:set-focusable',
  getSettings: 'settings:get',
  saveSettings: 'settings:save',
  openSettings: 'settings:open',
  testKey: 'settings:test',
  agySignIn: 'settings:agy-signin',
  // workspace IPC
  openWorkspace: 'workspace:open',
  listSessions: 'workspace:list-sessions',
  getSession: 'workspace:get-session',
  searchHistory: 'workspace:search',
  loadScene: 'workspace:load-scene',
  deleteSession: 'workspace:delete-session',
  newSession: 'workspace:new-session',
  // jobs IPC
  listJobs: 'jobs:list',
  createJob: 'jobs:create',
  getJob: 'jobs:get',
  approveJob: 'jobs:approve',
  cancelJob: 'jobs:cancel',
  // artifacts IPC
  listArtifacts: 'artifacts:list',
  getArtifact: 'artifacts:get',
  saveArtifact: 'artifacts:save',
  // walkthrough IPC
  startWalkthrough: 'walkthrough:start',
  nextWalkthroughStep: 'walkthrough:next',
  cancelWalkthrough: 'walkthrough:cancel',
  // memory IPC
  listMemories: 'memory:list',
  addMemory: 'memory:add',
  deleteMemory: 'memory:delete',
  searchMemories: 'memory:search',
  // routines IPC
  listRoutines: 'routines:list',
  createRoutine: 'routines:create',
  updateRoutine: 'routines:update',
  deleteRoutine: 'routines:delete',
  runRoutineNow: 'routines:run-now',
  // assistants IPC
  listAssistants: 'assistants:list',
  getActiveAssistant: 'assistants:get-active',
  setActiveAssistant: 'assistants:set-active',
  createAssistant: 'assistants:create',
  // studio & instant UI / image / antigravity harness IPC
  generateImage: 'studio:generate-image',
  previewScene: 'studio:preview-scene',
  getAntigravityUsage: 'studio:antigravity-usage',
  // dynamic notch
  notchState: 'notch:state',
  notchAction: 'notch:action',
  getNotchState: 'notch:get-state',
  runHeadlessCodeGen: 'studio:headless-codegen',
} as const;

/** What the notch shows about the brain HeyGuy is using. */
export type BrainStatus = 'missing' | 'signed-out' | 'connecting' | 'ready' | 'error' | 'api-key';

export interface NotchState {
  status: BrainStatus;
  provider: Provider;
  /** model id, e.g. gemini-3.8-flash-high */
  model: string;
  /** Google account label from Settings (the CLI owns the real sign-in) */
  account: string;
  /** user's first name for the greeting ('' = none) */
  userName: string;
  /** one readable line, e.g. why connecting failed */
  detail: string;
  requests: number;
  totalTokens: number;
}

export type NotchAction =
  | 'connect-google'
  | 'sign-out'
  | 'usage'
  | 'use-google'
  | 'retry'
  | 'settings'
  | 'history'
  | 'explain'
  | 'draw-demo';

export interface SpatialSelection {
  /** Rectangular bounds in overlay DIP coordinates */
  bounds: { x: number; y: number; width: number; height: number };
  /** Normalized (0..1) coordinates across the active display */
  normalized?: { x: number; y: number; width: number; height: number };
}

export interface AskRequest {
  /** Typed or transcribed question; empty means "explain this screen". */
  question: string;
  selection?: SceneSelection | null;
  spatialSelection?: SpatialSelection | null;
}

export interface AudioRequest {
  wav: Uint8Array;
  selection?: SceneSelection | null;
  spatialSelection?: SpatialSelection | null;
}

export interface CursorUpdate {
  x: number;
  y: number;
  /** overlay size, so the renderer can resize its canvas if the window moved displays */
  width: number;
  height: number;
}
