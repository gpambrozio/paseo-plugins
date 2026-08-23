export interface ParsedSkillDocument {
  frontmatter: Record<string, string>;
  body: string;
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function isIndented(line: string): boolean {
  return /^[ \t]/.test(line);
}

/**
 * Reads the leading `---` block of a SKILL.md.
 *
 * Supports the flat `key: value` pairs most skills use, plus `>` folded and `|`
 * literal block scalars, which real skills do use for long descriptions. Lines
 * that are indented belong to a nested structure, not the top level: they are
 * skipped rather than trimmed into a top-level key, so a nested `metadata.name`
 * cannot overwrite the skill's own name.
 *
 * A file whose fence is missing or unterminated is reported as all body with no
 * frontmatter, which callers treat as "not a skill".
 */
export function parseFrontmatter(raw: string): ParsedSkillDocument {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { frontmatter: {}, body: raw };
  }

  const lines = normalized.split("\n");
  let closingIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]!.trim() === "---") {
      closingIndex = index;
      break;
    }
  }
  if (closingIndex === -1) {
    return { frontmatter: {}, body: raw };
  }

  const frontmatter: Record<string, string> = {};
  let index = 1;
  while (index < closingIndex) {
    const line = lines[index]!;
    index += 1;
    if (isIndented(line)) continue;

    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    if (key.length === 0) continue;
    const rest = line.slice(separator + 1).trim();

    if (/^[>|][-+]?$/.test(rest)) {
      const continuation: string[] = [];
      while (index < closingIndex && (isIndented(lines[index]!) || lines[index]!.trim() === "")) {
        continuation.push(lines[index]!.trim());
        index += 1;
      }
      while (continuation.length > 0 && continuation[continuation.length - 1] === "") {
        continuation.pop();
      }
      frontmatter[key] =
        rest[0] === ">"
          ? continuation.filter((entry) => entry !== "").join(" ")
          : continuation.join("\n");
      continue;
    }

    frontmatter[key] = unquote(rest);
  }

  const body = lines
    .slice(closingIndex + 1)
    .join("\n")
    .replace(/^\n+/, "");
  return { frontmatter, body };
}
