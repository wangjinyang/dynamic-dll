import { Metadata, ModuleInfo } from "./dllBuilder";

const NODE_MODULES = /node_modules/;

export interface ModuleCollectorOptions {
  metadata: Metadata;
  include?: RegExp[];
  exclude?: RegExp[];
}

export interface ModuleSnapshot {
  [key: string]: ModuleInfo;
}

export class ModuleCollector {
  private _include;
  private _exclude;
  private _modules!: Record<string, ModuleInfo>;
  private _changed!: boolean;

  constructor(options: ModuleCollectorOptions) {
    this._include = options.include || [];
    this._exclude = options.exclude || [];
    this.updateSnapshot(options.metadata.dll);
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

  hasChanged() {
    return this._changed;
  }

  add(id: string, { libraryPath, version }: ModuleInfo) {
    const modules = this._modules;
    const mod = modules[id];
    if (!mod) {
      modules[id] = {
        libraryPath,
        version,
      };
      this._changed = true;
    } else {
      const { version: oldVersion } = mod;
      if (oldVersion !== version) {
        modules[id] = {
          libraryPath,
          version,
        };
        this._changed = true;
      }
    }
  }

  snapshot(): ModuleSnapshot {
    return { ...this._modules };
  }

  updateSnapshot(snapshot: ModuleSnapshot) {
    this._changed = false;
    this._modules = snapshot;
  }
}
