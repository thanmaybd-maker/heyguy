// Persistent Job Engine: executes multi-step delegated tasks with approval checkpoints,
// cancellation propagation, and durable SQLite backing.
import { EventEmitter } from 'node:events';
import type { DatabaseStore } from '../storage/db';
import type { ToolRegistry } from '../tools/registry';
import type { JobApprovalRequest, JobRecord } from '../../shared/types';

export class JobEngine extends EventEmitter {
  private activeJobs = new Map<string, AbortController>();

  constructor(
    private readonly db: DatabaseStore,
    private readonly tools: ToolRegistry
  ) {
    super();
  }

  createJob(
    title: string,
    goal: string,
    steps: { description: string; toolName?: string; toolInput?: Record<string, unknown> }[]
  ): JobRecord {
    const job = this.db.createJob(title, goal, steps);
    this.emit('job-created', job);
    return job;
  }

  getJob(jobId: string): JobRecord | null {
    return this.db.getJob(jobId);
  }

  listJobs(limit = 50): JobRecord[] {
    return this.db.listJobs(limit);
  }

  cancelJob(jobId: string): boolean {
    const controller = this.activeJobs.get(jobId);
    if (controller) {
      controller.abort();
      this.activeJobs.delete(jobId);
    }
    const job = this.db.getJob(jobId);
    if (!job) return false;
    if (job.status !== 'completed' && job.status !== 'failed') {
      this.db.updateJobStatus(jobId, 'cancelled');
      this.emit('job-updated', { ...job, status: 'cancelled' });
    }
    return true;
  }

  async approveAndResume(jobId: string): Promise<boolean> {
    const job = this.db.getJob(jobId);
    if (!job || job.status !== 'awaiting-approval' || !job.requiresApprovalFor) return false;

    // Clear approval gate and resume
    this.db.updateJobStatus(jobId, 'running');
    await this.runRemainingSteps(jobId, true);
    return true;
  }

  async startJob(jobId: string): Promise<void> {
    const job = this.db.getJob(jobId);
    if (!job || job.status === 'running') return;

    this.db.updateJobStatus(jobId, 'running');
    this.emit('job-updated', { ...job, status: 'running' });
    await this.runRemainingSteps(jobId, false);
  }

  private async runRemainingSteps(jobId: string, approvedCurrentStep = false): Promise<void> {
    const controller = new AbortController();
    this.activeJobs.set(jobId, controller);

    try {
      let job = this.db.getJob(jobId);
      if (!job) return;

      while (job.currentStepIndex < job.steps.length) {
        if (controller.signal.aborted) {
          this.db.updateJobStatus(jobId, 'cancelled');
          return;
        }

        const stepIndex = job.currentStepIndex;
        const step = job.steps[stepIndex];
        if (!step) break;

        this.db.updateJobStep(step.id, 'running');
        this.emit('step-started', { jobId, stepIndex, description: step.description });

        if (step.toolName) {
          const isApproved = approvedCurrentStep && stepIndex === job.currentStepIndex;
          approvedCurrentStep = false; // reset flag after first use

          const execResult = await this.tools.execute(
            step.toolName,
            step.toolInput ?? {},
            { jobId, signal: controller.signal },
            isApproved
          );

          if (execResult.requiresApproval) {
            const req: JobApprovalRequest = {
              toolName: step.toolName,
              description: execResult.approvalDescription ?? step.description,
              params: step.toolInput ?? {},
            };
            this.db.updateJobStatus(jobId, 'awaiting-approval', undefined, req, stepIndex);
            this.emit('job-awaiting-approval', { jobId, request: req });
            return; // pause until approveAndResume is called
          }

          if (!execResult.success) {
            this.db.updateJobStep(step.id, 'failed', execResult.error);
            this.db.updateJobStatus(jobId, 'failed', execResult.error ?? 'Step failed', undefined, stepIndex);
            this.emit('job-updated', this.db.getJob(jobId));
            return;
          }

          this.db.updateJobStep(step.id, 'completed', execResult.data);
        } else {
          // Pure description step
          this.db.updateJobStep(step.id, 'completed', { done: true });
        }

        const nextIndex = stepIndex + 1;
        this.db.updateJobStatus(jobId, 'running', undefined, undefined, nextIndex);
        job = this.db.getJob(jobId);
        if (!job) break;
      }

      this.db.updateJobStatus(jobId, 'completed');
      this.emit('job-completed', this.db.getJob(jobId));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.db.updateJobStatus(jobId, 'failed', msg);
      this.emit('job-updated', this.db.getJob(jobId));
    } finally {
      this.activeJobs.delete(jobId);
    }
  }
}
