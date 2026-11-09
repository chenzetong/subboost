import { describe, expect, it } from "vitest";
import { loadMihomoYaml } from "./yaml-schema";

describe("Mihomo YAML schema", () => {
  it("keeps decimal and signed base-prefixed integers without YAML 1.1 boolean coercion", () => {
    expect(loadMihomoYaml("decimal: 00123\nhex: -0xff\noctal: +0o17\nbinary: 0b101\nlabel: yes"))
      .toEqual({ decimal: 123, hex: -255, octal: 15, binary: 5, label: "yes" });
  });

  it("preserves explicit sets, ordered mappings and pairs as ordinary objects and arrays", () => {
    expect(loadMihomoYaml("set: !!set {a: null, b: null}\nomap: !!omap [{a: 1}, {b: 2}]\npairs: !!pairs [{a: 1}, {a: 2}]"))
      .toEqual({ set: { a: null, b: null }, omap: [{ a: 1 }, { b: 2 }], pairs: [["a", 1], ["a", 2]] });
    expect(() => loadMihomoYaml("!!set {a: 1}")).toThrow("Set entries must have null values");
  });

  it("lets explicit mapping values override merged defaults", () => {
    expect(loadMihomoYaml("<<: &defaults {port: 443, tls: true}\nport: 8443"))
      .toEqual({ port: 8443, tls: true });
  });

  it("preserves empty-document results and rejects a document stream", () => {
    expect(loadMihomoYaml("")).toBeUndefined();
    expect(loadMihomoYaml("\uFEFF")).toBeUndefined();
    expect(loadMihomoYaml(" \n")).toBeUndefined();
    expect(loadMihomoYaml("\r\n")).toBeNull();
    expect(loadMihomoYaml("# comment\n")).toBeNull();
    expect(loadMihomoYaml("---\n")).toBeNull();
    expect(() => loadMihomoYaml("a: 1\n---\na: 2")).toThrow("expected a single document");
  });

  it("keeps zero signs and overflowing integer strings compatible", () => {
    expect(loadMihomoYaml("a: -0\nb: -00")).toEqual({ a: 0, b: -0 });
    const decimal = "9".repeat(400);
    const hexadecimal = `0x${"f".repeat(400)}`;
    expect(loadMihomoYaml(`a: ${decimal}\nb: ${hexadecimal}`))
      .toEqual({ a: decimal, b: hexadecimal });
    expect(() => loadMihomoYaml(`a: !!int ${decimal}`)).toThrow();
  });

  it("preserves complex mapping keys without changing the object prototype", () => {
    const value = loadMihomoYaml("[one, two]: pair\n__proto__: {safe: true}");
    expect(value).toEqual({ "one,two": "pair", ["__proto__"]: { safe: true } });
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  });

  it.each([":", ":\n", ": value", ":\n  bad", "before:\n: value", "before: 1\n: value", "nested:\n  : value", "- : value"])(
    "rejects a block mapping with no key node: %j", (source) => {
      expect(() => loadMihomoYaml(source)).toThrow("a key node is missed");
    },
  );

  it.each(["?\n: value", "? # comment\n: value", "null: value", "~: value", "!!null : value", "&key : value", "{ : value }"])(
    "preserves explicit and flow null keys: %j", (source) => {
      expect(loadMihomoYaml(source)).toEqual({ null: "value" });
    },
  );

  it.each(['"": value', "'': value", "!!str : value", '? ""\n: value'])(
    "preserves empty string keys: %j", (source) => {
      expect(loadMihomoYaml(source)).toEqual({ "": "value" });
    },
  );

  it("does not mistake scalar contents or completed collections for missing keys", () => {
    expect(loadMihomoYaml('before: {empty:}\n? # comment\n: value'))
      .toEqual({ before: { empty: null }, null: "value" });
    expect(loadMihomoYaml('before: ["?"]\n?\n: value'))
      .toEqual({ before: ["?"], null: "value" });
    expect(loadMihomoYaml('literal: |\n  : value\nquoted: ": value"'))
      .toEqual({ literal: ": value\n", quoted: ": value" });
  });

  it.each(["+.0", "-.0", "+.5", "-.5", "+.5e+2", "-.5E-1"])(
    "preserves signed leading-dot strings and keys: %s", (value) => {
      expect(loadMihomoYaml(`value: ${value}\n${value}: key`))
        .toEqual({ value, [value]: "key" });
      expect(() => loadMihomoYaml(`value: !!float ${value}`)).toThrow();
    },
  );

  it("keeps ordinary floats, infinities and legacy empty-stream distinctions", () => {
    expect(loadMihomoYaml("a: .5\nb: +0.5\nc: -0.5\nd: -.inf"))
      .toEqual({ a: 0.5, b: 0.5, c: -0.5, d: -Infinity });
    expect(loadMihomoYaml("\r")).toBeUndefined();
    expect(loadMihomoYaml("\n\n")).toBeNull();
    expect(loadMihomoYaml("\n ")).toBeNull();
  });

  it.each<[string, unknown]>([
    ["dns:\n  nameserver: [local.subboost.test\n, 127.0.0.1\n]\n", { dns: { nameserver: ["local.subboost.test", "127.0.0.1"] } }],
    ["dns:\n  nameserver: [\n    local.subboost.test,\n    127.0.0.1\n  ]\n", { dns: { nameserver: ["local.subboost.test", "127.0.0.1"] } }],
    ["sniffer:\n  sniff:\n    TLS: {ports: [443, 8443],\noverride-destination: true}\n", { sniffer: { sniff: { TLS: { ports: [443, 8443], "override-destination": true } } } }],
  ])("preserves previously accepted multiline flow indentation: %j", (source, expected) => {
    expect(loadMihomoYaml(source)).toEqual(expected);
  });

  const flowRepair = "dns:\n  nameserver: [one,\ntwo\n]\n";

  it("keeps quoted and plain scalar punctuation intact during flow repair", () => {
    expect(loadMihomoYaml([
      'double: "a \\"quote\\" [#], b"',
      "single: 'don''t [change], # text'",
      'plain: https://local.subboost.test/a[b#c',
      'quoted-key: {"list": [one, # ] } must remain a comment',
      'two]}',
      flowRepair,
    ].join("\n"))).toEqual({
      double: 'a "quote" [#], b', single: "don't [change], # text",
      plain: "https://local.subboost.test/a[b#c", "quoted-key": { list: ["one", "two"] },
      dns: { nameserver: ["one", "two"] },
    });
  });

  it("preserves literal and folded block scalar contents during flow repair", () => {
    expect(loadMihomoYaml([
      "literal: |", "  [one", "  , two]", "", "folded: >-", "  {one", "  , two}",
      "explicit: |2-", "  [three", "  , four]", flowRepair,
    ].join("\n"))).toEqual({
      literal: "[one\n, two]\n", folded: "{one , two}", explicit: "[three\n, four]",
      dns: { nameserver: ["one", "two"] },
    });
  });

  it("keeps brackets in multiline plain scalar continuations as scalar text", () => {
    expect(loadMihomoYaml(`${flowRepair}label: first\n  [literal,\n  ]\nother: value\n`))
      .toEqual({ dns: { nameserver: ["one", "two"] }, label: "first [literal, ]", other: "value" });
  });

  it("distinguishes block scalar content from a sequence mapping's sibling flow", () => {
    expect(loadMihomoYaml("- data: |\n    text\n  flow: [one,\ntwo]\n"))
      .toEqual([{ data: "text\n", flow: ["one", "two"] }]);
    expect(loadMihomoYaml(`- |\n  [literal,\n  ]\n- {values: [one,\ntwo]}\n`))
      .toEqual(["[literal,\n]\n", { values: ["one", "two"] }]);
    expect(loadMihomoYaml("- data: text\n  flow: [one,\ntwo]\n"))
      .toEqual([{ data: "text", flow: ["one", "two"] }]);
    expect(loadMihomoYaml("x:\n  - data: text\n    flow: [one,\ntwo]\n"))
      .toEqual({ x: [{ data: "text", flow: ["one", "two"] }] });
  });

  it("handles adjacent anchors, explicit tags and carriage-return line endings", () => {
    expect(loadMihomoYaml("dns:\r  values: &x[one,\rtwo]\ralias: *x\r"))
      .toEqual({ dns: { values: ["one", "two"] }, alias: ["one", "two"] });
    expect(loadMihomoYaml("values: !<tag:yaml.org,2002:seq> [one,\ntwo]\n"))
      .toEqual({ values: ["one", "two"] });
  });

  it("preserves anchors, nested flow nodes and prototype-safe mappings during repair", () => {
    const value = loadMihomoYaml([
      "defaults: &defaults {port: 443,", "tls: true}",
      "values:", "  - [one,", "[two, three]", "]",
      "merged: {<<: *defaults, port: 8443}", "__proto__: {safe: true}", flowRepair,
    ].join("\r\n"));
    expect(value).toEqual({
      defaults: { port: 443, tls: true }, values: [["one", ["two", "three"]]],
      merged: { port: 8443, tls: true }, ["__proto__"]: { safe: true },
      dns: { nameserver: ["one", "two"] },
    });
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  });

  it.each([
    "dns:\n  nameserver: [one\ntwo]\n",
    "dns:\n  nameserver: [one,\n\t]\n",
    "dns:\n  nameserver: [one,\ntwo}\n",
    "dns:\n  nameserver: [one,\ntwo\n",
    "root:\n  child:\n  misplaced\n",
    `${flowRepair}root:\n  child:\n  misplaced\n`,
    `${flowRepair}: value\n`,
    `${flowRepair}---\nother: value\n`,
    `${flowRepair}label: first\n  [literal,\n]\n`,
    `${flowRepair}label: first\n  [literal,\n---\n]\n`,
    "dns:\n  a: [one,\n---\n]\n",
  ])("continues rejecting ambiguous or malformed input: %j", (source) => {
    expect(() => loadMihomoYaml(source)).toThrow();
  });

  it("bounds whitespace expansion for excessively indented flow input", () => {
    const source = `${" ".repeat(64)}values: [one\n${", two\n".repeat(120)}]\n`;
    expect(() => loadMihomoYaml(source)).toThrow("deficient indentation");
  });

  it("rejects repeated invalid scalar headers with a long whitespace suffix", () => {
    const source = `${flowRepair}key: ${"|: ".repeat(16384)}${" ".repeat(16384)}\n`;
    expect(() => loadMihomoYaml(source)).toThrow();
  });

  it("handles long comments with Unicode separators without rescanning their suffix", () => {
    const source = `${flowRepair}key: ${"| # ".repeat(16384)}\u2028X\n`;
    expect(loadMihomoYaml(source)).toEqual({ dns: { nameserver: ["one", "two"] }, key: "" });
  });

  it("rejects repeated unterminated verbatim tags", () => {
    expect(() => loadMihomoYaml(`${flowRepair}key: ${"!<a ".repeat(16384)}\n`)).toThrow();
  });

  it("keeps the parser depth limit after flow repair", () => {
    expect(() => loadMihomoYaml(`${flowRepair}deep: ${"[".repeat(200)}one${"]".repeat(200)}\n`))
      .toThrow("maxDepth");
  });
});
