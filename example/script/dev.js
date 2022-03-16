const path = require("path");
const lodash = require("lodash");
const webpack = require("webpack");
const devMiddleware = require("webpack-dev-middleware");
const hotMiddleware = require("webpack-hot-middleware");
const baseConfig = require("../webpack.config");
const express = require("express");
const { DynamicDll } = require("../..");
const app = express();

function dynamicEntry(tempEntry) {
  if (Array.isArray(tempEntry)) {
    return () => new Promise(resolve => resolve(tempEntry));
  } else if (Object.prototype.toString.call(tempEntry) === "[object Object]") {
    const newEntry = {};
    const keys = Object.keys(tempEntry);
    console.log("-> keys", keys);
    for (let k of keys) {
      // @ts-ignore
      if (Object.prototype.toString.call(tempEntry[k]) === "[object Object]") {
        newEntry[k] = tempEntry[k];
      } else {
        newEntry[k] = changeDynamicEntry(tempEntry[k]);
      }
    }
    return newEntry;
  } else if (Object.prototype.toString.call(tempEntry) === "[object String]") {
    return () => new Promise(resolve => resolve(tempEntry));
  }
  return tempEntry;
}

const dllConfig = lodash.cloneDeep(baseConfig);
dllConfig.plugins = [];
const dynamicDll = new DynamicDll({
  webpackPath: path.join(path.dirname(require.resolve("webpack/package.json"))),
  exclude: [/webpack-hot-middleware\/client/, /react-refresh/],
  dllWebpackConfig: dllConfig,
});

const config = dynamicDll.modifyWebpack(baseConfig);
const compiler = webpack(config);

app.use(
  devMiddleware(compiler, {
    stats: "normal",
    publicPath: config.output.publicPath,
    writeToDisk: true,
  }),
  hotMiddleware(compiler, {
    path: "/__webpack_hmr",
  }),
  dynamicDll.middleware,
);

app.listen(3000, () => console.log("Example app listening on port 3000!"));
