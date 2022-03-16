import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import lodash from "lodash";
import path from "path";

const NODE_MODULES = /node_modules/;

export type ShareConfig = Record<string, any>;

export interface ModuleCollectorOptions {
  cache: string;
  shared: ShareConfig;
  include?: RegExp[];
  exclude?: RegExp[];
}

export interface ModuleSnapshot {
  modules: [string, ModuleInfo][];
  shared: ShareConfig;
}

export interface ModuleInfo {
  libraryPath: string;
  version: string;
}

export class ModuleCollector {
  private _include;
  private _exclude;
  private _modules = new Map<string, ModuleInfo>();
  private _shared: ShareConfig = {};
  private _update = false;
  private _cache: string;

  constructor(options: ModuleCollectorOptions) {
    this._cache = options.cache;
    this._shared = options.shared;
    this._include = options.include || [];
    this._exclude = options.exclude || [];
    this._loadCache();
  }

  shouldCollect({
    request,
    context,
    resource,
  }: {
    request: string;
    context: string;
    resource: string;
  }): boolean {
    if (request.startsWith(".")) {
      return false;
    }

    // only inlucde modules that user has referenced in his src/
    if (NODE_MODULES.test(context)) {
      return false;
    }

    if (this._include.some(p => p.test(request))) {
      return true;
    }

    if (this._exclude.some(p => p.test(request))) {
      return false;
    }

    return NODE_MODULES.test(resource);
  }

  hasUpdate() {
    return this._update;
  }

  add(id: string, { libraryPath, version }: ModuleInfo) {
    const modules = this._modules;
    const mod = modules.get(id);
    if (!mod) {
      modules.set(id, {
        libraryPath,
        version,
      });
      this._update = true;
    } else {
      const { libraryPath: oldLibraryPath, version: oldVersion } = mod;
      if (oldLibraryPath !== libraryPath || oldVersion !== version) {
        modules.set(id, {
          libraryPath,
          version,
        });
        this._update = true;
      }
    }
  }

  snapshot(): ModuleSnapshot {
    this._update = false;

    setImmediate(() => {
      this._saveCache();
    });

    return {
      modules: Array.from(this._modules),
      shared: this._shared,
    };
  }

  private _loadCache() {
    if (!existsSync(this._cache)) {
      return;
    }

    const { depSnapshotModules, shared = {} } = JSON.parse(
      readFileSync(this._cache, "utf-8"),
    );

    this._modules = new Map(depSnapshotModules);
    if (!lodash.isEqual(this._shared, shared)) {
      this._update = true;
    }
    this._shared = shared;
  }

  private _saveCache() {
    const cacheDir = path.dirname(this._cache);
    if (!existsSync) mkdirSync(cacheDir);

    writeFileSync(
      this._cache,
      JSON.stringify(
        {
          depSnapshotModules: Array.from(this._modules),
          shared: this._shared,
        },
        null,
        2,
      ),
      "utf-8",
    );
  }
}
