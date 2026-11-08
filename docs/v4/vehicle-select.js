// Ridge Runner v4 — vehicle select screen (grid of all vehicles with categories).
// Talks to the game through window.__rrGarage (exposed by game.js).
(function () {
  const CATS = ['All', 'Off-road', 'Trucks', 'Road & race', 'Specials'];
  let cat = 'All';
  try { cat = localStorage.getItem('rr4_vcat') || 'All'; } catch (e) {}
  if (!CATS.includes(cat)) cat = 'All';
  const $ = id => document.getElementById(id);

  function wait() {
    if (!window.__rrGarage || !$('vsel')) return setTimeout(wait, 200);
    init();
  }

  function init() {
    const G = window.__rrGarage;
    const panel = $('vsel'), grid = $('vGrid'), tabs = $('vTabs'), garage = $('garage');

    tabs.innerHTML = CATS.map(c => `<button class="vTab" data-c="${c}">${c}<span></span></button>`).join('');
    tabs.querySelectorAll('.vTab').forEach(b => b.onclick = () => {
      cat = b.dataset.c; try { localStorage.setItem('rr4_vcat', cat); } catch (e) {}
      render();
    });

    function render() {
      const cur = G.cur();
      tabs.querySelectorAll('.vTab').forEach(b => {
        const c = b.dataset.c;
        b.classList.toggle('on', c === cat);
        b.querySelector('span').textContent = c === 'All' ? G.list.length : G.list.filter(id => G.specs[id].cat === c).length;
      });
      grid.innerHTML = '';
      G.list.forEach((id, i) => {
        const v = G.specs[id];
        if (cat !== 'All' && v.cat !== cat) return;
        const st = G.stats(v);
        const el = document.createElement('button');
        el.className = 'vCard' + (id === cur ? ' sel' : '');
        el.innerHTML =
          `<div class="vImg"><img loading="lazy" alt="" src="assets/thumbs/${id}.webp">` +
          (v.isNew ? '<b class="vNew">NEW</b>' : '') + (id === cur ? '<b class="vCur">&#10003; Selected</b>' : '') +
          (v.model ? '<b class="v3d">3D model</b>' : '') + `</div>` +
          `<div class="vTxt"><div class="vCls">${v.cls}</div><div class="vName">${v.name}</div>` +
          `<div class="vBars">${st.map(([n, x]) => `<div title="${n}"><i style="width:${Math.round(x * 100)}%"></i><span>${n}</span></div>`).join('')}</div></div>`;
        el.onclick = () => { G.go(i); hide(); };
        grid.appendChild(el);
      });
      $('vCount').textContent = `${G.list.length} vehicles`;
    }

    function show() { render(); panel.classList.remove('hidden'); garage.classList.add('vOpen'); const s = grid.querySelector('.sel'); s && s.scrollIntoView({block: 'nearest'}); }
    function hide() { panel.classList.add('hidden'); garage.classList.remove('vOpen'); }

    $('gAll').onclick = show;
    $('vClose').onclick = hide;
    // opening the garage lands on the select screen first
    const btn = $('btnGarage'), orig = btn.onclick;
    btn.onclick = e => { orig && orig.call(btn, e); show(); };
    window.__rrGarageUpd = () => { if (!panel.classList.contains('hidden')) render(); };
    window.__rrVsel = {show, hide};
  }
  wait();
})();
