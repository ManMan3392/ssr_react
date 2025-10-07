import express from "express";
import type { RequestHandler } from "express";
import type { ViteDevServer } from "vite";
import { renderToString } from "react-dom/server";
import React from "react";
import path from "path";
import fs from "fs";
import { pathToFileURL } from "url";

const isProd = process.env.NODE_ENV === "production";
const cwd = process.cwd();

async function loadSsrEntryModule(vite: ViteDevServer | null) {
  // 生产模式下动态 import 打包后的产物
  if (isProd) {
    const entryPath = path.join(cwd, "dist/server/entry-server.js");
    // 在 ESM 环境下使用 file:// URL
    //ESM 是浏览器和现代 Node.js 通用的模块标准，它要求模块路径必须是合法的 URL（如 http://、https:// 或本地文件的 file://）。
    //pathToFileURL（Node.js 内置 API）将文件系统路径（如 C:/project/dist/entry.js 或 /usr/project/dist/entry.js）转换为符合 file:// 协议的 URL（如 file:///C:/project/dist/entry.js）。
    //.href 则获取该 URL 的字符串形式，供 import() 使用。
    const mod = await import(pathToFileURL(entryPath).href);
    return mod;
  }

  // 开发环境下通过 Vite 的 ssrLoadModule 加载源码（no-bundle）
  // 实时编译，收到请求时，动态将 TS 转译为 JS、JSX 转译为 React.createElement 调用，再返回给 Node.js 执行。
  const entryPath = path.join(cwd, "src/entry-server.tsx");
  return vite!.ssrLoadModule(entryPath);
}

function matchPageUrl(url: string) {
  if (url === "/") {
    return true;
    // 仅根路径需要 SSR，可扩展为更复杂的路由匹配
    // 无法自动处理未在路由配置中定义的 URL（包括无效路径、静态资源路径、API 路径等）。
    // matchPageUrl 的作用正是提前拦截这些 “不需要走 SSR 流程的 URL”（如静态资源、API），避免它们进入路由匹配环节导致无意义的错误或性能浪费。
  }
  return false;
}

function resolveTemplatePath() {
  // 生产环境使用构建后的客户端 index.html
  // 主要就是生产环境下有更多优化及改变了一下js文件的引入路径
  return isProd
    ? path.resolve(cwd, "dist/client/index.html")
    : path.resolve(cwd, "index.html");
}

async function fetchData(): Promise<Record<string, unknown>> {
  // 占位的数据预取实现 — 根据项目需要替换为真实的请求或数据库读取
  return {};
}

async function createSsrMiddleware(
  vite: ViteDevServer | null
): Promise<RequestHandler> {
  return async (req, res, next) => {
    try {
      const url = req.originalUrl;
      if (!matchPageUrl(url)) {
        // 走静态资源的处理
        return await next();
      }

      // 1. 服务端入口加载，兼容 default export 或命名导出 ServerEntry
      const mod = await loadSsrEntryModule(vite);
      const ServerEntry = (mod &&
        (mod.default ?? mod.ServerEntry)) as React.ComponentType<
        Record<string, unknown>
      > | null;

      // 2. 数据预取 — 优先使用模块导出的 fetchData（如果存在），否则使用本地占位实现
      const fetchDataFromModule =
        mod &&
        (mod.fetchData as
          | (() => Promise<Record<string, unknown>> | Record<string, unknown>)
          | undefined);
      const data = fetchDataFromModule
        ? await fetchDataFromModule()
        : await fetchData();

      // 3. 渲染组件为 HTML 字符串
      if (!ServerEntry) {
        throw new Error("Server entry component not found");
      }
      const appHtml = renderToString(
        React.createElement(ServerEntry, { data } as Record<string, unknown>)
      );

      // 4. 读取 HTML 模板
      const templatePath = resolveTemplatePath();
      let template = await fs.promises.readFile(templatePath, "utf-8");

      // 开发模式下需要 Vite 注入（HMR、script 标签等）
      if (!isProd && vite) {
        template = await vite.transformIndexHtml(url, template);
      }

      const html = template
        .replace("<!-- SSR_APP -->", appHtml)
        .replace(
          "<!-- SSR_DATA -->",
          `<script>window.__SSR_DATA__=${JSON.stringify(data)}</script>`
        );

      res.status(200).setHeader("Content-Type", "text/html").end(html);
    } catch (e: unknown) {
      vite?.ssrFixStacktrace(e as Error);
      console.error(e);
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).end(msg);
    }
  };
}

async function createServer() {
  const app = express();
  // 在开发模式下先创建 Vite server，然后先挂载 SSR 中间件，再挂载 Vite 的 middlewares
  let vite: ViteDevServer | null = null;
  if (!isProd) {
    const { createServer } = await import("vite");
    vite = await createServer({
      root: cwd,
      server: {
        middlewareMode: true,
      },
    });
    // 先挂载 SSR 中间件，这样 SSR 能拦截 index.html 并注入渲染内容
    app.use(await createSsrMiddleware(vite));
    // 然后挂载 Vite 的 middlewares（静态资源、HMR 等）
    app.use(vite.middlewares);
  } else {
    // 生产环境：直接挂载 SSR 中间件（vite 为 null），并提供静态资源
    app.use(await createSsrMiddleware(null));
    app.use(express.static(path.join(cwd, "dist/client")));
  }

  app.listen(3000, () => {
    console.log("Node 服务器已启动~");
    console.log("http://localhost:3000");
  });
}

createServer();
