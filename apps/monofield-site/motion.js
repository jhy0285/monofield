(function () {
  const root = document.documentElement;
  root.classList.add("js");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  /* Header: transparent over the dark hero, glass once the page moves on. */
  const header = document.querySelector(".site-header");
  const hero = document.querySelector(".hero");
  function updateHeader() {
    if (!header || !hero) return;
    const overHero = hero.getBoundingClientRect().bottom > (header.offsetHeight || 76) + 12;
    header.classList.toggle("on-dark", overHero);
  }
  if (hero) {
    updateHeader();
    let ticking = false;
    window.addEventListener(
      "scroll",
      () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          updateHeader();
          ticking = false;
        });
      },
      { passive: true },
    );
    window.addEventListener("resize", updateHeader);
  }

  /* Pointer glow: the light behind the hero drifts toward the pointer. It moves
     with `translate`, so following the pointer never touches layout. */
  const glow = hero?.querySelector(".hero-glow");
  if (hero && glow && finePointer && !reduced) {
    let frame = 0;
    hero.addEventListener("pointermove", (event) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const box = hero.getBoundingClientRect();
        const dx = event.clientX - box.left - box.width * 0.62;
        const dy = event.clientY - box.top - box.height * 0.18;
        glow.style.translate = `${dx.toFixed(0)}px ${dy.toFixed(0)}px`;
      });
    });
  }

  /* The code-to-spec scene plays once a good part of it is on screen. */
  const engine = document.querySelector(".engine");
  if (engine) {
    if ("IntersectionObserver" in window) {
      const watcher = new IntersectionObserver(
        ([entry]) => {
          if (!entry.isIntersecting) return;
          engine.classList.add("is-live");
          watcher.disconnect();
        },
        { threshold: 0.35 },
      );
      watcher.observe(engine);
    } else {
      engine.classList.add("is-live");
    }
  }

  /* A hero that has scrolled away stops animating (the CSS rule pauses it). */
  if (hero && "IntersectionObserver" in window) {
    new IntersectionObserver(
      ([entry]) => hero.classList.toggle("is-offscreen", !entry.isIntersecting),
      { threshold: 0 },
    ).observe(hero);
  }

  /* Reveal on scroll. Content is visible by default; the class below only exists when JS runs. */
  const revealTargets = Array.from(
    document.querySelectorAll(
      ".hero-shot, .intro-copy, .intro-player, .section-heading, .product-tabs, .product-panel:not([hidden]) > *, .workflow-steps li, .guide-copy, .guide-cover, .download-heading, .preview-release, .stable-release-heading, .download-card, .handover-story, .faq-section > *",
    ),
  );
  if (!reduced && "IntersectionObserver" in window && revealTargets.length) {
    root.classList.add("reveal-ready");
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-in");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    revealTargets.forEach((element, index) => {
      element.setAttribute("data-reveal", "");
      const siblings = element.parentElement ? Array.from(element.parentElement.children) : [];
      const position = Math.max(0, siblings.indexOf(element));
      element.style.setProperty("--d", `${Math.min(position, 4) * 90}ms`);
      observer.observe(element);
    });
    // Tabs swap panels without scrolling; show whatever just became visible.
    document.querySelectorAll("[data-project-mode]").forEach((tab) =>
      tab.addEventListener("click", () =>
        requestAnimationFrame(() =>
          document
            .querySelectorAll(".product-panel > *")
            .forEach((element) => element.classList.add("is-in")),
        ),
      ),
    );
  }

  /* Intro video: language-aware source, chapters, and a play overlay. */
  const video = document.getElementById("intro-video");
  const player = video?.closest(".intro-player");
  if (video && player) {
    const playButton = player.querySelector("[data-intro-play]");
    const chapters = Array.from(document.querySelectorAll("[data-seek]"));
    let currentLanguage = "";
    function applyVideoLanguage() {
      const language = root.lang === "en" ? "en" : "ko";
      if (language === currentLanguage) return;
      const wasPlaying = !video.paused;
      const time = video.currentTime;
      currentLanguage = language;
      video.poster = `/intro/monofield-intro-${language}-poster.jpg`;
      const source = video.querySelector("source");
      if (source) source.src = `/intro/monofield-intro-${language}.mp4`;
      video.load();
      if (time > 0) {
        video.addEventListener(
          "loadedmetadata",
          () => {
            video.currentTime = time;
            if (wasPlaying) void video.play().catch(() => {});
          },
          { once: true },
        );
      }
      playButton?.setAttribute("aria-label", language === "ko" ? "영상 재생" : "Play video");
      video.setAttribute("aria-label", language === "ko" ? "MonoField 소개 영상" : "MonoField intro video");
    }
    applyVideoLanguage();
    new MutationObserver(applyVideoLanguage).observe(root, { attributes: true, attributeFilter: ["lang"] });

    function start(at) {
      if (typeof at === "number") video.currentTime = at;
      void video.play().catch(() => {});
    }
    playButton?.addEventListener("click", () => start());
    document.querySelectorAll("[data-play-intro]").forEach((link) => link.addEventListener("click", () => start(0)));
    chapters.forEach((chapter) =>
      chapter.addEventListener("click", () => {
        start(Number(chapter.getAttribute("data-seek")));
        player.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
      }),
    );
    video.addEventListener("play", () => player.classList.add("is-playing"));
    video.addEventListener("ended", () => player.classList.remove("is-playing"));
    video.addEventListener("timeupdate", () => {
      let current = null;
      chapters.forEach((chapter) => {
        if (video.currentTime >= Number(chapter.getAttribute("data-seek")) - 0.2) current = chapter;
      });
      chapters.forEach((chapter) => chapter.classList.toggle("is-current", chapter === current));
    });
  }
})();
