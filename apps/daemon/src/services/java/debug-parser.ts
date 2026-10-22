import type { JavaDebugState } from "@open-design/contracts";
export function javaDebugFrames(output: string): JavaDebugState["frames"] {
  return [...output.matchAll(/^\s*\[(\d+)\]\s+(.+?)\s+\(([^\n)]+)\)\s*$/gm)]
    .slice(0, 200)
    .map((match) => {
      const location = /^(.*?):([\d,]+)$/.exec(match[3]!);
      return {
        index: Number(match[1]),
        method: match[2]!,
        source: location?.[1] ?? match[3]!,
        line: location ? Number(location[2]!.replaceAll(",", "")) : null,
      };
    });
}
export function javaDebugLocals(output: string): JavaDebugState["locals"] {
  return [...output.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*=\s*([^\r\n]*)/gm)]
    .slice(0, 200)
    .map((match) => ({ name: match[1]!, value: match[2]!.slice(0, 2000) }));
}
export function javaDebugPrompt(output: string) {
  return /(?:^|\n)(?:[^\n]*\[\d+\]|>)\s*$/.test(output);
}
