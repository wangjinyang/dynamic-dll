import path from "path";

const pkg = require(path.resolve(__dirname, "..", "package.json"));

export const version = pkg.version;

export function getDepsDir(dir: string) {
  return path.join(dir, "deps");
}

export function getDllDir(dir: string) {
  return path.join(dir, "current");
}

export function getDllPendingDir(dir: string) {
  return path.join(dir, "pending");
}
