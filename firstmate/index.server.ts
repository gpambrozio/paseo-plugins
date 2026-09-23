import type { PluginServerContext } from "@getpaseo/plugin/server";

import { readFirstmateConfig, resolveHome, updateFirstmateConfig } from "./server/config";
import {
  CaptainSteers,
  exitCrew,
  interruptCrew,
  registerSteerRelay,
  relaunchCrew,
  steerCrew,
} from "./server/crew";
import { ReportCache, loadFleet, readAgentTools } from "./server/fleet";
import { isHomeReady, prepareHome } from "./server/home";
import { adoptMate, askMate, launchMate, listCandidates, releaseMate } from "./server/mate";
import {
  adoptMate as adoptMateRpc,
  askMate as askMateRpc,
  enableAgentTools,
  exitCrew as exitCrewRpc,
  interruptCrew as interruptCrewRpc,
  launchMate as launchMateRpc,
  listCandidates as listCandidatesRpc,
  loadFleet as loadFleetRpc,
  readConfig,
  relaunchCrew as relaunchCrewRpc,
  releaseMate as releaseMateRpc,
  steerCrew as steerCrewRpc,
  writeConfig,
} from "./shared/fleet";
import { displaySettings } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
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

  server.handle(loadFleetRpc, async (_input, { paseo }) => loadFleet(paseo, await readFirstmateConfig(), reports));
  server.handle(enableAgentTools, async (_input, { paseo }) => {
    await paseo.config.patch({ mcp: { injectIntoAgents: true } });
    return { agentTools: (await readAgentTools(paseo)) === true };
  });

  server.handle(launchMateRpc, (input, { paseo }) => launchMate(paseo, input));
  server.handle(adoptMateRpc, async ({ agentId }, { paseo }) => ({ config: await adoptMate(paseo, agentId) }));
  server.handle(releaseMateRpc, async () => ({ config: await releaseMate() }));
  server.handle(listCandidatesRpc, (_input, { paseo }) => listCandidates(paseo));
  server.handle(askMateRpc, async ({ text }, { paseo }) => ({ agentId: await askMate(paseo, text) }));

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

  // Storage lives on the host; registering the definition is what makes the
  // board's `useSettings` reads and writes valid for this installation.
  server.registerSettings(displaySettings);

  const unregisterRelay = registerSteerRelay(server, steers, readFirstmateConfig);

  return () => {
    unregisterRelay();
  };
}
