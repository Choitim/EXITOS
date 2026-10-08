import type { Finding, UserReference, UsersConfig } from '@exitos/core';
import type { ClickUpInspection } from './inspection.js';

/** Normalise a user-map key: UUID-ish ids lose dashes and case; e-mails are lower-cased. */
export function userKey(raw: string): string {
  const t = raw.trim().toLowerCase();
  return /^[0-9a-f-]{32,36}$/.test(t) ? t.replace(/-/g, '') : t;
}

export interface ResolvedUser {
  id: number;
  via: 'explicit' | 'email';
}

/**
 * Maps source people to ClickUp members — only ever explicitly (ADR 0010). Notion and ClickUp user
 * ids are unrelated, so nothing is inferred except an opt-in exact e-mail match.
 */
export class UserResolver {
  readonly #byId = new Map<string, number>();
  readonly #members: ClickUpInspection['members'];
  readonly #memberIds: Set<number>;
  readonly #matchByEmail: boolean;
  readonly findings: Finding[] = [];

  constructor(config: UsersConfig, members: ClickUpInspection['members']) {
    this.#members = members;
    this.#memberIds = new Set(members.map((m) => m.id));
    this.#matchByEmail = config.matchByEmail;
    for (const [source, target] of Object.entries(config.map)) {
      const id = typeof target === 'number' ? target : Number(target);
      if (!Number.isInteger(id) || !this.#memberIds.has(id)) {
        this.findings.push({
          code: 'USER_MAP_UNKNOWN_TARGET',
          outcome: 'unsupported',
          severity: 'error',
          category: 'user_mapping',
          message: `users.map entry "${source.includes('@') ? '(e-mail)' : source.slice(0, 8) + '…'}" points to ClickUp user ${String(target)}, who is not a member of this Workspace.`,
        });
        continue;
      }
      this.#byId.set(userKey(source), id);
    }
  }

  resolve(user: UserReference): ResolvedUser | undefined {
    const byId = this.#byId.get(userKey(user.id));
    if (byId !== undefined) return { id: byId, via: 'explicit' };
    if (user.email !== undefined) {
      const byEmail = this.#byId.get(userKey(user.email));
      if (byEmail !== undefined) return { id: byEmail, via: 'explicit' };
      if (this.#matchByEmail) {
        const wanted = user.email.trim().toLowerCase();
        const match = this.#members.find((m) => m.email?.trim().toLowerCase() === wanted);
        if (match) return { id: match.id, via: 'email' };
      }
    }
    return undefined;
  }
}
