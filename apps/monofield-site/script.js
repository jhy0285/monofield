(function () {
  const languageButton = document.querySelector('.lang-toggle');
  const languageChoices = Array.from(document.querySelectorAll('[data-lang-choice]'));
  const translatable = Array.from(document.querySelectorAll('[data-en][data-ko]'));
  const savedLanguage = localStorage.getItem('monofield-language');
  let language = savedLanguage === 'en' || savedLanguage === 'ko'
    ? savedLanguage
    : navigator.language.toLowerCase().startsWith('ko') ? 'ko' : 'en';

  function configureDistributionLinks() {
    const productId = document
      .querySelector('meta[name="monofield-store-product-id"]')
      ?.getAttribute('content')
      ?.trim();
    const hasStoreListing = /^[A-Za-z0-9]{12}$/.test(productId || '');
    const storeUrl = hasStoreListing
      ? `https://apps.microsoft.com/detail/${encodeURIComponent(productId)}`
      : null;

    document.documentElement.toggleAttribute('data-store-ready', hasStoreListing);
    document.querySelectorAll('[data-store-download]').forEach((link) => {
      link.hidden = !hasStoreListing;
      if (storeUrl) link.setAttribute('href', storeUrl);
    });
    document.querySelectorAll('[data-store-fallback-primary]').forEach((link) => {
      link.classList.toggle('button-primary', !hasStoreListing);
      link.classList.toggle('is-secondary', hasStoreListing);
    });

    const primaryDownload = document.querySelector('[data-primary-download]');
    if (primaryDownload && storeUrl) {
      primaryDownload.setAttribute('href', storeUrl);
      primaryDownload.setAttribute('data-en', 'Microsoft Store');
      primaryDownload.setAttribute('data-ko', 'Microsoft Store');
    }
  }

  function applyLanguage() {
    document.documentElement.lang = language;
    document.title = language === 'ko'
      ? 'MonoField — 코드 / 디자인 / 문서'
      : 'MonoField — code / design / documents';
    translatable.forEach((element) => {
      element.textContent = element.getAttribute(`data-${language}`) || element.textContent;
    });
    languageChoices.forEach((choice) => {
      const active = choice.getAttribute('data-lang-choice') === language;
      choice.classList.toggle('is-active', active);
      choice.setAttribute('aria-current', active ? 'true' : 'false');
    });
    if (languageButton) {
      languageButton.setAttribute('aria-pressed', language === 'ko' ? 'true' : 'false');
      languageButton.setAttribute(
        'aria-label',
        language === 'ko' ? 'Switch to English' : '한국어로 전환',
      );
    }
  }

  languageButton?.addEventListener('click', () => {
    language = language === 'ko' ? 'en' : 'ko';
    localStorage.setItem('monofield-language', language);
    applyLanguage();
  });

  const tabs = Array.from(document.querySelectorAll('.workspace-tab'));
  const panels = Array.from(document.querySelectorAll('[data-workspace-panel]'));

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-panel');
      tabs.forEach((candidate) => {
        const active = candidate === tab;
        candidate.classList.toggle('is-active', active);
        candidate.setAttribute('aria-selected', String(active));
      });
      panels.forEach((panel) => {
        panel.classList.toggle('is-active', panel.getAttribute('data-workspace-panel') === target);
      });
    });
  });

  const projectModeTabs = Array.from(document.querySelectorAll('[data-project-mode]'));
  const projectModePanels = Array.from(document.querySelectorAll('[data-project-mode-panel]'));

  projectModeTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-project-mode');
      projectModeTabs.forEach((candidate) => {
        const active = candidate === tab;
        candidate.classList.toggle('is-active', active);
        candidate.setAttribute('aria-selected', String(active));
      });
      projectModePanels.forEach((panel) => {
        const active = panel.getAttribute('data-project-mode-panel') === target;
        panel.classList.toggle('is-active', active);
        panel.hidden = !active;
      });
    });
  });

  configureDistributionLinks();
  applyLanguage();
})();
