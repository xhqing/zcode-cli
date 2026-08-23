import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Writable } from "node:stream";

import { captureCommand } from "./command.ts";
import { compareReleaseVersions, parseReleaseVersion } from "../scripts/release-version.ts";

export const updateRepository = "xhqing/zcode-cli";
/** npm package name; the registry distributes the project as zcode-app-cli. */
export const packageName = "zcode-app-cli";
/** Display name used in user-facing progress output. */
export const displayName = "zcode-cli";
/**
 * Release asset name for a version. Assets are named after the project
 * (`zcode-cli-<version>.tgz`), not the npm package; pack-release.ts renames
 * the `npm pack` output accordingly.
 */
export function releaseAssetName(version: string): string {
  return `zcode-cli-${version}.tgz`;
}

export interface LatestRelease {
  tagName: string;
  version: string;
}

export interface UpdateRunOptions {
  /** Returns the newest published GitHub Release. */
  fetchLatest?: () => Promise<LatestRelease | undefined>;
  /** Installs the downloaded tarball; defaults to `npm install -g <tarball>`. */
  install?: (tarballPath: string) => Promise<void>;
  /** Resolves a writable temporary directory; exposed for tests. */
  makeTempDir?: () => Promise<string>;
  /** Overrides the gh download channel; exposed for tests. */
  downloadRunners?: Parameters<typeof downloadReleaseTarball>[2];
  stderr?: Writable;
  stdout?: Writable;
}

function output(options: UpdateRunOptions): { err: Writable; out: Writable } {
  return { err: options.stderr ?? process.stderr, out: options.stdout ?? process.stdout };
}

function write(stream: Writable, text: string): void {
  stream.write(text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Matches invocation forms `zcode update` and `zcode --update`. */
export function isUpdateInvocation(args: string[]): boolean {
  return args.length === 1 && (args[0] === "update" || args[0] === "--update");
}

async function runGh(args: string[]): Promise<unknown> {
  const { code, stdout, stderr } = await captureCommand("gh", args);
  if (code !== 0) {
    const failure = new Error(
      stderr.trim() || `gh ${args[0]!} exited with status ${code}`
    ) as Error & { stderr: string };
    failure.stderr = stderr;
    throw failure;
  }
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error("gh returned invalid release metadata.");
  }
}

function releaseVersion(tagName: string): string {
  const version = parseReleaseVersion(tagName.replace(/^v/u, ""));
  if (!version) throw new Error(`Cannot parse a release version from tag "${tagName}".`);
  return tagName.replace(/^v/u, "");
}

/**
 * Latest GitHub Release metadata for the project repository. Requires the
 * `gh` CLI; failures (missing binary, no authentication, repository without
 * releases) reject so the update command can surface one actionable hint.
 */
export async function fetchLatestGithubRelease(repository = updateRepository): Promise<LatestRelease> {
  const payload = await runGh([
    "release",
    "view",
    "--repo",
    repository,
    "--json",
    "tagName"
  ]);
  if (!isRecord(payload) || typeof payload.tagName !== "string") {
    throw new Error("gh returned no tag name for the latest release.");
  }
  return { tagName: payload.tagName, version: releaseVersion(payload.tagName) };
}

function ghDownloadHint(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/release not found|no releases/iu.test(message)) {
    return `No GitHub Release exists yet in ${updateRepository}. Publish one first; `
      + "`zcode --update` installs only from GitHub Release assets.";
  }
  return `${message}\nInstall the latest release manually from `
    + `https://github.com/${updateRepository}/releases/latest, `
    + "or check that the gh CLI is installed and authenticated (`gh auth status`).";
}

function downloadTarballOptions(
  release: LatestRelease,
  directory: string
): { args: string[]; command: string } {
  return {
    command: "gh",
    args: [
      "release",
      "download",
      release.tagName,
      "--repo",
      updateRepository,
      "--pattern",
      releaseAssetName(release.version),
      "--dir",
      directory,
      "--clobber"
    ]
  };
}

/**
 * Download the release tarball asset into a scratch directory. GitHub
 * Release is the only channel: a release without the tarball asset is an
 * error, not a reason to fall back elsewhere.
 */
export async function downloadReleaseTarball(
  release: LatestRelease,
  directory: string,
  runners: { ghDownload?: (args: string[]) => Promise<{ code: number; stderr: string }> } = {}
): Promise<string> {
  const expected = join(directory, releaseAssetName(release.version));
  const ghDownload = runners.ghDownload
    ?? (async (args) => await captureCommand("gh", args));
  const { command, args } = downloadTarballOptions(release, directory);
  const { code, stderr } = await ghDownload(args);
  if (code === 0) return expected;
  throw new Error(
    stderr.trim()
    || `${command} download failed with status ${code}.`
  );
}

function npmInstallGlobal(tarballPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["install", "-g", tarballPath], { stdio: "inherit" });
    child.once("error", (error) => reject(error));
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm install -g exited with status ${code}.`));
    });
  });
}

/**
 * Self-update to the newest GitHub Release. Prints progress to the given
 * streams and returns 0 when the installation completes (or nothing to do).
 */
export async function runSelfUpdate(
  currentVersion: string,
  options: UpdateRunOptions = {}
): Promise<number> {
  const streams = output(options);
  const fetchLatest = options.fetchLatest ?? fetchLatestGithubRelease;
  const install = options.install ?? npmInstallGlobal;
  const makeTempDir = options.makeTempDir ?? (async () => await mkdtemp(join(tmpdir(), "zcode-update-")));

  write(streams.out, "Checking for zcode-cli updates…\n");
  let latest: LatestRelease | undefined;
  try {
    latest = await fetchLatest();
    if (!latest?.tagName || !latest.version) throw new Error("No release metadata was resolved.");
  } catch (error) {
    throw new Error(ghDownloadHint(error));
  }
  const release = latest;
  write(streams.out, `Current version : ${currentVersion}\n`);
  write(streams.out, `Latest version  : ${release.version} (${updateRepository} release)\n`);

  const current = parseReleaseVersion(currentVersion);
  if (current && compareReleaseVersions(currentVersion, release.version) >= 0) {
    write(streams.out, "Already up-to-date.\n");
    return 0;
  }

  const directory = await makeTempDir();
  try {
    write(streams.out, `Downloading ${displayName} ${release.version} (${releaseAssetName(release.version)})…\n`);
    const tarballPath = await downloadReleaseTarball(release, directory, options.downloadRunners);
    write(streams.out, "Installing globally…\n");
    await install(tarballPath);
  } catch (error) {
    throw new Error(ghDownloadHint(error));
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }

  write(streams.out, `\nUpdated to ${release.version} successfully!\n`);
  write(streams.out, "Run `zcode` again to start the new version.\n");
  return 0;
}
