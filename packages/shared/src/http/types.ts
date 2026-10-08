/** The subset of `fetch` ExitOS relies on. Both the real `fetch` and test fakes satisfy it. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * How a connector classifies an outbound request. `unknown` is treated as a write (fail closed).
 */
export type RequestClass = 'read' | 'write' | 'unknown';

export interface RequestDescriptor {
  readonly method: string;
  readonly url: URL;
}

export type RequestClassifier = (request: RequestDescriptor) => RequestClass;
