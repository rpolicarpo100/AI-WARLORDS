import { describe, expect, it } from 'vitest';
import { markUntrusted, type ClientRequest, type PlayerId, type Untrusted } from './authority.js';
import {
  matchProducers,
  matchStartedEvent,
  runProducers,
  type EventInput,
  type EventProducer,
  type GameEvent,
  type ProducerInput,
} from './events.js';
import { Match, STANDARD_RULESET } from './match.js';
import type { RngHandler } from './validation.js';
import { createWorldState, type WorldState } from './world-state.js';

const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;

/** Simulates untrusted wire bytes: unknown input, marked at the boundary. */
function raw(value: unknown): Untrusted<ClientRequest> {
  return markUntrusted(value as ClientRequest);
}

function stdState(): WorldState {
  return createWorldState({ players: [P1, P2] });
}

function stdInput(after: WorldState): ProducerInput {
  return { type: 'test.x', caller: P1, params: {}, before: stdState(), after };
}

function stdMatch(
  handlers: ReadonlyMap<string, RngHandler<WorldState>> = new Map(),
  producers: ReadonlyMap<string, readonly EventProducer[]> = new Map(),
): Match {
  return new Match({
    seed: 999,
    ruleset: STANDARD_RULESET,
    players: [P1, P2],
    initialState: stdState(),
    extraHandlers: handlers,
    extraProducers: producers,
  });
}

function seqs(events: readonly GameEvent[]): number[] {
  return events.map((e) => e.seq);
}

function at(events: readonly GameEvent[], index: number): GameEvent {
  const event = events[index];
  if (event === undefined) {
    throw new Error('test setup: expected event at index');
  }
  return event;
}

describe('matchStartedEvent (unit)', () => {
  it('builds the exact frozen genesis fact', () => {
    const event = matchStartedEvent(999, [P1, P2], { id: 'standard', version: 1 }, 0);
    expect(event).toEqual({
      seq: 1,
      tick: 0,
      revision: 0,
      type: 'match.started',
      priority: 'normal',
      payload: {
        seed: 999,
        players: ['p1', 'p2'],
        ruleset: { id: 'standard', version: 1 },
      },
    });
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.payload)).toBe(true);
  });
});

describe('matchProducers registry (fence lock)', () => {
  it('registers exactly match.advance (noop is deliberately silent)', () => {
    const registry = matchProducers();
    expect([...registry.keys()]).toEqual(['match.advance']);
    expect(registry.get('world.noop')).toBeUndefined();
  });
});

describe('runProducers (unit)', () => {
  it('emits nothing without producers', () => {
    expect(runProducers(stdInput(stdState()), [], 0, 0, 1)).toEqual([]);
  });

  it('stamps seq/tick/revision and freezes the fact', () => {
    const facts: readonly EventInput[] = [
      { type: 'test.fact', priority: 'normal', payload: { n: 1 } },
    ];
    const producer: EventProducer = () => facts;
    const emitted = runProducers(stdInput(stdState()), [producer], 5, 3, 10);
    expect(emitted).toHaveLength(1);
    expect(at(emitted, 0)).toEqual({
      seq: 10,
      tick: 5,
      revision: 3,
      type: 'test.fact',
      priority: 'normal',
      payload: { n: 1 },
    });
    expect(Object.isFrozen(at(emitted, 0).payload)).toBe(true);
  });

  it('accepts all four priorities in order', () => {
    const facts: readonly EventInput[] = (['low', 'normal', 'high', 'critical'] as const).map(
      (priority) => ({ type: `test.${priority}`, priority, payload: {} }),
    );
    const producer: EventProducer = () => facts;
    const emitted = runProducers(stdInput(stdState()), [producer], 0, 0, 1);
    expect(emitted.map((e) => e.priority)).toEqual(['low', 'normal', 'high', 'critical']);
    expect(seqs(emitted)).toEqual([1, 2, 3, 4]);
  });

  it('emits nothing when the producer returns no facts', () => {
    const none: EventProducer = () => [];
    expect(runProducers(stdInput(stdState()), [none], 0, 0, 1)).toEqual([]);
  });

  it.each([[42], [''], ['x'.repeat(65)]] as Array<[unknown]>)(
    'surrogates bad fact type %j',
    (type) => {
      const bad: EventProducer = () => [{ type: type as string, priority: 'low', payload: {} }];
      const emitted = runProducers(stdInput(stdState()), [bad], 0, 0, 1);
      expect(emitted).toHaveLength(1);
      expect(at(emitted, 0)).toEqual({
        seq: 1,
        tick: 0,
        revision: 0,
        type: 'system.event-fault',
        priority: 'high',
        payload: {
          transition: 'test.x',
          producer: 0,
          message: 'invalid event fact for test.x (producer 0): bad type',
        },
      });
    },
  );

  it('surrogates bad fact priority', () => {
    const bad: EventProducer = () => [
      { type: 'test.x', priority: 'urgent' as unknown as EventInput['priority'], payload: {} },
    ];
    const emitted = runProducers(stdInput(stdState()), [bad], 0, 0, 1);
    expect(emitted).toHaveLength(1);
    expect(at(emitted, 0).payload).toEqual({
      transition: 'test.x',
      producer: 0,
      message: 'invalid event fact for test.x (producer 0): bad priority',
    });
  });

  it('surrogates exotic payloads (freeze rejects, emission survives)', () => {
    const bad: EventProducer = () => [
      { type: 'test.x', priority: 'low', payload: { fn: () => 0 } },
    ];
    const emitted = runProducers(stdInput(stdState()), [bad], 0, 0, 1);
    expect(emitted).toHaveLength(1);
    const payload = at(emitted, 0).payload as Record<string, unknown>;
    expect(at(emitted, 0).type).toBe('system.event-fault');
    expect(payload['transition']).toBe('test.x');
    expect(payload['producer']).toBe(0);
    expect(payload['message']).toMatch(/plain JSON/);
  });

  it('surrogates throwing producers and continues with the rest', () => {
    const boom: EventProducer = () => {
      throw new Error('producer boom');
    };
    const good: EventProducer = () => [{ type: 'test.ok', priority: 'low', payload: {} }];
    const emitted = runProducers(stdInput(stdState()), [boom, good], 2, 1, 5);
    expect(emitted.map((e) => e.type)).toEqual(['system.event-fault', 'test.ok']);
    expect(seqs(emitted)).toEqual([5, 6]);
    expect(at(emitted, 0).payload).toEqual({
      transition: 'test.x',
      producer: 0,
      message: 'producer boom',
    });
  });

  it('normalizes non-Error throws deterministically', () => {
    const notAnError = 42;
    const bad: EventProducer = () => {
      throw notAnError;
    };
    const emitted = runProducers(stdInput(stdState()), [bad], 0, 0, 1);
    expect(at(emitted, 0).payload).toEqual({
      transition: 'test.x',
      producer: 0,
      message: 'non-error thrown',
    });
  });

  it('surrogates null facts', () => {
    const bad: EventProducer = () => [null as unknown as EventInput];
    const emitted = runProducers(stdInput(stdState()), [bad], 0, 0, 1);
    expect(emitted).toHaveLength(1);
    expect(at(emitted, 0).type).toBe('system.event-fault');
    const payload = at(emitted, 0).payload as Record<string, unknown>;
    expect(payload['transition']).toBe('test.x');
    expect(payload['producer']).toBe(0);
    expect(payload['message']).toEqual(expect.any(String));
  });

  it('surrogates non-array producer returns', () => {
    const bad: EventProducer = () => 42 as unknown as readonly EventInput[];
    const emitted = runProducers(stdInput(stdState()), [bad], 0, 0, 1);
    expect(emitted).toHaveLength(1);
    expect(at(emitted, 0).type).toBe('system.event-fault');
  });
});

describe('genesis (Match E2E)', () => {
  it('emits match.started first on construction', () => {
    const events = stdMatch().getEvents();
    expect(events).toHaveLength(1);
    expect(at(events, 0)).toEqual({
      seq: 1,
      tick: 0,
      revision: 0,
      type: 'match.started',
      priority: 'normal',
      payload: {
        seed: 999,
        players: ['p1', 'p2'],
        ruleset: { id: 'standard', version: 1 },
      },
    });
  });

  it('shares frozen provenance (no copies)', () => {
    const match = stdMatch();
    const payload = at(match.getEvents(), 0).payload as Record<string, unknown>;
    expect(payload['players']).toBe(match.players);
    expect(payload['ruleset']).toBe(match.ruleset);
  });
});

describe('dispatch emission (Match E2E)', () => {
  it('emits match.advanced with the new tick', () => {
    const match = stdMatch();
    const session = match.join(P1);
    match.dispatch(
      session,
      raw({ requestId: 'r1', playerId: 'p1', type: 'match.advance', payload: {} }),
    );
    const events = match.getEvents();
    expect(events).toHaveLength(2);
    expect(at(events, 1)).toEqual({
      seq: 2,
      tick: 1,
      revision: 1,
      type: 'match.advanced',
      priority: 'low',
      payload: { tick: 1 },
    });
  });

  it('emits nothing for noop (restraint proof)', () => {
    const match = stdMatch();
    const session = match.join(P1);
    expect(
      match.dispatch(
        session,
        raw({ requestId: 'r1', playerId: 'p1', type: 'world.noop', payload: {} }),
      ),
    ).toEqual({ status: 'applied', revision: 1, summary: 'world-noop' });
    expect(match.getEvents()).toHaveLength(1);
  });

  it('emits nothing for rejections', () => {
    const match = stdMatch();
    const session = match.join(P1);
    match.dispatch(
      session,
      raw({ requestId: 'r1', playerId: 'p1', type: 'match.advance', payload: { x: 1 } }),
    );
    expect(match.getEvents()).toHaveLength(1);
  });

  it('emits nothing for faults', () => {
    const entries: Array<[string, RngHandler<WorldState>]> = [
      ['test.corrupt', () => ({ applied: true, state: {} as unknown as WorldState, summary: 'x' })],
    ];
    const match = stdMatch(new Map(entries));
    const session = match.join(P1);
    expect(
      match.dispatch(
        session,
        raw({ requestId: 'r1', playerId: 'p1', type: 'test.corrupt', payload: {} }),
      ),
    ).toEqual({ status: 'error', code: 'HANDLER_FAULT' });
    expect(match.getEvents()).toHaveLength(1);
  });

  it('emits nothing for duplicates', () => {
    const match = stdMatch();
    const session = match.join(P1);
    const request = { requestId: 'r1', playerId: 'p1', type: 'match.advance', payload: {} };
    match.dispatch(session, raw(request));
    match.dispatch(session, raw(request));
    expect(match.getEvents()).toHaveLength(2);
  });

  it('runs custom producers with caller + params', () => {
    const handlerEntries: Array<[string, RngHandler<WorldState>]> = [
      ['test.ping', (ctx) => ({ applied: true, state: ctx.state, summary: 'pong' })],
    ];
    const producerEntries: Array<[string, readonly EventProducer[]]> = [
      [
        'test.ping',
        [
          (input) => [
            {
              type: 'test.ponged',
              priority: 'normal',
              payload: { by: input.caller, x: (input.params as { readonly x: number }).x },
            },
          ],
        ],
      ],
    ];
    const match = stdMatch(new Map(handlerEntries), new Map(producerEntries));
    const session = match.join(P2);
    match.dispatch(
      session,
      raw({ requestId: 'r1', playerId: 'p2', type: 'test.ping', payload: { x: 7 } }),
    );
    const events = match.getEvents();
    expect(events).toHaveLength(2);
    expect(at(events, 1)).toEqual({
      seq: 2,
      tick: 0,
      revision: 1,
      type: 'test.ponged',
      priority: 'normal',
      payload: { by: 'p2', x: 7 },
    });
  });

  it('appends extras after built-ins (observation composes)', () => {
    const producerEntries: Array<[string, readonly EventProducer[]]> = [
      ['match.advance', [() => [{ type: 'test.appended', priority: 'low', payload: {} }]]],
    ];
    const match = stdMatch(new Map(), new Map(producerEntries));
    const session = match.join(P1);
    match.dispatch(
      session,
      raw({ requestId: 'r1', playerId: 'p1', type: 'match.advance', payload: {} }),
    );
    const events = match.getEvents();
    expect(events.map((e) => e.type)).toEqual(['match.started', 'match.advanced', 'test.appended']);
  });

  it('keeps the dispatch applied when a producer throws (surrogate E2E)', () => {
    const handlerEntries: Array<[string, RngHandler<WorldState>]> = [
      ['test.ping', (ctx) => ({ applied: true, state: ctx.state, summary: 'pong' })],
    ];
    const producerEntries: Array<[string, readonly EventProducer[]]> = [
      [
        'test.ping',
        [
          () => {
            throw new Error('e2e boom');
          },
        ],
      ],
    ];
    const match = stdMatch(new Map(handlerEntries), new Map(producerEntries));
    const session = match.join(P1);
    expect(
      match.dispatch(
        session,
        raw({ requestId: 'r1', playerId: 'p1', type: 'test.ping', payload: {} }),
      ),
    ).toEqual({ status: 'applied', revision: 1, summary: 'pong' });
    const events = match.getEvents();
    expect(events).toHaveLength(2);
    expect(at(events, 1)).toEqual({
      seq: 2,
      tick: 0,
      revision: 1,
      type: 'system.event-fault',
      priority: 'high',
      payload: { transition: 'test.ping', producer: 0, message: 'e2e boom' },
    });
  });

  it('reproduces identical events across runs (determinism)', () => {
    const run = (): Match => {
      const handlerEntries: Array<[string, RngHandler<WorldState>]> = [
        ['test.ping', (ctx) => ({ applied: true, state: ctx.state, summary: 'pong' })],
      ];
      const producerEntries: Array<[string, readonly EventProducer[]]> = [
        [
          'test.ping',
          [(input) => [{ type: 'test.ponged', priority: 'normal', payload: { by: input.caller } }]],
        ],
      ];
      const match = stdMatch(new Map(handlerEntries), new Map(producerEntries));
      const session = match.join(P1);
      match.dispatch(
        session,
        raw({ requestId: 'r1', playerId: 'p1', type: 'match.advance', payload: {} }),
      );
      match.dispatch(
        session,
        raw({ requestId: 'r2', playerId: 'p1', type: 'test.ping', payload: { x: 1 } }),
      );
      return match;
    };
    const first = run();
    const second = run();
    expect(second.getEvents()).toEqual(first.getEvents());
    expect(second.getStateHash()).toBe(first.getStateHash());
  });
});

describe('event integrity (security)', () => {
  it('freezes entries and payloads', () => {
    const match = stdMatch();
    const session = match.join(P1);
    match.dispatch(
      session,
      raw({ requestId: 'r1', playerId: 'p1', type: 'match.advance', payload: {} }),
    );
    const event = at(match.getEvents(), 1);
    expect(() => {
      (event as { type: string }).type = 'x';
    }).toThrow(TypeError);
    expect(() => {
      (event.payload as { tick: number }).tick = 99;
    }).toThrow(TypeError);
  });

  it('returns events by copy', () => {
    const match = stdMatch();
    const copy = match.getEvents();
    (copy as unknown as unknown[]).push(at(copy, 0));
    expect(match.getEvents()).toHaveLength(1);
  });

  it('keeps session ids out of events', () => {
    const match = stdMatch();
    const session = match.join(P1);
    match.dispatch(
      session,
      raw({ requestId: 'r1', playerId: 'p1', type: 'match.advance', payload: {} }),
    );
    expect(JSON.stringify(match.getEvents())).not.toContain(session.sessionId);
  });
});
