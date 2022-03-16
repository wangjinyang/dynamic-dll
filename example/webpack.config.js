const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require("html-webpack-plugin");
const ReactRefreshWebpackPlugin = require("@pmmmwh/react-refresh-webpack-plugin");

const baseConfig = {
  mode: "development",
  entry: [
    // Runtime code for hot module replacement
    // // Dev server client for web socket transport, hot and live reload logic
    // "webpack-dev-server/client/index.js?hot=true&live-reload=false",
    "webpack-hot-middleware/client?path=/__webpack_hmr&timeout=20000",
    path.join(__dirname, './src/index.js'),
  ],
  output: {
    publicPath: "/",
  },
  devtool: false,
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
        exclude: /node_modules/,
        loader: require.resolve("babel-loader"),
        options: {
          presets: [require.resolve("@babel/preset-react")],
          plugins: [require.resolve("react-refresh/babel")],
        },
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: "./public/index.html",
    }),
    new ReactRefreshWebpackPlugin(),
    new webpack.HotModuleReplacementPlugin(),
  ],
};

module.exports = baseConfig;
