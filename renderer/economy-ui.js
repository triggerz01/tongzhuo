/* economy-ui.js — 专注星界面装配。核心规则都在 economy.js。 */
(function () {
  'use strict';
  if (!window.TZEconomy) return;

  const points = new window.TZEconomy.Economy();
  let selected = 'companion';
  let penaltyTimer = null;

  const byId = (id) => document.getElementById(id);
  function style() {
    const el = document.createElement('style');
    el.textContent = `
      .modeCards{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .modeCard{padding:12px 14px;text-align:left;border:1px solid #2b333c;
        background:rgba(20,25,31,.7);color:#c2cad2;cursor:pointer;font-family:var(--sans)}
      .modeCard b{display:block;color:#edf1f4;font-size:14px;margin-bottom:4px}
      .modeCard small{display:block;color:#7f8a94;line-height:1.55}
      .modeCard.on{border-color:#9E1B25;background:#20161a}
      .modeCard.contract.on{border-color:#c38b43;background:#241e16}
      #pointsToast{position:absolute;z-index:50;left:50%;bottom:12%;transform:translateX(-50%);
        min-width:300px;max-width:460px;padding:14px 16px;background:rgba(14,18,22,.96);
        border:1px solid #46515b;box-shadow:0 12px 36px rgba(0,0,0,.5);display:none}
      #pointsToast.on{display:block} #pointsToast strong{display:block;margin-bottom:5px}
      #pointsToast p{margin:0;color:#aab4bc;font-size:13px;line-height:1.6}
      #pointsToast .actions{display:flex;gap:8px;margin-top:11px;justify-content:flex-end}
      #pointsToast button{padding:6px 11px;background:#20262d;color:#d5dce2;border:1px solid #39434c;cursor:pointer}
      #pointsToast button.primary{background:#9E1B25;border-color:#9E1B25;color:#fff}
      .pointsSummary{margin-top:9px;color:#c8d0d7;font:12px var(--mono)}
      .pointsSummary b{color:#f4c66a!important}
      #homePoints{margin-top:16px;color:#b8c1c9;font:12px var(--mono)}
      #homePoints b{color:#f4c66a;font-size:15px}
    `;
    document.head.appendChild(el);
  }

  function mount() {
    style();
    const setup = byId('setup');
    const foot = setup && setup.querySelector('.foot');
    if (setup && foot) {
      const section = document.createElement('section');
      section.innerHTML = `
        <h4>本场模式</h4>
        <div class="modeCards">
          <button class="modeCard on" data-point-mode="companion">
            <b>共场模式</b><small>专注获得积分；走神只暂停累计，不扣历史积分。</small>
          </button>
          <button class="modeCard contract" data-point-mode="contract">
            <b>契约模式 · 完成额外 +20%</b><small>满10分钟后启用奖惩；确认违规可能扣除账户积分。</small>
          </button>
        </div>`;
      setup.insertBefore(section, foot);
      section.querySelectorAll('[data-point-mode]').forEach((button) => {
        button.addEventListener('click', () => {
          selected = button.dataset.pointMode;
          section.querySelectorAll('[data-point-mode]').forEach((b) => b.classList.toggle('on', b === button));
        });
      });
    }

    const home = byId('home');
    if (home) {
      const balance = document.createElement('div');
      balance.id = 'homePoints';
      balance.innerHTML = `拥有 <b id="homePointBalance">0</b> 颗专注星`;
      home.appendChild(balance);
    }

    const summary = byId('homeSummary');
    if (summary) {
      const row = document.createElement('div');
      row.className = 'pointsSummary';
      row.innerHTML = `本场结算 <b id="sumPoints">0</b> 颗专注星 <span id="sumPointsNote"></span>`;
      summary.appendChild(row);
    }

    const toast = document.createElement('div');
    toast.id = 'pointsToast';
    toast.innerHTML = '<strong></strong><p></p><div class="actions"></div>';
    document.body.appendChild(toast);
    paint();
  }

  function paint() {
    const s = points.snapshot();
    if (byId('coinText')) byId('coinText').textContent = s.balance;
    if (byId('homePointBalance')) byId('homePointBalance').textContent = s.balance;
    if (byId('pendingPointText')) byId('pendingPointText').textContent = s.session ? s.session.pending : 0;
  }

  function toast(title, message, buttons, timeout) {
    const el = byId('pointsToast');
    if (!el) return;
    if (penaltyTimer) { clearTimeout(penaltyTimer); penaltyTimer = null; }
    el.querySelector('strong').textContent = title;
    el.querySelector('p').textContent = message || '';
    const actions = el.querySelector('.actions');
    actions.innerHTML = '';
    (buttons || []).forEach((b) => {
      const button = document.createElement('button');
      button.textContent = b.label;
      if (b.primary) button.className = 'primary';
      button.addEventListener('click', () => { hideToast(); b.onClick(); });
      actions.appendChild(button);
    });
    el.classList.add('on');
    if (timeout) penaltyTimer = setTimeout(hideToast, timeout);
  }
  function hideToast() {
    if (penaltyTimer) clearTimeout(penaltyTimer);
    penaltyTimer = null;
    const el = byId('pointsToast');
    if (el) el.classList.remove('on');
  }

  points.subscribe((event) => {
    paint();
    if (event.type === 'violation-warning') {
      toast('先提醒一次，不扣分', event.label + '。回到学习就好。', [], 4000);
    }
    if (event.type === 'penalty-not-active') {
      toast('契约尚未生效', '本场未满10分钟，这次只提醒，不扣除历史积分。', [], 4000);
    }
    if (event.type === 'penalty-proposed') {
      let applied = false;
      const apply = () => {
        if (applied) return;
        applied = true;
        points.applyPenalty(event.kind);
      };
      toast(`将扣除 ${event.amount} 颗专注星`, `${event.label}。5秒内可以申诉。`, [
        { label: '我在学习', onClick: () => { applied = true; points.appeal(event.kind); } },
        { label: '接受并继续', primary: true, onClick: apply }
      ]);
      penaltyTimer = setTimeout(() => { hideToast(); apply(); }, 5000);
    }
    if (event.type === 'penalty-applied') {
      toast(`已扣除 ${event.amount} 颗`, '接下来连续专注10分钟，可以全部追回。', [
        { label: '这是误判', onClick: () => points.appeal(event.kind) }
      ], 8000);
    }
    if (event.type === 'penalty-recovered') {
      toast(`已追回 ${event.amount} 颗`, event.reason === 'appeal' ? '申诉已接受，同类判断静默30分钟。' : '你重新回到了专注。', [], 4500);
    }
  });

  window.TZPoints = points;
  window.TZPointsUI = {
    mode: () => selected,
    paint,
    finish(result) {
      if (!result || !byId('sumPoints')) return;
      byId('sumPoints').textContent = result.creditedTotal;
      byId('sumPointsNote').textContent = result.eligible
        ? `（专注 ${result.base} + 完成 ${result.completionBonus} + 契约 ${result.contractBonus}`
          + `${result.dailyBonus ? ` + 今日 ${result.dailyBonus}` : ''}`
          + `${result.weeklyBonus ? ` + 本周 ${result.weeklyBonus}` : ''}）`
        : '（未满10分钟，本场不结算）';
      paint();
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
