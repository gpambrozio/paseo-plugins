import { describe, expect, it, vi } from "vitest";

import { imageOrigin, startImageLoad, type ImageLoaders } from "./image-gate";

function fakeLoaders() {
  return {
    viaDaemon: vi.fn((url: string) => Promise.resolve(`data:image/png;base64,${url.length}`)),
    measure: vi.fn((uri: string) => Promise.resolve({ uri, width: 4, height: 3 })),
  } satisfies ImageLoaders;
}

describe("imageOrigin", () => {
  it.each([
    "https://github.com/user-attachments/assets/00000000-0000-0000-0000-000000000000",
    "https://user-images.githubusercontent.com/1/x.png",
    "https://raw.githubusercontent.com/o/r/main/x.png",
  ])("treats %s as GitHub-hosted", (url) => {
    expect(imageOrigin(url)).toEqual({ kind: "github" });
  });

  it.each([
    ["https://tracker.example/pixel.gif", "tracker.example"],
    ["http://Images.Example.com:8080/x.png?id=1", "images.example.com"],
    ["https://github.com@tracker.example/x.png", "tracker.example"],
  ])("names the host of %s", (url, host) => {
    expect(imageOrigin(url)).toEqual({ kind: "external", host });
  });

  it.each([
    "not a url",
    "",
    "/relative/x.png",
    "data:image/png;base64,AAAA",
    "javascript:alert(1)",
    "https://tracker.example\\@other.example/x.png",
    "https://tracker.example\t/x.png",
  ])("cannot name a host for %j", (url) => {
    expect(imageOrigin(url)).toEqual({ kind: "unknown" });
  });
});

describe("startImageLoad", () => {
  it("requests nothing from another host before the tap", () => {
    const url = "https://tracker.example/pixel.gif";
    const loaders = fakeLoaders();

    expect(startImageLoad(url, imageOrigin(url), false, loaders)).toBeNull();
    expect(loaders.viaDaemon).not.toHaveBeenCalled();
    expect(loaders.measure).not.toHaveBeenCalled();
  });

  it("loads another host's image directly after the tap, never through the daemon", async () => {
    const url = "https://tracker.example/pixel.gif";
    const loaders = fakeLoaders();

    const loaded = await startImageLoad(url, imageOrigin(url), true, loaders);

    expect(loaded).toEqual({ uri: url, width: 4, height: 3 });
    expect(loaders.measure).toHaveBeenCalledExactlyOnceWith(url);
    expect(loaders.viaDaemon).not.toHaveBeenCalled();
  });

  it("never requests an image whose host is unknown, tapped or not", () => {
    const url = "not a url";
    const loaders = fakeLoaders();

    expect(startImageLoad(url, imageOrigin(url), false, loaders)).toBeNull();
    expect(startImageLoad(url, imageOrigin(url), true, loaders)).toBeNull();
    expect(loaders.viaDaemon).not.toHaveBeenCalled();
    expect(loaders.measure).not.toHaveBeenCalled();
  });

  it("loads a GitHub-hosted image through the daemon without a tap", async () => {
    const url = "https://github.com/user-attachments/assets/abc";
    const loaders = fakeLoaders();

    const loaded = await startImageLoad(url, imageOrigin(url), false, loaders);

    expect(loaders.viaDaemon).toHaveBeenCalledExactlyOnceWith(url);
    const dataUrl = `data:image/png;base64,${url.length}`;
    expect(loaders.measure).toHaveBeenCalledExactlyOnceWith(dataUrl);
    expect(loaded).toEqual({ uri: dataUrl, width: 4, height: 3 });
  });
});
