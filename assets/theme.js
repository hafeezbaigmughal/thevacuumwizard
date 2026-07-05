document.documentElement.classList.remove('no-js');

const queryAll = (root, selector) => Array.from(root.querySelectorAll(selector));

function initializeHeader(root = document) {
  const navToggle = root.querySelector('.nav-toggle');
  const navMenu = root.querySelector('#HeaderMenu');
  const navShell = root.querySelector('#header');

  if (navToggle && navMenu && !navToggle.dataset.initialized) {
    navToggle.dataset.initialized = 'true';
    navToggle.addEventListener('click', () => {
      const isOpen = navMenu.classList.toggle('is-open');
      navShell?.classList.toggle('is-open', isOpen);
      navToggle.setAttribute('aria-expanded', String(isOpen));
    });
  }

  queryAll(root, '.submenu-toggle:not([data-initialized])').forEach((toggle) => {
    toggle.dataset.initialized = 'true';
    toggle.addEventListener('click', () => {
      const parent = toggle.closest('.menu-item-has-children');
      const isOpen = parent?.classList.toggle('submenu-is-open') || false;
      toggle.setAttribute('aria-expanded', String(isOpen));
    });
  });
}

function initializeProductGallery(root = document) {
  queryAll(root, '[data-product-thumb]:not([data-initialized])').forEach((button) => {
    button.dataset.initialized = 'true';
    button.addEventListener('click', () => {
      const productSection = button.closest('.product-detail');
      const image = productSection?.querySelector('#ProductMainImage');
      if (!image) return;
      image.src = button.dataset.productThumb;
      image.removeAttribute('srcset');
      button.closest('.product-detail__thumbs')?.querySelectorAll('.product-detail__thumb').forEach((thumb) => {
        thumb.classList.toggle('is-active', thumb === button);
      });
    });
  });
}

function initializeTabs(root, containerSelector, buttonSelector, panelSelector, buttonDataKey, panelDataKey, prefix) {
  queryAll(root, `${containerSelector}:not([data-tabs-initialized])`).forEach((tabs, containerIndex) => {
    tabs.dataset.tabsInitialized = 'true';
    const buttons = queryAll(tabs, buttonSelector);
    const panels = queryAll(tabs, panelSelector);
    const sectionId = tabs.closest('[id^="shopify-section-"]')?.id || `${prefix}-${containerIndex}`;

    const activate = (activeButton) => {
      const target = activeButton.dataset[buttonDataKey];
      buttons.forEach((button) => {
        const isActive = button === activeButton;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-selected', String(isActive));
        button.setAttribute('tabindex', isActive ? '0' : '-1');
        button.closest('li')?.classList.toggle('pruduct_category_currents', isActive);
      });
      panels.forEach((panel) => {
        const isActive = panel.dataset[panelDataKey] === target;
        panel.classList.toggle('is-active', isActive);
        panel.toggleAttribute('hidden', !isActive);
      });
    };

    buttons.forEach((button, index) => {
      const panel = panels.find((item) => item.dataset[panelDataKey] === button.dataset[buttonDataKey]);
      const tabId = `${sectionId}-${prefix}-tab-${index}`;
      const panelId = `${sectionId}-${prefix}-panel-${index}`;
      button.id = tabId;
      button.setAttribute('aria-controls', panelId);
      panel?.setAttribute('id', panelId);
      panel?.setAttribute('role', 'tabpanel');
      panel?.setAttribute('aria-labelledby', tabId);
      button.addEventListener('click', () => activate(button));
      button.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        let nextIndex = index;
        if (event.key === 'ArrowRight') nextIndex = (index + 1) % buttons.length;
        if (event.key === 'ArrowLeft') nextIndex = (index - 1 + buttons.length) % buttons.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = buttons.length - 1;
        buttons[nextIndex].focus();
        activate(buttons[nextIndex]);
      });
    });

    if (buttons.length > 0) activate(buttons.find((button) => button.classList.contains('is-active')) || buttons[0]);
  });
}

function initializeProductForms(root = document) {
  queryAll(root, '.product-detail__form:not([data-initialized])').forEach((form) => {
    form.dataset.initialized = 'true';
    const productSection = form.closest('.product-detail');
    const variantSelect = form.querySelector('[data-product-variant-select]');
    const optionSelects = queryAll(form, '[data-product-option]');
    const price = productSection?.querySelector('[data-product-price]');
    const comparePrice = productSection?.querySelector('[data-product-compare-price]');
    const stock = productSection?.querySelector('[data-product-stock]');
    const sku = productSection?.querySelector('[data-product-sku]');
    const submit = form.querySelector('[data-product-submit]');

    const syncVariantDetails = () => {
      if (!variantSelect) return;
      const selected = variantSelect.options[variantSelect.selectedIndex];
      const available = selected?.dataset.available === 'true';
      if (price && selected?.dataset.price) price.childNodes[0].textContent = `${selected.dataset.price} `;
      if (comparePrice) {
        comparePrice.textContent = selected?.dataset.comparePrice || '';
        comparePrice.hidden = !selected?.dataset.comparePrice;
      }
      if (stock) {
        stock.textContent = available ? 'In stock' : 'Out of stock';
        stock.classList.toggle('is-out', !available);
      }
      if (sku && selected) sku.textContent = selected.dataset.sku || '';
      if (submit) {
        submit.disabled = !available;
        submit.textContent = available ? 'Add to Cart' : 'Sold Out';
      }
      if (selected?.dataset.image) {
        const image = productSection?.querySelector('#ProductMainImage');
        if (image) {
          image.src = selected.dataset.image;
          image.removeAttribute('srcset');
        }
      }
      if (selected?.value && window.history.replaceState) {
        const url = new URL(window.location.href);
        url.searchParams.set('variant', selected.value);
        window.history.replaceState({}, '', url);
      }
    };

    const selectMatchingVariant = () => {
      if (!variantSelect || optionSelects.length === 0) return;
      const selectedOptions = optionSelects.map((select) => select.value);
      const match = Array.from(variantSelect.options).find((option) => {
        return (option.dataset.options || '').split('||').every((value, index) => value === selectedOptions[index]);
      });
      if (match) {
        variantSelect.value = match.value;
        syncVariantDetails();
      }
    };

    optionSelects.forEach((select) => select.addEventListener('change', selectMatchingVariant));
    variantSelect?.addEventListener('change', syncVariantDetails);
    syncVariantDetails();
  });
}

function initializeAddresses(root = document) {
  queryAll(root, '[data-address-country]:not([data-initialized])').forEach((countrySelect) => {
    countrySelect.dataset.initialized = 'true';
    const form = countrySelect.closest('form');
    const provinceSelect = form?.querySelector('[data-address-province]');
    const provinceWrap = form?.querySelector('[data-address-province-wrap]');
    if (!provinceSelect || !provinceWrap) return;
    if (countrySelect.dataset.default) countrySelect.value = countrySelect.dataset.default;

    const updateProvinces = () => {
      const option = countrySelect.options[countrySelect.selectedIndex];
      let provinces = [];
      try { provinces = JSON.parse(option?.dataset.provinces || '[]'); } catch (error) { provinces = []; }
      provinceSelect.innerHTML = '';
      provinces.forEach(([value, label]) => {
        const provinceOption = document.createElement('option');
        provinceOption.value = value;
        provinceOption.textContent = label;
        provinceSelect.appendChild(provinceOption);
      });
      provinceWrap.hidden = provinces.length === 0;
      if (provinceSelect.dataset.default) provinceSelect.value = provinceSelect.dataset.default;
    };
    countrySelect.addEventListener('change', updateProvinces);
    updateProvinces();
  });
}

function initializeTheme(root = document) {
  initializeHeader(root);
  initializeProductGallery(root);
  initializeTabs(root, '[data-product-tabs]', '[data-product-tab-button]', '[data-product-tab-panel]', 'productTabButton', 'productTabPanel', 'product');
  initializeTabs(root, '[data-home-product-tabs]', '[data-home-product-tab]', '[data-home-product-panel]', 'homeProductTab', 'homeProductPanel', 'home-products');
  initializeProductForms(root);
  initializeAddresses(root);
}

initializeTheme();
document.addEventListener('shopify:section:load', (event) => initializeTheme(event.target));
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  document.querySelector('#HeaderMenu')?.classList.remove('is-open');
  document.querySelector('#header')?.classList.remove('is-open');
  document.querySelector('.nav-toggle')?.setAttribute('aria-expanded', 'false');
  document.querySelectorAll('.submenu-is-open').forEach((item) => item.classList.remove('submenu-is-open'));
  document.querySelectorAll('.submenu-toggle').forEach((toggle) => toggle.setAttribute('aria-expanded', 'false'));
});
