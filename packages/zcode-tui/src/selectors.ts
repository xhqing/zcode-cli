import { displayModelRef, displayProviderId, envProviderSlotPrefix } from "../../../src/env-config.ts";

import { asString, isRecord } from "./types.ts";

export interface PickerItem {
  value: string;
  label: string;
  description?: string;
  command: string;
}

export interface PickerSpec {
  items: PickerItem[];
  selectedIndex: number;
}

/** Provider→model cascade produced from the runtime's modelOptions list. */
export interface ProviderModelGroup {
  providerId: string;
  label: string;
  models: PickerSpec;
}

export interface ProviderModelPicker {
  providers: PickerSpec;
  groups: ProviderModelGroup[];
}

function pickerRequest(input: string, commands: Set<string>): boolean {
  const match = /^\/([^\s]+)(?:\s+(.*))?$/u.exec(input.trim());
  if (!match || !commands.has(match[1]?.toLowerCase() ?? "")) return false;
  const argument = match[2]?.trim().toLowerCase() ?? "";
  return argument === "" || argument === "list";
}

export function isModelPickerRequest(input: string): boolean {
  return pickerRequest(input, new Set(["model"]));
}

export function isModePickerRequest(input: string): boolean {
  return pickerRequest(input, new Set(["mode"]));
}

export function modePicker(currentMode?: string, availableModes?: readonly string[]): PickerSpec {
  const list = availableModes?.length ? availableModes : ["build", "edit", "yolo", "plan"];
  const items: PickerItem[] = list.map((mode) => ({
    value: mode,
    label: mode.charAt(0).toUpperCase() + mode.slice(1),
    description: mode === currentMode ? "current" : undefined,
    command: `/mode ${mode}`
  }));
  const currentIndex = items.findIndex((item) => item.value === currentMode);
  return { items, selectedIndex: currentIndex >= 0 ? currentIndex : 0 };
}

/**
 * Extract the explicit model reference from `/model <provider/model>`.
 * Returns undefined for the bare picker forms (`/model`, `/model list`) and
 * malformed references. Runtime aliases are returned as explicit requests so
 * they also use the session-only transient model bridge.
 */
export function explicitModelRequest(input: string): string | undefined {
  const match = /^\/model\s+(\S+)$/iu.exec(input.trim());
  const argument = match?.[1];
  if (!argument || argument.toLowerCase() === "list") return undefined;
  if (/^(?:main|lite|sonnet|opus|haiku)$/iu.test(argument)) return argument;
  const separator = argument.indexOf("/");
  if (separator <= 0 || separator === argument.length - 1) return undefined;
  return argument;
}

export function isEffortPickerRequest(input: string): boolean {
  return pickerRequest(input, new Set(["effort", "variant"]));
}

interface ModelOption {
  id: string;
  providerId: string;
  modelId: string;
  name?: string;
  providerLabel?: string;
}

function extractModelId(record: Record<string, unknown> | undefined, raw: unknown): string | undefined {
  const direct = asString(record?.id);
  if (direct) return direct;
  const modelId = asString(record?.modelId);
  if (modelId) {
    const providerId = asString(record?.providerId);
    return providerId ? `${providerId}/${modelId}` : modelId;
  }
  return asString(raw);
}

function parseModelRef(id: string): { providerId: string; modelId: string } | undefined {
  const separator = id.indexOf("/");
  if (separator <= 0 || separator === id.length - 1) return undefined;
  return { providerId: id.slice(0, separator), modelId: id.slice(separator + 1) };
}

/**
 * The official-slot id for an env-file slot entry: `env-<provider>/<model>`
 * maps to `<provider>/<model>`. Ids outside env-file slots return undefined.
 */
function officialTwinId(id: string): string | undefined {
  const separator = id.indexOf("/");
  if (separator <= 0) return undefined;
  const providerId = id.slice(0, separator);
  if (!providerId.startsWith(envProviderSlotPrefix)) return undefined;
  return `${displayProviderId(providerId)}${id.slice(separator)}`;
}

/**
 * Filters out env-file slot entries whose official-slot twin is also listed.
 * A provider also configured through custom-provider.env lists its models in
 * both the official slot and the env-file slot — the runtime reports both, and
 * pickers show each model once (the official entry wins; its id matches the
 * displayed current model). Env-only entries without an official twin stay.
 * Usability is not decided here: while signed out the official slot carries no
 * credential, and the switch path resolves the credentialed env slot instead
 * (`resolveModelSlotRef`), so every listed model works signed in or not.
 */
function withoutEnvSlotTwins<T>(entries: T[], idOf: (entry: T) => string): T[] {
  const officialIds = new Set(
    entries.map(idOf).filter((id) => officialTwinId(id) === undefined)
  );
  return entries.filter((entry) => {
    const twin = officialTwinId(idOf(entry));
    return twin === undefined || !officialIds.has(twin);
  });
}

/**
 * Both the internal slot form (`env-<provider>/<model>`) and the display form
 * (`<provider>/<model>`) of the current model reference. The saved config
 * keeps the internal form — which after the env-slot-twin dedup may not match
 * any listed id — so current-model marking matches either form.
 */
function currentModelIds(currentModel?: string): Set<string> {
  if (!currentModel) return new Set();
  return new Set([currentModel, displayModelRef(currentModel)]);
}

function extractModelOption(option: unknown): ModelOption | undefined {
  const record = isRecord(option) ? option : undefined;
  const id = extractModelId(record, option);
  if (!id) return undefined;
  const parsed = parseModelRef(id);
  if (!parsed) return undefined;
  return {
    id,
    providerId: parsed.providerId,
    modelId: parsed.modelId,
    name: asString(record?.name) ?? asString(record?.label),
    providerLabel: asString(record?.providerLabel) ?? asString(record?.providerName)
  };
}

function modelLabel(option: ModelOption): string {
  return option.name && option.name !== option.modelId
    ? option.name
    : option.modelId;
}

/** Current-model match on both forms: the internal slot id and its display form. */
function isCurrentModel(id: string, currentIds: ReadonlySet<string>): boolean {
  return currentIds.has(id) || currentIds.has(displayModelRef(id));
}

function describeModel(option: ModelOption, currentIds: ReadonlySet<string>): string | undefined {
  const details = [
    option.name && option.name !== option.modelId ? option.name : undefined,
    isCurrentModel(option.id, currentIds) ? "current" : undefined
  ].filter((value): value is string => Boolean(value));
  return details.length > 0 ? details.join(" · ") : undefined;
}

function providerLabel(option: ModelOption): string {
  return option.providerLabel ?? displayProviderId(option.providerId);
}

/**
 * Group the runtime's flat `modelOptions` list by provider, producing a
 * three-level cascade: provider → main model → lite model.
 *
 * The runtime passes each option as `{ modelId, providerId, ... }` (from
 * `listModels()`/`RXr`), but tests and some callers use `{ id, name }` — both
 * forms are accepted.
 *
 * Groups are keyed by the display provider id, so an official slot and the
 * same provider's custom.env slot (`env-<id>`) merge into a single group.
 * `signedIn === false` keeps only custom.env-slot entries (the official slots
 * carry no credential while signed out, so their entries would not connect);
 * `undefined` and `true` keep the full list.
 */
export function providerModelPicker(
  options: unknown[],
  currentModel?: string,
  signedIn?: boolean
): ProviderModelPicker | null {
  const parsed: ModelOption[] = [];
  const seen = new Set<string>();

  for (const option of options) {
    const candidate = extractModelOption(option);
    if (!candidate || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    parsed.push(candidate);
  }

  const candidates = signedIn === false
    ? parsed.filter((candidate) => candidate.providerId.startsWith(envProviderSlotPrefix))
    : parsed;

  const currentIds = currentModelIds(currentModel);
  const byProvider = new Map<string, ModelOption[]>();
  for (const candidate of withoutEnvSlotTwins(candidates, (option) => option.id)) {
    const groupId = displayProviderId(candidate.providerId);
    const group = byProvider.get(groupId) ?? [];
    group.push(candidate);
    byProvider.set(groupId, group);
  }

  if (byProvider.size === 0) return null;

  const groups: ProviderModelGroup[] = [];
  for (const [providerId, models] of byProvider) {
    const label = providerLabel(models[0]!);
    const items: PickerItem[] = models.map((model) => {
      const value = displayModelRef(model.id);
      return {
        value,
        label: modelLabel(model),
        description: describeModel(model, currentIds),
        command: `/model ${value}`
      };
    });
    const currentIndex = items.findIndex((item) => currentIds.has(item.value));
    groups.push({
      providerId,
      label,
      models: { items, selectedIndex: currentIndex >= 0 ? currentIndex : 0 }
    });
  }

  const providerItems: PickerItem[] = groups.map((group) => {
    const currentInGroup = group.models.items.some((item) => currentIds.has(item.value));
    const currentModelId = group.models.items.find((item) => currentIds.has(item.value))?.label;
    return {
      value: group.providerId,
      label: group.label,
      description: [
        `${group.models.items.length} model${group.models.items.length === 1 ? "" : "s"}`,
        currentInGroup && currentModelId ? `current: ${currentModelId}` : undefined
      ].filter((value): value is string => Boolean(value)).join(" · "),
      command: ""
    };
  });

  return {
    providers: {
      items: providerItems,
      selectedIndex: providerItems.findIndex((item) =>
        groups[providerItems.indexOf(item)]!.models.items.some((m) => currentIds.has(m.value))
      )
    },
    groups
  };
}

/**
 * Flat `/model` picker. Values, labels and the generated `/model <id>`
 * commands use the prefix-free display form (`displayModelRef`); the internal
 * `env-` slot prefix never reaches the user. `signedIn === false` keeps only
 * custom.env-slot entries (official slots carry no credential while signed
 * out); `undefined` and `true` keep the full list. The picked value resolves
 * back to a credentialed slot through `resolveModelSlotRef`.
 */
export function modelPicker(
  options: unknown[],
  currentModel?: string,
  signedIn?: boolean
): PickerSpec {
  const records = new Map<string, Record<string, unknown> | undefined>();
  for (const option of options) {
    const record = isRecord(option) ? option : undefined;
    const id = asString(record?.id) ?? asString(option);
    if (!id || records.has(id)) continue;
    records.set(id, record);
  }

  let ids = [...records.keys()];
  if (signedIn === false) {
    ids = ids.filter((id) => id.startsWith(envProviderSlotPrefix));
  }

  const currentIds = currentModelIds(currentModel);
  const items: PickerItem[] = withoutEnvSlotTwins(ids, (id) => id).map((id) => {
    const record = records.get(id);
    const value = displayModelRef(id);
    const details = [
      asString(record?.name) !== id ? asString(record?.name) : undefined,
      asString(record?.alias),
      isCurrentModel(id, currentIds) ? "current" : undefined
    ].filter((detail): detail is string => Boolean(detail));
    return {
      value,
      label: value,
      description: details.length > 0 ? details.join(" · ") : undefined,
      command: `/model ${value}`
    };
  });

  const currentIndex = items.findIndex((item) => currentIds.has(item.value));
  return { items, selectedIndex: currentIndex >= 0 ? currentIndex : 0 };
}

export function effortPicker(options: unknown[], currentEffort?: string): PickerSpec {
  const items: PickerItem[] = [];
  const seen = new Set<string>();

  for (const option of options) {
    const record = isRecord(option) ? option : undefined;
    const id = asString(record?.id) ?? asString(option);
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const label = asString(record?.label) ?? id;
    items.push({
      value: id,
      label,
      description: [label !== id ? id : undefined, id === currentEffort ? "current" : undefined]
        .filter((value): value is string => Boolean(value))
        .join(" · ") || undefined,
      command: `/effort ${id}`
    });
  }

  const currentIndex = items.findIndex((item) => item.value === currentEffort);
  return { items, selectedIndex: currentIndex >= 0 ? currentIndex : 0 };
}
