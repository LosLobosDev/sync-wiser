import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
  type IHttpConnectionOptions,
} from '@microsoft/signalr';
import type { RealtimeAdapter } from '../types';

type SignalRDocumentState = {
  listeners: Set<(update: Uint8Array) => void>;
  key: string;
  joined: boolean;
  joinPromise: Promise<HubConnection> | null;
};

export type SignalRRealtimeAdapterOptions = {
  /**
   * Base URL to the SignalR hub.
   */
  url: string;
  /**
   * Override the method invoked when publishing updates. Defaults to `SendDocumentUpdate`.
   */
  publishMethod?: string;
  /**
   * Event name emitted by the hub when a document update arrives. Defaults to `DocumentUpdate`.
   * The hub is expected to emit `(docId: string, payload: unknown)`.
   */
  receiveEvent?: string;
  /**
   * Hub method invoked to subscribe to a document (often used to join a SignalR group).
   * Defaults to `JoinDocument`. Set to `null` to disable explicit joins.
   */
  joinDocumentMethod?: string | null;
  /**
   * Hub method invoked to unsubscribe from a document. Defaults to `LeaveDocument`.
   * Set to `null` to skip explicit leaves.
   */
  leaveDocumentMethod?: string | null;
  /**
   * Map the logical document id to the identifier used when invoking hub methods.
   */
  documentIdentifier?: (docId: string) => string;
  /**
   * Custom serializer for outbound updates. Defaults to base64 strings.
   */
  encodeUpdate?: (update: Uint8Array) => unknown;
  /**
   * Custom deserializer for inbound payloads. Defaults to base64/string/ArrayBuffer coercion.
   */
  decodeUpdate?: (payload: unknown) => Uint8Array;
  /**
   * Merge additional connection options passed to `withUrl`.
   */
  connectionOptions?: IHttpConnectionOptions;
  /**
   * Access token factory helper for authenticated hubs.
   */
  accessTokenFactory?: () => string | Promise<string>;
  /**
   * Attach arbitrary headers to hub requests.
   */
  headers?: Record<string, string>;
  /**
   * Control credential forwarding on fetch requests.
   */
  withCredentials?: boolean;
  /**
   * Configure automatic reconnect settings. Pass `true` for defaults or the retry delays to apply.
   */
  automaticReconnect?: boolean | number[];
  /**
   * Configure SignalR logging.
   */
  logLevel?: LogLevel;
  /**
   * Customize the HubConnectionBuilder before build.
   */
  configureBuilder?: (
    builder: HubConnectionBuilder
  ) => HubConnectionBuilder | void;
  /**
   * Hook for surfacing adapter errors.
   */
  onError?: (error: unknown) => void;
};

const DEFAULT_PUBLISH_METHOD = 'SendDocumentUpdate';
const DEFAULT_RECEIVE_EVENT = 'DocumentUpdate';
const DEFAULT_JOIN_METHOD = 'JoinDocument';
const DEFAULT_LEAVE_METHOD = 'LeaveDocument';

export function createSignalRRealtimeAdapter(
  options: SignalRRealtimeAdapterOptions
): RealtimeAdapter {
  const {
    url,
    publishMethod = DEFAULT_PUBLISH_METHOD,
    receiveEvent = DEFAULT_RECEIVE_EVENT,
    joinDocumentMethod = DEFAULT_JOIN_METHOD,
    leaveDocumentMethod = DEFAULT_LEAVE_METHOD,
    documentIdentifier = (docId: string) => docId,
    encodeUpdate = defaultEncodeUpdate,
    decodeUpdate = defaultDecodeUpdate,
    connectionOptions,
    accessTokenFactory,
    headers,
    withCredentials,
    automaticReconnect,
    logLevel,
    configureBuilder,
    onError,
  } = options;

  let connection: HubConnection | null = null;
  let connectionPromise: Promise<HubConnection> | null = null;
  let inboundRegistered = false;
  const docStates = new Map<string, SignalRDocumentState>();
  const keyToDocId = new Map<string, string>();

  const reportError = (error: unknown) => {
    if (onError) {
      onError(error);
      return;
    }
    console.error('[sync-wiser][signalr]', error);
  };

  const ensureConnection = (): Promise<HubConnection> => {
    if (connection && connection.state === HubConnectionState.Connected) {
      return Promise.resolve(connection);
    }

    if (!connectionPromise) {
      connectionPromise = (async () => {
        if (!connection) {
          connection = buildConnection();
        }
        if (connection.state !== HubConnectionState.Connected) {
          await connection.start();
        }
        registerInboundHandlers(connection);
        return connection;
      })().catch((error) => {
        connectionPromise = null;
        reportError(error);
        throw error;
      });
    }

    return connectionPromise;
  };

  const buildConnection = (): HubConnection => {
    let builder = new HubConnectionBuilder();
    const mergedOptions: IHttpConnectionOptions = {
      ...(connectionOptions ?? {}),
    };
    if (accessTokenFactory) {
      mergedOptions.accessTokenFactory = accessTokenFactory;
    }
    if (headers || connectionOptions?.headers) {
      mergedOptions.headers = {
        ...(connectionOptions?.headers ?? {}),
        ...(headers ?? {}),
      };
    }
    if (withCredentials !== undefined) {
      mergedOptions.withCredentials = withCredentials;
    }

    builder = builder.withUrl(url, mergedOptions);

    if (automaticReconnect) {
      if (automaticReconnect === true) {
        builder = builder.withAutomaticReconnect();
      } else {
        builder = builder.withAutomaticReconnect(automaticReconnect);
      }
    }

    if (logLevel !== undefined) {
      builder = builder.configureLogging(logLevel);
    }

    if (configureBuilder) {
      const configured = configureBuilder(builder);
      if (configured) {
        builder = configured;
      }
    }

    const built = builder.build();

    if (typeof built.onreconnected === 'function' && joinDocumentMethod) {
      built.onreconnected(() => {
        for (const state of docStates.values()) {
          state.joined = false;
          state.joinPromise = ensureConnection()
            .then((activeConnection) =>
              activeConnection.invoke(joinDocumentMethod, state.key).then(() => activeConnection)
            )
            .then((activeConnection) => {
              state.joined = true;
              return activeConnection;
            })
            .catch((error) => {
              reportError(error);
              state.joinPromise = null;
              return built;
            });
        }
      });
    }

    if (typeof built.onclose === 'function') {
      built.onclose(() => {
        connection = null;
        connectionPromise = null;
        inboundRegistered = false;
      });
    }

    return built;
  };

  const registerInboundHandlers = (activeConnection: HubConnection) => {
    if (inboundRegistered) return;

    activeConnection.on(receiveEvent, (docKey: unknown, payload: unknown) => {
      try {
        const key = String(docKey);
        const docId = keyToDocId.get(key);
        if (!docId) {
          return;
        }
        const state = docStates.get(docId);
        if (!state || state.listeners.size === 0) {
          return;
        }
        const bytes = decodeUpdate(payload);
        for (const listener of state.listeners) {
          listener(bytes.slice());
        }
      } catch (error) {
        reportError(error);
      }
    });

    inboundRegistered = true;
  };

  const subscribe = (
    docId: string,
    onUpdate: (update: Uint8Array) => void
  ): (() => void) => {
    let state = docStates.get(docId);
    if (!state) {
      const key = documentIdentifier(docId);
      state = {
        listeners: new Set(),
        key,
        joined: false,
        joinPromise: null,
      };
      docStates.set(docId, state);
      keyToDocId.set(key, docId);
    }

    state.listeners.add(onUpdate);

    if (!state.joinPromise) {
      state.joinPromise = ensureConnection()
        .then((activeConnection) => {
          if (!state) {
            return activeConnection;
          }

          registerInboundHandlers(activeConnection);

          if (joinDocumentMethod && !state.joined) {
            return activeConnection
              .invoke(joinDocumentMethod, state.key)
              .then(() => {
                state.joined = true;
                return activeConnection;
              });
          }

          state.joined = true;
          return activeConnection;
        })
        .catch((error) => {
          state!.joinPromise = null;
          reportError(error);
          throw error;
        });
    }

    return () => {
      const currentState = docStates.get(docId);
      if (!currentState) {
        return;
      }

      currentState.listeners.delete(onUpdate);

      if (currentState.listeners.size > 0) {
        return;
      }

      docStates.delete(docId);
      keyToDocId.delete(currentState.key);

      const leave = async () => {
        try {
          await (currentState.joinPromise ?? ensureConnection());
          const activeConnection = connection;
          if (!activeConnection) return;
          if (leaveDocumentMethod && currentState.joined) {
            await activeConnection.invoke(leaveDocumentMethod, currentState.key);
          }
        } catch (error) {
          reportError(error);
        } finally {
          currentState.joinPromise = null;
          currentState.joined = false;
        }
      };

      void leave();
    };
  };

  const publish = async (docId: string, update: Uint8Array): Promise<void> => {
    const key =
      docStates.get(docId)?.key ?? documentIdentifier(docId);

    const payload = encodeUpdate(update);
    try {
      const activeConnection = await ensureConnection();
      await activeConnection.invoke(publishMethod, key, payload);
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  return {
    subscribe,
    publish,
  };
}

function defaultEncodeUpdate(update: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(update).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < update.length; i += 1) {
    binary += String.fromCharCode(update[i]!);
  }
  return btoa(binary);
}

function defaultDecodeUpdate(payload: unknown): Uint8Array {
  if (payload instanceof Uint8Array) {
    return payload.slice();
  }
  if (payload instanceof ArrayBuffer) {
    return new Uint8Array(payload.slice(0));
  }
  if (Array.isArray(payload)) {
    return Uint8Array.from(payload);
  }
  if (typeof payload === 'string') {
    if (typeof Buffer !== 'undefined') {
      return new Uint8Array(Buffer.from(payload, 'base64'));
    }
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  throw new TypeError(
    '[sync-wiser][signalr] Unsupported payload format; provide a custom decodeUpdate()'
  );
}
