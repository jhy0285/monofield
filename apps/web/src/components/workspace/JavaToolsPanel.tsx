"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Button } from "@open-design/components";
import type {
  JavaToolsStatus,
  JavaSemanticResult,
  JavaLocation,
  JavaPosition,
  JavaTextEdit,
} from "@open-design/contracts";
import { useT } from "../../i18n";
import { rememberJavaLocation, takeJavaLocation } from "../../state/java-tools";
import styles from "./JavaToolsPanel.module.css";
import { JavaDebugPanel } from "./JavaDebugPanel";

export function javaEditorOffset(text: string, point: JavaPosition) {
  const lines = text.split("\n");
  return (
    lines.slice(0, point.line).reduce((sum, line) => sum + line.length + 1, 0) +
    point.character
  );
}
export function applyEditorEdits(text: string, edits: JavaTextEdit[]) {
  const sorted = edits
    .map((edit) => ({
      start: javaEditorOffset(text, edit.range.start),
      end: javaEditorOffset(text, edit.range.end),
      text: edit.newText,
    }))
    .sort((a, b) => b.start - a.start);
  for (const edit of sorted)
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  return text;
}
const documentWrites = new Map<string, Promise<unknown>>();
function queueDocument(key: string, write: () => Promise<unknown>) {
  const next = (documentWrites.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(write);
  documentWrites.set(key, next);
  void next
    .finally(() => {
      if (documentWrites.get(key) === next) documentWrites.delete(key);
    })
    .catch(() => undefined);
  return next;
}
export function JavaToolsPanel({
  projectId,
  file,
  text,
  dirty,
  editorRef,
  onText,
  onRenamed,
  onOpenFile,
}: {
  projectId: string;
  file: string;
  text: string;
  dirty: boolean;
  editorRef: RefObject<HTMLTextAreaElement | null>;
  onText: (text: string) => void;
  onRenamed: () => Promise<void>;
  onOpenFile?: ((file: string) => void) | undefined;
}) {
  const t = useT(),
    base = `/api/projects/${encodeURIComponent(projectId)}/development/java`;
  const [enabled, setEnabled] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [javaHome, setJavaHome] = useState("");
  const [status, setStatus] = useState<JavaToolsStatus | null>(null),
    [result, setResult] = useState<JavaSemanticResult | null>(null),
    [name, setName] = useState("");
  const current = useRef(text);
  current.current = text;
  const epoch = useRef(0);
  const key = JSON.stringify([projectId, file]);
  useEffect(() => {
    setResult((value) => (value?.rename ? value : null));
  }, [text]);
  async function call(endpoint: string, body?: unknown) {
    const response = await fetch(base + endpoint, {
      method: body === undefined ? "GET" : "POST",
      ...(body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ file, ...(body as object) }),
          }),
    });
    const value = await response.json();
    if (!response.ok)
      throw new Error(value?.error?.message ?? "Java tools request failed");
    return value;
  }
  useEffect(() => {
    let cancelled = false;
    void call(`?file=${encodeURIComponent(file)}`)
      .then((state) => {
        if (
          !cancelled &&
          (state.state !== "stopped" || state.resumeAvailable)
        ) {
          setEnabled(true);
          setStatus(state);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, file]);
  function navigate(location: JavaLocation) {
    if (location.path !== file) {
      rememberJavaLocation(projectId, location);
      onOpenFile?.(location.path);
      return;
    }
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    editor.setSelectionRange(
      javaEditorOffset(current.current, location.range.start),
      javaEditorOffset(current.current, location.range.end),
    );
    const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 20;
    editor.scrollTop = Math.max(
      0,
      location.range.start.line * lineHeight - editor.clientHeight / 3,
    );
  }
  useEffect(() => {
    const apply = () => {
      const location = takeJavaLocation(projectId, file);
      if (location) navigate(location);
    };
    apply();
    window.addEventListener("monofield:java-location", apply);
    return () => window.removeEventListener("monofield:java-location", apply);
  }, [projectId, file, editorRef]);
  useEffect(() => {
    const generation = ++epoch.current;
    let stopped = false;
    setStatus(null);
    setResult(null);
    setError("");
    if (!enabled) return;
    const refresh = async () => {
      try {
        const state = await call(`?file=${encodeURIComponent(file)}`);
        if (!stopped && epoch.current === generation) setStatus(state);
      } catch (failure) {
        if (!stopped && epoch.current === generation)
          setError(
            String(failure instanceof Error ? failure.message : failure),
          );
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1200);
    return () => {
      stopped = true;
      epoch.current++;
      window.clearInterval(timer);
      void queueDocument(key, () => call("/close", {})).catch(() => undefined);
    };
  }, [projectId, file, enabled]);
  useEffect(() => {
    if (!enabled || status?.state !== "ready") return;
    const timer = window.setTimeout(
      () =>
        void queueDocument(key, () => call("/document", { text })).catch(
          (failure) => setError(String(failure.message)),
        ),
      350,
    );
    return () => window.clearTimeout(timer);
  }, [text, enabled, status?.state, projectId, file]);
  async function start() {
    setBusy(true);
    setError("");
    try {
      await call("/start", {
        ...(javaHome.trim() ? { javaHome: javaHome.trim() } : {}),
      });
      setEnabled(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }
  async function prepare() {
    setBusy(true);
    setError("");
    try {
      const run = await call("/prepare", {});
      let receipt;
      for (let n = 0; n < 300; n++) {
        receipt = await call(
          `/preparation?file=${encodeURIComponent(file)}&runId=${encodeURIComponent(run.id)}`,
        );
        if (receipt.run?.state !== "running") break;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (receipt?.run?.state !== "passed")
        throw new Error(
          receipt?.run?.error ??
            "Maven dependency preparation failed. Check the verification output.",
        );
      await call("/stop", {});
      await call("/start", {
        resolveDependencies: true,
        ...(javaHome.trim() ? { javaHome: javaHome.trim() } : {}),
      });
      setEnabled(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }
  async function query(
    operation: "completion" | "definition" | "references" | "rename" | "hover",
  ) {
    const captured = current.current,
      offset = editorRef.current?.selectionStart ?? 0;
    const before = captured.slice(0, offset),
      lines = before.split("\n"),
      position = { line: lines.length - 1, character: lines.at(-1)!.length };
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const value = await queueDocument(key, () =>
        call("/query", {
          operation,
          text: captured,
          position,
          ...(operation === "rename" ? { newName: name } : {}),
        }),
      );
      if (current.current === captured) setResult(value as JavaSemanticResult);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !enabled) return;
    const complete = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.code === "Space") {
        event.preventDefault();
        if (!busy) void query("completion");
      }
    };
    editor.addEventListener("keydown", complete);
    return () => editor.removeEventListener("keydown", complete);
  }, [enabled, status?.state, busy]);
  async function applyRename() {
    if (!result?.rename || dirty) return;
    setBusy(true);
    setError("");
    try {
      await call("/rename", { planId: result.rename.id });
      setResult(null);
      await onRenamed();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }
  const ready = enabled && status?.state === "ready";
  return (
    <section className={styles.root} aria-label={t("java.tools.title")}>
      <div className={styles.bar}>
        {!enabled ? (
          <Button disabled={busy} onClick={() => void start()}>
            {busy ? t("common.loading") : t("java.tools.enable")}
          </Button>
        ) : (
          <>
            <span role="status">
              {t(`java.tools.state.${status?.state ?? "starting"}`)}
            </span>
            <Button
              disabled={busy}
              onClick={() =>
                void call("/stop", {})
                  .then(() => setEnabled(false))
                  .catch((failure) => setError(failure.message))
              }
            >
              {t("java.tools.stop")}
            </Button>
            {!ready ? (
              <Button disabled={busy} onClick={() => void start()}>
                {t("fileViewer.reload")}
              </Button>
            ) : null}
          </>
        )}
        {enabled ? (
          <>
            <Button disabled={busy} onClick={() => void query("completion")}>
              {t("java.tools.complete")}
            </Button>
            <Button disabled={busy} onClick={() => void query("definition")}>
              {t("java.tools.definition")}
            </Button>
            <Button disabled={busy} onClick={() => void query("references")}>
              {t("java.tools.references")}
            </Button>
            <Button disabled={busy} onClick={() => void query("hover")}>
              {t("java.tools.hover")}
            </Button>
          </>
        ) : null}
        <details>
          <summary>{t("java.tools.setup")}</summary>
          <p>{t("java.tools.setupHint")}</p>
          <label>
            JDK
            <input
              value={javaHome}
              onChange={(event) => setJavaHome(event.target.value)}
              placeholder="JAVA_HOME"
            />
          </label>
          <Button disabled={busy} onClick={() => void prepare()}>
            {t("java.tools.prepare")}
          </Button>
        </details>
      </div>
      {enabled ? (
        <div className={styles.rename}>
          <input
            aria-label={t("java.tools.newName")}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button
            disabled={busy || dirty || !name.trim()}
            onClick={() => void query("rename")}
          >
            {t("java.tools.rename")}
          </Button>
          {dirty ? <small>{t("java.tools.saveFirst")}</small> : null}
        </div>
      ) : null}
      {error || status?.message ? (
        <p role="alert" className={styles.error}>
          {error || status?.message}
        </p>
      ) : null}
      {status?.diagnostics.length ? (
        <details open>
          <summary>
            {t("java.tools.problems")} ({status.diagnostics.length})
          </summary>
          <ul className={styles.results}>
            {status.diagnostics.slice(0, 100).map((item, i) => (
              <li key={i}>
                <Button
                  onClick={() => navigate({ path: file, range: item.range })}
                >
                  {item.range.start.line + 1}:{item.range.start.character + 1} ·{" "}
                  {item.message}
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {result?.hover ? (
        <pre className={styles.debugOutput}>{result.hover}</pre>
      ) : null}
      {result?.locations ? (
        <ul className={styles.results}>
          {result.locations.length ? (
            result.locations.map((location, i) => (
              <li key={i}>
                <Button
                  disabled={!onOpenFile && location.path !== file}
                  onClick={() => navigate(location)}
                >
                  {location.path}:{location.range.start.line + 1}
                </Button>
              </li>
            ))
          ) : (
            <li>{t("java.tools.noLocations")}</li>
          )}
        </ul>
      ) : null}
      {result?.completions ? (
        <ul className={styles.results}>
          {result.completions.map((item, i) => (
            <li key={i}>
              <Button
                onClick={() => {
                  onText(
                    applyEditorEdits(current.current, [
                      item.edit,
                      ...(item.additionalEdits ?? []),
                    ]),
                  );
                  setResult(null);
                  editorRef.current?.focus();
                }}
              >
                {item.label}
              </Button>
              <small>{item.detail}</small>
            </li>
          ))}
        </ul>
      ) : null}
      {result?.rename ? (
        <div className={styles.preview}>
          <p>
            {t("java.tools.renamePreview", {
              count: result.rename.files.length,
            })}
          </p>
          {result.rename.files.map((file) => (
            <details key={file.path}>
              <summary>{file.path}</summary>
              <div className={styles.compare}>
                <pre>{file.before}</pre>
                <pre>{file.after}</pre>
              </div>
            </details>
          ))}
          <Button disabled={busy || dirty} onClick={() => void applyRename()}>
            {t("docs.impact.apply")}
          </Button>
          <Button onClick={() => setResult(null)}>{t("common.cancel")}</Button>
        </div>
      ) : null}
      <JavaDebugPanel
        projectId={projectId}
        file={file}
        javaHome={javaHome}
        onOpenFile={onOpenFile}
      />
    </section>
  );
}
