import type { z } from 'zod';
import type { Clock, FetchLike, Logger, RequestClassifier, RequestRecorder } from '@exitos/shared';
import type { JsonValue } from '../schema/json.js';
import type {
  Finding,
  FieldDefinition,
  IdMapping,
  ItemVerification,
  MigrationAction,
  MigrationConfig,
  MigrationPlan,
  PlanCollection,
  PlanTarget,
  PlanUsers,
  MappingRule,
  SourceSnapshot,
  Workspace,
} from '../schema/index.js';

// ---------------------------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------------------------

export type ConnectorKind = 'source' | 'destination';
export type RunMode = 'demo' | 'live';

export interface ConnectorManifest {
  /** Stable id used in config files, e.g. `notion`. */
  id: string;
  name: string;
  version: string;
  kind: ConnectorKind;
  /** The vendor API version this connector targets (informational). */
  vendorApiVersion?: string;
  /** Human-readable list of what the connector can read/write. */
  capabilities: string[];
  documentationUrl?: string;
}

/** An environment variable a connector needs. Connectors never read `process.env` themselves. */
export interface CredentialSpec {
  env: string;
  description: string;
  required: boolean;
  /** Expected prefix, used only to give a friendly hint if the value looks wrong. */
  prefixHint?: string;
}

/**
 * Network behaviour a connector declares up front so the host can enforce it (ADR 0006): the hosts
 * its credential may be sent to, and which of its endpoints are reads.
 */
export interface NetworkPolicy {
  defaultBaseUrl: string;
  allowedHosts(baseUrl: string): string[];
  classify: RequestClassifier;
}

/** Everything a connector instance receives. Connectors do all I/O through `fetch`. */
export interface ConnectorContext {
  /** Guarded: host allow-list + read-only enforcement are applied before the network is touched. */
  fetch: FetchLike;
  logger: Logger;
  clock: Clock;
  signal?: AbortSignal;
  /** Resolved secrets keyed by `CredentialSpec.env`. */
  credentials: Readonly<Record<string, string>>;
  baseUrl: string;
  mode: RunMode;
  recorder?: RequestRecorder;
  /** Parallelism budget for the connector's own scheduler. */
  concurrency: number;
}

// ---------------------------------------------------------------------------------------------
// Source connectors
// ---------------------------------------------------------------------------------------------

export interface DiscoveredContainer {
  id: string;
  kind: string; // 'data_source', 'page', ...
  name: string;
  url?: string;
  /** Short description of where it lives, for display. */
  path?: string;
}

export interface SourceDiscovery {
  workspace: Workspace;
  containers: DiscoveredContainer[];
  findings: Finding[];
  /** Plain-language caveats, e.g. "search is not exhaustive". */
  notes: string[];
}

export interface InspectedCollection {
  key: string;
  id: string;
  name: string;
  recordCount: number;
  fields: Array<{
    field: FieldDefinition;
    /** How the field will fare in *any* destination: native, partially, or not at all. */
    support: 'supported' | 'transformed' | 'lossy' | 'unsupported';
    note?: string;
  }>;
  /** True if the source API capped the read (e.g. Notion's 10 000-row query limit). */
  incomplete?: boolean;
}

export interface SourceInspection {
  workspace: Workspace;
  collections: InspectedCollection[];
  documents: Array<{ key: string; title: string; childCount: number }>;
  findings: Finding[];
  notes: string[];
  requests: { reads: number };
}

export interface ExtractOptions {
  /** Called periodically so the CLI can show progress without the connector printing. */
  onProgress?: (message: string) => void;
}

/** A source reads. It never writes, and it never needs to know what the destination is. */
export interface SourceConnector<TRaw = unknown> {
  readonly manifest: ConnectorManifest;
  discover(): Promise<SourceDiscovery>;
  inspect(): Promise<SourceInspection>;
  /** All source I/O. Read-only. */
  extract(options?: ExtractOptions): Promise<TRaw>;
  /** Pure: no I/O, deterministic for identical input. */
  normalize(raw: TRaw): SourceSnapshot;
}

export interface SourceConnectorDefinition<TConfig = unknown, TRaw = unknown> {
  manifest: ConnectorManifest;
  network: NetworkPolicy;
  credentials: CredentialSpec[];
  configSchema: z.ZodType<TConfig>;
  create(
    context: ConnectorContext,
    config: TConfig,
    migration: MigrationConfig,
  ): SourceConnector<TRaw>;
}

// ---------------------------------------------------------------------------------------------
// Destination connectors
// ---------------------------------------------------------------------------------------------

export interface DestinationDiscovery {
  workspaces: Array<{ id: string; name: string }>;
  /** Flattened containers (spaces, folders, lists) the credential can reach. */
  containers: DiscoveredContainer[];
  findings: Finding[];
  notes: string[];
}

/** Connector-specific facts gathered read-only before planning (statuses, fields, members, …). */
export interface DestinationInspection {
  workspace: Workspace;
  targets: PlanTarget[];
  /** Opaque to the core; the same connector's `plan` and `validate` interpret it. */
  data: Record<string, unknown>;
  findings: Finding[];
  requests: { reads: number };
}

export interface PlanInput {
  snapshot: SourceSnapshot;
  inspection: DestinationInspection;
  config: MigrationConfig;
  mode: RunMode;
  /** Source key → destination id for items migrated by previous runs (duplicate prevention). */
  existing: ReadonlyMap<string, IdMapping>;
}

/** What a destination contributes to a plan. Core assembles and seals the final plan. */
export interface PlanFragment {
  collections: PlanCollection[];
  mappings: MappingRule[];
  /** In the order they should be attempted; dependencies must precede dependents. */
  actions: MigrationAction[];
  users: PlanUsers;
  findings: Finding[];
  targets: PlanTarget[];
  /** Minimal credential-free config to apply/verify the plan later (see `PlanBody.destination.config`). */
  destinationConfig: Record<string, JsonValue>;
  knownLimits: string[];
  options: Record<string, JsonValue>;
  requestsPerMinute: number;
}

export interface AdoptedItem {
  actionId: string;
  destinationId: string;
  destinationUrl?: string;
}

export interface ValidationResult {
  /** `error` severity findings block apply. */
  findings: Finding[];
  /** Planned items already present in the destination (found via the provenance marker). */
  adopted: AdoptedItem[];
  readRequests: number;
}

export interface ApplyContext {
  runId: string;
  attempt: number;
  /** Destination ids created earlier in this run (or earlier runs) for dependency resolution. */
  resolveDependency(
    actionId: string,
  ): { destinationId: string; destinationUrl?: string } | undefined;
  /** Destination id for any source key in this action's scope (cross-run lookups). */
  lookupBySource(
    sourceKey: string,
    scope: string,
  ): { destinationId: string; destinationUrl?: string } | undefined;
  signal?: AbortSignal;
}

export interface ApplyResult {
  destinationId: string;
  destinationUrl?: string;
}

export interface ReconcileRequest {
  /** ISO time of the first attempt that might have reached the server. */
  since: string;
  attempt: number;
  /** Destination ids of prerequisite actions (e.g. the task a link connects). */
  resolveDependency(
    actionId: string,
  ): { destinationId: string; destinationUrl?: string } | undefined;
}

export type ReconcileResult =
  | { status: 'found'; destinationId: string; destinationUrl?: string }
  /** No item carries the marker. `confident` is false if the destination listing may be stale/incomplete. */
  | { status: 'not_found'; confident: boolean }
  | { status: 'undecidable'; reason: string };

export interface VerifyInput {
  plan: MigrationPlan;
  /** Succeeded actions only: where each planned item ended up. */
  mappings: Array<{ actionId: string; destinationId: string }>;
}

export interface VerifyOutput {
  items: ItemVerification[];
  targets: Array<{ target: string; expected: number; found: number }>;
  scope: string;
  notes: string[];
  readRequests: number;
}

/** A destination plans, validates, writes (one action at a time) and verifies. */
export interface DestinationConnector {
  readonly manifest: ConnectorManifest;
  discover(): Promise<DestinationDiscovery>;
  inspect(): Promise<DestinationInspection>;
  /** Pure: no I/O, deterministic for identical input. */
  plan(input: PlanInput): PlanFragment;
  /** Read-only checks against the live destination, including adoption of prior migrations. */
  validate(plan: MigrationPlan): Promise<ValidationResult>;
  /**
   * Execute exactly one action. Throw `AmbiguousWriteError` whenever the outcome is unknown so the
   * executor reconciles instead of re-sending.
   */
  apply(action: MigrationAction, context: ApplyContext): Promise<ApplyResult>;
  /** Optional: look for the effects of an ambiguous write. Without it, ambiguous writes stop the run. */
  reconcile?(action: MigrationAction, request: ReconcileRequest): Promise<ReconcileResult>;
  verify(input: VerifyInput): Promise<VerifyOutput>;
}

export interface DestinationConnectorDefinition<TConfig = unknown> {
  manifest: ConnectorManifest;
  network: NetworkPolicy;
  credentials: CredentialSpec[];
  configSchema: z.ZodType<TConfig>;
  create(
    context: ConnectorContext,
    config: TConfig,
    migration: MigrationConfig,
  ): DestinationConnector;
}
