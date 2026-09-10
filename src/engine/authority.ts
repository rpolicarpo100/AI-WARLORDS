import { randomUUID } from 'node:crypto';

// ─── Trust boundary ──────────────────────────────────────────────────────

declare const untrustedBrand: unique symbol;

/**
 * Marks data that arrived from a client (or any untrusted source).
 * Compile-time aid only: at runtime it is the underlying value, and
 * `dispatch` validates it structurally. Anything typed `Untrusted` must
 * never reach canonical state without server-side validation.
 */
export type Untrusted<T> = T & { readonly [untrustedBrand]: 'untrusted' };

export function markUntrusted<T>(value: T): Untrusted<T> {
  return value as Untrusted<T>;
}

// ─── Branded ids ─────────────────────────────────────────────────────────

declare const playerBrand: unique symbol;
declare const requestBrand: unique symbol;
declare const sessionBrand: unique symbol;

export type PlayerId = string & { readonly [playerBrand]: 'player' };
export type RequestId = string & { readonly [requestBrand]: 'request' };
export type SessionId = string & { readonly [sessionBrand]: 'session' };

export const MAX_ID_LENGTH = 64;
export const MAX_TYPE_LENGTH = 64;
export const MAX_PAYLOAD_BYTES = 65536;

export function isPlayerId(value: unknown): value is PlayerId {
  return typeof value === 'string' && value.length >= 1 && value.length <= MAX_ID_LENGTH;
}

export function isRequestId(value: unknown): value is RequestId {
  return typeof value === 'string' && value.length >= 1 && value.length <= MAX_ID_LENGTH;
}

// ─── Client request envelope ─────────────────────────────────────────────

export interface ClientRequest {
  readonly requestId: RequestId;
  readonly playerId: PlayerId;
  readonly type: string;
  readonly payload: unknown;
}

export type EnvelopeError = 'MALFORMED_REQUEST' | 'PAYLOAD_TOO_LARGE';

export type EnvelopeValidation =
  | { readonly ok: true; readonly envelope: ClientRequest }
  | { readonly ok: false; readonly error: EnvelopeError };

/**
 * Structural validation of the request envelope (shape + sanity caps).
 * This is TRANSPORT-shape validation, not game-rule validation: game rules
 * live in transition handlers (to be centralized later by M006).
 */
export function validateEnvelope(raw: unknown): EnvelopeValidation {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'MALFORMED_REQUEST' };
  }
  const fields = raw as Record<string, unknown>;
  const requestId = fields['requestId'];
  if (!isRequestId(requestId)) {
    return { ok: false, error: 'MALFORMED_REQUEST' };
  }
  const playerId = fields['playerId'];
  if (!isPlayerId(playerId)) {
    return { ok: false, error: 'MALFORMED_REQUEST' };
  }
  const type = fields['type'];
  if (typeof type !== 'string' || type.length === 0 || type.length > MAX_TYPE_LENGTH) {
    return { ok: false, error: 'MALFORMED_REQUEST' };
  }
  const payload = fields['payload'];
  if (payload === undefined) {
    return { ok: false, error: 'MALFORMED_REQUEST' };
  }
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(payload);
  } catch {
    return { ok: false, error: 'MALFORMED_REQUEST' };
  }
  if (encoded === undefined) {
    return { ok: false, error: 'MALFORMED_REQUEST' };
  }
  if (encoded.length > MAX_PAYLOAD_BYTES) {
    return { ok: false, error: 'PAYLOAD_TOO_LARGE' };
  }
  return { ok: true, envelope: { requestId, playerId, type, payload } };
}

// ─── Transitions ─────────────────────────────────────────────────────────

export interface TransitionContext<S> {
  /** Frozen canonical state. Handlers must treat it as immutable and return new state. */
  readonly state: S;
  /** Server-established caller identity (never taken from client data at this point). */
  readonly caller: PlayerId;
  /** Raw client payload. Handlers validate it against server rules. */
  readonly params: unknown;
}

export type TransitionResult<S> =
  | { readonly applied: true; readonly state: S; readonly summary: string }
  | { readonly applied: false; readonly reason: string };

export type TransitionHandler<S> = (ctx: TransitionContext<S>) => TransitionResult<S>;

// ─── Outcomes + audit ────────────────────────────────────────────────────

export type DispatchErrorCode =
  | 'INVALID_SESSION'
  | 'SPOOFED_SENDER'
  | 'MALFORMED_REQUEST'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNKNOWN_TRANSITION'
  | 'HANDLER_FAULT';

export type RecordedOutcome =
  | { readonly status: 'applied'; readonly revision: number; readonly summary: string }
  | { readonly status: 'rejected'; readonly reason: string };

export type DispatchOutcome =
  | RecordedOutcome
  | { readonly status: 'duplicate'; readonly original: RecordedOutcome }
  | { readonly status: 'error'; readonly code: DispatchErrorCode };

export interface AppliedEntry {
  readonly revision: number;
  readonly requestId: RequestId;
  readonly playerId: PlayerId;
  readonly type: string;
  readonly applied: boolean;
  readonly detail: string;
}

export interface SessionHandle {
  readonly sessionId: SessionId;
  readonly playerId: PlayerId;
}

// ─── Deep freeze (plain data only) ───────────────────────────────────────

/**
 * Deeply freezes plain JSON-style data (objects, arrays, primitives).
 * Rejects class instances, Maps, Sets and other unfreezable values loudly:
 * canonical state must be structurally freezable, never silently half-frozen.
 */
export function freezeState<T>(value: T): T {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null && !Array.isArray(value)) {
    throw new Error(
      'AuthorityKernel state must be plain JSON-style data (objects, arrays, primitives).',
    );
  }
  if (Object.isFrozen(value)) {
    return value;
  }
  for (const key of Reflect.ownKeys(value)) {
    freezeState((value as Record<PropertyKey, unknown>)[key]);
  }
  Object.freeze(value);
  return value;
}

// ─── Kernel ──────────────────────────────────────────────────────────────

export interface AuthorityKernelInit<S> {
  readonly players: readonly PlayerId[];
  readonly initialState: S;
  readonly handlers: ReadonlyMap<string, TransitionHandler<S>>;
}

/**
 * Sole writer of canonical state. Clients (untrusted) submit request
 * envelopes; the kernel validates, authenticates the sender against its own
 * session table, executes the server-side handler, and — only on success —
 * commits a new frozen state + audit entry. Idempotency: the same requestId
 * always yields the same recorded outcome, never a double application.
 * Dispatch is synchronous and in-process (transport arrives in M069+).
 */
export class AuthorityKernel<S> {
  private canonical: S;
  private readonly handlers: Map<string, TransitionHandler<S>>;
  private readonly players: ReadonlySet<PlayerId>;
  private readonly sessions = new Map<SessionId, PlayerId>();
  private readonly seen = new Map<RequestId, RecordedOutcome>();
  private readonly log: AppliedEntry[] = [];
  private revision = 0;

  constructor(init: AuthorityKernelInit<S>) {
    if (init.players.length === 0) {
      throw new Error('AuthorityKernel needs at least one player.');
    }
    const players = new Set(init.players);
    if (players.size !== init.players.length) {
      throw new Error('AuthorityKernel players must be unique.');
    }
    this.players = players;
    this.handlers = new Map(init.handlers);
    // Detach from caller-owned input (clone), then freeze: from here on the
    // canonical state is immutable and unreachable except via snapshots.
    this.canonical = freezeState(structuredClone(init.initialState));
  }

  /** Binds a server-authenticated player to an opaque session (transport calls this after auth). */
  join(playerId: PlayerId): SessionHandle {
    if (!this.players.has(playerId)) {
      throw new Error('AuthorityKernel.join: unknown player.');
    }
    const sessionId = randomUUID() as SessionId;
    this.sessions.set(sessionId, playerId);
    return { sessionId, playerId };
  }

  getSnapshot(): S {
    // Zero-copy is safe: canonical state is always deep-frozen.
    // Snapshots are FULL-state views — per-player filtering is M004/M015's job
    // (no secret information exists yet, so full visibility is CORRECT here).
    return this.canonical;
  }

  getLog(): readonly AppliedEntry[] {
    return [...this.log];
  }

  getRevision(): number {
    return this.revision;
  }

  private record(
    requestId: RequestId,
    playerId: PlayerId,
    type: string,
    applied: boolean,
    detail: string,
  ): AppliedEntry {
    return freezeState({
      revision: this.revision,
      requestId,
      playerId,
      type,
      applied,
      detail,
    });
  }

  dispatch(session: SessionHandle, raw: Untrusted<ClientRequest>): DispatchOutcome {
    const bound = this.sessions.get(session.sessionId);
    if (bound === undefined || bound !== session.playerId) {
      return { status: 'error', code: 'INVALID_SESSION' };
    }
    const validation = validateEnvelope(raw);
    if (!validation.ok) {
      return { status: 'error', code: validation.error };
    }
    const { requestId, playerId, type, payload } = validation.envelope;
    if (playerId !== bound) {
      return { status: 'error', code: 'SPOOFED_SENDER' };
    }
    const prior = this.seen.get(requestId);
    if (prior !== undefined) {
      return { status: 'duplicate', original: prior };
    }
    const handler = this.handlers.get(type);
    if (handler === undefined) {
      return { status: 'error', code: 'UNKNOWN_TRANSITION' };
    }
    try {
      const result = handler({ state: this.canonical, caller: bound, params: payload });
      if (result.applied !== true) {
        const outcome: RecordedOutcome = { status: 'rejected', reason: result.reason };
        this.seen.set(requestId, outcome);
        this.log.push(this.record(requestId, playerId, type, false, result.reason));
        return outcome;
      }
      // Freeze BEFORE committing: if the new state is unfreezable the throw
      // below leaves revision/canonical/seen/log untouched (atomicity).
      const frozen = freezeState(result.state);
      this.revision += 1;
      this.canonical = frozen;
      const outcome: RecordedOutcome = {
        status: 'applied',
        revision: this.revision,
        summary: result.summary,
      };
      this.seen.set(requestId, outcome);
      this.log.push(this.record(requestId, playerId, type, true, result.summary));
      return outcome;
    } catch {
      return { status: 'error', code: 'HANDLER_FAULT' };
    }
  }
}
