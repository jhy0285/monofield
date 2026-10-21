"use client";
import { useEffect, useState } from "react";
import { Button } from "@open-design/components";
import type { JavaDebugState } from "@open-design/contracts";
import { useT } from "../../i18n";
import { rememberJavaLocation } from "../../state/java-tools";
import styles from "./JavaToolsPanel.module.css";

export function JavaDebugPanel({
  projectId,
  file,
  javaHome,
  onOpenFile,
}: {
  projectId: string;
  file: string;
  javaHome: string;
  onOpenFile?: ((path: string) => void) | undefined;
}) {
  const t = useT(),
    [open, setOpen] = useState(false),
    [port, setPort] = useState(5005),
    [line, setLine] = useState(1),
    [className, setClassName] = useState("");
  const [state, setState] = useState<JavaDebugState | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const base = `/api/projects/${encodeURIComponent(projectId)}/development/java/debug`;
  async function call(route: string, body?: unknown) {
    const response = await fetch(base + route, {
      method: body === undefined ? "GET" : "POST",
      ...(body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ file, ...(body as object) }),
          }),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result?.error?.message ?? "Java debugger request failed");
    return result;
  }
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const value = await call(`?file=${encodeURIComponent(file)}`);
        if (!cancelled) setState(value);
      } catch {}
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 750);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [projectId, file, open]);
  async function action(operation: string) {
    setBusy(true);
    setError("");
    try {
      const value =
        operation === "attach"
          ? await call("/attach", { port, ...(javaHome ? { javaHome } : {}) })
          : operation === "stop"
            ? await call("/stop", {})
            : await call("/command", {
                action: operation,
                line,
                ...(className ? { className } : {}),
              });
      setState(value);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }
  const paused = state?.state === "paused",
    connected = paused || state?.state === "running";
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{t("java.debug.title")}</summary>
      {open ? (
        <div className={styles.preview}>
          <p>{t("java.debug.hint")}</p>
          <div className={styles.bar}>
            <label>
              {t("java.debug.port")}
              <input
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(event) => setPort(Number(event.target.value))}
              />
            </label>
            <Button
              disabled={busy || connected}
              onClick={() => void action("attach")}
            >
              {t("java.debug.attach")}
            </Button>
            <Button
              disabled={busy || !state || state.state === "stopped"}
              onClick={() => void action("stop")}
            >
              {t("java.debug.detach")}
            </Button>
            {state ? (
              <span role="status">{t(`java.debug.state.${state.state}`)}</span>
            ) : null}
          </div>
          <div className={styles.bar}>
            <label>
              {t("java.debug.line")}
              <input
                type="number"
                min={1}
                value={line}
                onChange={(event) => setLine(Number(event.target.value))}
              />
            </label>
            <label>
              {t("java.debug.class")}
              <input
                value={className}
                onChange={(event) => setClassName(event.target.value)}
                placeholder={t("java.debug.classHint")}
              />
            </label>
            <Button
              disabled={busy || !connected}
              onClick={() => void action("breakpoint")}
            >
              {t("java.debug.breakpoint")}
            </Button>
            <Button
              disabled={busy || !connected}
              onClick={() => void action("remove-breakpoint")}
            >
              {t("java.debug.remove")}
            </Button>
          </div>
          <div className={styles.bar}>
            <Button
              disabled={busy || !paused}
              onClick={() => void action("continue")}
            >
              {t("java.debug.continue")}
            </Button>
            <Button
              disabled={busy || !paused}
              onClick={() => void action("next")}
            >
              {t("java.debug.next")}
            </Button>
            <Button
              disabled={busy || !paused}
              onClick={() => void action("step")}
            >
              {t("java.debug.step")}
            </Button>
            <Button
              disabled={busy || !paused}
              onClick={() => void action("refresh")}
            >
              {t("fileViewer.reload")}
            </Button>
          </div>
          {error || state?.message ? (
            <p className={styles.error} role="alert">
              {error || state?.message}
            </p>
          ) : null}
          {paused ? (
            <div className={styles.compare}>
              <section>
                <h4>{t("java.debug.frames")}</h4>
                <ol className={styles.results}>
                  {state.frames.map((frame) => (
                    <li key={frame.index}>
                      <Button
                        disabled={busy}
                        onClick={() => {
                          setBusy(true);
                          void call("/command", {
                            action: "frame",
                            index: frame.index,
                          })
                            .then(setState)
                            .catch((failure) => setError(failure.message))
                            .finally(() => setBusy(false));
                        }}
                      >
                        {frame.index} · {frame.method}
                      </Button>
                      {frame.path && frame.line && onOpenFile ? (
                        <Button
                          onClick={() => {
                            rememberJavaLocation(projectId, {
                              path: frame.path!,
                              range: {
                                start: { line: frame.line! - 1, character: 0 },
                                end: { line: frame.line! - 1, character: 0 },
                              },
                            });
                            onOpenFile(frame.path!);
                          }}
                        >
                          {frame.path}:{frame.line}
                        </Button>
                      ) : (
                        <small>
                          {frame.source}:{frame.line ?? "?"}
                        </small>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
              <section>
                <h4>{t("java.debug.locals")}</h4>
                <dl>
                  {state.locals.map((value) => (
                    <div key={value.name}>
                      <dt>{value.name}</dt>
                      <dd>{value.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            </div>
          ) : null}
          {state?.output ? (
            <details>
              <summary>{t("java.debug.output")}</summary>
              <pre className={styles.debugOutput}>{state.output}</pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}
