import type { Compiler, Stats } from "webpack";
import {
  ModuleCollector,
  ShareConfig,
  ModuleSnapshot,
} from "../moduleCollector";

export type SnapshotListener = (snapshot: ModuleSnapshot) => void;

export interface DynamicDLLPluginOptions {
  cache: string;
  shared: ShareConfig;
  include?: RegExp[];
  exclude?: RegExp[];
  webpackPath: string;
  dllName: string;
  onSnapshot: SnapshotListener;
  shareScope?: string;
}

const PLUGIN_NAME = "DLLBuildDeps";

export class DynamicDLLPlugin {
  private _collector: ModuleCollector;
  private _webpackPath: string;
  private _dllName: string;
  private _shareScope?: string;
  private _timer: null | ReturnType<typeof setTimeout>;
  private _matchCache: Map<string, string>;
  private _onSnapshot: SnapshotListener;

  constructor(opts: DynamicDLLPluginOptions) {
    this._webpackPath = opts.webpackPath;
    this._dllName = opts.dllName;
    this._shareScope = opts.shareScope;
    this._onSnapshot = opts.onSnapshot;
    this._collector = new ModuleCollector({
      cache: opts.cache,
      shared: opts.shared,
      include: opts.include,
      exclude: opts.exclude,
    });
    this._matchCache = new Map();
    this._timer = null;
  }

  apply(compiler: Compiler): void {
    compiler.hooks.normalModuleFactory.tap(PLUGIN_NAME, nmf => {
      nmf.hooks.beforeResolve.tap(PLUGIN_NAME, resolveData => {
        const { request } = resolveData;
        const replaceValue = this._matchCache.get(request);
        if (replaceValue) {
          resolveData.request = replaceValue;
        }
      });
      nmf.hooks.createModule.tap(PLUGIN_NAME, (_createData, resolveData) => {
        const collector = this._collector;
        const { createData = {}, request } = resolveData;
        const { resource = "" } = createData;
        if (
          !collector.shouldCollect({
            request,
            context: resolveData.context,
            resource,
          })
        ) {
          return;
        }
        const name = this._dllName;
        const replaceValue = `${name}/${request}`;
        // console.log("-> replaceValue", replaceValue);
        const {
          resourceResolveData: { descriptionFileData: { version = null } } = {},
        } = createData;
        collector.add(request, {
          libraryPath: resource,
          version,
        });
        resolveData.request = replaceValue;
        this._matchCache.set(request, replaceValue);

        const RemoteModule = require(`${this._webpackPath}/lib/container/RemoteModule`);
        console.log("resolveData.request", resolveData.request);
        return new RemoteModule(
          resolveData.request,
          [`webpack/container/reference/${name}`],
          `.${resolveData.request.slice(name.length)}`,
          this._shareScope || "default",
        );
      });
    });

    compiler.hooks.done.tap(PLUGIN_NAME, (stats: Stats) => {
      if (!stats.hasErrors()) {
        if (this._collector.hasUpdate()) {
          if (this._timer) {
            clearTimeout(this._timer);
          }
          this._timer = setTimeout(() => {
            const snapshot = this._collector.snapshot();
            this._onSnapshot(snapshot);
          }, 500);
        }
      }
    });
  }
}
