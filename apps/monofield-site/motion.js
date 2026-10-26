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

  /* Hero contour field: a topographic drawing that sketches itself in. */
  const contours = document.querySelector("[data-contours]");
  if (contours) {
    const NS = "http://www.w3.org/2000/svg";
    const paths = [];
    for (let i = 0; i < 16; i += 1) {
      const phase = i * 0.5;
      const base = 40 + i * 58;
      let d = "";
      for (let x = -20; x <= 1460; x += 20) {
        const y =
          base +
          Math.sin(x / 230 + phase) * 52 +
          Math.sin(x / 100 + phase * 1.7) * 15 -
          x * 0.12;
        d += `${d ? "L" : "M"}${x} ${y.toFixed(1)}`;
      }
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", d);
      path.setAttribute("stroke-width", i % 4 === 0 ? "1.6" : "1");
      contours.appendChild(path);
      paths.push(path);
    }
    if (reduced || !paths[0].animate) {
      contours.classList.add("is-drawn");
    } else {
      let finished = 0;
      paths.forEach((path, index) => {
        const length = path.getTotalLength();
        path.style.strokeDasharray = String(length);
        const draw = path.animate(
          [{ strokeDashoffset: length }, { strokeDashoffset: 0 }],
          {
            delay: 120 + index * 70,
            duration: 2400,
            easing: "cubic-bezier(0.3, 0, 0.1, 1)",
            fill: "backwards",
          },
        );
        draw.onfinish = () => {
          path.style.strokeDasharray = "none";
          finished += 1;
          if (finished === paths.length) contours.classList.add("is-drawn");
        };
      });
    }
  }

  /* Pointer parallax: the glow follows, floating deliverables drift, the app tilts. */
  const workspace = document.querySelector(".hero-workspace");
  const shot = workspace?.querySelector(".screenshot-button");
  if (hero && finePointer && !reduced) {
    let frame = 0;
    hero.addEventListener("pointermove", (event) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const box = hero.getBoundingClientRect();
        const nx = (event.clientX - box.left) / box.width;
        const ny = (event.clientY - box.top) / box.height;
        hero.style.setProperty("--gx", `${(nx * 100).toFixed(1)}%`);
        hero.style.setProperty("--gy", `${(ny * 100).toFixed(1)}%`);
        if (workspace) {
          workspace.style.setProperty("--px", ((nx - 0.5) * 2).toFixed(3));
          workspace.style.setProperty("--py", ((ny - 0.5) * 2).toFixed(3));
        }
        if (shot && workspace) {
          const wb = workspace.getBoundingClientRect();
          const tx = Math.max(-1, Math.min(1, ((event.clientX - wb.left) / wb.width - 0.5) * 2));
          const ty = Math.max(-1, Math.min(1, ((event.clientY - wb.top) / wb.height - 0.5) * 2));
          shot.style.setProperty("--ry", `${(tx * 4).toFixed(2)}deg`);
          shot.style.setProperty("--rx", `${(-ty * 3).toFixed(2)}deg`);
        }
      });
    });
    hero.addEventListener("pointerleave", () => {
      shot?.style.setProperty("--rx", "0deg");
      shot?.style.setProperty("--ry", "0deg");
    });
  }

  /* Reveal on scroll. Content is visible by default; the class below only exists when JS runs. */
  const revealTargets = Array.from(
    document.querySelectorAll(
      ".intro-copy, .intro-player, .section-heading, .product-tabs, .product-panel:not([hidden]) > *, .workflow-steps li, .guide-copy, .guide-cover, .download-heading, .preview-release, .stable-release-heading, .download-card, .handover-story, .faq-section > *",
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
