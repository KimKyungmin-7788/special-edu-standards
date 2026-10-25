// 전체 원문을 계층별로 탐색하고 기존 바구니에 중복 없이 추가한다.
export function mountStandardsBrowser({ getStandards, getBasket, addToBasket }) {
  const trigger = document.getElementById('browse-standards');
  const dialog = document.getElementById('standards-dialog');
  const tree = document.getElementById('standards-tree');
  const status = document.getElementById('tree-status');
  const selected = new Set();
  const groups = new Map();
  const fields = ['school_level', 'subject', 'grade_band', 'domain'];
  const escape = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let built = false;
  function branch(items, depth = 0) {
    if (depth === fields.length) return items.map(s => `<label class="tree-leaf"><input type="checkbox" data-code="${escape(s.code)}"><span><b>${escape(s.code)}</b><span>${escape(s.text)}</span></span></label>`).join('');
    const buckets = new Map();
    for (const s of items) {
      const name = s[fields[depth]] || '기타';
      if (!buckets.has(name)) buckets.set(name, []);
      buckets.get(name).push(s);
    }
    return [...buckets].map(([name, children]) => {
      const id = String(groups.size);
      groups.set(id, children.map(s => s.code));
      return `<div class="tree-branch"><input class="branch-check" type="checkbox" data-group="${id}" aria-label="${escape(name)} 전체 선택"><details><summary><span>${escape(name)}</span><small>${children.length}개</small></summary><div class="tree-children">${branch(children, depth + 1)}</div></details></div>`;
    }).join('');
  }
  function sync() {
    tree.querySelectorAll('[data-code]').forEach(el => { el.checked = selected.has(el.dataset.code); });
    tree.querySelectorAll('[data-group]').forEach(el => {
      const codes = groups.get(el.dataset.group);
      const count = codes.filter(code => selected.has(code)).length;
      el.checked = count === codes.length;
      el.indeterminate = count > 0 && count < codes.length;
    });
    document.getElementById('tree-count').textContent = `${selected.size}개 선택`;
    for (const id of ['tree-add', 'tree-copy']) document.getElementById(id).disabled = !selected.size;
  }
  trigger.addEventListener('click', () => {
    const standards = getStandards();
    dialog.showModal();
    status.textContent = '';
    document.getElementById('tree-fallback').hidden = true;
    if (!standards.length) { status.textContent = '성취기준을 불러오는 중이에요. 잠시 후 다시 열어 주세요.'; return; }
    if (!built) { tree.innerHTML = branch(standards); built = true; }
    selected.clear();
    getBasket().forEach(s => selected.add(s.code));
    sync();
  });
  document.getElementById('tree-close').addEventListener('click', () => dialog.close());
  tree.addEventListener('change', e => {
    const el = e.target;
    const codes = el.dataset.group !== undefined ? groups.get(el.dataset.group) : [el.dataset.code];
    for (const code of codes) if (code) el.checked ? selected.add(code) : selected.delete(code);
    status.textContent = '';
    sync();
  });
  document.getElementById('tree-clear').addEventListener('click', () => { selected.clear(); sync(); status.textContent = '선택을 해제했어요. 이미 담은 바구니는 유지돼요.'; });
  for (const [id, open] of [['tree-expand', true], ['tree-collapse', false]]) {
    document.getElementById(id).addEventListener('click', () => tree.querySelectorAll('details').forEach(d => { d.open = open; }));
  }
  function add() {
    const items = getStandards().filter(s => selected.has(s.code));
    addToBasket(items);
    return items;
  }
  document.getElementById('tree-add').addEventListener('click', () => {
    add(); status.textContent = `선택한 ${selected.size}개를 바구니에 담았어요. 중복된 기준은 한 번만 담아요.`;
  });
  document.getElementById('tree-copy').addEventListener('click', async () => {
    const items = add();
    const text = items.map((s, i) => `${i + 1}. ${s.code} ${s.text} (${s.school_level} ${s.grade_band} · ${s.subject})`).join('\n');
    try { await navigator.clipboard.writeText(text); status.textContent = `${items.length}개를 바구니에 담고 복사했어요.`; }
    catch {
      const field = document.getElementById('tree-fallback');
      field.hidden = false; field.value = text; field.focus(); field.select();
      status.textContent = '바구니에 담았어요. 자동 복사가 제한되어 아래 내용을 선택했으니 직접 복사해 주세요.';
    }
  });
}
