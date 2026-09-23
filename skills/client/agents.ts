import type { PluginClientContext } from "@getpaseo/plugin/client";

/**
 * Following the host's agents across Paseo 0.8 and 0.9 clients.
 *
 * Since 0.9, `agents.subscribe()` only adds a local listener to observations
 * that the same API instance opened with `agents.list({ subscribe: {} })`; on
 * its own it never hears anything. The observation delivers a snapshot first
 * and again after every reconnect, then the updates in between.
 *
 * A 0.8 client has no observations, and must not send `subscribe` either: the
 * daemon keeps one agents subscription slot per legacy connection, last query
 * wins, so a plugin asking for one would replace the app's own. The choice is
 * therefore made before any request, from the API's shape.
 */

type Paseo = PluginClientContext["paseo"];
type AgentListOptions = NonNullable<Parameters<Paseo["agents"]["list"]>[0]>;
export type AgentList = Awaited<ReturnType<Paseo["agents"]["list"]>>;
export type AgentUpdate = Parameters<Parameters<Paseo["agents"]["subscribe"]>[0]>[0];

/** The 0.9 observation handle; the 0.8 typings this plugin builds against predate it. */
type AgentObservation = {
  subscribe(observer: {
    snapshot(snapshot: AgentList): void;
    update(message: { type: string; payload?: unknown }): void;
    error?(error: unknown): void;
  }): () => void;
  release(): Promise<void>;
};
type ObservingAgents = {
  list(
    options: AgentListOptions & { subscribe: {}; signal: AbortSignal },
  ): Promise<AgentList & { subscription?: AgentObservation }>;
};

const RETRY_MIN_MS = 2_000;
const RETRY_MAX_MS = 60_000;

/** `observeEvents` shipped together with observations (0.9.0-beta.1). */
export function canObserveAgents(paseo: Paseo): boolean {
  return typeof (paseo as { observeEvents?: unknown }).observeEvents === "function";
}

/**
 * On a 0.9 client, keeps an agent observation open for the caller's lifetime:
 * `snapshot` replaces the caller's view, `update` applies one change. Paseo
 * releases an observation that fails (a re-request after reconnect, say), so it
 * is reopened with backoff rather than left silent. On a 0.8 client it runs
 * `legacy` instead, the pre-0.9 listener and read. Returns the cleanup.
 */
export function followAgents(
  paseo: Paseo,
  handlers: { snapshot(list: AgentList): void; update(update: AgentUpdate): void },
  legacy: () => () => void,
): () => void {
  if (!canObserveAgents(paseo)) return legacy();

  const lifetime = new AbortController();
  let observation: AgentObservation | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = RETRY_MIN_MS;

  function reopen(error: unknown): void {
    observation = null;
    if (lifetime.signal.aborted || retry !== null) return;
    console.warn("skills: agent observation failed; reopening", error);
    retry = setTimeout(() => {
      retry = null;
      open();
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
  }

  function open(): void {
    (paseo.agents as unknown as ObservingAgents)
      .list({ subscribe: {}, signal: lifetime.signal })
      .then(({ subscription }) => {
        if (lifetime.signal.aborted) return;
        if (subscription === undefined) throw new Error("the host returned no agent observation");
        observation = subscription;
        subscription.subscribe({
          snapshot(list) {
            retryDelay = RETRY_MIN_MS;
            handlers.snapshot(list);
          },
          update(message) {
            if (message.type === "agent_update") handlers.update(message.payload as AgentUpdate);
          },
          error: reopen,
        });
      })
      .catch(reopen);
  }

  open();
  return () => {
    lifetime.abort();
    if (retry !== null) clearTimeout(retry);
    retry = null;
    void observation?.release().catch(() => undefined);
    observation = null;
  };
}
