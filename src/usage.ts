import { createDecipheriv, createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import type { Writable } from "node:stream";

import { userConfigPath } from "./model-access.ts";

export interface StatsInvocation {
  args: string[];
}

/**
 * Credit rates for the BigModel GLM Coding Plan, per 10,000 tokens:
 * credits = (input × inputRate + cachedInput × cacheRate + output × outputRate) / 10000.
 * Source: docs.bigmodel.cn/cn/coding-plan/overview (2026-08). Requests in
 * off-peak hours (outside weekdays 14:00–18:00 UTC+8) deduct at 50%.
 */
export interface CreditRates {
  input: number;
  cache: number;
  output: number;
}

const codingPlanRates: Record<string, CreditRates> = {
  "glm-5.3": { input: 6.9, cache: 1.7, output: 24 },
  "glm-5.2": { input: 6.9, cache: 1.7, output: 24 },
  "glm-5.1": { input: 6.9, cache: 1.7, output: 24 },
  "glm-5-turbo": { input: 5.7, cache: 1.5, output: 21 },
  "glm-4.7": { input: 4.6, cache: 1.2, output: 16 },
  "glm-4.6v": { input: 1.2, cache: 0.3, output: 2.7 }
};

/** Peak window (credits at full rate): weekdays 14:00–18:00, UTC+8. */
const peakHoursUtc = { start: 6, endExclusive: 10 };
const dayOfWeekOffsetFromMonday = (utcDay: number): number => (utcDay + 6) % 7;

export function creditRatesForModel(modelId: string): CreditRates | undefined {
  return codingPlanRates[modelId.toLowerCase()];
}

/** True when a UTC timestamp falls inside the peak window (full-credit rate). */
export function isPeakCreditWindow(startedAtMs: number): boolean {
  const date = new Date(startedAtMs);
  const weekday = dayOfWeekOffsetFromMonday(date.getUTCDay());
  if (weekday >= 5) return false;
  const hour = date.getUTCHours();
  return hour >= peakHoursUtc.start && hour < peakHoursUtc.endExclusive;
}

export interface CreditBreakdown {
  inputCredits: number;
  cacheCredits: number;
  outputCredits: number;
  /** Set when at least one request had no matching model rate table entry. */
  estimated: boolean;
}

export function computeCredits(
  rows: { inputTokens: number; cacheReadTokens: number; outputTokens: number; modelId: string; startedAt: number }[]
): CreditBreakdown {
  let inputCredits = 0;
  let cacheCredits = 0;
  let outputCredits = 0;
  let estimated = false;
  for (const row of rows) {
    const rates = creditRatesForModel(row.modelId);
    if (!rates) {
      estimated = true;
      continue;
    }
    const factor = isPeakCreditWindow(row.startedAt) ? 1 : 0.5;
    // Official formula: credits = tokens × rate / 10000, per bucket.
    inputCredits += row.inputTokens * rates.input * factor / 10_000;
    cacheCredits += row.cacheReadTokens * rates.cache * factor / 10_000;
    outputCredits += row.outputTokens * rates.output * factor / 10_000;
  }
  return { inputCredits, cacheCredits, outputCredits, estimated };
}

export interface ProviderStats {
  providerId: string;
  apiKeyMasked?: string;
  requests: number;
  errors: number;
  /** Uncached input tokens (the runtime's input_tokens column). */
  inputTokens: number;
  /** Cache-hit tokens (the runtime's cache_read_input_tokens column). */
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  /** cacheReadTokens / (inputTokens + cacheReadTokens), 0–1. */
  cacheHitRate: number;
  credits: CreditBreakdown;
  models: { modelId: string; requests: number; inputTokens: number; cacheReadTokens: number; outputTokens: number }[];
}

export interface StatsTotals {
  keys: ProviderStats[];
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  cacheHitRate: number;
  credits: CreditBreakdown;
  /** Real server-side credits from the vendor monitor API, when available. */
  serverSpend?: SpendReport;
}

export interface StatsRunOptions {
  env?: NodeJS.ProcessEnv;
  /** Opens the runtime usage database; exposed for tests. */
  openDatabase?: (path: string) => Promise<StatsDatabase>;
  /** Fetches the vendor spend report; exposed for tests. */
  fetchSpendReport?: () => Promise<SpendReport | undefined>;
  stderr?: Writable;
  stdout?: Writable;
}

/** Server-side spend report from the BigModel monitor API (real credits). */
export interface SpendReport {
  /** Real deducted credits, already including promotions and off-peak discounts. */
  totalCredits: number;
  cacheHitRate?: number;
  /** Window covered by the report, `yyyy-MM-dd HH:mm:ss` strings. */
  startTime: string;
  endTime: string;
  modelCredits: {
    modelId: string;
    totalCredits: number;
    totalTokens: number;
    /** Real per-bucket credits when the API exposes them. */
    inputCredits?: number;
    cacheCredits?: number;
    outputCredits?: number;
  }[];
}

export function credentialsFilePath(
  env: NodeJS.ProcessEnv = process.env,
  fallbackHome: string = homedir()
): string {
  const configuredHome = (env.USERPROFILE ?? env.HOME)?.trim();
  return join(configuredHome || fallbackHome, ".zcode", "v2", "credentials.json");
}

/**
 * Decrypts a runtime-encrypted credential (`enc:v1:` AES-256-GCM). The key is
 * derived the same way the runtime does: SHA-256 of the fallback passphrase
 * (or `ZCODE_CREDENTIAL_SECRET` when set).
 */
export function decryptCredential(value: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!value.startsWith("enc:v1:")) return value;
  const configuredSecret = env.ZCODE_CREDENTIAL_SECRET?.trim();
  let username = "unknown";
  try {
    username = userInfo().username;
  } catch {
    // keep the fallback username
  }
  const secret = configuredSecret
    || `zcode-credential-fallback:${process.platform}:${homedir()}:${username}`;
  const key = createHash("sha256").update(secret).digest();
  const [ivPart, tagPart, dataPart] = value.slice("enc:v1:".length).split(".");
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error("Credential decrypt failed: invalid ciphertext format");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

interface MonitorDetailResponse {
  code?: number;
  data?: {
    summary?: {
      cacheHitRate?: { value?: string };
      totalCredits?: { value?: string };
    };
    modelUsage?: {
      modelDataList?: MonitorModelEntry[];
    };
  };
}

interface MonitorModelEntry {
  modelCode?: string;
  modelName?: string;
  /** Per-hour series in the requested window. */
  totalTokensUsage?: unknown;
  totalCreditsUsage?: unknown;
  uncachedInputCreditsUsage?: unknown;
  cachedInputCreditsUsage?: unknown;
  outputCreditsUsage?: unknown;
}

/** Sums an hourly series (or returns the value itself when it is a scalar). */
function sumSeries(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (!Array.isArray(value)) return 0;
  let sum = 0;
  for (const item of value) {
    const number = typeof item === "number" ? item : Number(item);
    if (Number.isFinite(number)) sum += number;
  }
  return sum;
}

const monitorBaseUrl = "https://bigmodel.cn/api/monitor";

function formatMonitorDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Fetches the real server-side credit spend for the last `days` days using the
 * BigModel OAuth token stored by `zcode login` (same API the ZCode desktop
 * usage page calls). Returns undefined when no usable token exists or the
 * request fails — callers fall back to local estimation.
 */
export async function fetchBigModelSpendReport(
  days = 30,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<SpendReport | undefined> {
  let token: string;
  try {
    const credentials = JSON.parse(await readFile(credentialsFilePath(env), "utf8")) as Record<string, string>;
    const stored = credentials["oauth:bigmodel:access_token"];
    if (!stored) return undefined;
    token = decryptCredential(stored, env);
  } catch {
    return undefined;
  }
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - days * 86_400_000);
  const url = `${monitorBaseUrl}/credit-usage/usage-detail?type=1`
    + `&startTime=${encodeURIComponent(formatMonitorDate(startTime))}`
    + `&endTime=${encodeURIComponent(formatMonitorDate(endTime))}`
    + "&usageType=MODEL";
  try {
    const response = await fetchImpl(url, {
      headers: {
        authorization: token,
        "User-Agent": "ZCode/stats",
        Accept: "application/json"
      }
    });
    if (!response.ok) return undefined;
    const body = await response.json() as MonitorDetailResponse;
    if (body.code !== 200 || !body.data) return undefined;
    const totalCredits = Number(body.data.summary?.totalCredits?.value);
    if (!Number.isFinite(totalCredits)) return undefined;
    const cacheHitRate = Number(body.data.summary?.cacheHitRate?.value);
    const modelCredits = (body.data.modelUsage?.modelDataList ?? [])
      .map((model) => ({
        modelId: model.modelCode ?? model.modelName ?? "unknown",
        totalCredits: sumSeries(model.totalCreditsUsage),
        totalTokens: sumSeries(model.totalTokensUsage),
        inputCredits: sumSeries(model.uncachedInputCreditsUsage),
        cacheCredits: sumSeries(model.cachedInputCreditsUsage),
        outputCredits: sumSeries(model.outputCreditsUsage)
      }))
      .filter((model) => model.totalCredits > 0 || model.totalTokens > 0);
    return {
      totalCredits,
      cacheHitRate: Number.isFinite(cacheHitRate) ? cacheHitRate : undefined,
      startTime: formatMonitorDate(startTime),
      endTime: formatMonitorDate(endTime),
      modelCredits
    };
  } catch {
    return undefined;
  }
}

/** Minimal surface of node:sqlite used by the report; tests substitute this. */
export interface StatsDatabase {
  all(query: string): unknown[];
  close(): void;
}

export function usageDatabasePath(
  env: NodeJS.ProcessEnv = process.env,
  fallbackHome: string = homedir()
): string {
  const configuredHome = (env.USERPROFILE ?? env.HOME)?.trim();
  return join(configuredHome || fallbackHome, ".zcode", "cli", "db", "db.sqlite");
}

/** Matches invocation forms `zcode stats` and `zcode stats --json`. */
export function isStatsInvocation(args: string[]): boolean {
  return args[0] === "stats" && (args.length === 1 || (args.length === 2 && args[1] === "--json"));
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

interface ProviderConfigEntry {
  name?: unknown;
  options?: {
    apiKey?: unknown;
  };
}

interface UserUsageConfig {
  provider?: Record<string, ProviderConfigEntry>;
}

/** Resolve the masked API key for every provider entry. */
async function keyLabels(
  env: NodeJS.ProcessEnv
): Promise<Map<string, { apiKeyMasked?: string }>> {
  const labels = new Map<string, { apiKeyMasked?: string }>();
  try {
    const config = JSON.parse(await readFile(userConfigPath(env), "utf8")) as UserUsageConfig;
    for (const [providerId, provider] of Object.entries(config.provider ?? {})) {
      const apiKey = typeof provider.options?.apiKey === "string" ? provider.options.apiKey.trim() : "";
      labels.set(providerId, { apiKeyMasked: apiKey ? maskApiKey(apiKey) : undefined });
    }
  } catch {
    // No readable config: report usage without credential labels.
  }
  return labels;
}

export function maskApiKey(apiKey: string): string {
  const key = apiKey.trim();
  if (key.length <= 8) return `${key.slice(0, 2)}…`;
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

const rowQuery = `
  select provider_id, model_id, status, started_at,
    input_tokens, output_tokens,
    cache_creation_input_tokens, cache_read_input_tokens
  from model_usage
  order by started_at
`;

interface UsageRow {
  providerId: string;
  modelId: string;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  startedAt: number;
  status: string;
}

function toUsageRow(record: Record<string, unknown>): UsageRow {
  return {
    providerId: typeof record.provider_id === "string" ? record.provider_id : "(unknown)",
    modelId: typeof record.model_id === "string" ? record.model_id : "(unknown)",
    inputTokens: asNumber(record.input_tokens),
    cacheReadTokens: asNumber(record.cache_read_input_tokens),
    outputTokens: asNumber(record.output_tokens),
    startedAt: asNumber(record.started_at),
    status: typeof record.status === "string" ? record.status : ""
  };
}

export async function collectStats(
  databasePath: string,
  env: NodeJS.ProcessEnv = process.env,
  openDatabase: (path: string) => Promise<StatsDatabase> = openSqliteDatabase,
  options?: { serverSpend?: SpendReport }
): Promise<StatsTotals> {
  const database = await openDatabase(databasePath);
  let records: unknown[];
  try {
    records = database.all(rowQuery);
  } finally {
    database.close();
  }
  const rows = records.map((record) => toUsageRow(record as Record<string, unknown>));
  const labels = await keyLabels(env);

  const keysById = new Map<string, ProviderStats>();
  for (const row of rows) {
    let key = keysById.get(row.providerId);
    if (!key) {
      const label = labels.get(row.providerId);
      key = {
        providerId: row.providerId,
        apiKeyMasked: label?.apiKeyMasked,
        requests: 0,
        errors: 0,
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 0,
        cacheHitRate: 0,
        credits: { inputCredits: 0, cacheCredits: 0, outputCredits: 0, estimated: false },
        models: []
      };
      keysById.set(row.providerId, key);
    }
    key.requests += 1;
    if (row.status === "error") key.errors += 1;
    key.inputTokens += row.inputTokens;
    key.cacheReadTokens += row.cacheReadTokens;
    key.outputTokens += row.outputTokens;
    key.models.push({
      modelId: row.modelId,
      requests: 1,
      inputTokens: row.inputTokens,
      cacheReadTokens: row.cacheReadTokens,
      outputTokens: row.outputTokens
    });
  }

  const totals: StatsTotals = {
    keys: [],
    inputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    cacheHitRate: 0,
    credits: { inputCredits: 0, cacheCredits: 0, outputCredits: 0, estimated: false },
    serverSpend: options?.serverSpend
  };
  for (const key of keysById.values()) {
    const inputSide = key.inputTokens + key.cacheReadTokens;
    key.cacheHitRate = inputSide > 0 ? key.cacheReadTokens / inputSide : 0;
    key.credits = computeCredits(rows.filter((row) => row.providerId === key.providerId));
    // Merge per-model rows.
    const models = new Map<string, ProviderStats["models"][number]>();
    for (const model of key.models) {
      const existing = models.get(model.modelId);
      if (existing) {
        existing.requests += model.requests;
        existing.inputTokens += model.inputTokens;
        existing.cacheReadTokens += model.cacheReadTokens;
        existing.outputTokens += model.outputTokens;
      } else {
        models.set(model.modelId, model);
      }
    }
    key.models = [...models.values()].sort((a, b) => (b.inputTokens + b.cacheReadTokens + b.outputTokens)
      - (a.inputTokens + a.cacheReadTokens + a.outputTokens));
    totals.inputTokens += key.inputTokens;
    totals.cacheReadTokens += key.cacheReadTokens;
    totals.outputTokens += key.outputTokens;
    totals.credits = {
      inputCredits: totals.credits.inputCredits + key.credits.inputCredits,
      cacheCredits: totals.credits.cacheCredits + key.credits.cacheCredits,
      outputCredits: totals.credits.outputCredits + key.credits.outputCredits,
      estimated: totals.credits.estimated || key.credits.estimated
    };
  }
  const totalInputSide = totals.inputTokens + totals.cacheReadTokens;
  totals.cacheHitRate = totalInputSide > 0 ? totals.cacheReadTokens / totalInputSide : 0;
  totals.keys = [...keysById.values()].sort(
    (a, b) => (b.inputTokens + b.cacheReadTokens + b.outputTokens)
      - (a.inputTokens + a.cacheReadTokens + a.outputTokens)
  );
  return totals;
}

async function openSqliteDatabase(path: string): Promise<StatsDatabase> {
  if (!existsSync(path)) {
    throw new Error(`ZCode usage database not found: ${path}. Start a session first.`);
  }
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(path, { readOnly: true });
  return {
    all: (query: string) => database.prepare(query).all(),
    close: () => database.close()
  };
}

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const creditsFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function formatInteger(value: number): string {
  return numberFormat.format(Math.max(0, Math.floor(value)));
}

function formatCredits(value: number): string {
  return creditsFormat.format(Math.max(0, value));
}

function formatPercent(ratio: number): string {
  return `${(Math.max(0, Math.min(1, ratio)) * 100).toFixed(1)}%`;
}

export function formatStatsReport(totals: StatsTotals): string {
  if (totals.keys.length === 0) {
    return "No model usage recorded yet. Start a session first.";
  }
  const lines: string[] = [
    "Model usage by provider",
    ""
  ];
  for (const key of totals.keys) {
    const credential = key.apiKeyMasked ? `key ${key.apiKeyMasked}` : key.providerId.startsWith("builtin:")
      ? "built-in plan (OAuth)"
      : "no API key on record";
    lines.push(`${key.providerId}  (${credential})`);
    lines.push(`  requests: ${formatInteger(key.requests)} (${formatInteger(key.errors)} errors)`);
    lines.push(`  input tokens: ${formatInteger(key.inputTokens)}`);
    lines.push(`  cache-hit tokens: ${formatInteger(key.cacheReadTokens)} (hit rate ${formatPercent(key.cacheHitRate)})`);
    lines.push(`  output tokens: ${formatInteger(key.outputTokens)}`);
    lines.push(
      `  credits: input ${formatCredits(key.credits.inputCredits)}`
      + ` + cache ${formatCredits(key.credits.cacheCredits)}`
      + ` + output ${formatCredits(key.credits.outputCredits)}`
      + ` = ${formatCredits(key.credits.inputCredits + key.credits.cacheCredits + key.credits.outputCredits)}`
      + (key.credits.estimated ? " (partial: unknown model rates skipped)" : "")
    );
    for (const model of key.models) {
      lines.push(
        `  · ${model.modelId}: ${formatInteger(model.requests)} requests,`
        + ` in ${formatInteger(model.inputTokens)} / cached ${formatInteger(model.cacheReadTokens)}`
        + ` / out ${formatInteger(model.outputTokens)}`
      );
    }
    lines.push("");
  }
  lines.push(
    "All providers: "
    + `${formatInteger(totals.inputTokens + totals.cacheReadTokens + totals.outputTokens)} tokens`
    + ` (in ${formatInteger(totals.inputTokens)}, cached ${formatInteger(totals.cacheReadTokens)}`
    + ` @ ${formatPercent(totals.cacheHitRate)}, out ${formatInteger(totals.outputTokens)}),`
    + ` credits ${formatCredits(totals.credits.inputCredits + totals.credits.cacheCredits + totals.credits.outputCredits)} (estimated)`
  );
  if (totals.serverSpend) {
    const spend = totals.serverSpend;
    lines.push("");
    lines.push(
      `Vendor spend report (real credits, ${spend.startTime.slice(0, 10)} → ${spend.endTime.slice(0, 10)}): `
      + `${formatCredits(spend.totalCredits)} credits`
    );
    for (const model of spend.modelCredits) {
      const buckets = model.inputCredits !== undefined && model.cacheCredits !== undefined && model.outputCredits !== undefined
        ? ` (input ${formatCredits(model.inputCredits)} + cache ${formatCredits(model.cacheCredits)}`
          + ` + output ${formatCredits(model.outputCredits)})`
        : "";
      lines.push(
        `  · ${model.modelId}: ${formatCredits(model.totalCredits)} credits${buckets}`
        + ` (${formatInteger(model.totalTokens)} tokens)`
      );
    }
  }
  return lines.join("\n");
}

export function formatStatsJson(totals: StatsTotals): string {
  return `${JSON.stringify(totals, null, 2)}\n`;
}

export async function runStatsReport(
  invocation: StatsInvocation,
  options: StatsRunOptions = {}
): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const env = options.env ?? process.env;
  const json = invocation.args.includes("--json");
  try {
    // Prefer the vendor's server-side spend report (real credits including
    // promotions); fall back to silent local estimation on any failure.
    const serverSpend = options.fetchSpendReport
      ? await options.fetchSpendReport().catch(() => undefined)
      : await fetchBigModelSpendReport(30, env).catch(() => undefined);
    const totals = await collectStats(
      usageDatabasePath(env),
      env,
      options.openDatabase,
      { serverSpend }
    );
    stdout.write(json ? formatStatsJson(totals) : `${formatStatsReport(totals)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
