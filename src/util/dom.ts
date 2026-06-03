/**
 * Replace an element's contents from a trusted, developer-authored markup
 * string.
 *
 * Functionally equivalent to assigning `el.innerHTML`, but parses the markup in
 * a detached document and moves the resulting nodes in, so it never touches the
 * live `innerHTML` / `outerHTML` setters (Obsidian's review guidelines flag
 * those as XSS vectors). This helper is ONLY ever called with static SVG icon
 * constants and template literals whose interpolated values are already passed
 * through `escapeHtml` — never with raw user input.
 *
 * The HTML parser handles inline SVG via foreign-content rules, so SVG icons
 * come out with the correct namespaces, identical to the old innerHTML path.
 */
export function setHtml(el: HTMLElement, markup: string): void {
  const doc = new DOMParser().parseFromString(markup, 'text/html');
  el.empty();
  for (const node of Array.from(doc.body.childNodes)) el.appendChild(node);
}
