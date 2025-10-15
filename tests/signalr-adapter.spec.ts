import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createSignalRRealtimeAdapter } from '../src/realtime/signalrAdapter';

vi.mock('@microsoft/signalr', async () => {
  class MockHubConnection {
    public state = 'Disconnected';
    public handlers = new Map<string, Array<(...args: any[]) => void>>();
    public invocations: Array<{ method: string; args: unknown[] }> = [];
    public onreconnectedHandlers: Array<() => void> = [];
    public oncloseHandlers: Array<() => void> = [];

    async start() {
      this.state = 'Connected';
    }

    async stop() {
      this.state = 'Disconnected';
    }

    on(event: string, handler: (...args: any[]) => void) {
      const list = this.handlers.get(event);
      if (list) {
        list.push(handler);
      } else {
        this.handlers.set(event, [handler]);
      }
    }

    off(event: string, handler: (...args: any[]) => void) {
      const list = this.handlers.get(event);
      if (!list) return;
      this.handlers.set(
        event,
        list.filter((fn) => fn !== handler)
      );
    }

    async invoke(method: string, ...args: unknown[]) {
      this.invocations.push({ method, args });
    }

    onreconnected(handler: () => void) {
      this.onreconnectedHandlers.push(handler);
    }

    onclose(handler: () => void) {
      this.oncloseHandlers.push(handler);
    }

    emit(event: string, ...args: unknown[]) {
      const list = this.handlers.get(event) ?? [];
      for (const handler of list) {
        handler(...args);
      }
    }

    triggerReconnected() {
      for (const handler of this.onreconnectedHandlers) {
        handler();
      }
    }

    triggerClose() {
      for (const handler of this.oncloseHandlers) {
        handler();
      }
    }
  }

  class MockHubConnectionBuilder {
    public url: string | null = null;
    public options: Record<string, unknown> | null = null;
    public reconnect: boolean | number[] | null = null;
    public logLevel: number | null = null;
    public connection: MockHubConnection | null = null;

    static instances: MockHubConnectionBuilder[] = [];

    constructor() {
      MockHubConnectionBuilder.instances.push(this);
    }

    withUrl(url: string, options: Record<string, unknown>) {
      this.url = url;
      this.options = options;
      return this;
    }

    withAutomaticReconnect(retryDelays?: number[]) {
      this.reconnect = retryDelays ?? true;
      return this;
    }

    configureLogging(level: number) {
      this.logLevel = level;
      return this;
    }

    build() {
      this.connection = new MockHubConnection();
      return this.connection;
    }
  }

  const HubConnectionState = {
    Disconnected: 'Disconnected',
    Connected: 'Connected',
  };

  const LogLevel = {
    None: 0,
    Information: 1,
  };

  const internals = {
    getBuilders: () => MockHubConnectionBuilder.instances,
    reset: () => {
      MockHubConnectionBuilder.instances.splice(
        0,
        MockHubConnectionBuilder.instances.length
      );
    },
  };

  return {
    HubConnectionBuilder: MockHubConnectionBuilder,
    HubConnectionState,
    LogLevel,
    __signalRMockInternals: internals,
  };
});

const getInternals = async () => {
  const signalR = await import('@microsoft/signalr');
  return (signalR as any).__signalRMockInternals;
};

describe('createSignalRRealtimeAdapter', () => {
  beforeEach(async () => {
    const internals = await getInternals();
    internals.reset();
  });

  it('subscribes, publishes, and forwards inbound updates', async () => {
    const adapter = createSignalRRealtimeAdapter({ url: 'https://example.com/hub' });
    const handler = vi.fn();
    const unsubscribe = adapter.subscribe('doc-1', handler);

    await new Promise((resolve) => setTimeout(resolve, 0));

    const internals = await getInternals();
    const builders = internals.getBuilders();
    expect(builders).toHaveLength(1);
    const connection = builders[0]!.connection!;
    expect(connection.state).toBe('Connected');
    expect(connection.invocations[0]).toEqual({
      method: 'JoinDocument',
      args: ['doc-1'],
    });

    const update = new Uint8Array([1, 2, 3, 4]);
    const base64 = Buffer.from(update).toString('base64');
    connection.emit('DocumentUpdate', 'doc-1', base64);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(Array.from(handler.mock.calls[0]![0])).toEqual(Array.from(update));

    await adapter.publish('doc-1', update);
    expect(connection.invocations.some((call) => call.method === 'SendDocumentUpdate')).toBe(true);

    unsubscribe();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const leaveCall = connection.invocations.find(
      (call) => call.method === 'LeaveDocument'
    );
    expect(leaveCall?.args).toEqual(['doc-1']);
  });

  it('honors custom endpoint names and auth options', async () => {
    const accessTokenFactory = vi.fn(() => 'example-token');
    const adapter = createSignalRRealtimeAdapter({
      url: 'https://signal.example.com/live',
      publishMethod: 'PublishUpdate',
      receiveEvent: 'ReceiveUpdate',
      joinDocumentMethod: 'JoinDoc',
      leaveDocumentMethod: 'LeaveDoc',
      accessTokenFactory,
      headers: { 'x-tenant-id': 'abc' },
      withCredentials: true,
      automaticReconnect: [0, 100, 200],
      logLevel: 1,
    });

    adapter.subscribe('doc-42', vi.fn());
    await new Promise((resolve) => setTimeout(resolve, 0));

    const internals = await getInternals();
    const builder = internals.getBuilders()[0]!;
    expect(builder.url).toBe('https://signal.example.com/live');
    expect(builder.options?.accessTokenFactory).toBe(accessTokenFactory);
    expect(builder.options?.headers).toEqual({ 'x-tenant-id': 'abc' });
    expect(builder.options?.withCredentials).toBe(true);
    expect(builder.reconnect).toEqual([0, 100, 200]);
    expect(builder.logLevel).toBe(1);

    const connection = builder.connection!;
    expect(
      connection.invocations.some((call) => call.method === 'JoinDoc')
    ).toBe(true);
  });

  it('rejoins after reconnects', async () => {
    const adapter = createSignalRRealtimeAdapter({ url: 'https://example.com/hub' });
    adapter.subscribe('doc-1', vi.fn());
    adapter.subscribe('doc-2', vi.fn());

    await new Promise((resolve) => setTimeout(resolve, 0));
    const internals = await getInternals();
    const connection = internals.getBuilders()[0]!.connection!;

    connection.triggerReconnected();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const joinCalls = connection.invocations.filter(
      (call) => call.method === 'JoinDocument'
    );
    const joinedDocs = joinCalls.map((call) => call.args[0]);

    expect(joinedDocs).toContain('doc-1');
    expect(joinedDocs).toContain('doc-2');
  });
});
