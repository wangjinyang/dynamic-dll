import type {Compiler, Stats} from 'webpack'
import {lodash} from '@umijs/utils';
import {join} from 'path'
import {DynamicDll, IDepSnapshotModules, IShared} from '../dynamicDll'

const slashCode = '/'.charCodeAt(0)

const NODE_MODULES = /node_modules/

interface IOpts {
    dynamicDll: DynamicDll;
    mfConfig: {
        remotes: {
            [x: string]: string
        },
        shareScope?: string
    };
}

const PLUGIN_NAME = 'DLLBuildDeps'


export class BuildDepPlugin {
    public opts: IOpts
    private depSnapshotModules: IDepSnapshotModules
    private needBuild: boolean
    private shared: IShared
    private _remotes: any
    private timer: null | ReturnType<typeof setTimeout>
    private matchCache: Map<string, string>;

    constructor(opts: IOpts) {
        this.matchCache = new Map()
        this.opts = opts
        const {parseOptions} = require(join(this.opts.dynamicDll.opts.webpackPath, 'webpack/lib/container/options'));
        console.log(require.resolve(join(this.opts.dynamicDll.opts.webpackPath, 'webpack/lib/container/options')))
        console.log(require.resolve(join(this.opts.dynamicDll.opts.webpackPath, 'webpack/lib/container/RemoteModule')))

        this._remotes = parseOptions(
            opts.mfConfig.remotes,
            // @ts-ignore
            item => ({
                external: Array.isArray(item) ? item : [item],
                shareScope: opts.mfConfig.shareScope || 'default',
            }),
            // @ts-ignore
            item => ({
                external: Array.isArray(item.external)
                    ? item.external
                    : [item.external],
                shareScope: item.shareScope || opts.mfConfig.shareScope || 'default',
            }),
        )
        const {depSnapshotModules, shared = {}} = opts.dynamicDll.loadCache()
        this.depSnapshotModules = depSnapshotModules
        this.needBuild = false
        this.shared = this.opts.dynamicDll.opts.shared
        if (!lodash.isEqual(shared, this.shared)) {
            this.needBuild = true
        }
        Array.from(this.depSnapshotModules.keys()).map(library => {
            if (this.opts.dynamicDll.opts.excludeLibs?.some(p => p.test(library))) {
                this.depSnapshotModules.delete(library)
                this.needBuild = true
            }
        })
        this.timer = null
    }

    apply(compiler: Compiler): void {
        const {_remotes: remotes} = this
        compiler.hooks.normalModuleFactory.tap(PLUGIN_NAME, nmf => {
            nmf.hooks.beforeResolve.tap(PLUGIN_NAME, resolveData => {
                const {request} = resolveData;
                const replaceValue = this.matchCache.get(request);
                if (replaceValue) {
                    resolveData.request = replaceValue;
                }
            })
            nmf.hooks.createModule.tap(
                PLUGIN_NAME,
                (_createData, resolveData) => {
                    if (!NODE_MODULES.test(resolveData.context)) {
                        const {createData = {}, request} = resolveData
                        // @ts-ignore
                        const {resource} = createData
                        let isMatch = false
                        if (this.opts.dynamicDll.opts.includesLibs.some(p => p.test(request))) {
                            isMatch = true
                        }
                        if (!isMatch) {
                            isMatch = NODE_MODULES.test(resource as string) &&
                                !this.opts.dynamicDll.opts.excludeLibs.some(p => p.test(request))
                        }
                        if (isMatch) {
                            if (!request.startsWith('.') && !request.includes('!')) {
                                const replaceValue = `${this.opts.dynamicDll.opts.mfName}/${request}`
                                // console.log("-> replaceValue", replaceValue);
                                // @ts-ignore
                                const {resourceResolveData: {descriptionFileData: {version = null}}} = createData
                                const dep = this.depSnapshotModules.get(request)
                                if (!dep) {
                                    this.depSnapshotModules.set(request, {
                                        // replaceValue: replaceValue,
                                        libraryPath: resource!,
                                        version,
                                    })
                                    this.needBuild = true
                                } else {
                                    const {libraryPath: oldLibraryPath, version: oldVersion} = dep
                                    if (oldLibraryPath !== resource || oldVersion !== version) {
                                        this.depSnapshotModules.set(request, {
                                            libraryPath: resource!,
                                            version,
                                        })
                                        this.needBuild = true
                                    }
                                }
                                this.matchCache.set(request, replaceValue)
                                resolveData.request = replaceValue
                                for (const [key, config] of remotes) {
                                    if (
                                        resolveData.request.startsWith(`${key}`) &&
                                        (resolveData.request.length === key.length ||
                                            resolveData.request.charCodeAt(key.length) === slashCode)
                                    ) {
                                        const RemoteModule = require(join(this.opts.dynamicDll.opts.webpackPath, 'webpack/lib/container/RemoteModule'));
                                        return new RemoteModule(
                                            resolveData.request,
                                            // @ts-ignore
                                            config.external.map((external, i) =>
                                                external.startsWith('internal ')
                                                    ? external.slice(9)
                                                    : `webpack/container/reference/${key}${
                                                        i ? `/fallback-${i}` : ''
                                                    }`,
                                            ),
                                            `.${resolveData.request.slice(key.length)}`,
                                            config.shareScope,
                                        )
                                    }
                                }
                            }
                        }
                    }
                },
            )
        })

        compiler.hooks.done.tap(PLUGIN_NAME, (stats: Stats) => {
            if (!stats.hasErrors()) {
                if (this.needBuild) {
                    this.needBuild = false
                    if (this.timer) {
                        clearTimeout(this.timer)
                    }
                    this.timer = setTimeout(() => {
                        this.opts.dynamicDll.buildDeps(this.depSnapshotModules, this.shared)
                    }, 500)
                }
            }
        })
    }
}
