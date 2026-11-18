/** 网关数据的后台刷新由当前可见窗口内的组件共享。 */
import { createContext, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { rememberAgentNames, type GatewayPayload, type GatewayResult } from "./gateway-model";

const shared: { payload: GatewayPayload | null } = { payload: null };
const listeners = new Set<(payload: GatewayPayload) => void>();
const pollers = new Map<(payload: GatewayPayload) => void, { interval: number; nextUpdate: number }>();
/** 每推一次新数据（保存的结果）加一。轮询发出后数据变过，答复就是旧的，丢掉不用，免得盖回刚保存的状态。 */
let generation = 0;
let pending: { generation: number; result: Promise<GatewayResult> } | undefined;
let polling = false;
let timer: number | undefined;
let interval = 0;

export function gatewayGeneration(): number {
  return generation;
}

/** 命令返回了新的网关数据（如在总览里接入了 Agent、在网关页改了供应商）：立刻推给所有在用的组件，不等下次轮询。 */
export function publishGatewayPayload(result: GatewayResult) {
  if (!result.gateway || !Array.isArray(result.pool)) return;
  generation += 1;
  shared.payload = result as GatewayPayload;
  rememberAgentNames(shared.payload.agents);
  for (const listener of listeners) listener(shared.payload);
  for (const listener of pollers.keys()) listener(shared.payload);
}

/** 订阅别处推来的新数据（不轮询）；返回取消订阅。 */
export function subscribeGatewayPayload(listener: (payload: GatewayPayload) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 显式刷新也可复用同一版本正在读取的结果。保存后新开一轮读取。 */
export function requestGatewayPayload(): Promise<GatewayResult> {
  if (pending?.generation === generation) return pending.result;
  const result = invoke<GatewayResult>("load_gateway").finally(() => {
    if (pending?.result === result) pending = undefined;
  });
  pending = { generation, result };
  return result;
}

async function pollGatewayPayload() {
  if (polling || document.hidden || !pollers.size) return;
  polling = true;
  const started = generation;
  try {
    // Windows WebView2 can report a visible document even when the native window is in the tray.
    if ("__TAURI_INTERNALS__" in window) {
      const nativeWindow = getCurrentWindow();
      if (!(await nativeWindow.isVisible()) || await nativeWindow.isMinimized()) return;
      if (document.hidden || !pollers.size || started !== generation) return;
    }
    const result = await requestGatewayPayload();
    if (started !== generation || !pollers.size || !result.gateway || !Array.isArray(result.pool)) return;
    shared.payload = result as GatewayPayload;
    rememberAgentNames(shared.payload.agents);
    const now = Date.now();
    for (const [listener, poller] of pollers) {
      if (now < poller.nextUpdate) continue;
      poller.nextUpdate = now + poller.interval;
      listener(shared.payload);
    }
  } catch {
    // 静默刷新失败时沿用已有快照。
  } finally {
    polling = false;
  }
}

function syncPollTimer() {
  const next = document.hidden || !pollers.size ? 0 : Math.min(...Array.from(pollers.values(), poller => poller.interval));
  if (next === interval) return;
  if (!interval) {
    for (const poller of pollers.values()) poller.nextUpdate = 0;
  }
  window.clearInterval(timer);
  interval = next;
  timer = next ? window.setInterval(pollGatewayPayload, next) : undefined;
  if (next) void pollGatewayPayload();
}

export function subscribeGatewayPolling(intervalMs: number, listener: (payload: GatewayPayload) => void): () => void {
  if (!pollers.size) {
    document.addEventListener("visibilitychange", syncPollTimer);
    window.addEventListener("focus", pollGatewayPayload);
  }
  pollers.set(listener, { interval: intervalMs, nextUpdate: 0 });
  syncPollTimer();
  return () => {
    pollers.delete(listener);
    if (!pollers.size) {
      document.removeEventListener("visibilitychange", syncPollTimer);
      window.removeEventListener("focus", pollGatewayPayload);
    }
    syncPollTimer();
  };
}

export function useGatewayPayload(intervalMs: number): GatewayPayload | null {
  const [payload, setPayload] = useState<GatewayPayload | null>(shared.payload);
  useEffect(() => {
    setPayload(shared.payload);
    return subscribeGatewayPolling(intervalMs, setPayload);
  }, [intervalMs]);
  return payload;
}

/** 网关各页之间跳转时带的落地位置：跳过去的页面读一次就清掉。 */
export const gatewayJump: { provider: string | null } = { provider: null };

/** 网关页里的跳转入口（只在网关页里有；总览、托盘里的模型下拉拿不到就不显示对应链接）。 */
export const GatewayNavContext = createContext<{ openModelGroups?: () => void }>({});
