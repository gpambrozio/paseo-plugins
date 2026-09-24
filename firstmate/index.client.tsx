import type { PluginClientContext, PluginWorkspaceCommandContext } from "@getpaseo/plugin/client";

import { FleetSurface, bindSettingsOpener } from "./client/fleet";
import { AgentPanel, WorkspacePanel } from "./client/panels";
import { SettingsScreen } from "./client/settings-screen";
import { askMate, askMateCommand, type MateCommand } from "./shared/fleet";

type CommandRpc = PluginWorkspaceCommandContext["rpc"];

/**
 * Every command goes to the first mate, never to a crewmate: it owns intake,
 * and the captain has one person to talk to. An async function rather than an
 * async arrow — Hermes evaluates an async arrow in an eval'd bundle to
 * `undefined`.
 */
async function tellFirstMate(rpc: CommandRpc, text: string): Promise<void> {
  if (text.trim() === "") throw new Error("Say something to the first mate: /fm <message>");
  await rpc(askMate, { text });
}

/** Bearings or Ahoy, worded by the daemon from its templates; `args` is what followed the command. */
async function askFirstMate(rpc: CommandRpc, command: MateCommand, args: string): Promise<void> {
  await rpc(askMateCommand, { command, args });
}

export default function contribute(client: PluginClientContext) {
  client.addSurface("fleet", FleetSurface);
  // The board's gear. A surface is given no way to open a settings screen, so
  // the capability is lent to it from here.
  bindSettingsOpener((id) => {
    client.openSettings(id);
  });
  client.addSidebarItem({ id: "fleet", title: "FirstMate", icon: "Ship", surface: "fleet" });
  client.addSettingsScreen({ id: "firstmate", title: "FirstMate", icon: "Ship", Component: SettingsScreen });

  client.addWorkspacePanel({
    id: "firstmate-workspace",
    title: "FirstMate",
    icon: "Ship",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: WorkspacePanel,
  });
  client.addWorkspacePanel({
    id: "firstmate-agent",
    title: "FirstMate",
    icon: "Ship",
    context: "agent",
    locations: ["workspace", "explorer"],
    Component: AgentPanel,
  });

  client.addCommandCenterItem({
    id: "open-fleet",
    title: "Open FirstMate",
    icon: "Ship",
    keywords: ["firstmate", "first mate", "fleet", "crew", "captain", "board"],
    context: "global",
    onSelect({ openSurface }) {
      openSurface("fleet");
    },
  });
  client.addCommandCenterItem({
    id: "bearings",
    title: "FirstMate: bearings",
    icon: "Compass",
    keywords: ["firstmate", "bearings", "status", "catch up", "digest"],
    context: "global",
    onSelect({ rpc, openSurface }) {
      openSurface("fleet");
      void rpc(askMateCommand, { command: "bearings", args: "" }).catch((caught: unknown) => {
        console.warn("[firstmate] bearings could not be asked for:", caught);
      });
    },
  });
  client.addCommandCenterItem({
    id: "settings",
    title: "FirstMate settings",
    icon: "Settings",
    keywords: ["firstmate", "first mate", "home", "crew model", "agent tools"],
    context: "global",
    onSelect({ openSettings }) {
      openSettings("firstmate");
    },
  });

  client.addSlashCommand({
    name: "fm",
    description: "Tell the first mate",
    argumentHint: "<message>",
    context: "workspace",
    onSubmit({ args, rpc }) {
      return tellFirstMate(rpc, args);
    },
  });
  client.addSlashCommand({
    name: "bearings",
    description: "FirstMate: where everything stands",
    argumentHint: "[file] [include PRs]",
    context: "workspace",
    onSubmit({ args, rpc, openSurface }) {
      openSurface("fleet");
      return askFirstMate(rpc, "bearings", args);
    },
  });
  client.addSlashCommand({
    name: "ahoy",
    description: "FirstMate: what happened, and what needs your call",
    argumentHint: "",
    context: "workspace",
    onSubmit({ args, rpc, openSurface }) {
      openSurface("fleet");
      return askFirstMate(rpc, "ahoy", args);
    },
  });

  return () => {
    bindSettingsOpener(null);
  };
}
