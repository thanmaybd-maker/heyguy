// Quiet Notification Dispatcher for HeyGuy.
// Delivers desktop notifications for background job completion, routines, and approvals
// with quiet mode and urgency awareness.
import type { NotificationOptions } from '../../shared/types';

export interface NotificationPolicy {
  quietMode: boolean;
  quietHoursStart?: number; // hour (0-23)
  quietHoursEnd?: number;   // hour (0-23)
}

export interface NotificationAdapter {
  isSupported(): boolean;
  show(title: string, body: string, silent: boolean): boolean;
}

export class NotificationDispatcher {
  private policy: NotificationPolicy = {
    quietMode: false,
    quietHoursStart: 22,
    quietHoursEnd: 8,
  };

  constructor(
    policy?: Partial<NotificationPolicy>,
    private readonly adapter?: NotificationAdapter
  ) {
    if (policy) {
      this.policy = { ...this.policy, ...policy };
    }
  }

  setQuietMode(enabled: boolean): void {
    this.policy.quietMode = enabled;
  }

  isQuietTime(): boolean {
    if (this.policy.quietMode) return true;
    if (this.policy.quietHoursStart === undefined || this.policy.quietHoursEnd === undefined) {
      return false;
    }

    const currentHour = new Date().getHours();
    const { quietHoursStart: start, quietHoursEnd: end } = this.policy;

    if (start <= end) {
      return currentHour >= start && currentHour < end;
    }
    // Overnight window (e.g. 22:00 to 08:00)
    return currentHour >= start || currentHour < end;
  }

  notify(opts: NotificationOptions): boolean {
    const isUrgent = opts.urgency === 'critical';
    const isQuiet = this.isQuietTime();

    // If quiet mode is active and not urgent, suppress visual/audio alert
    if (isQuiet && !isUrgent) {
      return false;
    }

    if (this.adapter) {
      return this.adapter.show(opts.title, opts.body, opts.silent ?? isQuiet);
    }

    try {
      // In Electron main process runtime, resolve electron dynamically
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const electron = require('electron');
      const NotificationClass = electron?.Notification;
      if (NotificationClass && NotificationClass.isSupported()) {
        const notif = new NotificationClass({
          title: opts.title,
          body: opts.body,
          silent: opts.silent ?? isQuiet,
        });
        notif.show();
        return true;
      }
    } catch {
      // Running outside Electron (e.g. unit test runner)
    }

    return false;
  }
}

