(function () {
  const languageButton = document.querySelector(".lang-toggle");
  const languageChoices = Array.from(
    document.querySelectorAll("[data-lang-choice]"),
  );
  const translatable = Array.from(
    document.querySelectorAll("[data-en][data-ko]"),
  );
  let savedLanguage;
  try {
    savedLanguage = localStorage.getItem("monofield-language");
  } catch {
    /* Storage may be disabled. */
  }
  let language =
    savedLanguage === "en" || savedLanguage === "ko"
      ? savedLanguage
      : navigator.language.toLowerCase().startsWith("ko")
        ? "ko"
        : "en";
  let release = null;

  function applyLanguage() {
    document.documentElement.lang = language;
    document.title =
      language === "ko"
        ? "MonoField (모노필드) | 로컬 AI 워크벤치"
        : "MonoField (모노필드) | Local-first AI workbench";
    translatable.forEach((element) => {
      element.textContent =
        element.getAttribute(`data-${language}`) || element.textContent;
    });
    languageChoices.forEach((choice) => {
      const active = choice.getAttribute("data-lang-choice") === language;
      choice.classList.toggle("is-active", active);
      choice.setAttribute("aria-current", active ? "true" : "false");
    });
    document
      .querySelectorAll("[data-ko-label][data-en-label]")
      .forEach((element) => {
        element.setAttribute(
          "aria-label",
          element.getAttribute(`data-${language}-label`),
        );
      });
    document
      .querySelectorAll("[data-ko-alt][data-en-alt]")
      .forEach((element) => {
        element.setAttribute(
          "alt",
          element.getAttribute(`data-${language}-alt`),
        );
      });
    languageButton?.setAttribute(
      "aria-label",
      language === "ko" ? "Switch to English" : "한국어로 전환",
    );
    updateMenuLabel();
    if (release) applyRelease(release);
  }
  languageButton?.addEventListener("click", () => {
    language = language === "ko" ? "en" : "ko";
    try {
      localStorage.setItem("monofield-language", language);
    } catch {
      /* Keep the choice for this visit. */
    }
    applyLanguage();
  });

  const header = document.querySelector(".site-header");
  const menuButton = document.querySelector(".menu-toggle");
  function updateMenuLabel() {
    const open = menuButton?.getAttribute("aria-expanded") === "true";
    menuButton?.setAttribute(
      "aria-label",
      language === "ko"
        ? open
          ? "메뉴 닫기"
          : "메뉴 열기"
        : open
          ? "Close menu"
          : "Open menu",
    );
  }
  function closeMenu() {
    header?.classList.remove("is-menu-open");
    menuButton?.setAttribute("aria-expanded", "false");
    updateMenuLabel();
  }
  menuButton?.addEventListener("click", () => {
    const open = menuButton.getAttribute("aria-expanded") !== "true";
    menuButton.setAttribute("aria-expanded", String(open));
    header?.classList.toggle("is-menu-open", open);
    updateMenuLabel();
  });
  document
    .querySelectorAll("#primary-navigation a")
    .forEach((link) => link.addEventListener("click", closeMenu));
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      menuButton?.getAttribute("aria-expanded") === "true"
    ) {
      closeMenu();
      menuButton.focus();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (header && !header.contains(event.target)) closeMenu();
  });

  const tabs = Array.from(document.querySelectorAll("[data-project-mode]"));
  const panels = Array.from(
    document.querySelectorAll("[data-project-mode-panel]"),
  );
  function activateTab(tab, focus = false) {
    const target = tab.getAttribute("data-project-mode");
    tabs.forEach((candidate) => {
      const active = candidate === tab;
      candidate.classList.toggle("is-active", active);
      candidate.setAttribute("aria-selected", String(active));
      candidate.setAttribute("tabindex", active ? "0" : "-1");
    });
    panels.forEach((panel) => {
      panel.hidden = panel.getAttribute("data-project-mode-panel") !== target;
    });
    if (focus) tab.focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activateTab(tab));
    tab.addEventListener("keydown", (event) => {
      let next = null;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      if (event.key === "ArrowLeft")
        next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      if (next === null) return;
      event.preventDefault();
      activateTab(tabs[next], true);
    });
  });

  const dialog = document.querySelector(".image-dialog");
  const dialogImage = dialog?.querySelector("img");
  let imageOpener = null;
  document.querySelectorAll("[data-image-view]").forEach((button) =>
    button.addEventListener("click", () => {
      if (!dialog || !dialogImage) return;
      imageOpener = button;
      dialogImage.src = button.getAttribute("data-image-view");
      dialogImage.alt = button.querySelector("img")?.alt || "MonoField";
      dialog.showModal();
    }),
  );
  dialog
    ?.querySelector(".image-dialog-close")
    ?.addEventListener("click", () => dialog.close());
  dialog?.addEventListener("click", (event) => {
    const bounds = dialog.getBoundingClientRect();
    if (
      event.target === dialog &&
      (event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom)
    )
      dialog.close();
  });
  dialog?.addEventListener("close", () => imageOpener?.focus());

  function trustedAssetUrl(url) {
    try {
      const parsed = new URL(url);
      return (
        parsed.protocol === "https:" &&
        parsed.hostname === "github.com" &&
        parsed.pathname.startsWith("/jhy0285/monofield/releases/download/") &&
        !parsed.username &&
        !parsed.password
      );
    } catch {
      return false;
    }
  }
  function applyRelease(value) {
    document.querySelectorAll("[data-release-version]").forEach((element) => {
      element.textContent = value.tag_name;
    });
    const assets = Array.isArray(value.assets) ? value.assets : [];
    const selected = {
      installer: assets.find(
        (asset) =>
          /monofield.*(?:setup|installer).*\.exe$/i.test(asset.name) &&
          trustedAssetUrl(asset.browser_download_url),
      ),
      portable: assets.find(
        (asset) =>
          /monofield.*portable.*\.zip$/i.test(asset.name) &&
          trustedAssetUrl(asset.browser_download_url),
      ),
      checksums: assets.find(
        (asset) =>
          /^(?:SHA256SUMS\.txt|checksums\.txt)$/i.test(asset.name) &&
          trustedAssetUrl(asset.browser_download_url),
      ),
    };
    document.querySelectorAll("[data-download]").forEach((link) => {
      const kind = link.getAttribute("data-download");
      const asset = selected[kind];
      // A release without this artifact must lead to the release page, never to a guessed file.
      link.setAttribute(
        "href",
        asset?.browser_download_url ||
          "https://github.com/jhy0285/monofield/releases/latest",
      );
    });
    Object.entries(selected).forEach(([kind, asset]) => {
      document
        .querySelectorAll(`[data-release-size="${kind}"]`)
        .forEach((element) => {
          element.textContent =
            asset && Number.isFinite(asset.size)
              ? `${kind === "installer" ? "EXE" : "ZIP"} · ${Math.round(asset.size / 1_000_000)} MB`
              : language === "ko"
                ? "릴리스에서 확인"
                : "See release";
        });
    });
  }
  async function loadRelease() {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 4000);
    try {
      const response = await fetch(
        "https://api.github.com/repos/jhy0285/monofield/releases/latest",
        {
          signal: abort.signal,
          credentials: "omit",
          headers: { Accept: "application/vnd.github+json" },
        },
      );
      if (!response.ok) return;
      const value = await response.json();
      if (
        value.draft ||
        value.prerelease ||
        typeof value.tag_name !== "string" ||
        !/^v?\d+\.\d+\.\d+$/.test(value.tag_name)
      )
        return;
      release = value;
      applyRelease(value);
    } catch {
      /* Valid current download links remain usable when the public API is unavailable. */
    } finally {
      clearTimeout(timer);
    }
  }

  const productId = document
    .querySelector('meta[name="monofield-store-product-id"]')
    ?.getAttribute("content")
    ?.trim();
  if (/^[A-Za-z0-9]{12}$/.test(productId || "")) {
    document.querySelectorAll("[data-store-download]").forEach((link) => {
      link.href = `https://apps.microsoft.com/detail/${encodeURIComponent(productId)}`;
      link.hidden = false;
    });
  }
  applyLanguage();
  void loadRelease();
})();
