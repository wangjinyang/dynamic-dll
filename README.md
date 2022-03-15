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
1. modifyWebpackChain by dynamicDll.modifyWebpackChain
    ```typescript
    chain = await dynamicDll.modifyWebpackChain(chain, resolveEntryFile)
    ```
