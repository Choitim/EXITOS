import type { RequestClass } from './types.js';

export interface RecordedRequest {
  readonly seq: number;
  readonly method: string;
  readonly host: string;
  /** Path only: no query values, no credentials. */
  readonly path: string;
  readonly class: RequestClass;
  /** True when the guard refused to send it. */
  readonly blocked: boolean;
  readonly status?: number;
}

/**
 * Records every request that passes through a guarded fetch. Stores NO headers and NO bodies, so it
 * is safe to persist and to use as the "request spy" proving that a dry run performs zero writes.
 */
export class RequestRecorder {
  readonly #entries: RecordedRequest[] = [];
  #seq = 0;

  record(entry: Omit<RecordedRequest, 'seq'>): void {
    this.#entries.push({ ...entry, seq: ++this.#seq });
  }

  get entries(): readonly RecordedRequest[] {
    return this.#entries;
  }

  /** Requests actually sent that were not classified as reads. */
  get writes(): readonly RecordedRequest[] {
    return this.#entries.filter((e) => !e.blocked && e.class !== 'read');
  }

  get reads(): readonly RecordedRequest[] {
    return this.#entries.filter((e) => !e.blocked && e.class === 'read');
  }

  get blocked(): readonly RecordedRequest[] {
    return this.#entries.filter((e) => e.blocked);
  }

  clear(): void {
    this.#entries.length = 0;
  }

  summary(): { reads: number; writes: number; blocked: number } {
    return { reads: this.reads.length, writes: this.writes.length, blocked: this.blocked.length };
  }
}
