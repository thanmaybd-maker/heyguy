import type { ChatTurn } from '../../shared/types';

export interface VisionRequest {
  system: string;
  history: ChatTurn[];
  imageJpegBase64: string;
  prompt: string;
  signal: AbortSignal;
}

export interface ProviderConfig {
  apiKey: string;
  model: string;
}
