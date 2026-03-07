import reactRouterNode from "@react-router/node";
const { createRequestListener } = reactRouterNode;

let listener;

export default async function handler(req, res) {
  if (!listener) {
    const build = await import("../build/server/index.js");
    listener = createRequestListener({
      build: build.default ?? build,
      mode: process.env.NODE_ENV,
    });
  }
  return listener(req, res);
}
