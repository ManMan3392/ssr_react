import express from "express";
import type { Express, RequestHandler } from "express";
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
    const mod = await import(pathToFileURL(entryPath).href);
    return mod;
  }

  // 开发环境下通过 Vite 的 ssrLoadModule 加载源码（no-bundle）
  const entryPath = path.join(cwd, "src/entry-server.tsx");
  return vite!.ssrLoadModule(entryPath);
}

function matchPageUrl(url: string) {
  if (url === "/") {
    return true;
  }
  return false;
}

function resolveTemplatePath() {
  // 生产环境使用构建后的客户端 index.html
  return isProd
    ? path.resolve(cwd, "dist/client/index.html")
    : path.resolve(cwd, "index.html");
}

async function fetchData(): Promise<Record<string, unknown>> {
  // 占位的数据预取实现 — 根据项目需要替换为真实的请求或数据库读取
  return {};
}

async function createSsrMiddleware(app: Express): Promise<RequestHandler> {
  let vite: ViteDevServer | null = null;
  if (!isProd) {
    const { createServer } = await import("vite");
    vite = await createServer({
      root: cwd,
      server: {
        middlewareMode: true,
      },
    });
    // 注册 Vite 中间件（处理静态资源、HMR 等）
    app.use(vite.middlewares);
  }

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
    } catch (e: any) {
      vite?.ssrFixStacktrace(e);
      console.error(e);
      res.status(500).end(e.message);
    }
  };
}

async function createServer() {
  const app = express();
  // 将 SSR 中间件挂载到应用上
  app.use(await createSsrMiddleware(app));

  if (isProd) {
    app.use(express.static(path.join(cwd, "dist/client")));
  }

  app.listen(3000, () => {
    console.log("Node 服务器已启动~");
    console.log("http://localhost:3000");
  });
}

createServer();
