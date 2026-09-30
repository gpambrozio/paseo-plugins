/**
 * `board.image` end to end, through the real handler: `gh auth token` answers a
 * made-up token and `fetch` is a stub that records every request, so nothing in
 * this file leaves the machine. The URLs are the shapes a comment's author can
 * type that a hand-rolled host check and the URL parser `fetch` uses read
 * differently.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FAKE_TOKEN = "gho_test_not_a_real_token";

vi.mock("node:child_process", () => ({
  execFile: (
    _file: string,
    args: readonly string[],
    _options: unknown,
    callback: (error: Error | null, result: { stdout: string; stderr: string }) => void,
  ) => {
    if (args[0] === "auth" && args[1] === "token") {
      callback(null, { stdout: `${FAKE_TOKEN}\n`, stderr: "" });
      return;
    }
    callback(new Error(`unexpected gh ${args.join(" ")}`), { stdout: "", stderr: "" });
  },
}));

const { loadImageHandler } = await import("./board");

type Seen = { url: string; authorization: string | null };

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function image(): Response {
  return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

/** A `fetch` that answers from `route` and remembers what it was asked for. */
function stubFetch(route: (url: URL) => Response): Seen[] {
  const seen: Seen[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      // What `fetch` would really request: the WHATWG parse of the input.
      const url = new URL(input instanceof Request ? input.url : String(input));
      const authorization = new Headers(init?.headers).get("authorization");
      seen.push({ url: url.href, authorization });
      return Promise.resolve(route(url));
    }),
  );
  return seen;
}

let unique = 0;
/** The handler caches by URL; a fresh path per test keeps them independent. */
function fresh(url: string): string {
  unique += 1;
  return `${url}${url.includes("?") ? "&" : "?"}n=${unique}`;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("board.image never hands the gh token to a host that is not GitHub", () => {
  const smuggled = [
    ["a backslash before the GitHub suffix", "https://attacker.example\\.githubusercontent.com/x.png"],
    ["a backslash and userinfo", "https://attacker.example\\@.githubusercontent.com/x.png"],
    ["a backslash after a port", "https://attacker.example:8443\\.githubusercontent.com/x.png"],
    ["userinfo before a non-GitHub host", "https://github.com@attacker.example/x.png"],
    ["a fragment before the GitHub suffix", "https://attacker.example#.githubusercontent.com/x.png"],
  ] as const;

  it.each(smuggled)("%s", async (_name, raw) => {
    const seen = stubFetch(() => image());
    await loadImageHandler({ url: fresh(raw) }).catch(() => undefined);
    for (const request of seen) {
      const host = new URL(request.url).hostname;
      const isGitHub = host === "github.com" || host.endsWith(".githubusercontent.com");
      expect({ host, isGitHub }).toEqual({ host, isGitHub: true });
    }
    expect(seen.every((request) => request.authorization === null)).toBe(true);
  });

  it("refuses a backslash URL outright", async () => {
    const seen = stubFetch(() => image());
    await expect(
      loadImageHandler({ url: fresh("https://attacker.example\\.githubusercontent.com/x.png") }),
    ).rejects.toThrow(/Only images hosted on GitHub/);
    expect(seen).toEqual([]);
  });

  it("does not send the token to a githubusercontent.com host, which never needs it", async () => {
    const seen = stubFetch(() => image());
    await loadImageHandler({ url: fresh("https://user-images.githubusercontent.com/1/x.png") });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.authorization).toBeNull();
  });

  it("sends the token to github.com, where a private repository's attachment needs it", async () => {
    const seen = stubFetch(() => image());
    const result = await loadImageHandler({
      url: fresh("https://github.com/user-attachments/assets/00000000-0000-0000-0000-000000000000"),
    });
    expect(result.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.authorization).toBe(`token ${FAKE_TOKEN}`);
  });
});

describe("board.image redirects", () => {
  it("follows GitHub's redirect to signed storage without the token", async () => {
    const seen = stubFetch((url) =>
      url.hostname === "github.com"
        ? redirect("https://github-production-user-asset-6210df.s3.amazonaws.com/1/x.png?X-Amz-Signature=abc")
        : image(),
    );
    const result = await loadImageHandler({
      url: fresh("https://github.com/user-attachments/assets/11111111-1111-1111-1111-111111111111"),
    });
    expect(result.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(seen.map((request) => new URL(request.url).hostname)).toEqual([
      "github.com",
      "github-production-user-asset-6210df.s3.amazonaws.com",
    ]);
    expect(seen[0]?.authorization).toBe(`token ${FAKE_TOKEN}`);
    expect(seen[1]?.authorization).toBeNull();
  });

  it("drops the token on a redirect that leaves github.com, even to another GitHub host", async () => {
    const seen = stubFetch((url) =>
      url.hostname === "github.com" ? redirect("https://raw.githubusercontent.com/o/r/main/x.png") : image(),
    );
    await loadImageHandler({ url: fresh("https://github.com/o/r/raw/main/x.png") });
    expect(seen.map((request) => request.authorization)).toEqual([`token ${FAKE_TOKEN}`, null]);
  });

  it("keeps the token on a redirect that stays on github.com", async () => {
    const seen = stubFetch((url) =>
      url.pathname.startsWith("/old/") ? redirect("https://github.com/new/x.png") : image(),
    );
    await loadImageHandler({ url: fresh("https://github.com/old/x.png") });
    expect(seen.map((request) => request.authorization)).toEqual([
      `token ${FAKE_TOKEN}`,
      `token ${FAKE_TOKEN}`,
    ]);
  });

  it("refuses a redirect to plain http", async () => {
    const seen = stubFetch((url) =>
      url.protocol === "https:" ? redirect("http://github.com/x.png") : image(),
    );
    await expect(loadImageHandler({ url: fresh("https://github.com/x.png") })).rejects.toThrow();
    expect(seen).toHaveLength(1);
  });

  it("gives up on a redirect loop", async () => {
    const seen = stubFetch(() => redirect("https://github.com/loop.png"));
    await expect(loadImageHandler({ url: fresh("https://github.com/loop.png") })).rejects.toThrow(
      /redirect/i,
    );
    expect(seen.length).toBeLessThanOrEqual(6);
  });
});

describe("board.image limits", () => {
  it("stops reading a body that runs past the cap, whatever its content-length said", async () => {
    let pulled = 0;
    const chunk = new Uint8Array(1024 * 1024);
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 64) {
          controller.close();
          return;
        }
        controller.enqueue(chunk);
      },
    });
    // React Native's DOM types shadow Node's in this project, and theirs do not
    // list a stream as a body; Node's `Response` takes one.
    const body = endless as unknown as ConstructorParameters<typeof Response>[0];
    stubFetch(() => new Response(body, { status: 200, headers: { "content-type": "image/png" } }));
    await expect(loadImageHandler({ url: fresh("https://github.com/huge.png") })).rejects.toThrow(
      /too large/,
    );
    // The cap is 4 MiB; reading stops within a chunk or two of it, not at 64.
    expect(pulled).toBeLessThan(8);
  });

  it("gives up on a host that never answers", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn((_input: unknown, init?: RequestInit) => {
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          });
        }),
      );
      const pending = loadImageHandler({ url: fresh("https://github.com/slow.png") });
      const settled = expect(pending).rejects.toThrow(/too long/);
      await vi.advanceTimersByTimeAsync(60_000);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });
});
