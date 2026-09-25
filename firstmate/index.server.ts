import type { PluginServerContext } from "@getpaseo/plugin/server";

import { migrateLegacyFiles, readFirstmateConfig, resolveHome, updateFirstmateConfig } from "./server/config";
import { nameHomeOnce } from "./server/home-name";
import {
  CaptainSteers,
  exitCrew,
  interruptCrew,
  registerSteerRelay,
  relaunchCrew,
  steerCrew,
} from "./server/crew";
import { registerCrewSeen } from "./server/crew-seen";
import { ReportCache, loadFleet, readAgentTools } from "./server/fleet";
import { listDirectory, readTextFile, requireHome, writeTextFile } from "./server/files";
import { CHARTER_FILE, NEW_CHARTER_FILE, acknowledgeCharter, writeNewCharter } from "./server/charter-file";
import { isHomeReady, prepareHome } from "./server/home";
import {
  adoptMate,
  askMate,
  commandText,
  compactMate,
  launchMate,
  listCandidates,
  markMateSeen,
  releaseMate,
  restartMate,
} from "./server/mate";
import {
  acknowledgeCharter as acknowledgeCharterRpc,
  adoptMate as adoptMateRpc,
  askMate as askMateRpc,
  askMateCommand as askMateCommandRpc,
  compactMate as compactMateRpc,
  compareCharter as compareCharterRpc,
  enableAgentTools,
  exitCrew as exitCrewRpc,
  interruptCrew as interruptCrewRpc,
  launchMate as launchMateRpc,
  listCandidates as listCandidatesRpc,
  loadFleet as loadFleetRpc,
  markMateSeen as markMateSeenRpc,
  readConfig,
  relaunchCrew as relaunchCrewRpc,
  releaseMate as releaseMateRpc,
  restartMate as restartMateRpc,
  steerCrew as steerCrewRpc,
  writeConfig,
} from "./shared/fleet";
import { listHomeFiles, readHomeFile, writeHomeFile } from "./shared/files";
import { displaySettings } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  migrateLegacyFiles();
  const reports = new ReportCache();
  const steers = new CaptainSteers();

  server.handle(readConfig, async () => {
    const config = await readFirstmateConfig();
    return { config, resolvedHome: resolveHome(config) };
  });
  server.handle(writeConfig, async (patch) => {
    const config = await updateFirstmateConfig(patch);
    const home = resolveHome(config);
    // The charter names the crew's model, so a saved change reaches the file
    // at once; a home nobody has launched in yet is left for the launch.
    if (await isHomeReady(home)) await prepareHome(home, config);
    return { config, resolvedHome: home };
  });

  server.handle(loadFleetRpc, async (_input, { paseo }) => {
    const fleet = await loadFleet(paseo, await readFirstmateConfig(), reports);
    // A first mate launched before the plugin named its home gets its name the first time the board looks.
    const workspaceId = fleet.mate?.workspaceId ?? null;
    if (workspaceId !== null && fleet.mateInHome) nameHomeOnce(paseo, workspaceId, fleet.home);
    return fleet;
  });
  server.handle(enableAgentTools, async (_input, { paseo }) => {
    await paseo.config.patch({ mcp: { injectIntoAgents: true } });
    return { agentTools: (await readAgentTools(paseo)) === true };
  });

  server.handle(launchMateRpc, (input, { paseo }) => launchMate(paseo, input));
  server.handle(adoptMateRpc, async ({ agentId }, { paseo }) => ({ config: await adoptMate(paseo, agentId) }));
  server.handle(releaseMateRpc, async () => ({ config: await releaseMate() }));
  server.handle(restartMateRpc, (_input, { paseo }) => restartMate(paseo));
  server.handle(compactMateRpc, async (_input, { paseo }) => ({ agentId: await compactMate(paseo) }));
  server.handle(listCandidatesRpc, (_input, { paseo }) => listCandidates(paseo));
  server.handle(askMateRpc, async (message, { paseo }) => ({ agentId: await askMate(paseo, message) }));
  server.handle(askMateCommandRpc, async ({ command, args }, { paseo }) => ({
    agentId: await askMate(paseo, { text: await commandText(command, args) }),
  }));
  server.handle(markMateSeenRpc, (_input, { paseo }) => markMateSeen(paseo));

  server.handle(steerCrewRpc, async ({ agentId, text }, { paseo }) => {
    await steerCrew(paseo, steers, agentId, text);
    return {};
  });
  server.handle(interruptCrewRpc, async ({ agentId }, { paseo }) => {
    await interruptCrew(paseo, agentId);
    return {};
  });
  server.handle(exitCrewRpc, async ({ agentId }, { paseo }) => {
    await exitCrew(paseo, agentId);
    return {};
  });
  server.handle(relaunchCrewRpc, async ({ agentId, note }, { paseo }) => ({
    agentId: await relaunchCrew(paseo, agentId, note),
  }));

  // The home as files, for the panel's file view. Confined to the home; see server/files.ts.
  async function home(): Promise<string> {
    return requireHome(resolveHome(await readFirstmateConfig()));
  }
  server.handle(listHomeFiles, async ({ path }) => {
    const root = await home();
    return { home: root, ...(await listDirectory(root, path)) };
  });
  server.handle(readHomeFile, async ({ path }) => readTextFile(await home(), path));
  server.handle(writeHomeFile, async (input) => {
    const written = await writeTextFile(await home(), input);
    // The charter's source, saved in the panel, reaches AGENTS.md at once rather than at the next reload.
    if (written.path === CHARTER_FILE) await refreshCharter();
    return written;
  });

  server.handle(compareCharterRpc, async () => ({
    path: (await writeNewCharter(await home())) ? NEW_CHARTER_FILE : null,
  }));
  server.handle(acknowledgeCharterRpc, async () => {
    await acknowledgeCharter(await home());
    return {};
  });

  // Storage lives on the host; registering the definition is what makes the
  // board's `useSettings` reads and writes valid for this installation.
  server.registerSettings(displaySettings);

  const unregisterRelay = registerSteerRelay(server, steers, readFirstmateConfig);
  // A crewmate whose finish the first mate has been told about leaves Paseo's "Ready to review"; see server/crew-seen.ts.
  const unregisterCrewSeen = registerCrewSeen(server, readFirstmateConfig);

  // A charter change reaches a home already in use on the next reload, rather
  // than waiting for the next launch. Only a home a launch has prepared: this
  // never creates one.
  void refreshCharter().catch((error: unknown) => {
    console.error("[firstmate] could not rewrite the charter:", error);
  });

  return () => {
    unregisterRelay();
    unregisterCrewSeen();
  };
}

async function refreshCharter(): Promise<void> {
  const config = await readFirstmateConfig();
  const home = resolveHome(config);
  if (await isHomeReady(home)) await prepareHome(home, config);
}
