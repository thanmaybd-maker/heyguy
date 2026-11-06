// Guided teaching walkthrough engine: tracks interactive tutorial steps,
// points to controls, observes user progress, and validates transition outcomes.
import { EventEmitter } from 'node:events';
import type { WalkthroughState, WalkthroughStep } from '../../shared/types';

export class WalkthroughObserver extends EventEmitter {
  private activeWalkthrough: {
    topic: string;
    steps: WalkthroughStep[];
    currentIndex: number;
  } | null = null;

  start(topic: string, steps: WalkthroughStep[]): WalkthroughState {
    this.activeWalkthrough = {
      topic,
      steps,
      currentIndex: 0,
    };
    const state = this.getState();
    this.emit('state-changed', state);
    return state;
  }

  next(): WalkthroughState {
    if (!this.activeWalkthrough) return this.getState();
    if (this.activeWalkthrough.currentIndex < this.activeWalkthrough.steps.length - 1) {
      this.activeWalkthrough.currentIndex++;
    } else {
      // Completed all steps
      const state: WalkthroughState = {
        active: false,
        topic: this.activeWalkthrough.topic,
        currentStep: this.activeWalkthrough.steps.length,
        totalSteps: this.activeWalkthrough.steps.length,
        step: null,
        completed: true,
      };
      this.activeWalkthrough = null;
      this.emit('state-changed', state);
      return state;
    }
    const state = this.getState();
    this.emit('state-changed', state);
    return state;
  }

  cancel(): WalkthroughState {
    this.activeWalkthrough = null;
    const state: WalkthroughState = {
      active: false,
      topic: '',
      currentStep: 0,
      totalSteps: 0,
      step: null,
      completed: false,
    };
    this.emit('state-changed', state);
    return state;
  }

  getState(): WalkthroughState {
    if (!this.activeWalkthrough) {
      return {
        active: false,
        topic: '',
        currentStep: 0,
        totalSteps: 0,
        step: null,
        completed: false,
      };
    }

    const step = this.activeWalkthrough.steps[this.activeWalkthrough.currentIndex] ?? null;
    return {
      active: true,
      topic: this.activeWalkthrough.topic,
      currentStep: this.activeWalkthrough.currentIndex + 1,
      totalSteps: this.activeWalkthrough.steps.length,
      step,
      completed: false,
    };
  }
}

