/* Get-started demo: shows what the real monofield CLI printed for each way the
   spec can drift. The eight outputs are recorded in /get-started-demo.json;
   nothing here computes or invents a result. */
(function () {
  const root = document.querySelector("[data-demo]");
  if (!root) return;

  const COMMAND = {
    compare:
      "monofield rea cross-check --project <project-id> --input docs/orders.interface-spec.json --evidence evidence/capture.json",
    apply:
      "monofield rea apply --project <project-id> --input docs/orders.interface-spec.json --evidence evidence/capture.json --write",
    recheck:
      "monofield rea cross-check --project <project-id> --input docs/orders.interface-spec.json --evidence evidence/capture.json",
    judge:
      "monofield judge check --project <project-id> --input docs/orders.interface-spec.json",
    render:
      "monofield docs render-interface-spec --input docs/orders.interface-spec.json --out orders.xlsx",
  };
  const STEPS = Object.keys(COMMAND);

  const TEXT = {
    ko: {
      compare: (s) =>
        s.warnings
          ? `REA 기록과 명세서를 비교합니다. 이 명세서에서는 경고 ${s.warnings}건이 나옵니다. 각 줄 아래의 id를 apply의 --finding 에 줄 수 있습니다.`
          : "REA 기록과 명세서를 비교합니다. 이 명세서는 기록과 맞아서 경고가 없습니다. 정보 1건은 명세서에 적히지 않은 오류 응답 코드입니다.",
      apply: (s) =>
        s.warnings
          ? "발견 사항을 명세서에 반영하고 저장합니다. 추가된 행은 한글명이 비어 있어 다음 단계에서 걸립니다."
          : "고칠 필드는 없고, 기록에 대한 근거 참조와 오류 응답 코드 메모만 붙습니다.",
      recheck: () => "반영한 파일을 다시 비교하면 경고와 정보가 모두 사라집니다.",
      judge: (s) =>
        s.warnings
          ? "한글명·업무명을 검토합니다. 모델 없이도 규칙이 먼저 동작해, 비어 있는 이름을 의심 항목으로 올립니다. 아래 출력은 판단 모델이 연결되지 않은 상태입니다."
          : "한글명·업무명을 검토합니다. 비어 있는 이름이 없어서 규칙에 걸리는 항목은 없고, 아래 출력은 판단 모델이 연결되지 않은 상태입니다.",
      render: () =>
        "명세서를 Excel로 내보냅니다. 관찰만으로 알 수 없는 필수 여부는 TBD로 남아 있어, 경고로 그대로 알려 줍니다.",
    },
    en: {
      compare: (s) =>
        s.warnings
          ? `Compare the REA capture with the spec. This spec gets ${s.warnings} warning${s.warnings === 1 ? "" : "s"}. The id under each line can be passed to apply as --finding.`
          : "Compare the REA capture with the spec. This spec agrees with the capture, so there are no warnings. The one info item is an error response code the spec does not mention.",
      apply: (s) =>
        s.warnings
          ? "Apply the findings to the spec and save it. Added rows have empty Korean labels, which the next step catches."
          : "Nothing to fix; only evidence references and the error-code note are added.",
      recheck: () => "Compare the written file again: every warning and info item is gone.",
      judge: (s) =>
        s.warnings
          ? "Check Korean labels and names. Rules run first even without a model and raise empty names as suspects. This output is from a run with no judgment model connected."
          : "Check Korean labels and names. Nothing is empty, so no rule fires; this output is from a run with no judgment model connected.",
      render: () =>
        "Export the spec to Excel. Required flags that observation cannot establish stay TBD, and the renderer says so as warnings.",
    },
  };
  const UI = {
    ko: {
      copy: "명령 복사",
      copied: "복사했습니다",
      none: "어긋남 없음",
      failed: "데모 데이터를 불러오지 못했습니다. 아래 저장소의 fixtures와 CLI로 직접 확인할 수 있습니다.",
      drifts: { removeField: "필드 누락", renameField: "이름 불일치", removeEndpoint: "인터페이스 누락" },
      steps: { compare: "대조", apply: "반영", recheck: "다시 대조", judge: "판단 검토", render: "Excel" },
      more: (rest, all) => `${rest}개 더 (모두 ${all}개)`,
    },
    en: {
      copy: "Copy command",
      copied: "Copied",
      none: "no drift",
      failed: "Could not load the demo data. The fixtures and the CLI in the repository reproduce it.",
      drifts: { removeField: "missing field", renameField: "renamed field", removeEndpoint: "missing interface" },
      steps: { compare: "Compare", apply: "Apply", recheck: "Re-check", judge: "Judgment check", render: "Excel" },
      more: (rest, all) => `${rest} more (${all} in all)`,
    },
  };

  const output = root.querySelector("[data-output] code");
  const explain = root.querySelector("[data-explain]");
  const status = root.querySelector("[data-status]");
  const copy = root.querySelector("[data-copy]");
  const panel = root.querySelector("[role=tabpanel]");
  const tabs = Array.from(root.querySelectorAll("[role=tab]"));
  const drifts = Array.from(root.querySelectorAll("[data-drift]"));
  let data = null;
  let step = "compare";

  const language = () => (document.documentElement.lang === "en" ? "en" : "ko");
  const key = () =>
    `${drifts.find((d) => d.dataset.drift === "removeField")?.checked ? 1 : 0}${
      drifts.find((d) => d.dataset.drift === "renameField")?.checked ? 1 : 0
    }${drifts.find((d) => d.dataset.drift === "removeEndpoint")?.checked ? 1 : 0}`;

  function renderText() {
    if (step === "render") {
      const r = data.render;
      const shown = r.sampleWarnings.map((w) => `    ${JSON.stringify(w)},`).join("\n");
      return [
        "{",
        `  "endpointCount": ${r.endpointCount},`,
        `  "sheetTitles": ${JSON.stringify(r.sheetTitles)},`,
        '  "warnings": [',
        shown,
        `    … ${UI[language()].more(r.warningCount - r.sampleWarnings.length, r.warningCount)}`,
        "  ]",
        "}",
        `# orders.xlsx — ${r.bytes.toLocaleString("en-US")} bytes`,
      ].join("\n");
    }
    return data.scenarios[key()][step];
  }

  function colorize(text) {
    const fragment = document.createDocumentFragment();
    text.split("\n").forEach((line, index, all) => {
      const span = document.createElement("span");
      const trimmed = line.trimStart();
      span.className = /^(\$|#)/.test(trimmed)
        ? "gs-l-dim"
        : /^error\b/.test(trimmed)
          ? "gs-l-error"
          : /^(warning|flag)\b/.test(trimmed)
            ? "gs-l-warn"
            : /^(info|review)\b/.test(trimmed)
              ? "gs-l-info"
              : /^(written:|0 error · 0 warning)/.test(trimmed)
                ? "gs-l-ok"
                : /^id: /.test(trimmed)
                  ? "gs-l-dim"
                  : "";
      span.textContent = line + (index < all.length - 1 ? "\n" : "");
      fragment.append(span);
    });
    return fragment;
  }

  function draw() {
    const lang = language();
    const scenario = data.scenarios[key()];
    const command = `$ ${COMMAND[step]}`;
    output.replaceChildren(colorize(`${command}\n${renderText()}`));
    explain.textContent = TEXT[lang][step](scenario.summary);
    const active = drifts.filter((d) => d.checked).map((d) => UI[lang].drifts[d.dataset.drift]);
    status.textContent = `${active.length ? active.join(" + ") : UI[lang].none} · ${UI[lang].steps[step]}`;
    copy.textContent = UI[lang].copy;
    panel.setAttribute("aria-labelledby", `gs-tab-${step}`);
  }

  function select(next, focus) {
    step = next;
    tabs.forEach((tab) => {
      const on = tab.dataset.step === next;
      tab.classList.toggle("is-active", on);
      tab.setAttribute("aria-selected", String(on));
      tab.setAttribute("tabindex", on ? "0" : "-1");
      if (on && focus) tab.focus();
    });
    draw();
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(tab.dataset.step));
    tab.addEventListener("keydown", (event) => {
      let target = null;
      if (event.key === "ArrowRight") target = (index + 1) % tabs.length;
      if (event.key === "ArrowLeft") target = (index - 1 + tabs.length) % tabs.length;
      if (event.key === "Home") target = 0;
      if (event.key === "End") target = tabs.length - 1;
      if (target === null) return;
      event.preventDefault();
      select(STEPS[target], true);
    });
  });
  drifts.forEach((box) => box.addEventListener("change", () => data && draw()));
  copy?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(COMMAND[step]);
      copy.textContent = UI[language()].copied;
      setTimeout(() => (copy.textContent = UI[language()].copy), 1400);
    } catch {
      /* Clipboard access can be refused; the command stays selectable in the terminal. */
    }
  });
  // script.js swaps the page language on <html lang>.
  new MutationObserver(() => data && draw()).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["lang"],
  });

  fetch("/get-started-demo.json", { credentials: "omit" })
    .then((response) => {
      if (!response.ok) throw new Error(String(response.status));
      return response.json();
    })
    .then((value) => {
      data = value;
      draw();
    })
    .catch(() => {
      explain.textContent = UI[language()].failed;
    });
})();
