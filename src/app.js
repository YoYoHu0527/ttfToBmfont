import './style.css';
import './main.js';
import './image-rounding.js';

const toolLinks = Array.from(document.querySelectorAll('[data-tool-link]'));
const toolPanels = document.querySelectorAll('[data-tool-panel]');

function selectTool() {
  const requestedTool = window.location.hash.slice(1);
  const activeLink = toolLinks.find((link) => link.dataset.toolLink === requestedTool) || toolLinks[0];

  for (const panel of toolPanels) {
    panel.hidden = panel.dataset.toolPanel !== activeLink.dataset.toolLink;
  }
  for (const link of toolLinks) {
    if (link === activeLink) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  }
  document.title = `${activeLink.textContent.trim()} · 素材工具箱`;
}

window.addEventListener('hashchange', selectTool);
selectTool();
