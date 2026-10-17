// 「Claude 連携」ダイアログ(ファイル → Claude 連携… / 下のステータスバーの表示をクリック)
//   オン / オフ・ポート番号・Claude Code に登録するコマンド(コピー)・トークンの作り直し・今の登録が合っているか
//   登録は「橋渡し」方式(1.41.0 から): Claude Code が小さなプログラム(lib/mcp-bridge.js)を起動し、それが Kodai につなぐ。
//   Kodai が閉じていても、Claude が呼んだときに裏で起動する。合言葉は登録に入れないので、ずれない
//   状態はメインプロセス(lib/claude.js)が持つ。ステータスバーに「Claude 連携: 待ち受け中」などを出す
import { toast } from './state.js';
import { openModal, escapeHtml } from './modal.js';

let current = null;

function showStatus(s) {
  current = s;
  const el = document.getElementById('st-claude');
  if (!el) return;
  const on = !!s?.enabled || !!s?.forced;
  el.hidden = !on;
  el.textContent = !on ? '' : s.running ? '● Claude 連携' : '● Claude 連携(止まっています)';
  el.classList.toggle('off', on && !s.running);
  el.title = s?.running ? `Claude から操作できます(${s.url})。クリックで設定` : s?.error || '';
}

export async function initClaudeStatus() {
  const c = window.native?.claude;
  if (!c) return;
  c.onStatus(showStatus);
  showStatus(await c.status());
}

// 今の登録の状態の文
const regText = (r) => !r ? '' : r.kind === 'none' ? '○ Claude Code にまだ登録されていません(下の「自動で登録する」)'
  : r.kind === 'bridge' ? (r.ok ? '● Claude Code に登録済み(Kodai を閉じていても使えます)' : `▲ 登録が古くなっています: ${r.why}。「自動で登録する」を押してください`)
  : r.kind === 'http' ? (r.ok ? '▲ 前の方式で登録されています(Kodai を開いている間だけ使える)。「自動で登録する」を押すと、閉じていても使える方式に変わります' : `▲ 登録がずれていて、つながりません: ${r.why}。「自動で登録する」を押してください`)
  : r.kind === 'other' ? '▲ kodai という名前で、別のものが登録されています。「自動で登録する」で置き換わります' : '';
const regClass = (r) => (!r ? '' : r.kind === 'bridge' && r.ok ? 'ok' : r.kind === 'none' ? '' : 'ng');

export async function claudeDialog() {
  const c = window.native?.claude;
  if (!c) { toast('Claude 連携はアプリ版だけで使えます'); return; }
  let s = await c.status();
  const body = document.createElement('div');
  body.className = 'form claude-dialog';
  const render = () => {
    body.innerHTML = `
      <div class="c-reg ${regClass(s.registration)}">${escapeHtml(regText(s.registration))}</div>
      <p class="note">オンにすると、<b>Claude Code</b> から Kodai を操作して、絵・ドット絵・テクスチャを作ってもらえます。
      絵を作る処理はこの PC の中の Kodai が行います(画像生成 AI やインターネットは使いません)。Claude が考える分は、ふだんの Claude の使用量としてかかります。</p>
      <label class="check"><input type="checkbox" class="c-on"${s.enabled ? ' checked' : ''}>Claude 連携をオンにする</label>
      <label>ポート番号 <input type="number" class="c-port num" min="1024" max="65535" value="${s.port}"> <span class="note">ふつうはそのままで OK</span></label>
      <div class="c-state ${s.running ? 'ok' : s.enabled ? 'ng' : ''}">${s.running ? `● 待ち受け中: ${escapeHtml(s.url)}(この PC の中からだけつながります)` : s.enabled ? `● 止まっています${s.error ? ': ' + escapeHtml(s.error) : ''}` : '○ オフ'}</div>
      <h3 class="form-sec">はじめに1回: Claude Code に登録する</h3>
      <div class="row"><button type="button" class="c-register primary">自動で登録する</button><span class="note c-reg-msg">Claude Code に Kodai をつなぎ、使い方メモ(スキル)も入れます</span></div>
      <p class="note"><b>登録しておくと、Kodai を閉じていても使えます</b>。Claude が Kodai を使うときに、Kodai が画面を出さずに裏で起動します(そのあと Kodai をふつうに開くと、Claude が作っていた絵がそのまま出ます)。登録したあとに開いた Claude Code で「Kodai で 64px の石畳のテクスチャを作って」のように頼めます。</p>
      <p class="note">うまくいかないときは、ターミナル(PowerShell など)で次のコマンドを1回実行します(前の登録があれば、先に <code>claude mcp remove kodai --scope user</code>)。</p>
      <div class="c-cmd"><code>${escapeHtml(s.command)}</code><button type="button" class="c-copy">コピー</button></div>
      <p class="note">合言葉(トークン)は Kodai の中だけで持ち、登録には入りません。作り直しても、登録し直す必要はありません。</p>
      <div class="row"><button type="button" class="c-token">トークンを作り直す</button></div>`;
    body.querySelector('.c-copy').onclick = async () => {
      try { await navigator.clipboard.writeText(s.command); toast('コマンドをコピーしました'); } catch { toast('コピーできませんでした。選んで Ctrl+C してください'); }
    };
    body.querySelector('.c-on').onchange = async (e) => { s = await c.set({ enabled: e.target.checked }); showStatus(s); render(); };
    body.querySelector('.c-port').onchange = async (e) => { s = await c.set({ port: Number(e.target.value) }); showStatus(s); render(); };
    body.querySelector('.c-register').onclick = async (e) => {
      const msg = body.querySelector('.c-reg-msg');
      e.target.disabled = true;
      msg.textContent = '登録しています…';
      const r = await c.register();
      e.target.disabled = false;
      s = await c.status();
      render();
      const m2 = body.querySelector('.c-reg-msg');
      m2.textContent = r.mcp
        ? `登録しました。これから開く Claude Code で使えます${r.skill ? '(使い方メモも入れました)' : ''}。開いたままの Claude Code は、つなぎ直すか開き直してください`
        : `登録できませんでした: ${r.mcpError}`;
      m2.classList.toggle('err', !r.mcp);
    };
    body.querySelector('.c-token').onclick = async () => { s = await c.set({ newToken: true }); showStatus(s); render(); toast('トークンを作り直しました'); };
  };
  render();
  await openModal({ title: 'Claude 連携', body, width: 640, buttons: [{ label: '閉じる', value: 'ok', primary: true }] });
  showStatus(await c.status());
}

export const claudeStatus = () => current;
