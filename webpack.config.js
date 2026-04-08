// webpack.config.js
"use strict";
const path = require("path");

// 1. Configuración para el motor de la extensión (Backend)
const extensionConfig = {
  target: "node",
  mode: "development", // Cambiado a desarrollo para evitar errores silenciosos
  devtool: "source-map",
  entry: "./src/extension.ts",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "extension.js",
    libraryTarget: "commonjs",
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [{ loader: "ts-loader" }],
      },
    ],
  },
  externals: {
    vscode: "commonjs vscode",
  },
};

// 2. Configuración para el panel de React (Frontend Webview)
const webviewConfig = {
  target: "web",
  mode: "development", // Vital para que React se empaquete correctamente
  devtool: "source-map", // Permite leer errores fácilmente en la consola
  entry: "./src/webview/index.tsx",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "webview.js",
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx"],
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: [{ loader: "ts-loader" }],
      },
    ],
  },
};

module.exports = [extensionConfig, webviewConfig];
