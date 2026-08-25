(function () {
  const languageButton = document.querySelector('.lang-toggle');
  const languageChoices = Array.from(document.querySelectorAll('[data-lang-choice]'));
  const translatable = Array.from(document.querySelectorAll('[data-en][data-ko]'));
  const savedLanguage = localStorage.getItem('monofield-language');
  let language = savedLanguage === 'en' || savedLanguage === 'ko'
    ? savedLanguage
    : navigator.language.toLowerCase().startsWith('ko') ? 'ko' : 'en';

  function applyLanguage() {
    document.documentElement.lang = language;
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

  applyLanguage();
})();
