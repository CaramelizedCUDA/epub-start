const periodData = {
  day: { title: '今天', total: '38m', range: '08.28 · 2 次可见阅读', caption: '今天的阅读，留下一枚小小的书签.' },
  week: { title: '本周', total: '4h 36m', range: '08.24 — 08.30 · 6 次可见阅读', caption: '一周的阅读，在这里留下一个轻微的圆。' },
  month: { title: '本月', total: '18h 42m', range: '08.01 — 08.31 · 23 次可见阅读', caption: '把一个月折叠起来，看看哪些日子亮过。' },
  quarter: { title: '本季度', total: '42h 18m', range: '06.01 — 08.31 · 58 次可见阅读', caption: '这个季度，不评价进度，只保留经过。' },
};

const optionData = {
  dial: { caption: periodData.week.caption },
  spine: { caption: '每一个小格是一日；蓝色书脊只说明那天曾打开过书。' },
  ribbon: { caption: '把阅读时间串成一条带子，节点只记录经过，不制造目标。' },
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const pageLinks = $$('.rail-link[data-page]');
const pageViews = $$('.page-view');

function setPage(pageId, updateHash = true) {
  const activePage = pageViews.some((view) => view.id === pageId) ? pageId : 'library-page';

  pageViews.forEach((view) => {
    const active = view.id === activePage;
    view.classList.toggle('is-active', active);
    view.hidden = !active;
  });

  pageLinks.forEach((link) => {
    const active = link.dataset.page === activePage;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  document.body.dataset.page = activePage;
  if (updateHash) {
    const hash = activePage === 'footprint-page' ? '#footprint' : '#library';
    if (window.location.hash !== hash) window.history.replaceState(null, '', hash);
  }
}

pageLinks.forEach((link) => link.addEventListener('click', (event) => {
  event.preventDefault();
  setPage(link.dataset.page);
}));

window.addEventListener('hashchange', () => {
  setPage(window.location.hash === '#footprint' ? 'footprint-page' : 'library-page', false);
});

function renderDial() {
  const ticks = Array.from({ length: 18 }, (_, index) => {
    const angle = (index / 18) * Math.PI * 2 - Math.PI / 2;
    const inner = 91;
    const outer = index % 3 === 0 ? 101 : 96;
    const x1 = 110 + Math.cos(angle) * inner;
    const y1 = 110 + Math.sin(angle) * inner;
    const x2 = 110 + Math.cos(angle) * outer;
    const y2 = 110 + Math.sin(angle) * outer;
    return `<line class="dial-tick" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" />`;
  }).join('');
  return `<svg viewBox="0 0 220 220" aria-hidden="true">
    <circle class="dial-base" cx="110" cy="110" r="102" />
    <circle class="dial-track" cx="110" cy="110" r="82" />
    <circle class="dial-progress" cx="110" cy="110" r="82" stroke-dasharray="330 516" />
    ${ticks}
    <circle class="dial-center" cx="110" cy="110" r="49" />
    <text class="dial-label" x="110" y="106">4H 36M</text>
    <text class="dial-sub" x="110" y="124">THIS WEEK</text>
  </svg>`;
}

function renderCalendar() {
  const levels = Array.from({ length: 49 }, (_, index) => {
    const level = [0, 1, 0, 2, 3, 1, 0, 0, 2, 4, 1, 0, 3, 2, 0, 1, 0, 0, 4, 2, 1, 3, 0, 0, 1, 2, 4, 0, 0, 2, 1, 0, 3, 1, 0, 0, 2, 4, 1, 0, 2, 3, 0, 1, 0, 0, 2, 4, 1][index];
    return `<i data-level="${level}" aria-label="阅读等级 ${level}"></i>`;
  }).join('');
  return `<div class="calendar-graphic" aria-hidden="true">${levels}</div>`;
}

function renderRibbon() {
  const points = [
    ['18%', '38m', 1], ['31%', '1h 12m', 2], ['47%', '24m', 0],
    ['61%', '2h 06m', 3], ['74%', '52m', 1], ['88%', '1h 24m', 2],
  ];
  return `<div class="ribbon-graphic" aria-hidden="true">${points.map(([left, label, level]) => `<i class="ribbon-node" style="left:${left}; transform:translate(-50%, ${level ? '-50%' : '50%'}); border-color:${level === 3 ? 'var(--seam)' : 'var(--brass)'}"></i><span class="ribbon-label" style="left:${left}">${label}</span>`).join('')}</div>`;
}

function renderGraphic(option) {
  const graphic = $('#time-graphic');
  graphic.innerHTML = option === 'dial' ? renderDial() : option === 'spine' ? renderCalendar() : renderRibbon();
  graphic.setAttribute('aria-label', option === 'dial' ? '本周阅读时长轮盘' : option === 'spine' ? '本周阅读日期热图' : '本周阅读时间带');
}

function renderHeatmap(scope) {
  const count = scope === 'all' ? 105 : 371;
  const cells = Array.from({ length: count }, (_, index) => {
    const pattern = [0, 0, 1, 0, 2, 0, 3, 1, 0, 0, 2, 4, 1, 0, 0, 3, 2, 0, 1, 0, 0];
    const level = scope === 'all' && index % 17 === 0 ? 4 : pattern[index % pattern.length];
    return `<i class="heat-cell" tabindex="0" data-level="${level}" title="${level ? `阅读等级 ${level}` : '没有记录'}"></i>`;
  }).join('');
  const heatmap = $('#heatmap');
  heatmap.style.gridTemplateColumns = `repeat(${scope === 'all' ? 15 : 53}, minmax(3px, 1fr))`;
  heatmap.innerHTML = cells;
  $('#footprint-page-title').textContent = scope === 'all' ? '从第一天开始留下的痕迹' : '这一年留下的痕迹';
  $('#footprint-total').textContent = scope === 'all' ? '126h 09m' : '42h 18m';
  $('#active-days').textContent = scope === 'all' ? '184' : '58';
  $('#distinct-books').textContent = scope === 'all' ? '31' : '18';
  $('#distinct-series').textContent = scope === 'all' ? '9' : '6';
  $('#heatmap').setAttribute('aria-label', scope === 'all' ? '全部阅读足迹热力图' : '2026 年阅读足迹热力图');
}

function setPeriod(period) {
  const data = periodData[period];
  document.body.dataset.period = period;
  $('#duration-title').textContent = data.title;
  $('#duration-total').textContent = data.total;
  $('#duration-range').textContent = data.range;
  const option = document.body.dataset.option;
  $('#option-caption').textContent = option === 'dial' ? data.caption : optionData[option].caption;
  $$('.period-tab').forEach((button) => {
    const selected = button.dataset.period === period;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-selected', String(selected));
  });
}

function setOption(option) {
  document.body.dataset.option = option;
  $('#option-caption').textContent = option === 'dial' ? periodData[document.body.dataset.period].caption : optionData[option].caption;
  $$('.option-button').forEach((button) => button.classList.toggle('is-selected', button.dataset.option === option));
  renderGraphic(option);
}

$$('.period-tab').forEach((button) => button.addEventListener('click', () => setPeriod(button.dataset.period)));
$$('.scope-tab').forEach((button) => button.addEventListener('click', () => {
  const scope = button.dataset.scope;
  document.body.dataset.scope = scope;
  $$('.scope-tab').forEach((item) => {
    const selected = item.dataset.scope === scope;
    item.classList.toggle('is-selected', selected);
    item.setAttribute('aria-selected', String(selected));
  });
  renderHeatmap(scope);
}));
$$('.option-button').forEach((button) => button.addEventListener('click', () => setOption(button.dataset.option)));

setPage(window.location.hash === '#footprint' ? 'footprint-page' : 'library-page');
renderGraphic('dial');
renderHeatmap('year');
