import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const srcRoot = join(root, "src");

/** First meaningful line after BOM / blank lines / line comments / block comments. */
function firstDirectiveLine(source: string): string | null {
  let i = 0;
  const text = source.replace(/^\uFEFF/, "");
  while (i < text.length) {
    if (/\s/.test(text[i]!)) {
      i += 1;
      continue;
    }
    if (text.startsWith("//", i)) {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end + 1;
      continue;
    }
    if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    const end = text.indexOf("\n", i);
    return text.slice(i, end < 0 ? text.length : end).trim();
  }
  return null;
}

function isUseServerFile(source: string): boolean {
  const first = firstDirectiveLine(source);
  return first === '"use server";' || first === "'use server';" || first === '"use server"' || first === "'use server'";
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(path, out);
      continue;
    }
    if (/\.(ts|tsx|js|jsx|mts|cts)$/.test(name)) out.push(path);
  }
  return out;
}

type Finding = { file: string; kind: string; detail: string };

function scanUseServerExports(source: string, file: string): Finding[] {
  const findings: Finding[] = [];
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const trimmed = line.trim();
    const loc = `${relative(root, file)}:${index + 1}`;
    if (/^export\s+type\b/.test(trimmed)) {
      findings.push({ file: loc, kind: "export type", detail: trimmed.slice(0, 120) });
    }
    if (/^export\s+interface\b/.test(trimmed)) {
      findings.push({ file: loc, kind: "export interface", detail: trimmed.slice(0, 120) });
    }
    if (/^export\s+\{/.test(trimmed)) {
      findings.push({ file: loc, kind: "export { re-export }", detail: trimmed.slice(0, 120) });
    }
    const fn = trimmed.match(/^export\s+(async\s+)?function\s+(\w+)/);
    if (fn && !fn[1]) {
      findings.push({ file: loc, kind: "non-async function", detail: fn[2]! });
    }
    const binding = trimmed.match(/^export\s+(?:const|let|var)\s+(\w+)\s*=/);
    if (binding) {
      // Look ahead across wrapped assignments for `async`.
      const window = lines.slice(index, index + 6).join("\n");
      const afterEq = window.slice(window.indexOf("=") + 1).trimStart();
      if (!afterEq.startsWith("async")) {
        findings.push({ file: loc, kind: "non-async const/let/var", detail: binding[1]! });
      }
    }
  }
  return findings;
}

describe("use server modules must only export async server actions", () => {
  it("finds no type exports, re-exports, or non-async exports under src/", () => {
    const files = walk(srcRoot).filter((path) => isUseServerFile(readFileSync(path, "utf8")));
    assert.ok(files.length > 10, "expected to find use server files");
    const findings = files.flatMap((path) => scanUseServerExports(readFileSync(path, "utf8"), path));
    assert.deepEqual(
      findings,
      [],
      findings.map((item) => `${item.file} [${item.kind}] ${item.detail}`).join("\n"),
    );
  });
});
