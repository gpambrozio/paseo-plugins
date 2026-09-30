import { describe, expect, it } from "vitest";

import { isGitHubImageHost, isGitHubTokenHost } from "./image-host";

/**
 * Every case is judged against what the WHATWG URL parser — the one `fetch`
 * uses — makes of the same string, so the check and the request cannot
 * disagree about where the request goes.
 */
describe("isGitHubImageHost", () => {
  it.each([
    "https://github.com/user-attachments/assets/00000000-0000-0000-0000-000000000000",
    "https://github.com/owner/repo/assets/1/00000000-0000-0000-0000-000000000000",
    "https://user-images.githubusercontent.com/1/x.png",
    "https://private-user-images.githubusercontent.com/1/x.png?jwt=abc",
    "https://raw.githubusercontent.com/o/r/main/x.png",
    "https://GITHUB.COM/user-attachments/assets/x",
    "https://github.com:443/x.png",
  ])("accepts %s", (url) => {
    expect(isGitHubImageHost(url)).toBe(true);
  });

  it.each([
    // Parsed as a path separator by `fetch`, as nothing by a host regex.
    ["backslash", "https://attacker.example\\.githubusercontent.com/x"],
    ["backslash with userinfo", "https://attacker.example\\@.githubusercontent.com/x"],
    ["backslash after a port", "https://attacker.example:1\\.githubusercontent.com/x"],
    ["backslash in the path", "https://github.com/a\\b.png"],
    ["encoded backslash in the host", "https://attacker.example%5C.githubusercontent.com/x"],
    ["tab in the host", "https://attacker.example\t.githubusercontent.com/x"],
    ["newline in the host", "https://attacker.example\n.githubusercontent.com/x"],
    ["leading space", " https://github.com/x.png"],
    ["userinfo before another host", "https://github.com@attacker.example/x"],
    ["userinfo before a GitHub host", "https://x@user-images.githubusercontent.com/x"],
    ["fragment before the suffix", "https://attacker.example#.githubusercontent.com/x"],
    ["query before the suffix", "https://attacker.example?.githubusercontent.com/x"],
    ["trailing dot", "https://github.com./x.png"],
    ["trailing dot on a subdomain", "https://a.githubusercontent.com./x.png"],
    ["another port", "https://github.com:8443/x.png"],
    ["plain http", "http://github.com/x.png"],
    ["no scheme", "//github.com/x.png"],
    ["lookalike IDN", "https://gıthub.com/x.png"],
    ["suffix without the dot", "https://evilgithubusercontent.com/x.png"],
    ["bare githubusercontent.com", "https://githubusercontent.com/x.png"],
    ["a subdomain of github.com", "https://gist.github.com/x.png"],
    ["not a URL", "github.com/x.png"],
  ])("refuses %s", (_name, url) => {
    expect(isGitHubImageHost(url)).toBe(false);
  });
});

describe("isGitHubTokenHost", () => {
  it("is github.com over https on the default port and nothing else", () => {
    expect(isGitHubTokenHost(new URL("https://github.com/user-attachments/assets/x"))).toBe(true);
    expect(isGitHubTokenHost(new URL("https://GitHub.com/x"))).toBe(true);
    expect(isGitHubTokenHost(new URL("https://user-images.githubusercontent.com/x"))).toBe(false);
    expect(isGitHubTokenHost(new URL("https://raw.githubusercontent.com/x"))).toBe(false);
    expect(isGitHubTokenHost(new URL("https://github.com.evil.example/x"))).toBe(false);
    expect(isGitHubTokenHost(new URL("https://github.com:8443/x"))).toBe(false);
    expect(isGitHubTokenHost(new URL("http://github.com/x"))).toBe(false);
    expect(isGitHubTokenHost(new URL("https://u:p@github.com/x"))).toBe(false);
  });
});
