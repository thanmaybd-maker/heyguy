import type { ToolDefinition } from '../../shared/types';

export interface ToolContext {
  jobId?: string;
  signal: AbortSignal;
}

export interface ToolHandler<TInput = Record<string, unknown>, TOutput = unknown> {
  definition: ToolDefinition;
  execute(input: TInput, ctx: ToolContext): Promise<TOutput>;
}

export interface ToolExecutionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  requiresApproval?: boolean;
  approvalDescription?: string;
}

