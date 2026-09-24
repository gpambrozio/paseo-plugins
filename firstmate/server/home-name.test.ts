import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PaseoApi } from "./host-types";
import { HOME_NAME, nameHome } from "./home-name";

let home = "";

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "firstmate-home-name-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function fakeWorkspace(descriptor: { title?: string | null; projectCustomName?: string | null; projectRootPath: string }) {
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
  async function rename(projectId: string, name: string): Promise<void> {
    renames.push([projectId, name]);
  }
  return { paseo, titles, renames, rename };
}

describe("nameHome", () => {
  it("calls the home's workspace and project FirstMate", async () => {
    const { paseo, titles, renames, rename } = fakeWorkspace({ title: null, projectCustomName: null, projectRootPath: home });
    await nameHome(paseo, "wks_home", home, rename);
    expect(titles).toEqual([HOME_NAME]);
    expect(renames).toEqual([["prj_home", HOME_NAME]]);
  });

  it("keeps a name the captain gave either", async () => {
    const { paseo, titles, renames, rename } = fakeWorkspace({
      title: "Bridge",
      projectCustomName: "Ship",
      projectRootPath: home,
    });
    await nameHome(paseo, "wks_home", home, rename);
    expect(titles).toEqual([]);
    expect(renames).toEqual([]);
  });

  it("leaves a project that is more than the home alone", async () => {
    const { paseo, titles, renames, rename } = fakeWorkspace({ title: null, projectRootPath: tmpdir() });
    await nameHome(paseo, "wks_home", home, rename);
    expect(titles).toEqual([HOME_NAME]);
    expect(renames).toEqual([]);
  });
});
