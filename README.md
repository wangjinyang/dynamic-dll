# Dynamic DLL

update webpack development compiled speed 

## Steps

1. new a DynamicDll

    ```javascript
    const dynamicDll = new DynamicDll({
        cwd: process.cwd(), // the root dir of your app
        webpackLib: webpack, // webpack
        webpackPath: '', // webpackpath default ''
        tmpBase: join(cwd, DEFAULT_TMP_DIR_NAME), // Dynamic DLL files dir
        includesLibs, // the libary you want include
        excludeLibs, // the libary you want exclude
        shared, // mf shared of Dynamic DLL
      });
    ```

1. server static files of Dynamic DLL build

    [connect middleware type](https://github.com/senchalabs/connect#use-middleware)
    ```typescript
    dynamicDll.middleware = async (req: IncomingMessage, res: ServerResponse, next: (...args: any[]) => any){
        // ...
    }
    ```

1. set specific depConfig config what will be use Dynamic DLL's webpack
    ```typescript
    const depConfig = {};
    depConfig.module={
        // ...
    }
    depConfig.plugins={
        // ...
    }
        // ...
    dynamicDll.depConfig = depConfig; // at last
    ```
1. modifyWebpackChain by dynamicDll.modifyWebpack or dynamicDll.modifyWebpackChain if you use WebpackChain
   ```typescript
   const config = dynamicDll.modifyWebpack(orignalConfig);
   ```
   ```typescript
    chain = await dynamicDll.modifyWebpackChain(chain, resolveEntryFile)
    ```
1. make sure webpack entry is [dynamic-entry](https://webpack.js.org/configuration/entry-context/#dynamic-entry)
   1. config with webpack chain can do this step by [webpack-virtual-modules](https://www.npmjs.com/package/webpack-virtual-modules)
   ```typescript
   // origin config
   {
     entry:{
         main: 'index.js'
     }
   }
   // webpack chain
   chain.plugin('dll-virtual-modules-plugin').use(VirtualModulesPlugin,[
     {
        './virtual-modules.js': 'import ("index.js")',
     }
   ])
   ```
