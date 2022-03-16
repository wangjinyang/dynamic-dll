import { readFileSync } from "fs";
import { MF_VA_PREFIX } from "../constants";
import { DynamicDll } from "../dynamicDll";
import { getExposeFromContent } from "./getExposeFromContent";

function trimFileContent(content: string) {
  return content.trim() + "\n";
}

export class Dep {
  public request: string;
  public version: string | null;
  public cwd: string;
  public libraryPath: string;
  public outputPath: string;
  public dynamicDll: DynamicDll;

  constructor(opts: {
    request: string;
    libraryPath: string;
    cwd: string;
    version: string | null;
    dynamicDll: DynamicDll;
  }) {
    this.request = opts.request;
    this.libraryPath = opts.libraryPath;
    this.cwd = opts.cwd;
    this.dynamicDll = opts.dynamicDll;
    this.version = opts.version;
    const name = this.request.replace(/\//g, "_").replace(/:/g, "_");
    this.outputPath = `${MF_VA_PREFIX}${name}.js`;
  }

  async buildExposeContent() {
    // node natives
    // @ts-ignore
    const isNodeNatives = !!process.binding("natives")[this.file];
    if (isNodeNatives) {
      return trimFileContent(`
import _ from '${this.request}';
export default _;
export * from '${this.request}';
      `);
    }

    const content = readFileSync(this.libraryPath, "utf-8");

    return await getExposeFromContent({
      content,
      filePath: this.libraryPath,
      dep: this,
    });
  }

  static buildDeps(opts: {
    deps: Map<string, { version: string | null; libraryPath: string }>;
    cwd: string;
    dynamicDll: DynamicDll;
  }) {
    return Array.from(opts.deps.entries()).map(
      ([request, { version, libraryPath }]) => {
        return new Dep({
          request,
          libraryPath,
          version,
          cwd: opts.cwd,
          dynamicDll: opts.dynamicDll,
        });
      }
    );
  }
}
