import { describe, expect, it, vi } from "vitest";

import { invocationText, sendInvocation } from "./invoke";

/** A send that answers only when the test says so. */
function deferredSend() {
  const sent: string[] = [];
  let settle: { resolve(): void; reject(error: Error): void } | undefined;
  const send = (text: string) => {
    sent.push(text);
    return new Promise<void>((resolve, reject) => {
      settle = { resolve, reject };
    });
  };
  return {
    send,
    sent,
    resolve: () => settle?.resolve(),
    reject: (error: Error) => settle?.reject(error),
  };
}

/** One detail screen's lifetime: showing from mount until it is left. */
function screen() {
  let showing = true;
  return {
    isShowing: () => showing,
    leave() {
      showing = false;
    },
    onSent: vi.fn(),
    onFailure: vi.fn(),
    onUnseenFailure: vi.fn(),
  };
}

function start(
  send: (text: string) => Promise<unknown>,
  text: string,
  on: ReturnType<typeof screen>,
) {
  return sendInvocation({
    send,
    text,
    isShowing: on.isShowing,
    onSent: on.onSent,
    onFailure: on.onFailure,
    onUnseenFailure: on.onUnseenFailure,
  });
}

describe("invocationText", () => {
  it("sends the bare command without arguments, and trims them otherwise", () => {
    expect(invocationText("review", "   ")).toBe("/review");
    expect(invocationText("review", "  focus on auth ")).toBe("/review focus on auth");
  });
});

describe("sendInvocation", () => {
  it("reports success to the screen that is still showing", async () => {
    const network = deferredSend();
    const detail = screen();
    const done = start(network.send, "/review", detail);
    network.resolve();
    await done;
    expect(network.sent).toEqual(["/review"]);
    expect(detail.onSent).toHaveBeenCalledOnce();
  });

  it("leaves a newer selection alone when the first send answers after going back", async () => {
    const network = deferredSend();
    const first = screen();
    const done = start(network.send, "/review", first);

    // "← All skills", then another skill: the first detail is gone, a second shows.
    first.leave();
    const second = screen();

    network.resolve();
    await done;
    expect(network.sent).toEqual(["/review"]);
    expect(first.onSent).not.toHaveBeenCalled();
    expect(second.onSent).not.toHaveBeenCalled();
  });

  it("does not close a reopened popover when the send from the dismissed one answers", async () => {
    const network = deferredSend();
    const close = vi.fn();
    const dismissed = { ...screen(), onSent: close };
    const done = start(network.send, "/review", dismissed);

    // Dismissing the popover unmounts its content; reopening mounts fresh content
    // whose `close` is the same host call.
    dismissed.leave();
    const reopened = { ...screen(), onSent: close };

    network.resolve();
    await done;
    expect(close).not.toHaveBeenCalled();
    expect(reopened.isShowing()).toBe(true);
  });

  it("keeps a failed send's screen open and shows the error there", async () => {
    const network = deferredSend();
    const detail = screen();
    const done = start(network.send, "/review", detail);
    network.reject(new Error("agent is busy"));
    await done;
    expect(detail.onFailure).toHaveBeenCalledWith("agent is busy");
    expect(detail.onSent).not.toHaveBeenCalled();
    expect(detail.onUnseenFailure).not.toHaveBeenCalled();
  });

  it("still reports a failure nobody is looking at any more", async () => {
    const network = deferredSend();
    const detail = screen();
    const done = start(network.send, "/review", detail);
    detail.leave();
    network.reject(new Error("agent is gone"));
    await done;
    expect(detail.onFailure).not.toHaveBeenCalled();
    expect(detail.onUnseenFailure).toHaveBeenCalledWith("agent is gone");
  });
});
