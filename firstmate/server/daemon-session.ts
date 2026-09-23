/**
 * A daemon request the plugin SDK does not expose, sent over the plugin's own
 * channel to the daemon.
 *
 * A plugin's server half is a forked process whose `PaseoApi` is a
 * `DaemonClient` speaking the ordinary session protocol over IPC: each frame
 * is `{ type: "paseo_frame", isBinary: false, data }`, and `data` is
 * `{ "type": "session", "message": … }` — the same envelope the app sends over
 * its websocket. `PaseoApi` wraps only part of that protocol; the rest (here,
 * clearing an agent's attention, which the app does when you look at an agent)
 * is reachable by writing a well-formed session message to the same channel
 * and listening for the response with our own `requestId`. The plugin's own
 * client ignores a response it did not ask for.
 *
 * This is the protocol, not an interface. Checked against 0.9.0 and 0.9.1;
 * a later daemon that changes the message is answered by a timeout, which the
 * caller logs and survives. Use it only for requests whose failure costs
 * nothing, and never send anything but a complete, valid session message: a
 * malformed frame is a protocol violation, and the daemon closes the socket
 * every other call from this plugin rides on.
 */
import { randomUUID } from "node:crypto";

const DEFAULT_TIMEOUT_MS = 10_000;

interface Frame {
  type?: unknown;
  isBinary?: unknown;
  data?: unknown;
}

interface SessionResponse {
  type?: unknown;
  message?: { type?: unknown; payload?: { requestId?: unknown } };
}

export function sendSessionRequest(
  message: { type: string } & Record<string, unknown>,
  responseType: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  const send = process.send?.bind(process);
  if (send === undefined) {
    return Promise.reject(new Error("This process has no channel to the daemon; it is not running as a Paseo plugin."));
  }
  const requestId = `firstmate-${randomUUID()}`;

  return new Promise((resolve, reject) => {
    function finish(): void {
      clearTimeout(timer);
      process.off("message", listen);
    }
    function listen(raw: unknown): void {
      const frame = raw as Frame | null;
      if (frame === null || typeof frame !== "object") return;
      if (frame.type !== "paseo_frame" || frame.isBinary !== false || typeof frame.data !== "string") return;
      let parsed: SessionResponse;
      try {
        parsed = JSON.parse(frame.data) as SessionResponse;
      } catch {
        return;
      }
      if (parsed.type !== "session" || parsed.message?.type !== responseType) return;
      if (parsed.message.payload?.requestId !== requestId) return;
      finish();
      resolve(parsed.message.payload as Record<string, unknown>);
    }
    const timer = setTimeout(() => {
      finish();
      reject(new Error(`The daemon did not answer ${message.type} within ${timeoutMs / 1000} seconds.`));
    }, timeoutMs);

    process.on("message", listen);
    try {
      send({ type: "paseo_frame", isBinary: false, data: JSON.stringify({ type: "session", message: { ...message, requestId } }) });
    } catch (error) {
      finish();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
