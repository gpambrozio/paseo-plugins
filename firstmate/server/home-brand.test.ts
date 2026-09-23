import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HOME_NAME, brandHome } from "./home-brand";
import { HOME_ICON_PNG } from "./home-icon";
import type { PaseoApi } from "./host-types";

let home = "";

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "firstmate-home-brand-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function fakeWorkspace(descriptor: {
  title?: string | null;
  projectCustomName?: string | null;
  projectCustomIconRevision?: string | null;
  projectRootPath: string;
}) {
  const titles: Array<string | null> = [];
  const paseo = {
    workspaces: {
      ref(id: string) {
        return {
          async refresh() {
            return { id, projectId: "prj_home", ...descriptor };
          },
          async setTitle(title: string | null) {
            titles.push(title);
            return { title };
          },
        };
      },
    },
  } as unknown as PaseoApi;
  const renames: Array<[string, string]> = [];
  const icons: Array<[string, string]> = [];
  const deps = {
    async renameProject(projectId: string, name: string) {
      renames.push([projectId, name]);
    },
    async setProjectIcon(projectId: string, base64: string) {
      icons.push([projectId, base64]);
    },
  };
  return { paseo, titles, renames, icons, deps };
}

describe("brandHome", () => {
  it("calls the home's workspace and project FirstMate and gives the project the ship", async () => {
    const { paseo, titles, renames, icons, deps } = fakeWorkspace({ title: null, projectRootPath: home });
    await brandHome(paseo, "wks_home", home, deps);
    expect(titles).toEqual([HOME_NAME]);
    expect(renames).toEqual([["prj_home", HOME_NAME]]);
    expect(icons).toEqual([["prj_home", HOME_ICON_PNG]]);
  });

  it("keeps a name or an icon the captain chose", async () => {
    const { paseo, titles, renames, icons, deps } = fakeWorkspace({
      title: "Bridge",
      projectCustomName: "Ship",
      projectCustomIconRevision: "rev-1",
      projectRootPath: home,
    });
    await brandHome(paseo, "wks_home", home, deps);
    expect(titles).toEqual([]);
    expect(renames).toEqual([]);
    expect(icons).toEqual([]);
  });

  it("leaves a project that is more than the home alone", async () => {
    const { paseo, titles, renames, icons, deps } = fakeWorkspace({ title: null, projectRootPath: tmpdir() });
    await brandHome(paseo, "wks_home", home, deps);
    expect(titles).toEqual([HOME_NAME]);
    expect(renames).toEqual([]);
    expect(icons).toEqual([]);
  });

  it("ships an icon Paseo takes: a square PNG well under its size limit", () => {
    const bytes = Buffer.from(HOME_ICON_PNG, "base64");
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    // IHDR: width and height, big-endian, at bytes 16 and 20.
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([128, 128]);
    expect(bytes.length).toBeLessThan(512 * 1024);
  });
});
