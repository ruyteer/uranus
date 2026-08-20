/**
 * Construção de DOM sem framework.
 *
 * `h()` existe para tornar o XSS impossível por construção, não por
 * disciplina: todo texto entra por `textContent`, então um título de task
 * com `<script>` vira literalmente os caracteres `<script>` na tela. O
 * projeto trata conteúdo de arquivo como dado, nunca como marcação (INV-6),
 * e o backlog e as tasks vêm de arquivos do repositório do usuário.
 *
 * A CSP do painel bloqueia origem externa, mas CSP não protege de innerHTML:
 * `img-src data:` sozinho já basta para um `<img onerror>` executar. Por isso
 * a regra aqui é `innerHTML` em nenhum lugar que toque dado da API.
 */

/**
 * @param {string} tag
 * @param {Record<string, unknown>|null} [props]
 * @param {...unknown} children
 */
export function h(tag, props, ...children) {
  const node = document.createElement(tag)
  if (props) applyProps(node, props)
  append(node, children)
  return node
}

function applyProps(node, props) {
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue
    if (key === 'class') node.className = String(value)
    else if (key === 'text') node.textContent = String(value)
    else if (key === 'dataset') Object.assign(node.dataset, value)
    else if (key === 'style') applyStyle(node, value)
    else if (key === 'on') for (const [type, fn] of Object.entries(value)) node.addEventListener(type, fn)
    else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'selected') {
      node[key] = value
    } else if (value === true) node.setAttribute(key, '')
    else node.setAttribute(key, String(value))
  }
}

/**
 * Propriedade customizada (`--i`) NÃO entra por atribuição em `style`: o
 * `CSSStyleDeclaration` ignora chaves que não são propriedades CSS conhecidas,
 * e a atribuição some sem erro nenhum. Só `setProperty` grava. Era isto que
 * fazia o stagger de entrada dos KPIs sair todo com atraso zero.
 */
function applyStyle(node, style) {
  for (const [property, value] of Object.entries(style)) {
    if (value === undefined || value === null) continue
    if (property.startsWith('--')) node.style.setProperty(property, String(value))
    else node.style[property] = String(value)
  }
}

function append(node, children) {
  for (const child of children) {
    if (child === undefined || child === null || child === false || child === '') continue
    if (Array.isArray(child)) append(node, child)
    else if (child instanceof Node) node.append(child)
    else node.append(document.createTextNode(String(child)))
  }
}

/** Fragmento, para devolver várias raízes de uma função só. */
export function frag(...children) {
  const fragment = document.createDocumentFragment()
  append(fragment, children)
  return fragment
}

/** Esvazia sem `innerHTML = ''` — mantém a regra de "nenhum innerHTML". */
export function clear(node) {
  while (node.firstChild) node.firstChild.remove()
}

export function replace(node, ...children) {
  clear(node)
  append(node, children)
  return node
}

/**
 * SVG a partir do catálogo de ícones.
 *
 * Único ponto do painel que usa `innerHTML`, e de propósito: o argumento é
 * sempre uma constante do nosso próprio `icons.js`, nunca dado da API. Um
 * `path` de SVG não tem como ser construído com `document.createElement`
 * sem transformar cada ícone num monte de linhas.
 */
export function svg(paths, className = 'icon') {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  node.setAttribute('viewBox', '0 0 24 24')
  node.setAttribute('aria-hidden', 'true')
  node.setAttribute('class', className)
  node.innerHTML = paths
  return node
}

/**
 * Delegação por `data-*`. Nenhum `onclick=` inline no painel inteiro: é o que
 * permite endurecer a CSP (tirar `unsafe-inline` de `script-src`) depois sem
 * reescrever tela nenhuma.
 */
export function delegate(root, type, selector, handler) {
  root.addEventListener(type, (event) => {
    const target = event.target instanceof Element ? event.target.closest(selector) : null
    if (target && root.contains(target)) handler(event, target)
  })
}

/** Escapa para os raros casos de texto composto. Preferir `h()`/`textContent`. */
export function esc(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  )
}
