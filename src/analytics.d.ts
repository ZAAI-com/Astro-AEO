import type { AnalyticsOptions, AnalyticsRuntimeSecret, JsonValue } from './index.js';

export type AnalyticsSurface = 'development' | 'preview' | 'node' | 'deno' | 'astro' | 'cloudflare' | 'netlify' | 'vercel';
/** A bounded observation, never a visitor identifier or proof of crawler identity. */
export interface AnalyticsEventV1 {
  version: 1;
  type: 'request';
  timestamp: string;
  registryVersion: string;
  method: 'GET' | 'HEAD';
  status: number;
  path: string;
  pathKind: 'inventory' | 'artifact' | 'pattern' | 'unlisted';
  crawler: { identity: string; classification: 'claimed' | 'unclassified' };
  representation: 'html' | 'markdown' | 'artifact' | 'redirect' | 'other';
  cache: 'not-modified' | 'unknown';
  surface: AnalyticsSurface;
  sampleRate: number;
  scope: 'agents' | 'all';
  coverage: 'observable-only';
}
export interface AnalyticsEnvelopeV1 { version: 1; events: readonly AnalyticsEventV1[] }
export type AnalyticsSink = (event: Readonly<AnalyticsEventV1>) => void | Promise<void>;
export interface AnalyticsAdapterModule {
  apiVersion: 1;
  createSink(options?: JsonValue): AnalyticsSink | Promise<AnalyticsSink>;
}
export interface AnalyticsObservation {
  pathname?: string;
  internal?: boolean;
  prerendered?: boolean;
  waitUntil?(work: Promise<void>): void;
  surface?: AnalyticsSurface;
  representation?: AnalyticsEventV1['representation'];
}
export interface AnalyticsObserver {
  /** Returns the exact Response; delivery never consumes or replaces its body. */
  observe(request: Request, response: Response, details?: AnalyticsObservation): Response;
}
export interface AnalyticsObserverOptions extends AnalyticsOptions {
  base?: string;
  surface?: AnalyticsSurface;
  inventory?: readonly string[] | (() => readonly string[]);
  artifacts?: readonly string[] | (() => readonly string[]);
  patterns?: readonly { pattern: RegExp; routePattern: string; artifact?: boolean }[];
  sink?: AnalyticsSink;
  clock?: () => number;
  random?: () => number;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}
export declare const ANALYTICS_CONSOLE_MARKER: 'astro-aeo:analytics-v1 ';
export declare function createAnalytics(options?: AnalyticsObserverOptions): AnalyticsObserver;
export declare function classifyCrawler(userAgent: string | null): AnalyticsEventV1['crawler'];
export declare function createConsoleSink(logger?: Pick<Console, 'log'>): AnalyticsSink;
export declare function createWebhookSink(options: {
  url: string; headers?: Record<string, AnalyticsRuntimeSecret>;
  secret?: (name: string) => string | undefined;
  fetch?: typeof fetch;
}): AnalyticsSink;
/** An injected optional-peer Meter, or OTLP/HTTP JSON, never path attributes. */
export declare function createOpenTelemetrySink(options: {
  meter?: { createCounter(name: string): { add(value: number, attributes: Record<string, string | number>): void } };
  endpoint?: string; headers?: Record<string, AnalyticsRuntimeSecret>;
  secret?: (name: string) => string | undefined; fetch?: typeof fetch;
  clock?: () => number;
}): AnalyticsSink;
