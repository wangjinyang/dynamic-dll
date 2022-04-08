const path = require("path");
const webpack = require("webpack");
const devMiddleware = require("webpack-dev-middleware");
const hotMiddleware = require("webpack-hot-middleware");
const baseConfig = require("../webpack.config");
const express = require("express");
const { DynamicDll } = require("../..");
const app = express();

const dynamicDll = new DynamicDll({
  webpackPath: path.join(path.dirname(require.resolve("webpack/package.json"))),
  exclude: [/webpack-hot-middleware\/client/, /react-refresh/],
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
