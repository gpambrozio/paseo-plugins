import { describe, expect, it } from "vitest";

import { DEFAULT_WPM, parseVoiceList, renderWithSay, sayArguments, speakable } from "./say";

describe("parseVoiceList", () => {
  it("reads names with spaces and parentheses, and skips noise", () => {
    const output = [
      "Albert              en_US    # Hello! My name is Albert.",
      "Eddy (English (UK)) en_GB    # Hello! My name is Eddy.",
      "Zoe (Premium)       en_US    # Hello! My name is Zoe.",
      "Amélie              fr_CA    # Bonjour! Je m’appelle Amélie.",
      "",
      "not a voice line",
    ].join("\n");
    expect(parseVoiceList(output)).toEqual([
      { name: "Albert", lang: "en_US" },
      { name: "Eddy (English (UK))", lang: "en_GB" },
      { name: "Zoe (Premium)", lang: "en_US" },
      { name: "Amélie", lang: "fr_CA" },
    ]);
  });
});

describe("sayArguments", () => {
  it("writes a WAV from stdin and only names a voice or rate when asked", () => {
    expect(sayArguments({ voice: "", rate: 1 }, "/tmp/x.wav")).toEqual([
      "-o",
      "/tmp/x.wav",
      "--file-format=WAVE",
      "--data-format=LEI16@16000",
      "-f",
      "-",
    ]);
    expect(sayArguments({ voice: " Zoe (Premium) ", rate: 1.2 }, "/tmp/x.wav").slice(6)).toEqual([
      "-v",
      "Zoe (Premium)",
      "-r",
      String(Math.round(DEFAULT_WPM * 1.2)),
    ]);
  });
});

describe("speakable", () => {
  it("removes embedded-command brackets and folds whitespace", () => {
    expect(speakable("Done.\n\n[[slnc 500]] Next   line")).toBe("Done. slnc 500 Next line");
  });
});

describe.runIf(process.platform === "darwin")("renderWithSay on a Mac", () => {
  it("returns a WAV without playing anything", async () => {
    const rendered = await renderWithSay("Herald.", { voice: "", rate: 1 });
    expect(rendered.mimeType).toBe("audio/wav");
    const bytes = Buffer.from(rendered.base64, "base64");
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it("renders with the default voice when the named one is not installed", async () => {
    const rendered = await renderWithSay("Herald.", { voice: "NoSuchVoiceHerald", rate: 1 });
    expect(Buffer.from(rendered.base64, "base64").subarray(0, 4).toString("ascii")).toBe("RIFF");
  });
});
