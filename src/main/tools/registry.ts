// Tool registry and host-side permission broker.
// Controls tool execution, schema parameters, and security policies (read-only vs consequential).
import type { ToolDefinition } from '../../shared/types';
import type { ToolContext, ToolExecutionResult, ToolHandler } from './types';

export class ToolRegistry {
  private readonly tools = new Map<string, ToolHandler>();

  register<TInput = Record<string, unknown>, TOutput = unknown>(handler: ToolHandler<TInput, TOutput>): void {
    this.tools.set(handler.definition.name, handler as ToolHandler);
  }

  get(name: string): ToolHandler | undefined {
    return this.tools.get(name);
  }

  listDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  async execute(
    name: string,
    input: Record<string, unknown>,
    ctx: ToolContext,
    hasUserApproval = false
  ): Promise<ToolExecutionResult> {
    const handler = this.tools.get(name);
    if (!handler) {
      return { success: false, error: `Tool "${name}" is not registered.` };
    }

    // Host-side permission decision independent of model output
    if (handler.definition.risk === 'consequential' && !hasUserApproval) {
      return {
        success: false,
        requiresApproval: true,
        approvalDescription: `Execute action ${name} (${handler.definition.description})`,
      };
    }

    try {
      if (ctx.signal.aborted) {
        return { success: false, error: 'Cancelled' };
      }
      const data = await handler.execute(input, ctx);
      return { success: true, data };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

