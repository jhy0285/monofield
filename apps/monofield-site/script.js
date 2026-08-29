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

  function setupTabs(tabSelector, panelSelector, tabTargetAttribute, panelTargetAttribute) {
    const tabs = Array.from(document.querySelectorAll(tabSelector));
    const panels = Array.from(document.querySelectorAll(panelSelector));

    function activateTab(tab, moveFocus = false) {
      const target = tab.getAttribute(tabTargetAttribute);
      tabs.forEach((candidate) => {
        const active = candidate === tab;
        candidate.classList.toggle('is-active', active);
        candidate.setAttribute('aria-selected', String(active));
        candidate.setAttribute('tabindex', active ? '0' : '-1');
      });
      panels.forEach((panel) => {
        const active = panel.getAttribute(panelTargetAttribute) === target;
        panel.classList.toggle('is-active', active);
        panel.hidden = !active;
      });
      if (moveFocus) tab.focus();
    }

    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => activateTab(tab));
      tab.addEventListener('keydown', (event) => {
        let nextIndex = null;
        if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
        if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = tabs.length - 1;
        if (nextIndex === null) return;
        event.preventDefault();
        activateTab(tabs[nextIndex], true);
      });
    });
  }

  setupTabs('.workspace-tab', '[data-workspace-panel]', 'data-panel', 'data-workspace-panel');
  setupTabs('[data-project-mode]', '[data-project-mode-panel]', 'data-project-mode', 'data-project-mode-panel');

  configureDistributionLinks();
  applyLanguage();
})();
