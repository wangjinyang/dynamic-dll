import type { Configuration } from "webpack";
import webpack from "webpack";
import {
  removeSync,
  renameSync,
  existsSync,
  readJSONSync,
  writeJSONSync,
  writeFileSync,
  writeFile,
  mkdirpSync,
  emptyDirSync,
} from "fs-extra";
import lodash from "lodash";
import { join } from "path";
import { createHash } from "crypto";
import {
  DETAULT_PUBLIC_PATH,
  NAME,
  DYNAMIC_DLL_FILENAME,
  METADATA_FILENAME,
} from "./constants";
import { Dep } from "./dep/dep";
import { ModuleSnapshot, ModuleCollector } from "./moduleCollector";
import { StripSourceMapUrlPlugin } from "./webpackPlugins/stripSourceMapUrlPlugin";

export interface BuildOptions {
  outputDir: string;
  webpackConfig?: Configuration;
  shared?: ShareConfig;
  force?: boolean;
}

export type ShareConfig = Record<string, any>;

export interface ModuleInfo {
  libraryPath: string;
  version: string;
}

export interface Metadata {
  hash: string;
  buildHash: string;
  dll: Record<string, ModuleInfo>;
  shared: Record<string, ShareConfig>;
}

export function getMetadata(root: string): Metadata {
  const file = join(getDllDir(root), METADATA_FILENAME);
  if (!existsSync(file)) {
    return {
      hash: "",
      buildHash: "",
      dll: {},
      shared: {},
    };
  }

  return readJSONSync(file) as Metadata;
}

function writeMetadata(root: string, content: Metadata) {
  writeJSONSync(join(root, METADATA_FILENAME), content, {
    spaces: 2,
  });
}

function getDepsDir(dir: string) {
  return join(dir, "deps");
}

export function getDllDir(dir: string) {
  return join(dir, "current");
}

function getDllPendingDir(dir: string) {
  return join(dir, "pending");
}

function getHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").substring(0, 8);
}

/**
 * hash everything that can change the build result
 *
 * @param {BuildOptions} options
 * @returns {string}
 */
function getDepHash(options: BuildOptions): string {
  let content = JSON.stringify({
    webpackConfig: options.webpackConfig,
    shared: options.shared,
  });
  return getHash(content);
}

function getBuildHash(hash: string, snapshot: ModuleSnapshot) {
  return getHash(hash + JSON.stringify(snapshot));
}

function getWebpackConfig({
  deps,
  entry,
  outputDir,
  webpackConfig,
  shared,
}: {
  deps: Dep[];
  webpackConfig: Configuration;
  entry: string;
  outputDir: string;
  shared?: ShareConfig;
}) {
  const name = NAME;
  const dllConfig = lodash.cloneDeep(webpackConfig || {});

  dllConfig.entry = entry;
  if (!dllConfig.output) {
    dllConfig.output = {};
  }
  dllConfig.output.path = join(outputDir);
  dllConfig.output.chunkFilename = `[name].js`;
  dllConfig.output.publicPath = DETAULT_PUBLIC_PATH;
  dllConfig.output.uniqueName = name;
  dllConfig.watch = false;
  // disable library
  if (dllConfig.output.library) delete dllConfig.output.library;
  if (dllConfig.output.libraryTarget) delete dllConfig.output.libraryTarget;

  // merge all deps to vendor
  dllConfig.optimization ||= {};
  dllConfig.optimization.runtimeChunk = false;
  // dllConfig.optimization.splitChunks = false;
  dllConfig.optimization.splitChunks = {
    chunks: "all",
    maxInitialRequests: Infinity,
    minSize: 0,
    cacheGroups: {
      vendor: {
        test: /.+/,
        name(_module: any, _chunks: any, cacheGroupKey: string) {
          return `_${cacheGroupKey}`;
        },
      },
    },
  };

  dllConfig.plugins = dllConfig.plugins || [];
  dllConfig.plugins.push(new StripSourceMapUrlPlugin());
  const exposes = deps.reduce<Record<string, string>>((memo, dep) => {
    memo[`./${dep.request}`] = dep.filename;
    return memo;
  }, {});
  dllConfig.plugins.push(
    new webpack.container.ModuleFederationPlugin({
      library: {
        type: "global",
        name,
      },
      name,
      filename: DYNAMIC_DLL_FILENAME,
      exposes,
      shared,
    }),
  );
  return dllConfig;
}

async function buildDeps({
  snapshot,
  dir,
}: {
  snapshot: ModuleSnapshot;
  dir: string;
}) {
  const deps = Object.entries(snapshot).map(
    ([request, { version, libraryPath }]) => {
      return new Dep({
        request,
        libraryPath,
        version,
        outputPath: dir,
      });
    },
  );
  mkdirpSync(dir);

  // expose files
  await Promise.all(
    deps.map(async dep => {
      const content = await dep.buildExposeContent();
      await writeFile(dep.filename, content, "utf-8");
    }),
  );

  // index file
  writeFileSync(
    join(dir, "index.js"),
    'export default "dynamicDll index.js";',
    "utf-8",
  );

  return deps;
}

async function webpackBuild(opts: {
  deps: Dep[];
  webpackConfig: Configuration;
  entry: string;
  outputDir: string;
  shared?: ShareConfig;
}) {
  const config = getWebpackConfig({
    entry: opts.entry,
    deps: opts.deps,
    webpackConfig: opts.webpackConfig,
    outputDir: opts.outputDir,
    shared: opts.shared,
  });
  return new Promise((resolve, reject) => {
    const compiler = webpack(config);
    compiler.run((err, stats) => {
      if (err || stats?.hasErrors()) {
        if (err) {
          reject(err);
        }
        if (stats) {
          const errorMsg = stats.toString("errors-only");
          reject(new Error(errorMsg));
        }
      } else {
        resolve(stats);
      }
      compiler.close(() => {});
    });
  });
}

export class DLLBuilder {
  private _nextBuild: ModuleSnapshot | null = null;
  private _completeFns: Function[] = [];
  private _isBuilding = false;
  private _collector: ModuleCollector;

  constructor(opts: { collector: ModuleCollector }) {
    this._collector = opts.collector;
  }

  async build(snapshot: ModuleSnapshot, options: BuildOptions) {
    if (this._isBuilding) {
      this._nextBuild = snapshot;
      return;
    }

    let hasError = false;
    this._isBuilding = true;
    let metadata: Metadata | null = null;
    try {
      metadata = await this._buildDll(snapshot, options);
    } catch (error) {
      console.error(`[ Dynamic Dll Compiled Error ]:\n`, error);
      hasError = true;
    }

    this._isBuilding = false;
    this._completeFns.forEach(fn => fn());
    this._completeFns = [];

    if (metadata && !hasError) {
      this._collector.updateSnapshot(snapshot);
      console.log(
        `[ Dynamic Dll Compiled Success ]: if hmr not worked. You may need to reload page by yourself!`,
      );
    }
  }

  private async _buildDll(
    snapshot: ModuleSnapshot,
    options: BuildOptions,
  ): Promise<Metadata | null> {
    const { shared = {}, webpackConfig = {}, outputDir, force } = options;
    const depHash = getDepHash(options);

    const dllDir = getDllDir(outputDir);
    const preMetadata = getMetadata(outputDir);
    const metadata: Metadata = {
      hash: depHash,
      buildHash: preMetadata.buildHash,
      dll: snapshot,
      shared: shared,
    };

    if (
      !force &&
      !this._collector.hasChanged() &&
      preMetadata.hash === metadata.hash
    ) {
      return null;
    }

    const dllPendingDir = getDllPendingDir(outputDir);

    // create a temporal dir to build. This avoids leaving the dll
    // in a corrupted state if there is an error during the build
    if (existsSync(dllPendingDir)) {
      emptyDirSync(dllPendingDir);
    }

    const srcDir = getDepsDir(outputDir);
    const deps = await buildDeps({
      snapshot,
      dir: srcDir,
    });
    await webpackBuild({
      deps,
      entry: join(srcDir, "index.js"),
      shared,
      webpackConfig,
      outputDir: dllPendingDir,
    });

    if (this._nextBuild) {
      const param = this._nextBuild;
      this._nextBuild = null;
      await this._buildDll(param, options);
    }
    metadata.buildHash = getBuildHash(metadata.hash, snapshot);

    // finish build
    writeMetadata(dllPendingDir, metadata);
    removeSync(dllDir);
    renameSync(dllPendingDir, dllDir);

    return metadata;
  }

  onBuildComplete(fn: Function) {
    if (this._isBuilding) {
      this._completeFns.push(fn);
    } else {
      fn();
    }
  }
}
