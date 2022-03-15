const webpack = require("webpack");
const devMiddleware = require("webpack-dev-middleware");
const hotMiddleware = require("webpack-hot-middleware");
const config = require("../webpack.config");
const compiler = webpack(config);
const express = require("express");
const app = express();

app.use(
  devMiddleware(compiler, {
    stats: "normal",
    publicPath: config.output.publicPath,
  }),
  hotMiddleware(compiler, {
    path: "/__webpack_hmr",
  })
);

app.listen(3000, () => console.log("Example app listening on port 3000!"));
