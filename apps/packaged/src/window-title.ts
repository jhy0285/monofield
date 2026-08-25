import {
  releaseChannelFromNamespace,
  releaseChannelFromVersion,
  releaseChannelDescriptor,
} from "@open-design/release";

const DEFAULT_WINDOW_TITLE = "MonoField";

export function resolvePackagedWindowTitle(config: { appVersion: string | null; namespace: string }): string {
  const channel =
    releaseChannelFromVersion(config.appVersion) ??
    releaseChannelFromNamespace(config.namespace);
  if (channel == null || channel === "stable") return DEFAULT_WINDOW_TITLE;
  return `${DEFAULT_WINDOW_TITLE} ${releaseChannelDescriptor(channel).displayLabel}`;
}
