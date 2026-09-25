/**
 * Hearing Paseo's agent stream at all.
 *
 * Since Paseo 0.9, `paseo.agents.subscribe()` only adds a local listener to
 * observations the same API instance opened with `agents.list({ subscribe })`,
 * and every plugin runtime gets an API instance of its own — so a bare
 * `subscribe()` hears nothing, ever. This opens that observation.
 *
 * Herald only takes the stream as a nudge to poll sooner; what is listed comes
 * from its own polls. So the snapshot is ignored and asked for one agent long:
 * the daemon filters an observation's updates by its `filter`, not by the page,
 * so every agent's changes still arrive.
 *
 * Paseo re-requests an observation after a reconnect on its own, but releases
 * one whose request fails, silently; that is caught through `error` and the
 * observation is reopened with backoff rather than left deaf.
 */
import type { PluginClientContext } from "@getpaseo/plugin/client";

type Paseo = PluginClientContext["paseo"];
export type AgentUpdate = Parameters<Parameters<Paseo["agents"]["subscribe"]>[0]>[0];
type AgentObservation = Awaited<ReturnType<typeof openObservation>>["subscription"];

const RETRY_MIN_MS = 2_000;
const RETRY_MAX_MS = 60_000;

function openObservation(paseo: Paseo, signal: AbortSignal) {
  return paseo.agents.list({ subscribe: {}, page: { limit: 1 }, signal });
}

/**
 * Calls `onUpdate` for every agent update the daemon sends, for as long as the
 * returned cleanup has not run. The cleanup releases the observation.
 */
export function watchAgents(paseo: Paseo, onUpdate: (update: AgentUpdate) => void): () => void {
  const lifetime = new AbortController();
  let observation: AgentObservation | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = RETRY_MIN_MS;

  function reopen(error: unknown): void {
    observation = null;
    if (lifetime.signal.aborted || retry !== null) return;
    console.warn("[herald] the agent stream failed; reopening", error);
    retry = setTimeout(() => {
      retry = null;
      open();
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
  }

  function open(): void {
    openObservation(paseo, lifetime.signal)
      .then(({ subscription }) => {
        if (lifetime.signal.aborted) {
          void subscription.release().catch(() => undefined);
          return;
        }
        observation = subscription;
        subscription.subscribe({
          snapshot() {
            retryDelay = RETRY_MIN_MS;
          },
          update(message) {
            if (message.type === "agent_update") onUpdate(message.payload as AgentUpdate);
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
