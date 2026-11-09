import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";

/** Lets `node --test` load extensionless TypeScript imports the same way Next does. */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/headers") {
    return nextResolve(pathToFileURL(resolvePath(process.cwd(), "scripts/shims/next-headers.mjs")).href, context);
  }
  if (specifier.startsWith("@/")) {
    let abs = resolvePath(process.cwd(), "src", specifier.slice(2));
    if (!existsSync(abs)) {
      if (existsSync(`${abs}.ts`)) abs = `${abs}.ts`;
      else if (existsSync(`${abs}.tsx`)) abs = `${abs}.tsx`;
    }
    return nextResolve(pathToFileURL(abs).href, context);
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    try {
      return await nextResolve(specifier, context);
    } catch (err) {
      if (err && err.code === "ERR_MODULE_NOT_FOUND" && !specifier.endsWith(".ts")) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw err;
    }
  }
  return nextResolve(specifier, context);
}
