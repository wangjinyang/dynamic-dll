import {fsExtra, lodash} from '@umijs/utils';
import {writeFileSync} from 'fs';
import {join} from 'path';
import {MF_DIST, MF_PUBLIC, REMOTE_FILE_FULL} from './constants';
import {Dep} from './dep/dep';
import {DynamicDll, IShared} from './dynamicDll';
import {StripSourceMapUrlPlugin} from './webpackPlugins/stripSourceMapUrlPlugin';

interface IOpts {
    dynamicDll: DynamicDll;
}

export class DepBuilder {
    public opts: IOpts;
    public completeFns: Function[] = [];
    public isBuilding = false;

    constructor(opts: IOpts) {
        this.opts = opts;
    }

    async buildWithWebpack(opts: {
        onBuildComplete: Function;
        deps: Dep[];
        shared?: IShared;
    }) {
        const config = this.getWebpackConfig({
            deps: opts.deps,
            shared: opts.shared
        });
        return new Promise((resolve, reject) => {
            const compiler = this.opts.dynamicDll.opts.webpackLib(config);
            compiler.run((err, stats) => {
                opts.onBuildComplete();
                if (err || stats?.hasErrors()) {
                    if (err) {
                        reject(err);
                    }
                    if (stats) {
                        const errorMsg = stats.toString('errors-only');
                        reject(new Error(errorMsg));
                    }
                } else {
                    resolve(stats);
                }
                compiler.close(() => {
                });
            });
        });
    }

    async build(opts: { deps: Dep[]; shared: IShared }) {
        this.isBuilding = true;
        await this.writeMFFiles({deps: opts.deps});
        const newOpts = {
            ...opts,
            onBuildComplete: () => {
                this.isBuilding = false;
                this.completeFns.forEach(fn => fn());
                this.completeFns = [];
            }
        };
        await this.buildWithWebpack(newOpts);
    }

    onBuildComplete(fn: Function) {
        if (this.isBuilding) {
            this.completeFns.push(fn);
        } else {
            fn();
        }
    }

    async writeMFFiles(opts: { deps: Dep[] }) {
        const tmpBase = this.opts.dynamicDll.opts.tmpBase;
        fsExtra.mkdirpSync(tmpBase);

        // expose files
        for (const dep of opts.deps) {
            const content = await dep.buildExposeContent();
            writeFileSync(join(tmpBase, dep.filePath), content, 'utf-8');
        }

        // index file
        writeFileSync(join(this.opts.dynamicDll.opts.tmpBase, 'index.js'), 'export default "dynamicDll index.js";', 'utf-8');
    }

    getWebpackConfig(opts: { deps: Dep[]; shared?: IShared }) {
        const mfName = this.opts.dynamicDll.opts.mfName;
        const depConfig = lodash.cloneDeep(this.opts.dynamicDll.depConfig!);

        depConfig.entry = join(this.opts.dynamicDll.opts.tmpBase!, 'index.js');
        depConfig.output!.path = join(this.opts.dynamicDll.opts.tmpBase!, MF_DIST);
        depConfig.output!.chunkFilename = `[name].js`;
        depConfig.output!.publicPath = join(MF_PUBLIC, MF_DIST);
        depConfig.output!.uniqueName = mfName;
        // disable devtool
        depConfig.watch = false;
        // disable library
        if (depConfig.output?.library) delete depConfig.output.library;
        if (depConfig.output?.libraryTarget) delete depConfig.output.libraryTarget;

        // merge all deps to vendor
        depConfig.optimization ||= {};
        depConfig.optimization.runtimeChunk = false;
        // depConfig.optimization.splitChunks = false;
        depConfig.optimization.splitChunks = {
            chunks: 'all',
            maxInitialRequests: Infinity,
            minSize: 0,
            cacheGroups: {
                vendor: {
                    test: /.+/,
                    name(_module: any, _chunks: any, cacheGroupKey: string) {
                        return `_${cacheGroupKey}`;
                    }
                }
            }
        };

        depConfig.plugins = depConfig.plugins || [];
        depConfig.plugins.push(
            new StripSourceMapUrlPlugin({
                webpackLib: this.opts.dynamicDll.opts.webpackLib
            })
        );
        const exposes = opts.deps.reduce<Record<string, string>>((memo, dep) => {
            memo[`./${dep.file}`] = join(this.opts.dynamicDll.opts.tmpBase!, dep.filePath);
            return memo;
        }, {});
        depConfig.plugins.push(
            new this.opts.dynamicDll.opts.webpackLib.container.ModuleFederationPlugin({
                library: {
                    type: 'global',
                    name: mfName
                },
                name: mfName,
                filename: REMOTE_FILE_FULL,
                exposes,
                shared: opts.shared || {}
            })
        );
        return depConfig;
    }
}
