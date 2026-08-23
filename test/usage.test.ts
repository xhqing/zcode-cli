import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  collectStats,
  computeCredits,
  credentialsFilePath,
  creditRatesForModel,
  decryptCredential,
  fetchBigModelSpendReport,
  formatStatsJson,
  formatStatsReport,
  isPeakCreditWindow,
  isStatsInvocation,
  maskApiKey,
  runStatsReport,
  usageDatabasePath,
  type SpendReport,
  type StatsDatabase
} from "../src/usage.ts";
import { userConfigPath } from "../src/model-access.ts";

function fakeDatabase(rows: unknown[]): StatsDatabase {
  return {
    all: () => rows,
    close: () => {}
  };
}

// Weekday 2026-08-19 (Wed) 08:00 UTC = 16:00 UTC+8 → inside the peak window.
const peakStart = Date.UTC(2026, 7, 19, 8, 0, 0);
// Saturday 2026-08-22 08:00 UTC → off-peak regardless of hour.
const offPeakStart = Date.UTC(2026, 7, 22, 8, 0, 0);

const baseRow = {
  provider_id: "bigmodel-team",
  model_id: "glm-5.3",
  status: "completed",
  started_at: peakStart,
  input_tokens: 1000,
  output_tokens: 200,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 300
};

describe("stats invocation", () => {
  test("accepts zcode stats and zcode stats --json only", () => {
    expect(isStatsInvocation(["stats"])).toBe(true);
    expect(isStatsInvocation(["stats", "--json"])).toBe(true);
    expect(isStatsInvocation(["stats", "--bogus"])).toBe(false);
    expect(isStatsInvocation(["usage"])).toBe(false);
    expect(isStatsInvocation([])).toBe(false);
  });

  test("resolves the database path from the home directory", () => {
    expect(usageDatabasePath({ HOME: "/home/alice" })).toBe("/home/alice/.zcode/cli/db/db.sqlite");
    expect(usageDatabasePath({ USERPROFILE: "C:\\Users\\alice" })).toBe(
      join("C:\\Users\\alice", ".zcode", "cli", "db", "db.sqlite")
    );
  });

  test("masks API keys to the first and last four characters", () => {
    expect(maskApiKey("abcdefghijklmnopqrstuvwxyz")).toBe("abcd…wxyz");
    expect(maskApiKey("short-key")).toBe("shor…-key");
    expect(maskApiKey("12345678")).toBe("12…");
  });
});

describe("credit estimation", () => {
  test("maps model IDs to official coding-plan rates", () => {
    expect(creditRatesForModel("GLM-5.3")).toEqual({ input: 6.9, cache: 1.7, output: 24 });
    expect(creditRatesForModel("glm-5.2")).toEqual(creditRatesForModel("glm-5.3"));
    expect(creditRatesForModel("glm-4.7")).toEqual({ input: 4.6, cache: 1.2, output: 16 });
    expect(creditRatesForModel("unknown-model")).toBeUndefined();
  });

  test("detects the weekday peak window in UTC+8 terms", () => {
    // Wednesday 08:00 UTC = 16:00 UTC+8 → peak (full rate).
    expect(isPeakCreditWindow(peakStart)).toBe(true);
    // Wednesday 05:00 UTC = 13:00 UTC+8 → off-peak.
    expect(isPeakCreditWindow(Date.UTC(2026, 7, 19, 5, 0, 0))).toBe(false);
    // Saturday any hour → off-peak.
    expect(isPeakCreditWindow(offPeakStart)).toBe(false);
  });

  test("computes per-bucket credits with the /10000 formula and off-peak halving", () => {
    const peak = computeCredits([{
      inputTokens: 10_000,
      cacheReadTokens: 20_000,
      outputTokens: 1_000,
      modelId: "glm-5.3",
      startedAt: peakStart
    }]);
    expect(peak.inputCredits).toBeCloseTo(6.9, 6);
    expect(peak.cacheCredits).toBeCloseTo(3.4, 6);
    expect(peak.outputCredits).toBeCloseTo(2.4, 6);
    expect(peak.estimated).toBe(false);

    const offPeak = computeCredits([{
      inputTokens: 10_000,
      cacheReadTokens: 0,
      outputTokens: 0,
      modelId: "glm-5.3",
      startedAt: offPeakStart
    }]);
    expect(offPeak.inputCredits).toBeCloseTo(3.45, 6);

    const partial = computeCredits([{
      inputTokens: 10_000,
      cacheReadTokens: 0,
      outputTokens: 0,
      modelId: "some-other-model",
      startedAt: peakStart
    }]);
    expect(partial.inputCredits).toBe(0);
    expect(partial.estimated).toBe(true);
  });
});

describe("stats aggregation", () => {
  test("groups rows per key with cache hit rate and credit totals", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zcode-stats-"));
    try {
      const rows = [
        { ...baseRow },
        { ...baseRow, input_tokens: 500, cache_read_input_tokens: 500, output_tokens: 100 },
        { ...baseRow, provider_id: "builtin:bigmodel-coding-plan", model_id: "GLM-5.3", input_tokens: 9_000, cache_read_input_tokens: 90_000, output_tokens: 4_000 },
        { ...baseRow, status: "error", output_tokens: 0 }
      ];
      const totals = await collectStats(
        join(directory, "db.sqlite"),
        { HOME: directory },
        () => Promise.resolve(fakeDatabase(rows))
      );

      expect(totals.keys).toHaveLength(2);
      const team = totals.keys.find((key) => key.providerId === "bigmodel-team")!;
      expect(team.requests).toBe(3);
      expect(team.errors).toBe(1);
      // Three rows with input 1000 + 500 + 1000, cache 300 + 500 + 300.
      expect(team.inputTokens).toBe(2_500);
      expect(team.cacheReadTokens).toBe(1_100);
      expect(team.outputTokens).toBe(300);
      // 1100 / (2500 + 1100)
      expect(team.cacheHitRate).toBeCloseTo(1_100 / 3_600, 6);
      // 2500 in + 1100 cached + 300 out at glm-5.3 peak rates.
      expect(team.credits.inputCredits).toBeCloseTo(2500 * 6.9 / 10_000, 6);
      expect(team.credits.cacheCredits).toBeCloseTo(1100 * 1.7 / 10_000, 6);
      expect(team.credits.outputCredits).toBeCloseTo(300 * 24 / 10_000, 6);

      const builtin = totals.keys.find((key) => key.providerId === "builtin:bigmodel-coding-plan")!;
      expect(builtin.requests).toBe(1);
      // GLM-5.3 uppercase resolves to the same rates.
      expect(builtin.credits.inputCredits).toBeCloseTo(9_000 * 6.9 / 10_000, 6);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("masks provider API keys from the user config", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zcode-stats-"));
    try {
      await mkdir(dirname(userConfigPath({ HOME: directory })), { recursive: true });
      await writeFile(
        userConfigPath({ HOME: directory }),
        JSON.stringify({
          provider: {
            "bigmodel-team": {
              name: "Team plan",
              options: { apiKey: "abcdefghijklmnopqrstuvwxyz" }
            }
          }
        }),
        "utf8"
      );
      const totals = await collectStats(
        join(directory, "db.sqlite"),
        { HOME: directory },
        () => Promise.resolve(fakeDatabase([baseRow]))
      );
      const key = totals.keys[0]!;
      expect(key.providerId).toBe("bigmodel-team");
      expect(key.apiKeyMasked).toBe("abcd…wxyz");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("flags credits as estimated for models without published rates", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zcode-stats-"));
    try {
      const totals = await collectStats(
        join(directory, "db.sqlite"),
        { HOME: directory },
        () => Promise.resolve(fakeDatabase([
          { ...baseRow, model_id: "unknown-model" }
        ]))
      );
      const legacy = totals.keys[0]!;
      expect(legacy.credits.estimated).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("reports missing databases with a clear error", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zcode-stats-"));
    try {
      await expect(
        collectStats(join(directory, "db.sqlite"), { HOME: directory })
      ).rejects.toThrow(/not found/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("vendor spend report", () => {
  test("resolves the shared credentials file path", () => {
    expect(credentialsFilePath({ HOME: "/home/alice" })).toBe("/home/alice/.zcode/v2/credentials.json");
  });

  test("decrypts runtime enc:v1 credentials with the derived fallback key", () => {
    // Encrypted with the same algorithm as the runtime: AES-256-GCM, key =
    // SHA-256("zcode-credential-fallback:<platform>:<home>:<user>").
    const { createCipheriv, createHash } = require("node:crypto") as typeof import("node:crypto");
    const { homedir, userInfo } = require("node:os") as typeof import("node:os");
    const secret = `zcode-credential-fallback:${process.platform}:${homedir()}:${userInfo().username}`;
    const key = createHash("sha256").update(secret).digest();
    const cipher = createCipheriv("aes-256-gcm", key, Buffer.alloc(12, 7));
    const data = Buffer.from("plain-secret-token", "utf8");
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const value = `enc:v1:${Buffer.alloc(12, 7).toString("base64url")}`
      + `.${cipher.getAuthTag().toString("base64url")}`
      + `.${encrypted.toString("base64url")}`;
    expect(decryptCredential(value)).toBe("plain-secret-token");
    expect(decryptCredential("not-encrypted")).toBe("not-encrypted");
  });

  test("parses the monitor response and skips unusable tokens", async () => {
    // The function reads the shared credentials file first; provide one with a
    // stored (encrypted) BigModel token so the fetch stage is reached.
    const { createCipheriv, createHash } = require("node:crypto") as typeof import("node:crypto");
    const { homedir, userInfo } = require("node:os") as typeof import("node:os");
    const directory = await mkdtemp(join(tmpdir(), "zcode-spend-"));
    try {
      const secret = `zcode-credential-fallback:${process.platform}:${homedir()}:${userInfo().username}`;
      const key = createHash("sha256").update(secret).digest();
      const iv = Buffer.alloc(12, 9);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(Buffer.from("fake-bigmodel-jwt", "utf8")), cipher.final()]);
      const stored = `enc:v1:${iv.toString("base64url")}`
        + `.${cipher.getAuthTag().toString("base64url")}`
        + `.${encrypted.toString("base64url")}`;
      const credentialsPath = credentialsFilePath({ HOME: directory });
      await mkdir(dirname(credentialsPath), { recursive: true });
      await writeFile(credentialsPath, JSON.stringify({ "oauth:bigmodel:access_token": stored }), "utf8");

      const monitorOk: unknown = {
        code: 200,
        data: {
          summary: {
            cacheHitRate: { value: "0.98" },
            totalCredits: { value: "105647.9051" }
          },
          modelUsage: {
            modelDataList: [
              {
                modelCode: "glm-5.3",
                totalCreditsUsage: [27000, 27079.1],
                totalTokensUsage: [291423892, 300000000],
                uncachedInputCreditsUsage: [1000, 1756.4],
                cachedInputCreditsUsage: [24000, 26572.8],
                outputCreditsUsage: [2000, -48.2]
              },
              { modelCode: "glm-4.7", totalCreditsUsage: [0, 0], totalTokensUsage: [0, 0] }
            ]
          }
        }
      };
      const respondWith = (body: unknown, status = 200): typeof fetch =>
        (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
      const env = { HOME: directory };

      const ok = await fetchBigModelSpendReport(7, env, respondWith(monitorOk));
      expect(ok?.totalCredits).toBeCloseTo(105647.9051, 4);
      expect(ok?.cacheHitRate).toBeCloseTo(0.98, 4);
      expect(ok?.modelCredits).toHaveLength(1);
      const model = ok?.modelCredits[0]!;
      expect(model.modelId).toBe("glm-5.3");
      expect(model.totalCredits).toBeCloseTo(54079.1, 4);
      expect(model.totalTokens).toBe(591423892);
      expect(model.inputCredits).toBeCloseTo(2756.4, 4);
      expect(model.cacheCredits).toBeCloseTo(50572.8, 4);
      expect(model.outputCredits).toBeCloseTo(1951.8, 4);

      const failed = await fetchBigModelSpendReport(7, env, respondWith({}, 500));
      expect(failed).toBeUndefined();

      const notJson = await fetchBigModelSpendReport(7, env, respondWith({ code: 401 }));
      expect(notJson).toBeUndefined();

      // No stored token at all → undefined without any fetch.
      const noToken = await fetchBigModelSpendReport(7, { HOME: "/nonexistent" }, respondWith(monitorOk));
      expect(noToken).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("appends the real vendor spend section when available", async () => {
    const spend: SpendReport = {
      totalCredits: 105647.9,
      startTime: "2026-07-24 00:00:00",
      endTime: "2026-08-23 00:00:00",
      modelCredits: [{
        modelId: "glm-5.3",
        totalCredits: 54079.1,
        totalTokens: 591423892,
        inputCredits: 2756.4,
        cacheCredits: 50572.8,
        outputCredits: 1951.8
      }]
    };
    const totals = await collectStats(
      "/dev/null/db.sqlite",
      { HOME: "/nonexistent" },
      () => Promise.resolve(fakeDatabase([baseRow])),
      { serverSpend: spend }
    );
    const report = formatStatsReport(totals);
    expect(report).toContain("Vendor spend report (real credits, 2026-07-24 → 2026-08-23)");
    expect(report).toContain("105,647.9 credits");
    expect(report).toContain("glm-5.3: 54,079.1 credits (input 2,756.4 + cache 50,572.8 + output 1,951.8) (591,423,892 tokens)");
    // The estimated line stays labeled as such.
    expect(report).toMatch(/credits [\d.,]+ \(estimated\)/u);
  });
});

describe("stats report formatting", () => {
  test("renders per-key lines with hit rate and credit buckets", async () => {
    const totals = await collectStats(
      "/dev/null/db.sqlite",
      { HOME: "/nonexistent" },
      () => Promise.resolve(fakeDatabase([baseRow]))
    );
    const report = formatStatsReport(totals);
    expect(report).toContain("Model usage by provider");
    expect(report).toContain("bigmodel-team");
    expect(report).toContain("requests: 1 (0 errors)");
    expect(report).toContain("input tokens: 1,000");
    expect(report).toContain("cache-hit tokens: 300 (hit rate 23.1%)");
    expect(report).toContain("output tokens: 200");
    expect(report).toContain("credits: input 0.7 + cache 0.1 + output 0.5");
    expect(report).toContain("All providers:");
  });

  test("handles an empty database", () => {
    expect(formatStatsReport({
      keys: [],
      inputTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      cacheHitRate: 0,
      credits: { inputCredits: 0, cacheCredits: 0, outputCredits: 0, estimated: false }
    })).toContain("No model usage recorded yet");
  });

  test("emits machine-readable JSON", async () => {
    const totals = await collectStats(
      "/dev/null/db.sqlite",
      { HOME: "/nonexistent" },
      () => Promise.resolve(fakeDatabase([baseRow]))
    );
    const parsed = JSON.parse(formatStatsJson(totals)) as { keys: { providerId: string }[] };
    expect(parsed.keys).toHaveLength(1);
  });
});

describe("stats command runner", () => {
  test("writes the report to stdout and exits zero", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zcode-stats-"));
    try {
      await writeFile(join(directory, "db.sqlite"), "", "utf8");
      const outChunks: string[] = [];
      const errChunks: string[] = [];
      const stdout = { write: (text: string) => outChunks.push(text) } as unknown as NodeJS.WriteStream;
      const stderr = { write: (text: string) => errChunks.push(text) } as unknown as NodeJS.WriteStream;
      const code = await runStatsReport({ args: ["stats"] }, {
        env: { HOME: directory },
        openDatabase: () => Promise.resolve(fakeDatabase([baseRow])),
        stdout,
        stderr
      });
      expect(code).toBe(0);
      expect(errChunks).toHaveLength(0);
      expect(outChunks[0]).toContain("Model usage by provider");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("reports a missing database on stderr with exit code 1", async () => {
    const outChunks: string[] = [];
    const errChunks: string[] = [];
    const stdout = { write: (text: string) => outChunks.push(text) } as unknown as NodeJS.WriteStream;
    const stderr = { write: (text: string) => errChunks.push(text) } as unknown as NodeJS.WriteStream;
    const code = await runStatsReport({ args: ["stats"] }, { env: { HOME: "/nonexistent" }, stdout, stderr });
    expect(code).toBe(1);
    expect(outChunks).toHaveLength(0);
    expect(errChunks[0]).toMatch(/Error: /u);
  });

  test("emits JSON when --json is passed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zcode-stats-"));
    try {
      await writeFile(join(directory, "db.sqlite"), "", "utf8");
      const outChunks: string[] = [];
      const stdout = { write: (text: string) => outChunks.push(text) } as unknown as NodeJS.WriteStream;
      const stderr = { write: () => {} } as unknown as NodeJS.WriteStream;
      const code = await runStatsReport({ args: ["stats", "--json"] }, {
        env: { HOME: directory },
        openDatabase: () => Promise.resolve(fakeDatabase([baseRow])),
        stdout,
        stderr
      });
      expect(code).toBe(0);
      const parsed = JSON.parse(outChunks[0] ?? "") as { keys: unknown[] };
      expect(parsed.keys).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
