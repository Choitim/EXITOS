import { ConfigError } from '@exitos/shared';
import type { DestinationConnectorDefinition, SourceConnectorDefinition } from './types.js';

/**
 * Registry of available connectors. The CLI is the composition root: it registers the connectors
 * it ships with, and third parties can register their own before running the engine.
 */
export class ConnectorRegistry {
  readonly #sources = new Map<string, SourceConnectorDefinition>();
  readonly #destinations = new Map<string, DestinationConnectorDefinition>();

  registerSource<TConfig, TRaw>(definition: SourceConnectorDefinition<TConfig, TRaw>): this {
    const id = definition.manifest.id;
    if (definition.manifest.kind !== 'source') {
      throw new TypeError(`Connector "${id}" is not a source connector.`);
    }
    if (this.#sources.has(id))
      throw new TypeError(`Source connector "${id}" is already registered.`);
    this.#sources.set(id, definition);
    return this;
  }

  registerDestination<TConfig>(definition: DestinationConnectorDefinition<TConfig>): this {
    const id = definition.manifest.id;
    if (definition.manifest.kind !== 'destination') {
      throw new TypeError(`Connector "${id}" is not a destination connector.`);
    }
    if (this.#destinations.has(id)) {
      throw new TypeError(`Destination connector "${id}" is already registered.`);
    }
    this.#destinations.set(id, definition);
    return this;
  }

  source(id: string): SourceConnectorDefinition {
    const found = this.#sources.get(id);
    if (!found) {
      throw new ConfigError(
        `Unknown source "${id}". Available sources: ${[...this.#sources.keys()].join(', ') || '(none)'}.`,
      );
    }
    return found;
  }

  destination(id: string): DestinationConnectorDefinition {
    const found = this.#destinations.get(id);
    if (!found) {
      throw new ConfigError(
        `Unknown destination "${id}". Available destinations: ${[...this.#destinations.keys()].join(', ') || '(none)'}.`,
      );
    }
    return found;
  }

  sources(): SourceConnectorDefinition[] {
    return [...this.#sources.values()];
  }

  destinations(): DestinationConnectorDefinition[] {
    return [...this.#destinations.values()];
  }
}
