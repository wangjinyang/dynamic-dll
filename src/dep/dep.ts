import {readFileSync} from 'fs';
import {MF_VA_PREFIX} from '../constants';
import {DynamicDll} from '../dynamicDll';
import {getExposeFromContent} from './getExposeFromContent';

function trimFileContent(content: string) {
    return content.trim() + '\n';
}

export class Dep {
    public file: string;
    public version: string | null;
    public cwd: string;
    public libraryPath: string;
    public filePath: string;
    public dynamicDll: DynamicDll;

    constructor(opts: {
        file: string;
        libraryPath: string;
        cwd: string;
        version: string | null;
        dynamicDll: DynamicDll;
    }) {
        this.file = opts.file;
        this.libraryPath = opts.libraryPath;
        this.cwd = opts.cwd;
        this.dynamicDll = opts.dynamicDll;
        this.version = opts.version;
        const shortFile = this.file;
        const normalizedFile = shortFile.replace(/\//g, '_').replace(/:/g, '_');
        this.filePath = `${MF_VA_PREFIX}${normalizedFile}.js`;
    }

    async buildExposeContent() {
        // node natives
        // @ts-ignore
        const isNodeNatives = !!process.binding('natives')[this.file];
        if (isNodeNatives) {
            return trimFileContent(`
import _ from '${this.file}';
export default _;
export * from '${this.file}';
      `);
        }

        const content = readFileSync(this.libraryPath, 'utf-8');

        return await getExposeFromContent({
            content,
            filePath: this.libraryPath,
            dep: this
        });
    }

    static buildDeps(opts: {
        deps: Map<string, { version: string | null, libraryPath: string }>;
        cwd: string;
        dynamicDll: DynamicDll;
    }) {
        return Array.from(opts.deps.entries()).map(([file, {version, libraryPath}]) => {
            return new Dep({
                file,
                libraryPath,
                version,
                cwd: opts.cwd,
                dynamicDll: opts.dynamicDll
            });
        });
    }
}
