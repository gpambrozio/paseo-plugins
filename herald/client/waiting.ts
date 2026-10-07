/**
 * The waiting list, loaded once for everything that draws it: the screen, the
 * sidebar row's badge and the row's popover. One query key, so with the
 * screen open beside the sidebar they poll once between them.
 *
 * Async **function expressions**, never async arrows, and no closure in a
 * `for…of` body: the app `eval`s the client bundle, and Hermes's eval compiler
 * on iOS and Android gets both wrong.
 */
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { listAttention } from "../shared/herald";
import { watchAgents } from "./agents";
import { joinRows, type FlaggedAgent, type Row } from "./rows";

export interface Waiting {
  rows: Row[];
  /** Workspace id to its current title, for naming rows. */
  workspaceNames: Record<string, string>;
}

const WAITING_QUERY_KEY = ["herald", "waiting"] as const;

const IDLE_REFRESH_MS = 10_000;
const BUSY_REFRESH_MS = 2_500;
const NUDGE_DEBOUNCE_MS = 400;

/**
 * The last list loaded, so a remount — the screen is unmounted whenever the
 * user opens an agent from it — repaints before the first load answers.
 *
 * Workspace names come from the host API, not `useWorkspace`: the SDK's state
 * hooks are for workspace and agent panels and throw in a screen or a sidebar
 * item ("Plugin state hooks must run inside a workspace panel").
 */
let cachedWaiting: Waiting | null = null;

function hasPending(waiting: Waiting | undefined): boolean {
  return waiting?.rows.some((row) => row.entry?.summary.status === "pending") ?? false;
}

/**
 * Paseo's attention flag decides who is listed — it is what the sidebar
 * badges already follow — and Herald's entries explain why, in a sentence.
 * Polled, and quickened while a summary is being written.
 */
export function useWaiting() {
  const paseo = usePaseo();
  const list = useRpc(listAttention);
  return useQuery({
    queryKey: WAITING_QUERY_KEY,
    queryFn: async function loadWaiting(): Promise<Waiting> {
      const [attention, flagged, workspaces] = await Promise.all([
        list({}),
        paseo.agents.list({ filter: { requiresAttention: true }, page: { limit: 100 } }),
        paseo.workspaces.list({ page: { limit: 200 } }),
      ]);
      const workspaceNames: Record<string, string> = {};
      workspaces.entries.forEach((workspace) => {
        workspaceNames[workspace.id] = workspace.title ?? workspace.name;
      });
      const agents: FlaggedAgent[] = flagged.entries.map((item) => ({
        id: item.agent.id,
        title: item.agent.title ?? null,
        workspaceId: item.agent.workspaceId ?? null,
        cwd: item.agent.cwd,
        status: item.agent.status,
        attentionReason: item.agent.attentionReason ?? null,
        at: item.agent.attentionTimestamp ?? item.agent.updatedAt,
      }));
      const waiting = { rows: joinRows(attention.entries, agents), workspaceNames };
      cachedWaiting = waiting;
      return waiting;
    },
    refetchInterval: (query) => (hasPending(query.state.data) ? BUSY_REFRESH_MS : IDLE_REFRESH_MS),
    ...(cachedWaiting === null ? {} : { placeholderData: cachedWaiting }),
  });
}

/**
 * Loads the list again within a moment of Paseo reporting any agent change,
 * so a new arrival does not wait for the poll. Opens an agents observation —
 * see `client/agents.ts` — and releases it on unmount.
 *
 * Kept apart from `useWaiting` so the popover, which lives only while it is
 * open under a row that already listens, does not open a second one.
 */
export function useWaitingNudges(): void {
  const paseo = usePaseo();
  const queryClient = useQueryClient();
  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const unwatch = watchAgents(paseo, () => {
      if (debounce !== null) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        // `cancelRefetch: false` joins a load already in flight — the screen
        // and the sidebar row both listen — rather than restarting it.
        void queryClient.invalidateQueries({ queryKey: WAITING_QUERY_KEY }, { cancelRefetch: false });
      }, NUDGE_DEBOUNCE_MS);
    });
    return () => {
      if (debounce !== null) clearTimeout(debounce);
      unwatch();
    };
  }, [paseo, queryClient]);
}
