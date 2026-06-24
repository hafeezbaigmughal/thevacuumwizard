document.documentElement.classList.remove('no-js');

const navToggle = document.querySelector('.nav-toggle');
const navMenu = document.querySelector('#HeaderMenu');

if (navToggle && navMenu) {
  navToggle.addEventListener('click', () => {
    const isOpen = navMenu.classList.toggle('is-open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });
}
