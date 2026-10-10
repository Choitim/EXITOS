import { ConfigError } from '@exitos/shared';
import type {
  ApplyContext,
  ApplyResult,
  ConnectorContext,
  DestinationConnector,
  DestinationConnectorDefinition,
  DestinationDiscovery,
  DestinationInspection,
  DiscoveredContainer,
  MigrationAction,
  MigrationConfig,
  MigrationPlan,
  PlanFragment,
  PlanInput,
  ReconcileRequest,
  ReconcileResult,
  ValidationResult,
  VerifyInput,
  VerifyOutput,
} from '@exitos/core';
import { applyClickUpAction } from './apply.js';
import { ClickUpClient } from './client.js';
import { ClickUpDestinationConfigSchema, type ClickUpDestinationConfig } from './config.js';
import { inspectClickUp } from './inspection.js';
import { clickupNetworkPolicy } from './network.js';
import { planClickUp } from './plan.js';
import { reconcileClickUpAction } from './reconcile.js';
import { validateClickUpPlan } from './validate.js';
import { verifyClickUp } from './verify.js';

export const CLICKUP_CONNECTOR_VERSION = '0.1.0';

export const clickupManifest = {
  id: 'clickup',
  name: 'ClickUp',
  version: CLICKUP_CONNECTOR_VERSION,
  kind: 'destination' as const,
  vendorApiVersion: 'v2 (tasks), v3 (Docs)',
  capabilities: [
    'tasks (name, Markdown description, status, priority, dates, assignees, tags, existing Custom Fields)',
    'linked tasks',
    'Docs and pages (experimental)',
    'reconciliation of ambiguous writes',
    'list-based verification',
  ],
  documentationUrl: 'https://developer.clickup.com/docs/authentication',
};

class ClickUpDestination implements DestinationConnector {
  readonly manifest = clickupManifest;
  readonly #client: ClickUpClient;
  readonly #config: ClickUpDestinationConfig;
  readonly #migration: MigrationConfig;

  constructor(
    context: ConnectorContext,
    config: ClickUpDestinationConfig,
    migration: MigrationConfig,
  ) {
    const token = context.credentials.CLICKUP_API_TOKEN;
    if (token === undefined) throw new ConfigError('CLICKUP_API_TOKEN is not set.');
    this.#config = config;
    this.#migration = migration;
    this.#client = new ClickUpClient({
      context,
      token,
      requestsPerMinute: config.requestsPerMinute,
    });
  }

  async discover(): Promise<DestinationDiscovery> {
    const teams = await this.#client.getTeams();
    const containers: DiscoveredContainer[] = [];
    for (const team of teams) {
      const spaces = await this.#client.getSpaces(team.id);
      for (const space of spaces) {
        containers.push({ id: space.id, kind: 'space', name: space.name, path: team.name });
        for (const list of await this.#client.getFolderlessLists(space.id)) {
          containers.push({
            id: list.id,
            kind: 'list',
            name: list.name,
            path: `${team.name} / ${space.name}`,
          });
        }
        for (const folder of await this.#client.getFolders(space.id)) {
          containers.push({
            id: folder.id,
            kind: 'folder',
            name: folder.name,
            path: `${team.name} / ${space.name}`,
          });
          for (const list of folder.lists) {
            containers.push({
              id: list.id,
              kind: 'list',
              name: list.name,
              path: `${team.name} / ${space.name} / ${folder.name}`,
            });
          }
        }
      }
    }
    return {
      workspaces: teams.map((t) => ({ id: t.id, name: t.name })),
      containers,
      findings: [],
      notes: [
        'Copy a list id into destination.lists[].listId. In ClickUp API v2 a "team" is a Workspace.',
        'ExitOS only fills existing Custom Fields — the ClickUp API cannot create them.',
      ],
    };
  }

  inspect(): Promise<DestinationInspection> {
    return inspectClickUp(this.#client, this.#config);
  }

  plan(input: PlanInput): PlanFragment {
    return planClickUp({ ...input, config: this.#migration }, this.#config);
  }

  validate(plan: MigrationPlan): Promise<ValidationResult> {
    return validateClickUpPlan(this.#client, plan);
  }

  apply(action: MigrationAction, context: ApplyContext): Promise<ApplyResult> {
    return applyClickUpAction(this.#client, action, context);
  }

  reconcile(action: MigrationAction, request: ReconcileRequest): Promise<ReconcileResult> {
    return reconcileClickUpAction(this.#client, action, request);
  }

  verify(input: VerifyInput): Promise<VerifyOutput> {
    return verifyClickUp(this.#client, input);
  }
}

export const clickupDestination: DestinationConnectorDefinition<ClickUpDestinationConfig> = {
  manifest: clickupManifest,
  network: clickupNetworkPolicy,
  credentials: [
    {
      env: 'CLICKUP_API_TOKEN',
      description: 'ClickUp personal API token (Settings → Apps)',
      required: true,
      prefixHint: 'pk_',
      helpUrl: 'https://developer.clickup.com/docs/authentication',
    },
  ],
  configSchema: ClickUpDestinationConfigSchema,
  create: (context, config, migration) => new ClickUpDestination(context, config, migration),
};
