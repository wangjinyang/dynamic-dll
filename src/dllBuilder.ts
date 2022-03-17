import type { Configuration } from "webpack";
import webpack from "webpack";
import fsExtra from "fs-extra";
import lodash from "lodash";
import { writeFileSync } from "fs";
import { join } from "path";
import {
  OUTPUT_DIR,
  DETAULT_PUBLIC_PATH,
  NAME,
  DYNAMIC_DLL_FILENAME,
} from "./constants";
import { Dep } from "./dep/dep";
import { ModuleSnapshot, ShareConfig } from "./moduleCollector";
import { StripSourceMapUrlPlugin } from "./webpackPlugins/stripSourceMapUrlPlugin";

interface IOpts {
  cwd: string;
  webpackConfig?: Configuration;
  outputDir: string;
}

export class DLLBuilder {
  private _nextBuild: ModuleSnapshot | null = null;
  private _cwd: string;
  private _webpackConfig: Configuration;
  private _completeFns: Function[] = [];
  private _outputDir: string;
  private _isBuilding = false;

  constructor(opts: IOpts) {
    this._cwd = opts.cwd;
    this._webpackConfig = opts.webpackConfig || {};
    this._outputDir = opts.outputDir;
  }

  async buildWithWebpack(opts: {
    onBuildComplete: Function;
    deps: Dep[];
    shared: ShareConfig;
  }) {
    const config = this.getWebpackConfig({
      deps: opts.deps,
      shared: opts.shared,
    });
    return new Promise((resolve, reject) => {
      const compiler = webpack(config);
      compiler.run((err, stats) => {
        opts.onBuildComplete();
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

  async build(snapshot: ModuleSnapshot) {
    if (this._isBuilding) {
      this._nextBuild = snapshot;
      return;
    }

    this._isBuilding = true;
    const { modules, shared } = snapshot;
    const deps = Dep.buildDeps({
      modules: modules,
      cwd: this._cwd,
    });
    await this.writeMFFiles({ deps });
    const newOpts = {
      deps,
      shared,
      onBuildComplete: () => {
        this._isBuilding = false;
        this._completeFns.forEach(fn => fn());
        this._completeFns = [];
      },
    };
    await this.buildWithWebpack(newOpts);
    if (this._nextBuild) {
      const param = this._nextBuild;
      this._nextBuild = null;
      await this.build(param);
    }
  }

  onBuildComplete(fn: Function) {
    if (this._isBuilding) {
      this._completeFns.push(fn);
    } else {
      fn();
    }
  }

  async writeMFFiles(opts: { deps: Dep[] }) {
    const outputDir = this._outputDir;
    fsExtra.mkdirpSync(outputDir);

    // expose files
    for (const dep of opts.deps) {
      const content = await dep.buildExposeContent();
      writeFileSync(join(outputDir, dep.outputPath), content, "utf-8");
    }

    // index file
    writeFileSync(
      join(this._outputDir, "index.js"),
      'export default "dynamicDll index.js";',
      "utf-8",
    );
  }

  getWebpackConfig(opts: { deps: Dep[]; shared: ShareConfig }) {
    const name = NAME;
    const depConfig = lodash.cloneDeep(this._webpackConfig || {});

    depConfig.entry = join(this._outputDir, "index.js");
    if (!depConfig.output) {
      depConfig.output = {};
    }
    depConfig.output.path = join(this._outputDir, OUTPUT_DIR);
    depConfig.output.chunkFilename = `[name].js`;
    depConfig.output.publicPath = DETAULT_PUBLIC_PATH;
    depConfig.output.uniqueName = name;
    depConfig.watch = false;
    // disable library
    if (depConfig.output.library) delete depConfig.output.library;
    if (depConfig.output.libraryTarget) delete depConfig.output.libraryTarget;

    // merge all deps to vendor
    depConfig.optimization ||= {};
    depConfig.optimization.runtimeChunk = false;
    // depConfig.optimization.splitChunks = false;
    depConfig.optimization.splitChunks = {
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

    depConfig.plugins = depConfig.plugins || [];
    depConfig.plugins.push(new StripSourceMapUrlPlugin());
    const exposes = opts.deps.reduce<Record<string, string>>((memo, dep) => {
      memo[`./${dep.request}`] = join(this._outputDir, dep.outputPath);
      return memo;
    }, {});
    depConfig.plugins.push(
      new webpack.container.ModuleFederationPlugin({
        library: {
          type: "global",
          name,
        },
        name,
        filename: DYNAMIC_DLL_FILENAME,
        exposes,
        shared: opts.shared,
      }),
    );
    return depConfig;
  }
}
