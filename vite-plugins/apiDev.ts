/// <reference types="node" />
/**
 * Serves the leaderboard functions (api/*.ts) from `npm run dev`, so the
 * game works locally without `vercel dev`.
 *
 * On Vercel each file in api/ is a function whose named exports (`GET`,
 * `POST`…) take a Web `Request` and return a `Response`. This middleware
 * does the same for the dev server: `/api/<name>` loads api/<name>.ts
 * through Vite (`ssrLoadModule`, so edits reload), turns Node's request into
 * a `Request`, calls the export for the method, and writes the `Response`
 * back. Environment variables come from .env (see .env.example) via
 * `loadEnv`, like on Vercel from the project settings.
 *
 * Dev only (`apply: "serve"`): the built game has no server of its own.
 */
import { existsSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { resolve } from "node:path";
import { loadEnv, type Plugin } from "vite";

/** Route names: api/<name>.ts, lower-case letters only (no `_lib`, no `..`). */
const ROUTE = /^\/api\/([a-z]+)(?:\?.*)?$/;

/** The body of `req`, or undefined for methods without one. */
async function readBody(req: IncomingMessage): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return new Uint8Array(Buffer.concat(chunks));
}

export function apiDev(): Plugin {
  return {
    name: "api-dev",
    apply: "serve",
    configureServer(server) {
      // .env values for the functions (DATABASE_URL, LEADERBOARD_SECRET),
      // without overriding variables already set in the shell.
      const env = loadEnv(server.config.mode, server.config.root, "");
      for (const [key, value] of Object.entries(env)) process.env[key] ??= value;

      server.middlewares.use(async (req, res, next) => {
        const match = req.url ? ROUTE.exec(req.url) : null;
        const file = match ? resolve(server.config.root, "api", `${match[1]}.ts`) : "";
        if (!match || !existsSync(file)) return next();
        try {
          const mod = (await server.ssrLoadModule(file)) as Record<string, unknown>;
          const handler = mod[req.method ?? "GET"];
          if (typeof handler !== "function") {
            res.statusCode = 405;
            res.end();
            return;
          }
          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (typeof value === "string") headers.set(key, value);
            else if (Array.isArray(value)) headers.set(key, value.join(", "));
          }
          // Vercel sets this at its edge; fill it from the socket here.
          if (!headers.has("x-forwarded-for") && req.socket.remoteAddress) {
            headers.set("x-forwarded-for", req.socket.remoteAddress);
          }
          const request = new Request(`http://${req.headers.host ?? "localhost"}${req.url}`, {
            method: req.method,
            headers,
            body: await readBody(req),
          });
          const response = (await handler(request)) as Response;
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          server.config.logger.error(`api-dev: ${req.url} failed: ${String(err)}`);
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "server" }));
        }
      });
    },
  };
}
