// シンプルなモーダルダイアログ
// openModal({ title, body, buttons:[{label, value, primary}], side }) → Promise<{ value, body }>
// side: true なら画面の右側(パネルの上)に出して背景を暗くしない(キャンバスを見ながら値を変えられる。ホイールでズームもできる)

let openCount = 0;

export const isModalOpen = () => openCount > 0;

// 自前の全画面ダイアログ(パーツ分けなど)を開いている間、アプリのショートカットを止める。戻り値で解除
export function holdModal() {
  openCount++;
  let done = false;
  return () => { if (!done) { done = true; openCount--; } };
}

export function openModal({ title, body, buttons, width, side = false }) {
  return new Promise((resolve) => {
    openCount++;
    const root = document.getElementById('modal-root');
    const back = document.createElement('div');
    back.className = 'modal-backdrop' + (side ? ' side' : '');
    const box = document.createElement('div');
    box.className = 'modal';
    if (width) box.style.width = width + 'px';
    const h = document.createElement('h2');
    h.textContent = title;
    const content = document.createElement('div');
    content.className = 'modal-body';
    if (typeof body === 'string') content.innerHTML = body;
    else if (body) content.append(body);
    const foot = document.createElement('div');
    foot.className = 'modal-foot';
    box.append(h, content, foot);
    back.append(box);
    root.append(back);

    const close = (value) => {
      openCount--;
      document.removeEventListener('keydown', onKey, true);
      back.remove();
      resolve({ value, body: content });
    };
    const primary = buttons.find((b) => b.primary);
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.textContent = b.label;
      if (b.primary) btn.className = 'primary';
      btn.onclick = () => close(b.value);
      foot.append(btn);
    }
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
      else if (e.key === 'Enter' && primary && e.target.tagName !== 'BUTTON') {
        e.preventDefault(); e.stopPropagation(); close(primary.value);
      } else {
        e.stopPropagation();
      }
    };
    document.addEventListener('keydown', onKey, true);
    const focusable = content.querySelector('input, select') || foot.querySelector('.primary');
    focusable?.focus();
  });
}

export async function alertModal(title, message) {
  await openModal({ title, body: escapeHtml(message), buttons: [{ label: 'OK', value: true, primary: true }] });
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
