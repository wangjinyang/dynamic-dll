import webpack from "webpack";
import WebpackChain from "webpack-chain";
import path from "path";
import { StripSourceMapUrlPlugin } from "./plugins/stripSourceMapUrlPlugin";
import type { Configuration } from "webpack";

export type ShareConfig = Record<string, any>;

export interface ConfigOptions {
  name: string;
  entry: string;
  filename: string;
  outputDir: string;
  publicPath: string;
  shared?: ShareConfig;
  externals: Configuration["externals"];
  esmFullSpecific: Boolean;
  exposes: Record<string, string>;
}

const moduleFileExtensions = [
  ".web.mjs",
  ".mjs",
  ".web.cjs",
  ".cjs",
  ".web.js",
  ".js",
  ".json",
  ".web.jsx",
  ".jsx",
];

export function getConfig({
  name,
  entry,
  filename,
  outputDir,
  publicPath,
  shared,
  externals,
  esmFullSpecific,
  exposes,
}: ConfigOptions) {
  const config = new WebpackChain();
  config.mode("development");
  config.entry("main").add(entry);
  config.devtool("cheap-module-source-map");
  config.bail(true);
  config.watch(false);
  config.set("infrastructureLogging", {
    level: "none",
  });
  config.output.merge({
    pathinfo: false,
    path: outputDir,
    chunkFilename: "[name].js",
    publicPath,
    uniqueName: name,
  });
  config.performance.hints(false);

  config.optimization.merge({
    emitOnErrors: true,
    checkWasmTypes: false,
    // TODO: need to use DefinePlugin to set process.env.NODE_ENV
    nodeEnv: false,
    runtimeChunk: false,
    minimize: false,
    realContentHash: false,
  });

  config.optimization.splitChunks({
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
  });

  config.resolve.extensions.merge(moduleFileExtensions);

  config.module.set("strictExportPresence", true);

  // Handle node_modules packages that contain sourcemaps
  config.module
    .rule("pre")
    .enforce("pre")
    .test(/\.(js|mjs|cjs|jsx)$/)
    .use("source-map-loader")
    .loader(require.resolve("source-map-loader"));

  // x-ref: https://github.com/webpack/webpack/issues/11467
  if (!esmFullSpecific) {
    config.module
      .rule("webpackPatch")
      .test(/\.(c|m)?js/)
      .resolve.set("fullySpecified", false);
  }

  config.module
    .rule("js")
    .test(/\.(js|mjs|cjs|jsx)$/)
    .exclude.add(/@babel(?:\/|\\{1,2})runtime/)
    .end()
    .use("babel-loader")
    .loader(require.resolve("babel-loader"))
    .options({
      babelrc: false,
      configFile: false,
      compact: false,
      sourceType: "unambiguous",
      presets: [
        [
          require.resolve("@babel/preset-env"),
          {
            useBuiltIns: false,
            // Exclude transforms that make all code slower
            exclude: ["transform-typeof-symbol"],
          },
        ],
        require.resolve("@babel/preset-react"),
      ],
      plugins: [
        [
          require.resolve("@babel/plugin-transform-runtime"),
          {
            corejs: false,
            helpers: true,
            // By default, babel assumes babel/runtime version 7.0.0-beta.0,
            // explicitly resolving to match the provided helper functions.
            // https://github.com/babel/babel/issues/10261
            version: require("@babel/runtime/package.json").version,
            regenerator: true,
            // https://babeljs.io/docs/en/babel-plugin-transform-runtime#useesmodules
            // We should turn this on once the lowest version of Node LTS
            // supports ES Modules.
            useESModules: true,
            // Undocumented option that lets us encapsulate our runtime, ensuring
            // the correct version is used
            // https://github.com/babel/babel/blob/090c364a90fe73d36a30707fc612ce037bdbbb24/packages/babel-plugin-transform-runtime/src/index.js#L35-L42
            absoluteRuntime: path.dirname(
              require.resolve("@babel/runtime/package.json"),
            ),
          },
        ],
      ],
      cacheDirectory: true,
      cacheCompression: false,
      // Babel sourcemaps are needed for debugging into node_modules
      // code.  Without the options below, debuggers like VSCode
      // show incorrect code and set breakpoints on the wrong lines.
      sourceMaps: true,
    });

  config.plugin("private/strip-source-map-plugin").use(StripSourceMapUrlPlugin);
  config.plugin("private/ignore-plugin").use(webpack.IgnorePlugin, [
    {
      resourceRegExp: /^\.\/locale$/,
      contextRegExp: /moment$/,
    },
  ]);
  config.plugin("define").use(webpack.DefinePlugin, [
    {
      "process.env.NODE_ENV": JSON.stringify("development"),
    },
  ]);
  config.plugin("private/mf").use(webpack.container.ModuleFederationPlugin, [
    {
      library: {
        type: "global",
        name,
      },
      name,
      filename,
      exposes,
      shared,
    },
  ]);

  config.externals(externals);

  return config;
}
