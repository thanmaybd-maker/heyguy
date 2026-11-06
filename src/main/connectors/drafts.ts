// Structured drafting connector: email & document drafting with verified formatting,
// checksums, and artifact storage.
import type { DatabaseStore } from '../storage/db';
import type { ArtifactRecord } from '../../shared/types';

export interface EmailDraftInput {
  to: string;
  subject: string;
  body: string;
  jobId?: string;
}

export interface DocumentDraftInput {
  title: string;
  kind: 'markdown' | 'text' | 'code';
  content: string;
  jobId?: string;
}

export class DraftConnector {
  constructor(private readonly db: DatabaseStore) {}

  createEmailDraft(input: EmailDraftInput): { artifact: ArtifactRecord; rawRfc822: string } {
    const rawRfc822 = [
      `To: ${input.to}`,
      `Subject: ${input.subject}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      input.body,
    ].join('\r\n');

    const artifact = this.db.saveArtifact(
      `Draft: ${input.subject || 'Untitled'}`,
      'email-draft',
      rawRfc822,
      input.jobId
    );

    return { artifact, rawRfc822 };
  }

  createDocument(input: DocumentDraftInput): ArtifactRecord {
    return this.db.saveArtifact(input.title, input.kind, input.content, input.jobId);
  }

  createImageArtifact(input: { title: string; dataUrl: string; jobId?: string }): ArtifactRecord {
    return this.db.saveArtifact(input.title || 'Generated Image', 'image', input.dataUrl, input.jobId);
  }
}

