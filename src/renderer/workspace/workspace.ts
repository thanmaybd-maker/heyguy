// Workspace & History renderer logic: browsing past chats, viewing saved scenes,
// managing background jobs, approving tool actions, inspecting saved artifacts,
// configuring scheduled routines, and managing persistent memory and assistants.
import type {
  ArtifactRecord,
  AssistantProfile,
  JobRecord,
  MemoryRecord,
  RoutineRecord,
  SessionSummary,
  StoredMessage,
  StoredScene,
} from '../../shared/types';
import type { WorkspaceApi } from '../../preload/workspace';
import { DEMO_DIAGRAM, DEMO_ENGINE, DEMO_UI } from '../../main/demo-scenes';

declare global {
  interface Window {
    heyguyWorkspace: WorkspaceApi;
  }
}

const api = window.heyguyWorkspace;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const tabChats = $('tab-chats');
const tabStudio = $('tab-studio');
const tabJobs = $('tab-jobs');
const tabArtifacts = $('tab-artifacts');
const tabRoutines = $('tab-routines');
const tabMemory = $('tab-memory');

const sessionListEl = $('session-list');
const studioListEl = $('studio-list');
const jobsListEl = $('jobs-list');
const artifactsListEl = $('artifacts-list');
const routinesListEl = $('routines-list');
const memoryListEl = $('memory-list');

const messagesContainerEl = $('messages-container');
const activeTitleEl = $('active-title');
const activeStatsEl = $('active-stats');
const searchInputEl = $<HTMLInputElement>('search-input');
const btnNewSession = $('btn-new-session');
const btnDeleteSession = $('btn-delete-session');
const selectAssistantEl = $<HTMLSelectElement>('select-assistant');

type TabMode = 'chats' | 'studio' | 'jobs' | 'artifacts' | 'routines' | 'memory';
let currentTab: TabMode = 'chats';

let sessions: SessionSummary[] = [];
let jobs: JobRecord[] = [];
let artifacts: ArtifactRecord[] = [];
let routines: RoutineRecord[] = [];
let memories: MemoryRecord[] = [];
let assistants: AssistantProfile[] = [];

let activeSessionId: string | null = null;
let activeJobId: string | null = null;
let activeArtifactId: string | null = null;
let activeRoutineId: string | null = null;
let activeMemoryId: string | null = null;
let searchDebounceTimer = 0;

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function switchTab(mode: TabMode): void {
  currentTab = mode;
  tabChats.classList.toggle('active', mode === 'chats');
  tabStudio.classList.toggle('active', mode === 'studio');
  tabJobs.classList.toggle('active', mode === 'jobs');
  tabArtifacts.classList.toggle('active', mode === 'artifacts');
  tabRoutines.classList.toggle('active', mode === 'routines');
  tabMemory.classList.toggle('active', mode === 'memory');

  sessionListEl.classList.toggle('hidden', mode !== 'chats');
  studioListEl.classList.toggle('hidden', mode !== 'studio');
  jobsListEl.classList.toggle('hidden', mode !== 'jobs');
  artifactsListEl.classList.toggle('hidden', mode !== 'artifacts');
  routinesListEl.classList.toggle('hidden', mode !== 'routines');
  memoryListEl.classList.toggle('hidden', mode !== 'memory');

  btnDeleteSession.style.display = mode === 'chats' && activeSessionId ? 'inline-block' : 'none';
  btnNewSession.textContent =
    mode === 'chats' ? '+ New Chat' :
    mode === 'studio' ? '⚡ Launch UI' :
    mode === 'jobs' ? '+ New Task' :
    mode === 'artifacts' ? '+ New Doc' :
    mode === 'routines' ? '+ New Routine' : '+ New Memory';

  searchInputEl.placeholder =
    mode === 'memory' ? 'Search memories…' :
    mode === 'studio' ? 'Filter Studio presets…' :
    mode === 'chats' ? 'Search conversations…' : 'Search…';

  if (mode === 'chats') void loadSessions();
  else if (mode === 'studio') renderStudioView();
  else if (mode === 'jobs') void loadJobs();
  else if (mode === 'artifacts') void loadArtifacts();
  else if (mode === 'routines') void loadRoutines();
  else if (mode === 'memory') void loadMemories();
}

tabChats.addEventListener('click', () => switchTab('chats'));
tabStudio.addEventListener('click', () => switchTab('studio'));
tabJobs.addEventListener('click', () => switchTab('jobs'));
tabArtifacts.addEventListener('click', () => switchTab('artifacts'));
tabRoutines.addEventListener('click', () => switchTab('routines'));
tabMemory.addEventListener('click', () => switchTab('memory'));

// ---------------------------------------------------------------- Chats

async function loadSessions(): Promise<void> {
  sessions = await api.listSessions();
  renderSessionList();
  if (sessions.length && !activeSessionId) {
    selectSession(sessions[0]!.id);
  } else if (!sessions.length) {
    activeSessionId = null;
    renderEmpty('No conversation selected.');
  }
}

function renderSessionList(): void {
  sessionListEl.replaceChildren();
  if (!sessions.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.style.padding = '24px 8px';
    empty.textContent = 'No conversations yet.';
    sessionListEl.appendChild(empty);
    return;
  }

  for (const s of sessions) {
    const item = document.createElement('div');
    item.className = `session-item ${s.id === activeSessionId ? 'active' : ''}`;
    item.setAttribute('role', 'option');

    const title = document.createElement('div');
    title.className = 'session-item-title';
    title.textContent = s.title;

    const sub = document.createElement('div');
    sub.className = 'session-item-sub';

    const date = document.createElement('span');
    date.textContent = `${formatDate(s.updatedAt)} · ${s.messageCount} msgs`;

    sub.appendChild(date);
    if (s.sceneCount > 0) {
      const pill = document.createElement('span');
      pill.className = 'scene-pill';
      pill.textContent = `${s.sceneCount} scene${s.sceneCount > 1 ? 's' : ''}`;
      sub.appendChild(pill);
    }

    item.appendChild(title);
    item.appendChild(sub);
    item.addEventListener('click', () => selectSession(s.id));
    sessionListEl.appendChild(item);
  }
}

async function selectSession(sessionId: string): Promise<void> {
  activeSessionId = sessionId;
  renderSessionList();
  const data = await api.getSession(sessionId);
  if (!data) return;

  activeTitleEl.textContent = data.session.title;
  activeStatsEl.textContent = `${data.messages.length} messages · ${data.scenes.length} scene${data.scenes.length === 1 ? '' : 's'}`;
  btnDeleteSession.style.display = 'inline-block';
  renderMessages(data.messages, data.scenes);
}

function renderMessages(messages: StoredMessage[], scenes: StoredScene[]): void {
  messagesContainerEl.replaceChildren();
  if (!messages.length) {
    renderEmpty('No messages in this conversation.');
    return;
  }

  const scenesByTurn = new Map<number, StoredScene>();
  for (const sc of scenes) scenesByTurn.set(sc.turnId, sc);

  for (const m of messages) {
    const el = document.createElement('div');
    el.className = `message ${m.role}`;

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = m.cleanText || m.text;

    const scene = m.role === 'assistant' ? scenesByTurn.get(m.turnId) : undefined;
    if (scene) {
      const card = document.createElement('div');
      card.className = 'scene-card';

      const head = document.createElement('div');
      head.className = 'scene-card-head';

      const title = document.createElement('span');
      title.className = 'scene-card-title';
      title.textContent = scene.title;

      const pill = document.createElement('span');
      pill.className = `scene-pill ${scene.kind === '3d' ? 'scene-3d' : scene.kind === 'ui' ? 'scene-ui-pill' : ''}`;
      pill.textContent = scene.kind.toUpperCase();

      head.appendChild(title);
      head.appendChild(pill);

      const btnShow = document.createElement('button');
      btnShow.type = 'button';
      btnShow.className = 'btn-overlay';
      btnShow.textContent = 'Display in Overlay';
      btnShow.addEventListener('click', async () => {
        btnShow.textContent = 'Opening…';
        await api.loadScene(scene.id);
        btnShow.textContent = 'Displayed!';
        setTimeout(() => (btnShow.textContent = 'Display in Overlay'), 2000);
      });

      card.appendChild(head);
      card.appendChild(btnShow);
      bubble.appendChild(card);
    }

    const time = document.createElement('span');
    time.className = 'message-time';
    time.textContent = formatTime(m.createdAt);

    el.appendChild(bubble);
    el.appendChild(time);
    messagesContainerEl.appendChild(el);
  }

  messagesContainerEl.scrollTop = messagesContainerEl.scrollHeight;
}

// ---------------------------------------------------------------- Jobs

async function loadJobs(): Promise<void> {
  jobs = await api.listJobs();
  renderJobsList();
  if (jobs.length && !activeJobId) {
    selectJob(jobs[0]!.id);
  } else if (!jobs.length) {
    activeJobId = null;
    renderEmpty('No background jobs yet.');
  }
}

function renderJobsList(): void {
  jobsListEl.replaceChildren();
  if (!jobs.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.style.padding = '24px 8px';
    empty.textContent = 'No jobs running or completed.';
    jobsListEl.appendChild(empty);
    return;
  }

  for (const j of jobs) {
    const item = document.createElement('div');
    item.className = `session-item ${j.id === activeJobId ? 'active' : ''}`;

    const title = document.createElement('div');
    title.className = 'session-item-title';
    title.textContent = j.title;

    const sub = document.createElement('div');
    sub.className = 'session-item-sub';

    const date = document.createElement('span');
    date.textContent = formatDate(j.updatedAt);

    const pill = document.createElement('span');
    pill.className = `scene-pill ${j.status === 'completed' ? 'scene-3d' : ''}`;
    pill.textContent = j.status;

    sub.appendChild(date);
    sub.appendChild(pill);
    item.appendChild(title);
    item.appendChild(sub);
    item.addEventListener('click', () => selectJob(j.id));
    jobsListEl.appendChild(item);
  }
}

async function selectJob(jobId: string): Promise<void> {
  activeJobId = jobId;
  renderJobsList();
  const job = await api.getJob(jobId);
  if (!job) return;

  activeTitleEl.textContent = job.title;
  activeStatsEl.textContent = `Status: ${job.status.toUpperCase()} · ${job.steps.length} steps`;
  btnDeleteSession.style.display = 'none';

  messagesContainerEl.replaceChildren();

  // If requires approval, show banner
  if (job.status === 'awaiting-approval' && job.requiresApprovalFor) {
    const banner = document.createElement('div');
    banner.className = 'approval-banner';

    const p = document.createElement('p');
    p.textContent = `Approval required: ${job.requiresApprovalFor.description}`;

    const btns = document.createElement('div');
    btns.className = 'approval-btns';

    const btnApprove = document.createElement('button');
    btnApprove.className = 'btn-approve';
    btnApprove.textContent = 'Approve & Run';
    btnApprove.addEventListener('click', async () => {
      btnApprove.disabled = true;
      await api.approveJob(job.id);
      await loadJobs();
      selectJob(job.id);
    });

    const btnReject = document.createElement('button');
    btnReject.className = 'btn-reject';
    btnReject.textContent = 'Cancel Task';
    btnReject.addEventListener('click', async () => {
      btnReject.disabled = true;
      await api.cancelJob(job.id);
      await loadJobs();
      selectJob(job.id);
    });

    btns.appendChild(btnApprove);
    btns.appendChild(btnReject);
    banner.appendChild(p);
    banner.appendChild(btns);
    messagesContainerEl.appendChild(banner);
  }

  // Render steps
  for (const step of job.steps) {
    const row = document.createElement('div');
    row.className = 'step-row';

    const icon = document.createElement('span');
    icon.className = `step-status-icon ${step.status}`;
    icon.textContent = step.status === 'completed' ? '✓' : step.status === 'running' ? '▶' : step.status === 'failed' ? '✗' : '○';

    const desc = document.createElement('span');
    desc.style.flex = '1';
    desc.textContent = step.description;

    row.appendChild(icon);
    row.appendChild(desc);
    if (step.toolName) {
      const badge = document.createElement('span');
      badge.className = 'scene-pill';
      badge.textContent = step.toolName;
      row.appendChild(badge);
    }
    messagesContainerEl.appendChild(row);
  }
}

// ---------------------------------------------------------------- Artifacts

async function loadArtifacts(): Promise<void> {
  artifacts = await api.listArtifacts();
  renderArtifactsList();
  if (artifacts.length && !activeArtifactId) {
    selectArtifact(artifacts[0]!.id);
  } else if (!artifacts.length) {
    activeArtifactId = null;
    renderEmpty('No saved drafts or artifacts yet.');
  }
}

function renderArtifactsList(): void {
  artifactsListEl.replaceChildren();
  if (!artifacts.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.style.padding = '24px 8px';
    empty.textContent = 'No artifacts created yet.';
    artifactsListEl.appendChild(empty);
    return;
  }

  for (const a of artifacts) {
    const item = document.createElement('div');
    item.className = `session-item ${a.id === activeArtifactId ? 'active' : ''}`;

    const title = document.createElement('div');
    title.className = 'session-item-title';
    title.textContent = a.title;

    const sub = document.createElement('div');
    sub.className = 'session-item-sub';

    const date = document.createElement('span');
    date.textContent = formatDate(a.updatedAt);

    const pill = document.createElement('span');
    pill.className = 'scene-pill';
    pill.textContent = a.kind;

    sub.appendChild(date);
    sub.appendChild(pill);
    item.appendChild(title);
    item.appendChild(sub);
    item.addEventListener('click', () => selectArtifact(a.id));
    artifactsListEl.appendChild(item);
  }
}

async function selectArtifact(artifactId: string): Promise<void> {
  activeArtifactId = artifactId;
  renderArtifactsList();
  const art = await api.getArtifact(artifactId);
  if (!art) return;

  activeTitleEl.textContent = art.title;
  activeStatsEl.textContent = `Type: ${art.kind} · SHA256: ${art.checksum.slice(0, 10)}…`;
  btnDeleteSession.style.display = 'none';

  messagesContainerEl.replaceChildren();

  if (art.kind === 'image' && art.content.startsWith('data:image/')) {
    const card = document.createElement('div');
    card.className = 'studio-image-card';

    const img = document.createElement('img');
    img.className = 'studio-generated-img';
    img.src = art.content;
    img.alt = art.title;

    const bar = document.createElement('div');
    bar.className = 'studio-image-bar';

    const isSvg = art.content.startsWith('data:image/svg+xml');
    const metaInfo = `${isSvg ? 'heyguy-svg-synth (Vector)' : 'gpt-image-1 (PNG)'} · SHA256 ${art.checksum.slice(0, 8)}`;

    const metaSpan = document.createElement('span');
    metaSpan.className = 'studio-meta-text';
    metaSpan.textContent = metaInfo;

    const dlLink = document.createElement('a');
    dlLink.className = 'btn-overlay';
    dlLink.href = art.content;
    dlLink.download = `${art.title.replace(/[^a-z0-9-_]+/gi, '_')}.${isSvg ? 'svg' : 'png'}`;
    dlLink.textContent = 'Download Image';

    bar.append(metaSpan, dlLink);
    card.append(img, bar);
    messagesContainerEl.appendChild(card);
    return;
  }

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.style.maxWidth = '100%';
  bubble.style.fontFamily = art.kind === 'code' ? 'monospace' : 'inherit';
  bubble.textContent = art.content;

  messagesContainerEl.appendChild(bubble);
}

// ---------------------------------------------------------------- Instant Studio (UI Harness & GPT-Image-1)

const STUDIO_PRESETS = [
  {
    id: 'preset-ui-harness',
    title: 'AI Inference & Latency Harness',
    badge: 'UI',
    desc: 'Interactive Shadcn dashboard with KPI metrics, SVG throughput bars, live context cost slider, and sortable model matrix.',
    scene: DEMO_UI,
  },
  {
    id: 'preset-2d-transformer',
    title: 'Transformer Attention Flow',
    badge: '2D',
    desc: 'Auto-routed DAG diagram showing tokenization, positional embeddings, multi-head self-attention, and token sampling.',
    scene: DEMO_DIAGRAM,
  },
  {
    id: 'preset-3d-engine',
    title: 'Single-Cylinder Four-Stroke Engine',
    badge: '3D',
    desc: 'Interactive WebGL Three.js scene with animated piston kinematics, connecting rod, crankshaft, and inspectable parts.',
    scene: DEMO_ENGINE,
  },
];

function renderStudioView(): void {
  studioListEl.replaceChildren();
  for (const preset of STUDIO_PRESETS) {
    const item = document.createElement('div');
    item.className = 'session-item';

    const title = document.createElement('div');
    title.className = 'session-item-title';
    title.textContent = preset.title;

    const sub = document.createElement('div');
    sub.className = 'session-item-sub';

    const kindSpan = document.createElement('span');
    kindSpan.textContent = 'Instant Overlay Scene';

    const pill = document.createElement('span');
    pill.className = `scene-pill ${preset.badge === '3D' ? 'scene-3d' : preset.badge === 'UI' ? 'scene-ui-pill' : ''}`;
    pill.textContent = preset.badge;

    sub.append(kindSpan, pill);
    item.append(title, sub);
    item.addEventListener('click', () => {
      void api.previewScene(JSON.stringify(preset.scene));
    });
    studioListEl.appendChild(item);
  }

  activeTitleEl.textContent = 'Instant Studio — Antigravity Harness, Declarative UI & Image Gen';
  activeStatsEl.textContent = 'thanmaybd@gmail.com · gemini-3.8-flash · Shadcn UI · GPT-Image-1';
  btnDeleteSession.style.display = 'none';

  messagesContainerEl.replaceChildren();

  const grid = document.createElement('div');
  grid.className = 'studio-grid';

  // Section 0: Google Account Antigravity Editor-Free Code & Usage Harness (gemini-3.8-flash)
  const agyCard = document.createElement('div');
  agyCard.className = 'studio-section-card';

  const agyHead = document.createElement('div');
  agyHead.className = 'scene-card-head';

  const agyTitle = document.createElement('h3');
  agyTitle.className = 'studio-section-title';
  agyTitle.textContent = '🚀 Antigravity Google Account & Editor-Free Code Harness';

  const agyBadge = document.createElement('span');
  agyBadge.className = 'scene-pill scene-ui-pill';
  agyBadge.textContent = 'thanmaybd@gmail.com · gemini-3.8-flash';
  agyHead.append(agyTitle, agyBadge);

  const agySub = document.createElement('p');
  agySub.className = 'studio-section-sub';
  agySub.textContent =
    'Harnesses your signed-in Google account via Antigravity (gemini-3.8-flash) to generate production code and launch a live interactive UI preview directly onto your overlay — without needing to open or view a code editor.';

  const telemetryBar = document.createElement('div');
  telemetryBar.className = 'studio-image-bar';
  telemetryBar.style.marginBottom = '12px';

  const telemetryText = document.createElement('span');
  telemetryText.className = 'studio-meta-text';
  telemetryText.textContent = 'Loading Antigravity account telemetry…';

  const refreshTelemetry = async () => {
    try {
      const u = await api.getAntigravityUsage();
      const cliLabel = u.cliAvailable ? 'agy CLI Ready' : 'Fallback Synth';
      telemetryBadgeUpdate(u.accountEmail, u.activeModel);
      telemetryText.textContent = `${cliLabel} · Account: ${u.accountEmail} · Model: ${u.activeModel} · Requests: ${u.totalRequests} · Tokens: ${u.totalTokens.toLocaleString()} (In ${u.inputTokens.toLocaleString()} / Out ${u.outputTokens.toLocaleString()} / Think ${u.thinkingTokens.toLocaleString()})`;
    } catch {
      telemetryText.textContent = 'Account: thanmaybd@gmail.com · Model: gemini-3.8-flash-high';
    }
  };

  const telemetryBadgeUpdate = (email: string, model: string) => {
    agyBadge.textContent = `${email} · ${model}`;
  };

  telemetryBar.appendChild(telemetryText);
  void refreshTelemetry();

  const agyForm = document.createElement('div');
  agyForm.className = 'studio-form';

  const agyPrompt = document.createElement('textarea');
  agyPrompt.className = 'studio-textarea';
  agyPrompt.rows = 2;
  agyPrompt.placeholder = 'Describe the app, microservice, or interactive tool to build without opening a code editor…';
  agyPrompt.value = 'Real-time Gemini 3.8 Flash token & latency rate-limiter with interactive throughput simulator';

  const agyControls = document.createElement('div');
  agyControls.className = 'studio-controls-row';

  const langSelect = document.createElement('select');
  langSelect.className = 'assistant-dropdown';
  for (const [val, label] of [
    ['react-tsx', 'Stack: React / TSX Component'],
    ['typescript', 'Stack: TypeScript Module'],
    ['python', 'Stack: Python Service'],
    ['html-app', 'Stack: Self-Contained HTML App'],
  ] as const) {
    langSelect.appendChild(new Option(label, val));
  }

  const agyBtn = document.createElement('button');
  agyBtn.type = 'button';
  agyBtn.className = 'btn-new';
  agyBtn.textContent = '⚡ Generate Code & Launch Overlay UI';

  const agyStatus = document.createElement('span');
  agyStatus.className = 'studio-meta-text';

  const agyOutputPre = document.createElement('pre');
  agyOutputPre.className = 'artifact-content hidden';
  agyOutputPre.style.maxHeight = '220px';
  agyOutputPre.style.overflowY = 'auto';

  agyBtn.addEventListener('click', async () => {
    const prompt = agyPrompt.value.trim();
    if (!prompt) return;
    agyBtn.disabled = true;
    agyBtn.textContent = 'Running Antigravity Harness…';
    agyStatus.textContent = 'Generating code & live UI via gemini-3.8-flash…';
    try {
      const res = await api.runHeadlessCodeGen({
        prompt,
        language: langSelect.value as 'typescript' | 'react-tsx' | 'python' | 'html-app',
      });
      agyStatus.textContent = `${res.summary} — Overlay UI launched & saved to Artifacts!`;
      agyOutputPre.textContent = res.artifact.content;
      agyOutputPre.classList.remove('hidden');
      await refreshTelemetry();
    } catch (err) {
      agyStatus.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      agyBtn.disabled = false;
      agyBtn.textContent = '⚡ Generate Code & Launch Overlay UI';
    }
  });

  agyControls.append(langSelect, agyBtn, agyStatus);
  agyForm.append(agyPrompt, agyControls, agyOutputPre);
  agyCard.append(agyHead, agySub, telemetryBar, agyForm);

  // Section 1: Instant UI & Visual Harness Cards
  const harnessCard = document.createElement('div');
  harnessCard.className = 'studio-section-card';

  const hTitle = document.createElement('h3');
  hTitle.className = 'studio-section-title';
  hTitle.textContent = '⚡ Instant Interactive UI & Scene Harness';

  const hSub = document.createElement('p');
  hSub.className = 'studio-section-sub';
  hSub.textContent =
    'Launch validated Shadcn-styled interactive dashboards, 2D diagrams, or 3D WebGL assemblies directly onto your desktop overlay—or paste custom <scene> JSON to preview immediately.';

  const presetRow = document.createElement('div');
  presetRow.className = 'studio-preset-cards';

  for (const preset of STUDIO_PRESETS) {
    const pCard = document.createElement('div');
    pCard.className = 'studio-preset-card';

    const pHead = document.createElement('div');
    pHead.className = 'scene-card-head';

    const pName = document.createElement('span');
    pName.className = 'scene-card-title';
    pName.textContent = preset.title;

    const pBadge = document.createElement('span');
    pBadge.className = `scene-pill ${preset.badge === '3D' ? 'scene-3d' : preset.badge === 'UI' ? 'scene-ui-pill' : ''}`;
    pBadge.textContent = preset.badge;

    pHead.append(pName, pBadge);

    const pDesc = document.createElement('p');
    pDesc.className = 'studio-preset-desc';
    pDesc.textContent = preset.desc;

    const pBtn = document.createElement('button');
    pBtn.type = 'button';
    pBtn.className = 'btn-overlay';
    pBtn.textContent = 'Launch in Overlay';
    pBtn.addEventListener('click', async () => {
      pBtn.textContent = 'Launching…';
      await api.previewScene(JSON.stringify(preset.scene));
      pBtn.textContent = 'Active on Overlay ✓';
      setTimeout(() => (pBtn.textContent = 'Launch in Overlay'), 2000);
    });

    pCard.append(pHead, pDesc, pBtn);
    presetRow.appendChild(pCard);
  }

  harnessCard.append(hTitle, hSub, presetRow);

  // Section 2: GPT-Image-1 & Vector Illustration Studio
  const imgCard = document.createElement('div');
  imgCard.className = 'studio-section-card';

  const iTitle = document.createElement('h3');
  iTitle.className = 'studio-section-title';
  iTitle.textContent = '🎨 GPT Image Generation (gpt-image-1) & Vector Synth';

  const iSub = document.createElement('p');
  iSub.className = 'studio-section-sub';
  iSub.textContent =
    'Generate high-resolution visual concepts, UI mockups, and technical diagrams using OpenAI gpt-image-1 (automatically falls back to deterministic crisp SVG vector synthesis if no OpenAI key is configured).';

  const formWrap = document.createElement('div');
  formWrap.className = 'studio-form';

  const promptInput = document.createElement('textarea');
  promptInput.className = 'studio-textarea';
  promptInput.rows = 3;
  promptInput.placeholder = 'Describe the image, UI mockup, or architecture diagram to generate (e.g. "Futuristic neural engine telemetry HUD with glowing cyan metrics and dark zinc glassmorphism")…';
  promptInput.value = 'Futuristic neural engine telemetry HUD with glowing cyan metrics and dark zinc glassmorphism';

  const controlsRow = document.createElement('div');
  controlsRow.className = 'studio-controls-row';

  const sizeSelect = document.createElement('select');
  sizeSelect.className = 'assistant-dropdown';
  for (const [val, label] of [
    ['1024x1024', 'Square (1024×1024)'],
    ['1536x1024', 'Landscape (1536×1024)'],
    ['1024x1536', 'Portrait (1024×1536)'],
  ] as const) {
    sizeSelect.appendChild(new Option(label, val));
  }

  const qualitySelect = document.createElement('select');
  qualitySelect.className = 'assistant-dropdown';
  for (const [val, label] of [
    ['auto', 'Quality: Auto'],
    ['high', 'Quality: High'],
    ['medium', 'Quality: Medium'],
    ['low', 'Quality: Low (Fast)'],
  ] as const) {
    qualitySelect.appendChild(new Option(label, val));
  }

  const genBtn = document.createElement('button');
  genBtn.type = 'button';
  genBtn.className = 'btn-new';
  genBtn.textContent = 'Generate Visual Artifact';

  const statusSpan = document.createElement('span');
  statusSpan.className = 'studio-meta-text';

  const previewBox = document.createElement('div');
  previewBox.className = 'studio-preview-box';

  genBtn.addEventListener('click', async () => {
    const prompt = promptInput.value.trim();
    if (!prompt) return;
    genBtn.disabled = true;
    genBtn.textContent = 'Generating…';
    statusSpan.textContent = 'Synthesizing image…';
    try {
      const artifact = await api.generateImage({
        prompt,
        size: sizeSelect.value as '1024x1024' | '1536x1024' | '1024x1536',
        quality: qualitySelect.value as 'auto' | 'high' | 'medium' | 'low',
      });
      statusSpan.textContent = `Saved to Artifacts ("${artifact.title}")`;
      previewBox.replaceChildren();
      const img = document.createElement('img');
      img.className = 'studio-generated-img';
      img.src = artifact.content;
      img.alt = artifact.title;
      previewBox.appendChild(img);
    } catch (err) {
      statusSpan.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      genBtn.disabled = false;
      genBtn.textContent = 'Generate Visual Artifact';
    }
  });

  controlsRow.append(sizeSelect, qualitySelect, genBtn, statusSpan);
  formWrap.append(promptInput, controlsRow, previewBox);
  imgCard.append(iTitle, iSub, formWrap);

  grid.append(agyCard, harnessCard, imgCard);
  messagesContainerEl.appendChild(grid);
}

// ---------------------------------------------------------------- Global Helpers

// ---------------------------------------------------------------- Routines

async function loadRoutines(): Promise<void> {
  routines = await api.listRoutines();
  renderRoutinesList();
  if (routines.length && !activeRoutineId) {
    selectRoutine(routines[0]!.id);
  } else if (!routines.length) {
    activeRoutineId = null;
    renderEmpty('No scheduled routines configured yet.');
  }
}

function renderRoutinesList(): void {
  routinesListEl.replaceChildren();
  if (!routines.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.style.padding = '24px 8px';
    empty.textContent = 'No routines yet.';
    routinesListEl.appendChild(empty);
    return;
  }

  for (const r of routines) {
    const item = document.createElement('div');
    item.className = `session-item ${r.id === activeRoutineId ? 'active' : ''}`;
    item.setAttribute('role', 'option');

    const title = document.createElement('div');
    title.className = 'session-item-title';
    title.textContent = r.title;

    const sub = document.createElement('div');
    sub.className = 'session-item-sub';

    const statusBadge = document.createElement('span');
    statusBadge.className = `badge-status ${r.status}`;
    statusBadge.textContent = r.status.toUpperCase();

    const schedText = document.createElement('span');
    schedText.textContent = `${r.scheduleType}: ${r.scheduleValue}`;

    sub.appendChild(statusBadge);
    sub.appendChild(schedText);

    item.appendChild(title);
    item.appendChild(sub);
    item.addEventListener('click', () => selectRoutine(r.id));
    routinesListEl.appendChild(item);
  }
}

async function selectRoutine(id: string): Promise<void> {
  activeRoutineId = id;
  renderRoutinesList();
  const routine = routines.find((r) => r.id === id);
  if (!routine) return;

  activeTitleEl.textContent = routine.title;
  activeStatsEl.textContent = `Next run: ${new Date(routine.nextRunAt).toLocaleString()} (${routine.timezone})`;
  btnDeleteSession.style.display = 'none';

  messagesContainerEl.replaceChildren();

  const card = document.createElement('div');
  card.className = 'artifact-preview-card';

  const head = document.createElement('div');
  head.className = 'artifact-meta';

  const statusBadge = document.createElement('span');
  statusBadge.className = `badge-status ${routine.status}`;
  statusBadge.textContent = `STATUS: ${routine.status.toUpperCase()}`;
  head.appendChild(statusBadge);

  const sched = document.createElement('span');
  sched.textContent = `Schedule: ${routine.scheduleType} (${routine.scheduleValue})`;
  head.appendChild(sched);

  const last = document.createElement('span');
  last.textContent = routine.lastRunAt ? `Last run: ${new Date(routine.lastRunAt).toLocaleString()}` : 'Never run yet';
  head.appendChild(last);

  const tools = document.createElement('span');
  tools.textContent = `Allowed tools: ${routine.allowedTools.join(', ')}`;
  head.appendChild(tools);

  card.appendChild(head);

  const promptBlock = document.createElement('div');
  promptBlock.className = 'job-goal';
  promptBlock.style.margin = '16px 0';
  promptBlock.textContent = `Prompt: "${routine.prompt}"`;
  card.appendChild(promptBlock);

  // Actions
  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.gap = '10px';
  actions.style.marginTop = '16px';

  const btnRun = document.createElement('button');
  btnRun.className = 'btn-overlay';
  btnRun.textContent = '▶ Run Now';
  btnRun.addEventListener('click', async () => {
    btnRun.textContent = 'Running…';
    btnRun.setAttribute('disabled', 'true');
    await api.runRoutineNow(routine.id);
    await loadRoutines();
  });
  actions.appendChild(btnRun);

  const btnToggle = document.createElement('button');
  btnToggle.className = 'btn-overlay';
  btnToggle.textContent = routine.status === 'active' ? '⏸ Pause Routine' : '▶ Resume Routine';
  btnToggle.addEventListener('click', async () => {
    await api.updateRoutine(routine.id, { status: routine.status === 'active' ? 'paused' : 'active' });
    await loadRoutines();
    selectRoutine(routine.id);
  });
  actions.appendChild(btnToggle);

  const btnDel = document.createElement('button');
  btnDel.className = 'btn-danger';
  btnDel.textContent = 'Delete Routine';
  btnDel.addEventListener('click', async () => {
    if (!confirm(`Delete routine "${routine.title}"?`)) return;
    await api.deleteRoutine(routine.id);
    activeRoutineId = null;
    await loadRoutines();
  });
  actions.appendChild(btnDel);

  card.appendChild(actions);
  messagesContainerEl.appendChild(card);
}

// ---------------------------------------------------------------- Memory

async function loadMemories(): Promise<void> {
  memories = await api.listMemories();
  renderMemoriesList();
  if (memories.length && !activeMemoryId) {
    selectMemory(memories[0]!.id);
  } else if (!memories.length) {
    activeMemoryId = null;
    renderEmpty('No long-term memories or preferences recorded yet.');
  }
}

function renderMemoriesList(): void {
  memoryListEl.replaceChildren();
  if (!memories.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.style.padding = '24px 8px';
    empty.textContent = 'No memories recorded yet.';
    memoryListEl.appendChild(empty);
    return;
  }

  for (const m of memories) {
    const item = document.createElement('div');
    item.className = `session-item ${m.id === activeMemoryId ? 'active' : ''}`;
    item.setAttribute('role', 'option');

    const title = document.createElement('div');
    title.className = 'session-item-title';
    title.textContent = m.content;

    const sub = document.createElement('div');
    sub.className = 'session-item-sub';

    const catBadge = document.createElement('span');
    catBadge.className = `badge-category ${m.category}`;
    catBadge.textContent = m.category;

    const conf = document.createElement('span');
    conf.textContent = `${Math.round(m.confidence * 100)}% conf`;

    sub.appendChild(catBadge);
    sub.appendChild(conf);

    item.appendChild(title);
    item.appendChild(sub);
    item.addEventListener('click', () => selectMemory(m.id));
    memoryListEl.appendChild(item);
  }
}

async function selectMemory(id: string): Promise<void> {
  activeMemoryId = id;
  renderMemoriesList();
  const memory = memories.find((m) => m.id === id);
  if (!memory) return;

  activeTitleEl.textContent = `Memory: ${memory.key}`;
  activeStatsEl.textContent = `${memory.category.toUpperCase()} · ${Math.round(memory.confidence * 100)}% confidence`;
  btnDeleteSession.style.display = 'none';

  messagesContainerEl.replaceChildren();

  const card = document.createElement('div');
  card.className = 'artifact-preview-card';

  const meta = document.createElement('div');
  meta.className = 'artifact-meta';

  const cat = document.createElement('span');
  cat.className = `badge-category ${memory.category}`;
  cat.textContent = memory.category.toUpperCase();
  meta.appendChild(cat);

  const date = document.createElement('span');
  date.textContent = `Recorded: ${new Date(memory.createdAt).toLocaleDateString()}`;
  meta.appendChild(date);

  if (memory.provenance) {
    const prov = document.createElement('span');
    prov.textContent = `Provenance: ${memory.provenance}`;
    meta.appendChild(prov);
  }

  card.appendChild(meta);

  const content = document.createElement('pre');
  content.className = 'artifact-content';
  content.style.marginTop = '16px';
  content.textContent = memory.content;
  card.appendChild(content);

  const actions = document.createElement('div');
  actions.style.marginTop = '20px';

  const btnForget = document.createElement('button');
  btnForget.className = 'btn-danger';
  btnForget.textContent = 'Forget (Delete Memory)';
  btnForget.addEventListener('click', async () => {
    if (!confirm('Forget this memory? HeyGuy will no longer use it in prompts.')) return;
    await api.deleteMemory(memory.id);
    activeMemoryId = null;
    await loadMemories();
  });
  actions.appendChild(btnForget);

  card.appendChild(actions);
  messagesContainerEl.appendChild(card);
}

// ---------------------------------------------------------------- Assistants

async function loadAssistants(): Promise<void> {
  assistants = await api.listAssistants();
  const active = await api.getActiveAssistant();

  selectAssistantEl.replaceChildren();
  for (const a of assistants) {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = `${a.avatar ?? '🤖'} ${a.name} (${a.role})`;
    if (a.id === active.id) opt.selected = true;
    selectAssistantEl.appendChild(opt);
  }

  selectAssistantEl.addEventListener('change', async () => {
    const selectedId = selectAssistantEl.value;
    await api.setActiveAssistant(selectedId);
  });
}

// ---------------------------------------------------------------- Global Helpers

function renderEmpty(text: string): void {
  activeTitleEl.textContent = 'HeyGuy Workspace';
  activeStatsEl.textContent = '';
  btnDeleteSession.style.display = 'none';
  messagesContainerEl.replaceChildren();
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  empty.textContent = text;
  messagesContainerEl.appendChild(empty);
}

// Search handler
searchInputEl.addEventListener('input', () => {
  clearTimeout(searchDebounceTimer);
  const q = searchInputEl.value.trim();
  searchDebounceTimer = window.setTimeout(async () => {
    if (currentTab === 'chats') {
      if (!q) {
        await loadSessions();
        return;
      }
      const results = await api.search(q);
      sessionListEl.replaceChildren();
      if (!results.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.style.padding = '24px 8px';
        empty.textContent = 'No matching messages.';
        sessionListEl.appendChild(empty);
        return;
      }

      for (const r of results) {
        const item = document.createElement('div');
        item.className = 'session-item';
        const title = document.createElement('div');
        title.className = 'session-item-title';
        title.textContent = r.sessionTitle;

        const snippet = document.createElement('div');
        snippet.className = 'session-item-sub';
        snippet.textContent = r.matchedSnippet;

        item.appendChild(title);
        item.appendChild(snippet);
        item.addEventListener('click', () => selectSession(r.sessionId));
        sessionListEl.appendChild(item);
      }
    } else if (currentTab === 'memory') {
      if (!q) {
        await loadMemories();
        return;
      }
      memories = await api.searchMemories(q);
      renderMemoriesList();
      if (memories.length) selectMemory(memories[0]!.id);
      else renderEmpty('No matching memories found.');
    }
  }, 200);
});

// New action
btnNewSession.addEventListener('click', async () => {
  if (currentTab === 'chats') {
    const created = await api.newSession();
    await loadSessions();
    selectSession(created.id);
  } else if (currentTab === 'studio') {
    await api.previewScene(JSON.stringify(DEMO_UI));
  } else if (currentTab === 'jobs') {
    // Demo delegated research / draft task
    const job = await api.createJob('Research & Draft Summary', 'Analyze active screen and draft report', [
      { description: 'Query active application window', toolName: 'query_window' },
      { description: 'Draft summary document', toolName: 'create_document', toolInput: { title: 'Workspace Report', kind: 'markdown', content: '# Screen Analysis\nObserved active desktop state.' } },
      { description: 'Prepare email draft', toolName: 'draft_email', toolInput: { to: 'colleague@example.com', subject: 'Summary Report', body: 'Here is the summary of the active screen.' } },
    ]);
    await loadJobs();
    selectJob(job.id);
  } else if (currentTab === 'routines') {
    const routine = await api.createRoutine({
      title: 'Daily Screen & Email Standup Prep',
      prompt: 'Check open application windows and draft a morning standup summary artifact.',
      scheduleType: 'daily',
      scheduleValue: '09:00',
      allowedTools: ['query_window', 'create_document'],
      missedRunPolicy: 'run_once_on_wake',
    });
    await loadRoutines();
    selectRoutine(routine.id);
  } else if (currentTab === 'memory') {
    const mem = await api.addMemory({
      category: 'preference',
      key: 'code_style',
      content: 'User prefers concise TypeScript solutions with unit test verification.',
      confidence: 1.0,
      provenance: 'workspace-ui',
    });
    await loadMemories();
    selectMemory(mem.id);
  }
});

// Delete session
btnDeleteSession.addEventListener('click', async () => {
  if (!activeSessionId) return;
  if (!confirm('Are you sure you want to delete this conversation?')) return;
  await api.deleteSession(activeSessionId);
  activeSessionId = null;
  await loadSessions();
});

// Initial load
void loadAssistants();
void loadSessions();
