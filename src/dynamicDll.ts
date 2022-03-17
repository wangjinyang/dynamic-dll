import { readFileSync, statSync } from "fs";
import { IncomingMessage, ServerResponse } from "http";
import { extname, join } from "path";
import lodash from "lodash";
import type { Configuration } from "webpack";
import type WebpackChain from "webpack-chain";
import {
  NAME,
  DEFAULT_TMP_DIR_NAME,
  OUTPUT_DIR,
  DETAULT_PUBLIC_PATH,
  CACHE_FILENAME,
  DYNAMIC_DLL_FILENAME,
} from "./constants";
import { lookup } from "mrmime";
import WebpackVirtualModules from "webpack-virtual-modules";
import { DLLBuilder } from "./dllBuilder";
import { ModuleSnapshot, ShareConfig } from "./moduleCollector";
import {
  DynamicDLLPlugin,
  DynamicDLLPluginOptions,
} from "./webpackPlugins/DynamicDLLPlugin";

interface IOpts {
  cwd?: string;
  dir?: string;
  webpackPath?: string;
  dllWebpackConfig?: any;
  include?: RegExp[];
  exclude?: RegExp[];
  shared?: ShareConfig;
}

type IDepKey = string;
type IDepValue = {
  libraryPath: string;
  version: string | null;
};

export type IDepSnapshotModules = Map<IDepKey, IDepValue>;

export class DynamicDll {
  private _dllBuilder: DLLBuilder;
  private _dir: string;
  private _webpackPath: string;
  private _dllPluginOptions: DynamicDLLPluginOptions;

  constructor(opts: IOpts) {
    const cwd = opts.cwd || process.cwd();
    this._dir = opts.dir || join(cwd, DEFAULT_TMP_DIR_NAME);
    this._webpackPath = opts.webpackPath || "webpack";
    this._dllBuilder = new DLLBuilder({
      cwd,
      webpackConfig: opts.dllWebpackConfig,
      outputDir: this._dir,
    });
    this._dllPluginOptions = {
      dllName: NAME,
      shared: opts.shared || {},
      include: opts.include,
      exclude: opts.exclude,
      webpackPath: this._webpackPath,
      cache: join(this._dir, CACHE_FILENAME),
      onSnapshot: snapshot => {
        this.buildDLL(snapshot);
      },
    };
  }

  asyncImport(content: string) {
    return `import('${content}');`;
  }

  async buildDLL(snapshot: ModuleSnapshot): Promise<void> {
    let hasError = false;
    try {
      await this._dllBuilder.build(snapshot);
    } catch (e) {
      console.error(`[ Dynamic Dll Compiled Error ]:\n`, e);
      hasError = true;
    }
    if (!hasError) {
      console.log(
        `[ Dynamic Dll Compiled Success ]: if hmr not worked. You may need to reload page by yourself!`,
      );
    }
  }

  middleware = async (
    req: IncomingMessage,
    res: ServerResponse,
    next: (...args: any[]) => any,
  ) => {
    const url = req.url || "";
    const shouldServe = url.startsWith(DETAULT_PUBLIC_PATH);
    if (!shouldServe) {
      return next();
    }

    this._dllBuilder.onBuildComplete(() => {
      const relativePath = url.replace(
        new RegExp(`^${DETAULT_PUBLIC_PATH}`),
        "/",
      );
      const filePath = join(this._dir, OUTPUT_DIR, relativePath);
      const { mtime } = statSync(filePath);
      // Get the last modification time of the file and convert the time into a world time string
      let lastModified = mtime.toUTCString();
      const ifModifiedSince = req.headers["if-modified-since"];

      // Tell the browser what time to use the browser cache without asking the server directly, but it seems that it is not effective, and needs to learn why.
      res.setHeader("cache-control", "no-cache");

      if (ifModifiedSince && lastModified <= ifModifiedSince) {
        // If the request header contains the request ifModifiedSince and the file is not modified, it returns 304
        res.writeHead(304, "Not Modified");
        res.end();
        return;
      }
      // Return the header Last-Modified for the last modification time of the current request file
      res.setHeader("Last-Modified", lastModified);
      // Return file
      res.setHeader("content-type", lookup(extname(url)) || "text/plain");
      const content = readFileSync(filePath);
      res.statusCode = 200;
      res.end(content);
    });
  };

  modifyWebpackChain = (chain: WebpackChain): WebpackChain => {
    const webpack = require(this._webpackPath);
    const entries = chain.entryPoints.entries();
    const entry = Object.keys(entries).reduce((acc, name) => {
      acc[name] = entries[name].values();
      return acc;
    }, {} as Record<string, string[]>);
    const { asyncEntry, virtualModules } = this._makeAsyncEntry(entry);

    chain.merge({
      entry: asyncEntry,
    });
    chain
      .plugin("dynamic-virtual-modules")
      .use(WebpackVirtualModules, [virtualModules]);
    chain
      .plugin("dynamic-dll-mf")
      .use(webpack.container.ModuleFederationPlugin, [this._getMFconfig()]);
    chain
      .plugin("dynamic-dll-plugin")
      .use(DynamicDLLPlugin, [this._dllPluginOptions]);
    return chain;
  };

  modifyWebpack = (config: Configuration): Configuration => {
    const { asyncEntry, virtualModules } = this._makeAsyncEntry(config.entry);

    config.entry = asyncEntry;
    const webpack = require(this._webpackPath);
    if (!config.plugins) {
      config.plugins = [];
    }
    config.plugins.push(
      new WebpackVirtualModules(virtualModules),
      new webpack.container.ModuleFederationPlugin(this._getMFconfig()),
      new DynamicDLLPlugin(this._dllPluginOptions),
    );

    return config;
  };

  private _makeAsyncEntry(entry: any) {
    const asyncEntry: Record<string, string> = {};
    const virtualModules: Record<string, string> = {};
    // ensure entry object type
    const entryObject = (
      lodash.isString(entry) || lodash.isArray(entry)
        ? { main: ([] as any).concat(entry) }
        : entry
    ) as Record<string, string[]>;

    for (const key of Object.keys(entryObject)) {
      const virtualPath = `./dynamic-dll-virtual-entry/${key}.js`;
      const virtualContent: string[] = [];
      const entryFiles = lodash.isArray(entryObject[key])
        ? entryObject[key]
        : ([entryObject[key]] as unknown as string[]);
      for (let entry of entryFiles) {
        virtualContent.push(this.asyncImport(entry));
      }
      virtualModules[virtualPath] = virtualContent.join("\n");
      asyncEntry[key] = virtualPath;
    }

    return {
      asyncEntry,
      virtualModules,
    };
  }

  private _getMFconfig() {
    return {
      name: "__",
      remotes: {
        // [NAME]: `${NAME}@${DETAULT_PUBLIC_PATH}${DYNAMIC_DLL_FILENAME}`,
        // https://webpack.js.org/concepts/module-federation/#promise-based-dynamic-remotes
        [NAME]: `
promise new Promise(resolve => {
  const remoteUrl = '${DETAULT_PUBLIC_PATH}${DYNAMIC_DLL_FILENAME}';
  const script = document.createElement('script');
  script.src = remoteUrl;
  script.onload = () => {
    // the injected script has loaded and is available on window
    // we can now resolve this Promise
    const proxy = {
      get: (request) => {
        const promise = window['${NAME}'].get(request);
        return promise;
      },
      init: (arg) => {
        try {
          return window['${NAME}'].init(arg);
        } catch(e) {
          console.log('remote container already initialized');
        }
      }
    }
    resolve(proxy);
  }
  // inject this script with the src set to the versioned remoteEntry.js
  document.head.appendChild(script);
})`.trim(),
      },
    };
  }
}
