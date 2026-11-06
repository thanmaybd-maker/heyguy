// Built-in tools for HeyGuy: email & document drafting, desktop control,
// workspace search, and browser automation.
import type { ToolRegistry } from './registry';
import type { DatabaseStore } from '../storage/db';
import type { DraftConnector } from '../connectors/drafts';
import type { WindowsController } from '../control/windows';
import type { BrowserBridge } from '../browser/bridge';
import { generateImage, type ImageQuality, type ImageSize } from '../ai/image-gen';
import { runHeadlessCodeGen } from '../ai/antigravity';

export function registerBuiltinTools(
  registry: ToolRegistry,
  deps: {
    db: DatabaseStore;
    drafts: DraftConnector;
    windows: WindowsController;
    browser: BrowserBridge;
    getOpenaiKey?: () => string;
    getAntigravityConfig?: () => { accountEmail: string; model: string; geminiKeyFallback?: string; geminiModel?: string };
  }
): void {
  // 1. Email drafting
  registry.register({
    definition: {
      name: 'draft_email',
      description: 'Creates a verified email draft in the local artifact store.',
      risk: 'consequential',
      parameters: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Subject line' },
        body: { type: 'string', description: 'Email body contents' },
      },
    },
    async execute(input, ctx) {
      const to = String(input.to ?? '');
      const subject = String(input.subject ?? '');
      const body = String(input.body ?? '');
      return deps.drafts.createEmailDraft({ to, subject, body, jobId: ctx.jobId });
    },
  });

  // 2. Document creation
  registry.register({
    definition: {
      name: 'create_document',
      description: 'Saves a structured markdown or text document into artifacts.',
      risk: 'reversible',
      parameters: {
        title: { type: 'string', description: 'Document title' },
        kind: { type: 'string', enum: ['markdown', 'text', 'code'], description: 'Document type' },
        content: { type: 'string', description: 'Document text' },
      },
    },
    async execute(input, ctx) {
      const title = String(input.title ?? 'Untitled Document');
      const kind = (input.kind === 'code' ? 'code' : input.kind === 'text' ? 'text' : 'markdown') as 'markdown' | 'text' | 'code';
      const content = String(input.content ?? '');
      return deps.drafts.createDocument({ title, kind, content, jobId: ctx.jobId });
    },
  });

  // 3. Workspace search
  registry.register({
    definition: {
      name: 'search_workspace',
      description: 'Searches previous conversations, summaries, and notes.',
      risk: 'read-only',
      parameters: {
        query: { type: 'string', description: 'Search keywords' },
      },
    },
    async execute(input) {
      const query = String(input.query ?? '');
      return deps.db.search(query, 10);
    },
  });

  // 4. Windows active window query
  registry.register({
    definition: {
      name: 'query_window',
      description: 'Inspects the active foreground application window and coordinates.',
      risk: 'read-only',
      parameters: {},
    },
    async execute() {
      const info = await deps.windows.getActiveWindow();
      return info ?? { message: 'No active window found' };
    },
  });

  // 5. Desktop click
  registry.register({
    definition: {
      name: 'desktop_click',
      description: 'Clicks at physical desktop pixel coordinates with takeover detection.',
      risk: 'consequential',
      parameters: {
        x: { type: 'number', description: 'X coordinate' },
        y: { type: 'number', description: 'Y coordinate' },
      },
    },
    async execute(input) {
      const x = Number(input.x);
      const y = Number(input.y);
      if (Number.isNaN(x) || Number.isNaN(y)) throw new Error('Invalid click coordinates');

      const leased = deps.windows.acquireControlLease(() => {
        // User touched mouse -> takeover
      });
      if (!leased) throw new Error('Desktop control lease busy');

      try {
        const ok = await deps.windows.click(x, y);
        return { clicked: ok, x, y };
      } finally {
        deps.windows.releaseControlLease();
      }
    },
  });

  // 6. Desktop type
  registry.register({
    definition: {
      name: 'desktop_type',
      description: 'Types keystrokes into active window with takeover detection.',
      risk: 'consequential',
      parameters: {
        text: { type: 'string', description: 'Text to type' },
      },
    },
    async execute(input) {
      const text = String(input.text ?? '');
      const leased = deps.windows.acquireControlLease(() => {});
      if (!leased) throw new Error('Desktop control lease busy');

      try {
        const ok = await deps.windows.type(text);
        return { typed: ok, length: text.length };
      } finally {
        deps.windows.releaseControlLease();
      }
    },
  });

  // 7. Browser navigation
  registry.register({
    definition: {
      name: 'browser_navigate',
      description: 'Navigates the user active browser tab to a specified URL.',
      risk: 'consequential',
      parameters: {
        url: { type: 'string', description: 'Target URL' },
      },
    },
    async execute(input) {
      const url = String(input.url ?? '');
      return deps.browser.sendCommand('navigate', { url });
    },
  });

  // 8. Browser extract
  registry.register({
    definition: {
      name: 'browser_extract',
      description: 'Extracts visible text content from the current active browser tab.',
      risk: 'read-only',
      parameters: {},
    },
    async execute() {
      return deps.browser.sendCommand('extract_content');
    },
  });

  // 9. Image generation (OpenAI gpt-image-1 + SVG synthesis fallback)
  registry.register({
    definition: {
      name: 'generate_image',
      description: 'Generates a visual illustration or concept image using gpt-image-1 (or SVG synthesis) and saves it to the artifact store.',
      risk: 'reversible',
      parameters: {
        title: { type: 'string', description: 'Title for the saved image artifact' },
        prompt: { type: 'string', description: 'Detailed visual description of the image to generate' },
        size: { type: 'string', enum: ['1024x1024', '1536x1024', '1024x1536'], description: 'Image dimensions' },
        quality: { type: 'string', enum: ['low', 'medium', 'high', 'auto'], description: 'Rendering quality' },
      },
    },
    async execute(input, ctx) {
      const title = String(input.title ?? 'Generated Visual');
      const prompt = String(input.prompt ?? title);
      const size = (typeof input.size === 'string' ? input.size : '1024x1024') as ImageSize;
      const quality = (typeof input.quality === 'string' ? input.quality : 'auto') as ImageQuality;
      const res = await generateImage({ openaiKey: deps.getOpenaiKey?.() }, { prompt, size, quality }, ctx.signal);
      const artifact = deps.drafts.createImageArtifact({ title, dataUrl: res.dataUrl, jobId: ctx.jobId });
      return { artifactId: artifact.id, model: res.model, mimeType: res.mimeType, size: res.size };
    },
  });

  // 10. Antigravity Editor-Free Headless Code Generation Harness
  registry.register({
    definition: {
      name: 'antigravity_codegen',
      description: 'Generates production code and an interactive SceneUI harness without opening a code editor, using the Google Account Antigravity (gemini-3.8-flash) harness.',
      risk: 'reversible',
      parameters: {
        prompt: { type: 'string', description: 'What software, component, or script to generate' },
        language: { type: 'string', enum: ['typescript', 'react-tsx', 'python', 'html-app'], description: 'Target language' },
      },
    },
    async execute(input, ctx) {
      const prompt = String(input.prompt ?? 'Build a telemetry widget');
      const language = (typeof input.language === 'string' ? input.language : 'react-tsx') as 'typescript' | 'react-tsx' | 'python' | 'html-app';
      const agyCfg = deps.getAntigravityConfig?.() ?? { accountEmail: 'thanmaybd@gmail.com', model: 'gemini-3.8-flash-high' };
      const res = await runHeadlessCodeGen({ prompt, language, ...agyCfg }, ctx.signal);
      const artifact = deps.drafts.createDocument({
        title: res.title,
        kind: 'code',
        content: res.code,
        jobId: ctx.jobId,
      });
      return {
        artifactId: artifact.id,
        summary: res.summary,
        sceneId: res.scene.id,
        usage: res.usage,
      };
    },
  });
}
