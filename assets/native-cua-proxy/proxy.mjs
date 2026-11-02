import { readFileSync } from "node:fs";
import { createConnection } from "node:net";

const proxyKeys = ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY"];

function value(env, key) {
  return env[key]?.trim() || env[key.toLowerCase()]?.trim();
}

export function applyProxy(env, inherited) {
  const selected = proxyKeys.some((key) => value(env, key)) ? env : inherited;
  const https = value(selected, "HTTPS_PROXY")
    || value(selected, "ALL_PROXY")
    || value(selected, "HTTP_PROXY");
  if (!https) return null;
  for (const key of proxyKeys) {
    const configured = value(selected, key);
    if (!value(env, key) && configured) env[key] = configured;
  }
  // The native authenticated-fetch host needs HTTPS_PROXY even with an HTTP-only proxy.
  if (!value(env, "HTTPS_PROXY")) env.HTTPS_PROXY = https;
  const bypass = new Set(
    [value(env, "NO_PROXY"), value(inherited, "NO_PROXY")]
      .filter(Boolean).flatMap((list) => list.split(",").map((part) => part.trim()))
      .filter(Boolean),
  );
  for (const host of ["localhost", "127.0.0.1", "::1"]) bypass.add(host);
  env.NO_PROXY = [...bypass].join(",");
  // On Unix, a pre-existing lowercase value must not hide the loopback additions.
  if (Object.hasOwn(env, "no_proxy")) env.no_proxy = env.NO_PROXY;
  return value(env, "HTTPS_PROXY");
}

async function checkProxy(address) {
  try {
    const url = new URL(address);
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    await new Promise((resolve, reject) => {
      const socket = createConnection({ host: url.hostname.replace(/^\[|\]$/g, ""), port });
      const done = (error) => {
        socket.destroy();
        error ? reject(error) : resolve();
      };
      socket.setTimeout(1000, () => done(new Error("timeout")));
      socket.once("connect", () => done());
      socket.once("error", done);
    });
  } catch {
    // Keep the selected proxy: a failed probe must never silently change the route.
    console.error("[Codex++] CUA proxy is unavailable; configured proxy retained.");
  }
}

export async function initialize(env, config) {
  if (!config.enabled) return;
  const address = applyProxy(env, config.env);
  if (address) await checkProxy(address);
}

// The file is installed beside its control document; importing it never changes tool arguments.
try {
  await initialize(process.env, JSON.parse(readFileSync(new URL("./control.json", import.meta.url), "utf8")));
} catch {
  // Fail closed if a previously active adapter loses its configuration.
  throw new Error("Codex++ CUA proxy configuration is unavailable; restart Codex++.");
}
