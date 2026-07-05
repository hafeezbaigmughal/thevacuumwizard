document.documentElement.classList.remove('no-js');

const navToggle = document.querySelector('.nav-toggle');
const navMenu = document.querySelector('#HeaderMenu');
const navShell = document.querySelector('#header');

if (navToggle && navMenu) {
  navToggle.addEventListener('click', () => {
    const isOpen = navMenu.classList.toggle('is-open');
    navShell?.classList.toggle('is-open', isOpen);
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });
}

document.querySelectorAll('.submenu-toggle').forEach((toggle) => {
  toggle.addEventListener('click', () => {
    const parent = toggle.closest('.menu-item-has-children');
    const isOpen = parent?.classList.toggle('submenu-is-open') || false;
    toggle.setAttribute('aria-expanded', String(isOpen));
  });
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  navMenu?.classList.remove('is-open');
  navShell?.classList.remove('is-open');
  navToggle?.setAttribute('aria-expanded', 'false');
  document.querySelectorAll('.submenu-is-open').forEach((item) => item.classList.remove('submenu-is-open'));
  document.querySelectorAll('.submenu-toggle').forEach((toggle) => toggle.setAttribute('aria-expanded', 'false'));
});

document.querySelectorAll('[data-product-thumb]').forEach((button) => {
  button.addEventListener('click', () => {
    const image = document.querySelector('#ProductMainImage');
    if (!image) return;

    image.src = button.dataset.productThumb;
    image.removeAttribute('srcset');
    button.closest('.product-detail__thumbs')?.querySelectorAll('.product-detail__thumb').forEach((thumb) => {
      thumb.classList.toggle('is-active', thumb === button);
    });
  });
});

document.querySelectorAll('[data-product-tabs]').forEach((tabs) => {
  const buttons = tabs.querySelectorAll('[data-product-tab-button]');
  const panels = tabs.querySelectorAll('[data-product-tab-panel]');

  buttons.forEach((button, index) => {
    const panel = Array.from(panels).find((item) => item.dataset.productTabPanel === button.dataset.productTabButton);
    const tabId = `ProductTab-${index}`;
    const panelId = `ProductPanel-${index}`;
    button.id = tabId;
    button.setAttribute('aria-controls', panelId);
    panel?.setAttribute('id', panelId);
    panel?.setAttribute('aria-labelledby', tabId);
    panel?.toggleAttribute('hidden', !button.classList.contains('is-active'));

    button.addEventListener('click', () => {
      const target = button.dataset.productTabButton;

      buttons.forEach((item) => {
        const isActive = item === button;
        item.classList.toggle('is-active', isActive);
        item.setAttribute('aria-selected', String(isActive));
        item.closest('li')?.classList.toggle('pruduct_category_currents', isActive);
      });

      panels.forEach((panel) => {
        const isActive = panel.dataset.productTabPanel === target;
        panel.classList.toggle('is-active', isActive);
        panel.toggleAttribute('hidden', !isActive);
      });
    });

    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let nextIndex = index;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % buttons.length;
      if (event.key === 'ArrowLeft') nextIndex = (index - 1 + buttons.length) % buttons.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = buttons.length - 1;
      buttons[nextIndex].focus();
      buttons[nextIndex].click();
    });
  });
});

document.querySelectorAll('[data-home-product-tabs]').forEach((tabs) => {
  const buttons = tabs.querySelectorAll('[data-home-product-tab]');
  const panels = tabs.querySelectorAll('[data-home-product-panel]');

  buttons.forEach((button, index) => {
    const panel = Array.from(panels).find((item) => item.dataset.homeProductPanel === button.dataset.homeProductTab);
    const tabId = `HomeProductTab-${index}`;
    const panelId = `HomeProductPanel-${index}`;
    button.id = tabId;
    button.setAttribute('aria-controls', panelId);
    panel?.setAttribute('id', panelId);
    panel?.setAttribute('role', 'tabpanel');
    panel?.setAttribute('aria-labelledby', tabId);
    panel?.toggleAttribute('hidden', !button.classList.contains('is-active'));

    button.addEventListener('click', () => {
      const target = button.dataset.homeProductTab;

      buttons.forEach((item) => {
        const isActive = item === button;
        item.classList.toggle('is-active', isActive);
        item.setAttribute('aria-selected', String(isActive));
      });

      panels.forEach((panel) => {
        const isActive = panel.dataset.homeProductPanel === target;
        panel.classList.toggle('is-active', isActive);
        panel.toggleAttribute('hidden', !isActive);
      });
    });

    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let nextIndex = index;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % buttons.length;
      if (event.key === 'ArrowLeft') nextIndex = (index - 1 + buttons.length) % buttons.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = buttons.length - 1;
      buttons[nextIndex].focus();
      buttons[nextIndex].click();
    });
  });
});

document.querySelectorAll('.product-detail__form').forEach((form) => {
  const variantSelect = form.querySelector('[data-product-variant-select]');
  const optionSelects = form.querySelectorAll('[data-product-option]');
  const price = document.querySelector('[data-product-price]');
  const comparePrice = document.querySelector('[data-product-compare-price]');
  const stock = document.querySelector('[data-product-stock]');
  const sku = document.querySelector('[data-product-sku]');
  const submit = form.querySelector('[data-product-submit]');

  const syncVariantDetails = () => {
    if (!variantSelect) return;
    const selected = variantSelect.options[variantSelect.selectedIndex];
    const available = selected?.dataset.available === 'true';

    if (price && selected?.dataset.price) {
      price.childNodes[0].textContent = selected.dataset.price + ' ';
    }

    if (comparePrice) {
      comparePrice.textContent = selected?.dataset.comparePrice || '';
      comparePrice.hidden = !selected?.dataset.comparePrice;
    }

    if (stock) {
      stock.textContent = available ? 'In stock' : 'Out of stock';
      stock.classList.toggle('is-out', !available);
    }

    if (sku && selected) {
      sku.textContent = selected.dataset.sku || '';
    }

    if (submit) {
      submit.disabled = !available;
      submit.textContent = available ? 'Add to Cart' : 'Sold Out';
    }

    if (selected?.dataset.image) {
      const image = document.querySelector('#ProductMainImage');
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

    const selectedOptions = Array.from(optionSelects).map((select) => select.value);
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

document.querySelectorAll('[data-address-country]').forEach((countrySelect) => {
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
