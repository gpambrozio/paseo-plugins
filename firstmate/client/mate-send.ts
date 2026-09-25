/**
 * Sending the captain's words to the first mate. The chat's Send, Bearings
 * and Ahoy, and a suggestion's button all go through here, so they share one
 * message in flight at a time per first mate, and a failure is reported the
 * same way whichever sent it. What the first mate does with a message that
 * arrives mid-turn is the daemon's (`server/send.ts`); what the captain sees
 * go out is the transcript, which echoes the message like any other.
 *
 * The gate is in module scope, not component state, so it is shared by the
 * chat and the surface, and a phone switching tabs mid-send — which unmounts
 * the chat — cannot send a second message behind the first.
 */
import { useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useSyncExternalStore } from "react";

import type { CaptainMessage } from "../shared/attachments";
import { askMate, askMateCommand, type MateCommand } from "../shared/fleet";
import { errorText } from "./format";

/** One task at a time; a second started while the first runs is refused. */
export interface SendGate {
  busy(): boolean;
  subscribe(listener: () => void): () => void;
  /** Starts `task` and resolves as it does, or returns null without starting it while another runs. */
  run<T>(task: () => Promise<T>): Promise<T> | null;
}

export function createSendGate(): SendGate {
  let running = false;
  const listeners = new Set<() => void>();
  function set(next: boolean): void {
    running = next;
    listeners.forEach((listener) => listener());
  }
  return {
    busy: () => running,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    run<T>(task: () => Promise<T>): Promise<T> | null {
      if (running) return null;
      set(true);
      let started: Promise<T>;
      try {
        started = task();
      } catch (error) {
        // A task that throws before it has a promise must not leave the gate shut.
        started = Promise.reject(error);
      }
      return started.finally(() => set(false));
    },
  };
}

const gates = new Map<string, SendGate>();

function gateFor(mateId: string): SendGate {
  let gate = gates.get(mateId);
  if (gate === undefined) {
    gate = createSendGate();
    gates.set(mateId, gate);
  }
  return gate;
}

export interface MateSender {
  /** A message to the first mate is on its way. */
  sending: boolean;
  /**
   * Sends a message, unless one is already on its way; false when refused. A
   * failure is shown as a toast, then `onFailure` runs — the chat's Send puts
   * its text back there.
   */
  send: (message: CaptainMessage, onFailure?: () => void) => boolean;
  /** Bearings or Ahoy, worded on the daemon; refused and reported like `send`. */
  command: (command: MateCommand) => boolean;
}

export function useMateSender(mateId: string): MateSender {
  const ask = useRpc(askMate);
  const askCommand = useRpc(askMateCommand);
  const toast = useToast();
  const gate = gateFor(mateId);
  const sending = useSyncExternalStore(gate.subscribe, gate.busy);

  function deliver(task: () => Promise<unknown>, onFailure?: () => void): boolean {
    const started = gate.run(task);
    if (started === null) return false;
    started.catch((caught: unknown) => {
      toast.error(errorText(caught));
      onFailure?.();
    });
    return true;
  }

  return {
    sending,
    send: (message, onFailure) => deliver(() => ask(message), onFailure),
    command: (command) => deliver(() => askCommand({ command, args: "" })),
  };
}
