function isBlockScalarHeader(line: string, position: number): boolean {
  let cursor = position + 1;
  for (let n = 0; n < 2 && /[1-9+-]/.test(line[cursor] || ""); n += 1) cursor += 1;
  while (line[cursor] === " " || line[cursor] === "\t") cursor += 1;
  return cursor === line.length || /[\r\n#]/.test(line[cursor]);
}

/** Restore legacy flow whitespace only at unambiguous node boundaries. */
export function normalizeLegacyFlowIndent(content: string): string {
  const lines = content.split(/(?<=\n)|(?<=\r)(?!\n)/);
  const flow: number[] = [];
  let quote = "";
  let nodeStart = true;
  let previous = "";
  let blockIndent = -1;
  let plainIndent = -1;
  let added = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    let line = lines[lineIndex];
    const indent = line.match(/^ */)![0].length;
    const first = line.slice(indent);
    if (plainIndent >= 0) {
      if (!first.trim() || first.startsWith("#") || indent > plainIndent) continue;
      plainIndent = -1;
    }
    if (blockIndent >= 0) {
      if (!first.trim() || indent > blockIndent) continue;
      blockIndent = -1;
    }

    if (flow.length && !quote && first.trim() && !first.startsWith("#")) {
      if (/^(?:---|\.\.\.)(?:\s|$)/.test(first)) return content;
      const boundary = /[\[{,]/.test(previous) || /^[,\]}]/.test(first);
      const required = flow[flow.length - 1];
      if (boundary && indent < required && !first.startsWith("\t")) {
        const padding = required - indent;
        added += padding;
        // Keep the repair linear in input size even for adversarial indentation.
        if (added > content.length) return content;
        line = " ".repeat(padding) + line;
        lines[lineIndex] = line;
      }
    }

    const sequenceIndent = line.match(/^ *(?:- +)+/)?.[0].length ?? indent;
    let blockMapping = false;

    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quote) {
        if (quote === '"' && ch === "\\") { i += 1; continue; }
        if (ch === quote) {
          if (quote === "'" && line[i + 1] === "'") { i += 1; continue; }
          quote = "";
          previous = ch;
        }
        continue;
      }
      if (/\s/.test(ch)) continue;
      if (ch === "#" && (i === 0 || /[\s\[{,]/.test(line[i - 1]))) break;
      if (nodeStart && (ch === '"' || ch === "'")) {
        quote = ch;
        nodeStart = false;
      } else if (nodeStart && !flow.length && /[|>]/.test(ch) && isBlockScalarHeader(line, i)) {
        blockIndent = sequenceIndent > indent
          ? blockMapping ? sequenceIndent : sequenceIndent - 2
          : indent;
        break;
      } else if (nodeStart && /[!&]/.test(ch)) {
        const tagEnd = ch === "!" && line[i + 1] === "<" ? line.indexOf(">", i + 2) : -1;
        if (ch === "!" && line[i + 1] === "<" && tagEnd < 0) return content;
        if (tagEnd >= 0) i = tagEnd;
        else while (i + 1 < line.length && !/[\s\[\]{},]/.test(line[i + 1])) i += 1;
      } else if (nodeStart && /[\[{]/.test(ch)) {
        plainIndent = -1;
        flow.push(Math.max(indent + 1, flow[flow.length - 1] || 0));
        previous = ch;
      } else if (flow.length && /[\]}]/.test(ch)) {
        flow.pop();
        nodeStart = false;
        previous = ch;
      } else if ((flow.length && ch === ",") || (ch === ":" && /\s|[\[\]{},]/.test(line[i + 1] || "\n"))) {
        if (!flow.length) blockMapping = true;
        plainIndent = -1;
        nodeStart = true;
        previous = ch;
      } else if (nodeStart && /[-?]/.test(ch) && /\s/.test(line[i + 1] || "\n")) {
        previous = ch;
      } else {
        if (nodeStart && !flow.length) {
          plainIndent = sequenceIndent > indent
            ? blockMapping ? sequenceIndent : sequenceIndent - 2
            : indent;
        }
        nodeStart = false;
        previous = ch;
      }
    }
    if (!flow.length && !quote) { nodeStart = true; previous = ""; }
  }
  return lines.join("");
}
