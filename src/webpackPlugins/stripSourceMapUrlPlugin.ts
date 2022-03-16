import { Compiler } from "webpack";

export class StripSourceMapUrlPlugin {
  apply(compiler: Compiler): void {
    compiler.hooks.compilation.tap("StripSourceMapUrlPlugin", compilation => {
      compilation.hooks.processAssets.tap(
        {
          name: "StripSourceMapUrlPlugin",
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_DERIVED,
        },
        assets => {
          Object.keys(assets)
            .filter(filename => /\.js$/.test(filename))
            .forEach(filename => {
              const asset = assets[filename];
              const source = asset
                .source()
                .toString()
                .replace(/# sourceMappingURL=(.+?\.map)/g, "# $1");
              compilation.updateAsset(
                filename,
                new compiler.webpack.sources.RawSource(source),
              );
            });
        },
      );
    });
  }
}
