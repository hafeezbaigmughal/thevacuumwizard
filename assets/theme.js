document.documentElement.classList.remove('no-js');

const navToggle = document.querySelector('.nav-toggle');
const navMenu = document.querySelector('#HeaderMenu');

if (navToggle && navMenu) {
  navToggle.addEventListener('click', () => {
    const isOpen = navMenu.classList.toggle('is-open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });
}

document.querySelectorAll('[data-product-thumb]').forEach((button) => {
  button.addEventListener('click', () => {
    const image = document.querySelector('#ProductMainImage');
    if (!image) return;

    image.src = button.dataset.productThumb;
    button.closest('.product-detail__thumbs')?.querySelectorAll('.product-detail__thumb').forEach((thumb) => {
      thumb.classList.toggle('is-active', thumb === button);
    });
  });
});

document.querySelectorAll('[data-product-tabs]').forEach((tabs) => {
  const buttons = tabs.querySelectorAll('[data-product-tab-button]');
  const panels = tabs.querySelectorAll('[data-product-tab-panel]');

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.productTabButton;

      buttons.forEach((item) => {
        const isActive = item === button;
        item.classList.toggle('is-active', isActive);
        item.setAttribute('aria-selected', String(isActive));
      });

      panels.forEach((panel) => {
        panel.classList.toggle('is-active', panel.dataset.productTabPanel === target);
      });
    });
  });
});

document.querySelectorAll('.product-detail__form').forEach((form) => {
  const variantSelect = form.querySelector('[data-product-variant-select]');
  const optionSelects = form.querySelectorAll('[data-product-option]');
  const price = document.querySelector('[data-product-price]');
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
