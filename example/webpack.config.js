const HtmlWebpackPlugin = require("html-webpack-plugin");
const DynamicDLLPlugin = require("..");

module.exports = {
  mode: "development",
  entry: [
    // Runtime code for hot module replacement
    // // Dev server client for web socket transport, hot and live reload logic
    // "webpack-dev-server/client/index.js?hot=true&live-reload=false",
    "./src/index",
  ],
  output: {
    publicPath: "http://localhost:3001/", // New
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
        },
      },
    ],
  },

  plugins: [
    // New
    new DynamicDLLPlugin(),
    new HtmlWebpackPlugin({
      template: "./public/index.html",
    }),
    // new webpack.HotModuleReplacementPlugin(),
  ],
};
