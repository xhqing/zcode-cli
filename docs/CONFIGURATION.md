# Configuration

This document covers the detailed model-access configuration for
zcode-cli. For installation and basic usage, see the
[main README](../README.md).

## Configuration file location

On first launch, ZCode recursively creates the configuration directory and a
credential-free `config.json` when it is missing. Existing files are never
replaced. The location is `~/.zcode/cli/config.json` on macOS and Linux, and
`%USERPROFILE%\.zcode\cli\config.json` on Windows. Newly created directories
and files use private permissions on POSIX; Windows keeps the current user's
inherited ACLs.

The generated file contains the complete non-secret configuration shape plus
valid Z.AI model metadata, but deliberately omits `apiKey` until one is
configured. This lets the official runtime and TUI start cleanly without
pretending that model access is already configured. Choose one of the
model-access paths below before sending a prompt.

## First-run setup wizard

When the TUI starts while model access has not been set up, a setup wizard
opens automatically. ZCode tracks this with a `setup-pending` marker file next
to `config.json`: it is written when the credential-free default config is
first created, survives non-interactive commands (`zcode plugin list`,
`zcode -p …`, `app-server`, …) so the wizard still appears on the first
interactive TUI start, and is cleared once setup is handled — finishing or
explicitly skipping the wizard, choosing the custom-provider help entry,
deferring the post-import sign-in, or configuring model access by any other
means (`zcode login`, a hand-edited `config.json`), in which case the wizard
does not appear at all. The marker is only kept when login or the desktop
import was attempted and failed, so an unconfigured user is guided again on
the next start. Press Esc to skip the wizard. It can be reopened anytime with
`/setup`, and it never appears for an existing configuration unless invoked
manually.

### Importing settings from the ZCode desktop app

The desktop import copies the selected desktop provider family (Z.AI or
BigModel): provider name, `baseURL`, and the desktop model list (merged into
the existing models, desktop IDs first). `model.main` keeps the current
selection when the model ID exists on both sides (case-insensitively),
otherwise it falls back to the first available of `glm-5.2`/`glm-5.3` (or the
desktop list's first model); `model.lite` falls back to `glm-5-turbo` and then
to the selected main model, so both selections always reference models that
exist after the import. A backup of the pre-import `config.json` is written
next to it as `config.json.pre-migration.bak`; if the backup cannot be
written, the import is aborted before any change is made.

Desktop credentials are never copied: the desktop app stores them encrypted
(`enc:v1:`) with a key held by the desktop process, and the CLI reads desktop
files only. After importing, sign in once via the offered login step (or
`/login` later) so a fresh Coding Plan API key lands in the CLI config. An
existing CLI-side `apiKey` for the same provider is always preserved.

## Model-access paths

Three model-access paths are supported:

- **Z.AI OAuth on macOS**: run `zcode login` when no provider is configured, or
  `zcode login --oauth` to force reauthorization; add `--no-browser` to print
  the authorization URL instead of opening a browser (useful over SSH);
- **Z.AI/BigModel Coding Plan API key**: open `/login` in the TUI and choose the
  matching masked API-key option;
- **Direct API key with a custom provider**: use the
  [`config.example.json`](../config.example.json) template — or the flat
  [`.env` file](#environment-file-env) — and do not log in.

When `model.main` already resolves to a configured provider/model with an
inline API key, plain `zcode login` exits successfully and explains that OAuth
is unnecessary. This prevents a custom provider from being replaced by an
unrelated login flow.

## Usage stats per API key

`zcode stats` prints a usage report grouped by provider, aggregated from the
local SQLite database the runtime maintains at `~/.zcode/cli/db/db.sqlite`
(`%USERPROFILE%\.zcode\cli\db\db.sqlite` on Windows). Each group shows the
provider ID with the masked API key, request/error counts, input tokens,
cache-hit tokens with hit rate, output tokens, and estimated credit
consumption split into input / cache / output buckets (official GLM Coding
Plan rates: credits = tokens × rate ÷ 10000; off-peak hours at 50%).
`zcode stats --json` emits the same data as JSON for scripting.

zcode-cli sends requests through the official ZCode runtime (requests carry
`User-Agent: ZCode/<version>`), so ZCode-targeted vendor promotions apply
here too. When the BigModel OAuth token stored by `zcode login` is available,
`zcode stats` queries the vendor monitor API (the same one the ZCode desktop
usage page calls) and appends a real server-side spend report: actual
deducted credits per model with input / cache / output buckets. A missing
token or a failed request silently omits the section.

### Environment file (.env)

Instead of hand-editing the nested `config.json`, keep model settings in a
single flat file. Copy the commented template from the repository to
`~/.zcode/cli/.env` (same directory as `config.json`; override the location
with `ZCODE_ENV_FILE`) and fill in your values:

```bash
mkdir -p ~/.zcode/cli
cp .env.example ~/.zcode/cli/.env
chmod 600 ~/.zcode/cli/.env
```

The minimum required content:

```bash
ZCODE_API_KEY=your-api-key
ZCODE_MAIN_MODEL=glm-5.2
```

Optional entries (all documented inline in `.env.example`): the provider ID
(`ZCODE_PROVIDER_ID`, default `zai`; use `zai` or `bigmodel` because the
upstream login gate only recognizes API keys under those IDs), the display
name, the wire protocol (`ZCODE_PROVIDER_KIND`: `anthropic`, `openai`, or
`openai-compatible`), the endpoint root (`ZCODE_BASE_URL`), the lite model for
lightweight/subagent work (`ZCODE_LITE_MODEL`), and extra models for the picker
(`ZCODE_EXTRA_MODELS`, comma-separated `id` or `id:Display Name` entries).

On every start zcode reads the file and syncs it into `config.json` before the
runtime boots. The file is the authority for its own provider entry and the
`model` block; other providers (for example credentials written by an OAuth
login) and every unrelated config block are left untouched. A file without
model settings is ignored, an absent file changes nothing, and invalid values
stop startup with a clear error pointing at the offending entry. Deleting the
file returns control to `config.json`.

The file holds a live API key: keep it out of every repository and at mode 600.

#### Multiple keys with automatic failover

Keys are configured one variable per key: the primary stays in
`ZCODE_API_KEY`, backups add numbered variables (tried in ascending order,
duplicates dropped):

```bash
ZCODE_API_KEY=key-aaaa
ZCODE_API_KEY_2=key-bbbb
ZCODE_API_KEY_3=key-cccc
ZCODE_MAIN_MODEL=glm-5.2
```

With more than one key zcode starts a loopback proxy (bound to `127.0.0.1`,
first free port from 7849) before the runtime boots and syncs the provider in
`config.json` to point at it with the placeholder key `zcode-failover`. The
runtime keeps talking to what it believes is the real endpoint; the proxy holds
the real keys in memory and forwards every request with the currently selected
key. When the upstream rejects that key — HTTP 401/403/429, any 5xx status, or
a connection failure — the same request is retried with the next key before
anything is sent back. Successful responses are streamed untouched, so SSE
model streams behave exactly as with a single key. The next request starts
from the key that last succeeded.

Failover events are appended to `~/.zcode/cli/key-failover.log` (keys masked
to their first and last four characters, rotated at 1 MiB). If every key fails,
the last upstream answer is passed through so the runtime's own retry logic
and error reporting keep working.

Notes:

- The real keys never enter `config.json` or any other file — only the `.env`
  file and proxy memory hold them.
- The endpoint stays the one declared by `ZCODE_BASE_URL` / the provider
  default; failover only rotates keys, all keys must belong to the same
  endpoint/account family.
- A single key keeps the direct connection with no proxy involved. Removing
  the extra variables (or the `.env` file) restores the previous behavior on
  the next start.
- Each variable holds exactly one key; comma-separated lists are not read.

### Coding Plan API key

Start the TUI and open its setup picker:

```text
/login
```

Choose either **Z.AI Coding Plan API Key** or **BigModel Coding Plan API Key**,
then paste the key into the masked prompt. The raw key is sent only to the
official runtime's `configureCodingPlanApiKey` implementation. The local TUI
does not add it to editor history or the visible/session transcript, and error
messages are redacted before rendering.

The same picker includes a **Custom provider** entry that points to the
configuration-template path below. Custom providers do not use OAuth.

Selecting **Z.AI Coding Plan** releases TUI raw mode and starts the registered
Desktop authorization-code flow. On macOS the CLI temporarily installs a
background-only callback receiver, verifies the returned `state`, restores the
previous `zcode://` handler, and hands the callback to the official runtime.
The authorization code travels over stdin instead of command-line arguments or
environment variables. The runtime performs token exchange, encrypted
credential persistence, Coding Plan API-key resolution and `config.json`
updates. The TUI is then restored and the model configuration is re-read.

The callback receiver is removed after success, cancellation or timeout. A
small recovery record lets the next login restore the previous handler after
an unclean process exit. The BigModel option continues to use the official
localhost-callback implementation inside the runtime.

### Custom provider without login

Start `zcode` once to generate the full user configuration automatically. From
a source checkout, `config.example.json` contains the same initial structure
for reference. Then edit the generated file:

```bash
zcode
```

Edit these four areas in `~/.zcode/cli/config.json` (or the Windows path shown
above):

1. `provider.zai.kind`: use `anthropic`, `openai-compatible`, or `openai`;
2. `provider.zai.options.baseURL`: use the provider's API root;
3. `provider.zai.options.apiKey`: insert the direct API key;
4. replace the entries in `provider.zai.models`, then point both `model.main`
   and `model.lite` at the desired model IDs.

The provider map key is deliberately `zai`. The upstream CLI 0.15.x TUI
considers a direct API key configured only when it is stored under provider ID
`zai` or `bigmodel`. An arbitrary provider ID is valid model configuration,
but as the only provider it still triggers the upstream login gate. The
display name, API format, endpoint, headers and models remain fully custom.

For an Anthropic-compatible endpoint:

```json
{
  "kind": "anthropic",
  "options": {
    "baseURL": "https://example.com/api/anthropic",
    "apiKey": "YOUR_API_KEY",
    "apiKeyRequired": true
  }
}
```

Use the API root, not a final `/messages` path. For an OpenAI-compatible
endpoint, set `kind` to `openai-compatible` and normally use a root ending in
`/v1`, not `/chat/completions`. For the official OpenAI API, use `openai`;
`baseURL` can be omitted.

The object keys form the runtime model reference:

```text
provider.<provider-id>.models.<model-id>
                    -> <provider-id>/<model-id>
```

Set both roles to keep all work on the custom provider:

```json
{
  "model": {
    "main": "zai/your-model-id",
    "lite": "zai/your-model-id"
  }
}
```

`main` is the normal conversation model. `lite` is used for lightweight and
subagent work. Model IDs are case-sensitive and must match the endpoint.

The no-login TUI path currently requires a non-empty `options.apiKey` in the
local config; an environment-only API key does not satisfy the upstream login
gate. Never commit the populated file, and keep its mode at `600`.

### Using the custom provider

After saving the config, no login command is required. Start the client:

```bash
zcode
```

From a source checkout, use `bun run dev` instead (see
[Development](./DEVELOPMENT.md)).

Use these commands inside the TUI:

```text
/model                         # show the active and available models
/model zai/your-model-id       # switch to the custom provider explicitly
/new                           # start a new session with the configured default
```

The status line should show `zai/your-model-id`. Setting both `model.main` and
`model.lite` in the config makes the custom provider the default for normal,
lightweight and subagent work. A resumed session may retain its previous model,
so use `/new` after changing the default.

Headless prompts use the same provider configuration:

```bash
zcode --prompt "Explain this repository"
```

Project-level overrides are read from `zcode.json` or `.zcode/config.json` in
the working directory. Running `/model` does not call the provider, so it is a
safe configuration check before the first prompt.

### Background agents

Long-running Agent calls automatically detach from the foreground turn after
one second and remain available through `/tasks`. Short Agent calls stay inline
so the current response can use their result without a notification round trip.
Configure the threshold in milliseconds:

```json
{
  "subagents": {
    "autoBackgroundMs": 1000
  }
}
```

Set the value to `0` to disable automatic backgrounding. Agent tool calls that
use `run_in_background: true` detach immediately regardless of this threshold.

### Request retries and stalled streams

The CLI leaves retry classification and execution to the official ZCode
runtime. It supplies a default retry budget of five retries; override it when
needed with the runtime's own environment variable:

```bash
ZCODE_MODEL_RETRY_MAX_RETRIES=3 zcode
```

Newly generated configs use a 60-second model-stream idle timeout:

```json
{
  "modelStream": {
    "idleTimeoutMs": 60000
  }
}
```

Existing configs are never overwritten, so update this field manually if an
older generated file still contains `600000`. Retryable timeouts, dropped
streams, rate limits and server/network errors are retried and shown in the
TUI. Authentication and invalid-request responses remain non-retryable.

## Runtime diagnostics

The interactive TUI captures runtime `stderr` so background diagnostics cannot
overwrite terminal rendering. A non-zero runtime exit prints its status and the
diagnostic path after the TUI stops. The active log is capped at 2 MB and rotated
to `.1` on the next launch; both files use owner-only permissions.

The default path is `~/.zcode/cli/tui-runtime.log`. Override it when collecting
diagnostics in an isolated environment:

```bash
ZCODE_TUI_RUNTIME_LOG=/tmp/zcode-tui-runtime.log zcode
```

## Theme

Set `ui.theme` to `"auto"` (terminal detection), `"dark"`, or `"light"` in the
user config: `~/.zcode/cli/config.json` on macOS/Linux or
`%USERPROFILE%\.zcode\cli\config.json` on Windows. An explicit dark/light value
takes priority over terminal probing. `auto` queries the terminal background
color and color scheme at startup and re-applies the matching palette.

## Turn completion notifications

Notifications are enabled by default and emitted after a normal agent turn
completes or fails while the terminal is unfocused. Following Codex's terminal
capability fallback, `auto` uses OSC 9 in Ghostty, iTerm2, Kitty, Warp and
WezTerm, and BEL in terminals such as Apple Terminal. Selecting OSC 9 in an
unsupported terminal also falls back to BEL instead of silently emitting an
ignored sequence.

The `unfocused` condition uses DEC focus reporting when the terminal provides
it. Until focus support is confirmed, ZCode sends the notification instead of
permanently suppressing it as focused. `native` is an explicit opt-in that uses
an existing system command: `terminal-notifier` on macOS, `notify-send` on
Linux, or `SnoreToast` on Windows. These tools are not bundled, keeping the
default terminal notification path dependency-free. If the selected command is
unavailable or delivery fails, ZCode falls back to BEL. On macOS, the detected
terminal application is used as both the sender and click target. Exact tab or
pane restoration remains terminal-dependent; use the default `auto` setting so
OSC-capable terminals can preserve their native session behavior.

Open the interactive settings picker inside the TUI (both commands are
equivalent):

```text
/config
/settings
```

Saving a value returns to the settings root so several options can be changed
in one visit. `Esc` returns from a setting to the root, then closes the root.

The picker updates the active session immediately and persists the selected
values under `ui.notifications` in the cross-platform user `config.json`:

```json
{
  "ui": {
    "notifications": {
      "method": "auto",
      "condition": "unfocused"
    }
  }
}
```

Environment variables override `config.json` on startup and are useful for a
temporary per-shell setting:

```bash
export ZCODE_TUI_NOTIFICATION_METHOD=auto       # auto|osc9|bel|native|off
export ZCODE_TUI_NOTIFICATION_CONDITION=always  # unfocused|always
zcode
```
