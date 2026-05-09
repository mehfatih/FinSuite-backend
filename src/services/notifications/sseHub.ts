// ================================================================
// sseHub.ts — in-process pub/sub fanout for SSE streams.
// One Express process owns its own subscriber set; cross-process
// fanout would need a Redis pub/sub bridge (not in D-4 scope).
//
// API:
//   addSubscriber(merchantId, res) → unsubscribe()
//   broadcast(merchantId, event)
//   keepalive interval is owned per-subscriber by the controller.
// ================================================================
import type { Response } from "express";

type SubscriberFn = (eventName: string, payload: unknown) => void;

const subscribers = new Map<string, Set<SubscriberFn>>();

export function addSubscriber(merchantId: string, fn: SubscriberFn): () => void {
  let set = subscribers.get(merchantId);
  if (!set) {
    set = new Set();
    subscribers.set(merchantId, set);
  }
  set.add(fn);
  return () => {
    const s = subscribers.get(merchantId);
    if (!s) return;
    s.delete(fn);
    if (s.size === 0) subscribers.delete(merchantId);
  };
}

export function broadcast(merchantId: string, eventName: string, payload: unknown): void {
  const set = subscribers.get(merchantId);
  if (!set || set.size === 0) return;
  for (const fn of set) {
    try { fn(eventName, payload); }
    catch (err) {
      console.error("[sseHub] subscriber threw:", (err as any)?.message || err);
    }
  }
}

/** Diagnostic: connected subscriber count per merchant (debug only). */
export function subscriberCount(merchantId?: string): number {
  if (merchantId) return subscribers.get(merchantId)?.size || 0;
  let total = 0;
  for (const s of subscribers.values()) total += s.size;
  return total;
}

/** Helper: write an SSE-formatted message to a Response. */
export function writeSseMessage(res: Response, eventName: string, payload: unknown): void {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/** Helper: write a comment line — clients ignore it; keeps the connection alive. */
export function writeSseKeepalive(res: Response): void {
  res.write(`: ping ${Date.now()}\n\n`);
}
