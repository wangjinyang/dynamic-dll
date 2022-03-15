const ReactRefreshWebpackPlugin = require("@pmmmwh/react-refresh-webpack-plugin");
const webpack = require("webpack");
const HtmlWebpackPlugin = require("html-webpack-plugin");
// const DynamicDLLPlugin = require("..");

module.exports = {
  mode: "development",
  entry: [
    "webpack-hot-middleware/client?path=/__webpack_hmr&timeout=20000",
    "./src/index",
  ],
  output: {
    publicPath: "/",
  },
  devtool: "source-map",
  optimization: {
    minimize: false,
  },
  devServer: {
    hot: true,
  },
  resolve: {
    extensions: [".jsx", ".js", ".json"],
    alias: {
      "@remote": "application_b/SayHelloFromB",
    },
  },
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        loader: require.resolve("babel-loader"),
        options: {
          presets: [require.resolve("@babel/preset-react")],
          plugins: [require.resolve("react-refresh/babel")],
        },
      },
    ],
  },
  plugins: [
    // new DynamicDLLPlugin(),
    new HtmlWebpackPlugin({
      template: "./public/index.html",
    }),
    new ReactRefreshWebpackPlugin(),
    new webpack.HotModuleReplacementPlugin(),
  ],
};
