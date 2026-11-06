// Turn ownership: every user request gets a turn id. Only the current turn may
// emit events or change shared state, so a slow old request can never
// overwrite a newer answer, drawing or display lock.

export interface Turn {
  readonly id: number;
  readonly controller: AbortController;
  /** next event sequence number for this turn */
  seq: number;
}

export class TurnManager {
  private counter = 0;
  private current: Turn | null = null;

  /** Start a new turn, cancelling whatever was running. */
  begin(): Turn {
    this.current?.controller.abort();
    const turn: Turn = { id: ++this.counter, controller: new AbortController(), seq: 0 };
    this.current = turn;
    return turn;
  }

  isCurrent(turn: Turn): boolean {
    return this.current === turn && !turn.controller.signal.aborted;
  }

  /** Finish a turn. Returns true only if it was still the current one. */
  end(turn: Turn): boolean {
    if (this.current !== turn) return false;
    this.current = null;
    return true;
  }

  cancel(): void {
    this.current?.controller.abort();
    this.current = null;
  }

  get active(): Turn | null {
    return this.current;
  }
}
