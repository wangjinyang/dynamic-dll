import {existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'fs';
import {IncomingMessage, ServerResponse} from 'http';
import {extname, join, dirname} from 'path';
import type { Configuration, container } from 'webpack';
import type webpack from 'webpack';
import {DEFAULT_MF_NAME, DEFAULT_TMP_DIR_NAME, MF_DIST, MF_PUBLIC, REMOTE_FILE_FULL} from './constants'
import {lookup} from 'mrmime';
import {Dep} from './dep/dep';
import {DepBuilder} from './depBuilder';
import {BuildDepPlugin} from './webpackPlugins/buildDepPlugin'
import type WebpackChain from 'webpack-chain';

interface IOpts {
    cwd?: string;
    mfName?: string;
    mode?: 'development' | 'production';
    tmpBase?: string;
    webpackLib: typeof webpack;
    webpackPath?: string;
    depBuildConfig: any;
    includesLibs: RegExp[]
    excludeLibs: RegExp[]
    shared?: IShared
}

type IDepKey = string;
type IDepValue = {
    libraryPath: string;
    version: string | null;
};

export type IDepSnapshotModules = Map<IDepKey, IDepValue>;
type FirstArgument<T> = T extends (arg1: infer U, ...args: any[]) => any
    ? U
    : any;

export type IShared = FirstArgument<container.ModuleFederationPlugin>['shared'];
type DynamicDllOpts = IOpts &
    Required<Pick<IOpts, 'cwd' | 'mfName' | 'mode' | 'tmpBase' | 'webpackPath'>>;

export class DynamicDll {
    public opts: DynamicDllOpts;
    public alias: Record<string, string> = {};
    public externals: (Record<string, string> | Function)[] = [];
    public depBuilder: DepBuilder;
    public depConfig: Configuration | null = null;
    public task: IDepSnapshotModules[];
    private cacheFilePath: string;

    constructor(opts: IOpts) {
        this.opts = opts as DynamicDllOpts;
        this.opts.mfName = this.opts.mfName || DEFAULT_MF_NAME;
        this.opts.cwd = this.opts.cwd || process.cwd();
        this.opts.tmpBase =
            this.opts.tmpBase || join(this.opts.cwd, DEFAULT_TMP_DIR_NAME);
        this.opts.mode = this.opts.mode || 'development';
        this.opts.webpackPath = this.opts.webpackPath || '';
        this.opts.includesLibs = this.opts.includesLibs || [];
        this.opts.excludeLibs = this.opts.excludeLibs || [];
        this.cacheFilePath = join(this.opts.tmpBase, 'DLL_DEPS_CACHE.json');
        this.depBuilder = new DepBuilder({dynamicDll: this});
        this.task = [];
    }

    asyncImport(content: string) {
        return `import('${content}');`;
    }

    loadCache(): {
        depSnapshotModules: IDepSnapshotModules;
        shared: IShared;
    } {
        if (existsSync(this.cacheFilePath)) {
            console.log('Dynamic Dll restore cache');
            const {depSnapshotModules, shared = {}} = JSON.parse(
                readFileSync(this.cacheFilePath, 'utf-8')
            );
            return {
                depSnapshotModules: new Map(depSnapshotModules),
                shared
            };
        }
        return {
            depSnapshotModules: new Map(),
            shared: {}
        };
    }

    writeCache(depSnapshotModules: IDepSnapshotModules, shared: IShared) {
        const cacheDir = dirname(this.cacheFilePath);
        if(!existsSync) mkdirSync(cacheDir);
        console.log('Dynamic DLL write cache');
        writeFileSync(
            this.cacheFilePath,
            JSON.stringify(
                {
                    depSnapshotModules: Array.from(depSnapshotModules),
                    shared
                },
                null,
                2
            ),
            'utf-8'
        );
    }

    async buildDeps(
        depSnapshotModules: IDepSnapshotModules,
        shared: IShared
    ): Promise<void> {
        this.task = [depSnapshotModules];
        if (this.depBuilder.isBuilding) {
            return;
        }
        if (!this.task.length) {
            return;
        }
        const lastDepSnapshotModules = this.task.pop();
        const deps = Dep.buildDeps({
            deps: lastDepSnapshotModules!,
            cwd: this.opts.cwd,
            dynamicDll: this
        });
        let hasError = false;
        try {
            await this.depBuilder.build({
                deps,
                shared
            });
        } catch (e) {
            console.error(`[ Dynamic Dll Compiled Error ]:\n`, e);
            hasError = true;
        }
        if (!hasError) {
            console.log(
                `[ Dynamic Dll Compiled Success ]: if hmr not worked. You may need to reload page by yourself!`
            );
            this.writeCache(lastDepSnapshotModules!, shared);
        }
        if (this.task.length) {
            return await this.buildDeps(this.task[0], shared);
        }
    }

    middleware = async (req: IncomingMessage, res: ServerResponse, next: (...args: any[]) => any) => {
        const url = req.url || '';
        const isMF = url.startsWith(MF_PUBLIC);
        if (isMF) {
            this.depBuilder.onBuildComplete(() => {
                const relativePath = url.replace(
                    new RegExp(`^${MF_PUBLIC}`),
                    '/'
                );
                const filePath = join(this.opts.tmpBase!, relativePath);
                const {mtime} = statSync(filePath);
                // Get the last modification time of the file and convert the time into a world time string
                let lastModified = mtime.toUTCString();
                const ifModifiedSince = req.headers['if-modified-since'];

                // Tell the browser what time to use the browser cache without asking the server directly, but it seems that it is not effective, and needs to learn why.
                res.setHeader('cache-control', 'no-cache');

                if (ifModifiedSince && lastModified === ifModifiedSince) {
                    // If the request header contains the request ifModifiedSince and the file is not modified, it returns 304
                    res.writeHead(304, 'Not Modified');
                    res.end();
                    return;
                }
                // Return the header Last-Modified for the last modification time of the current request file
                res.setHeader('Last-Modified', lastModified);
                // Return file
                res.setHeader(
                    'content-type',
                    lookup(extname(url)) || 'text/plain'
                );
                const content = readFileSync(filePath);
                res.statusCode = 200;
                res.end(content);
            });
        } else {
            next();
        }
    }

    modifyWebpackChain = (chain: WebpackChain): WebpackChain => {

        const {mfName} = this.opts;

        const mfConfig = {
            name: '__',
            remotes: {
                [mfName]: `${mfName}@${MF_PUBLIC}${MF_DIST}${REMOTE_FILE_FULL}`
            }
        }

        chain.plugin('dynamic-dll-mf').use(this.opts.webpackLib.container.ModuleFederationPlugin, [
            mfConfig
        ]);

        chain.plugin('dll-build-dep-plugin').use(BuildDepPlugin, [
            {
                dynamicDll: this,
                mfConfig,
            }
        ]);
        return chain;
    }

    modifyWebpack = (config: Configuration): Configuration => {
        if(!config.plugins){
            config.plugins = []
        }
        const {mfName} = this.opts;

        const mfConfig = {
            name: '__',
            remotes: {
                [mfName]: `${mfName}@${MF_PUBLIC}${MF_DIST}${REMOTE_FILE_FULL}`
            }
        };


        config.plugins.push(
            new this.opts.webpackLib.container.ModuleFederationPlugin(mfConfig),
            new BuildDepPlugin({
                dynamicDll: this,
                mfConfig,
            })
        )

        return config;
    }

}
