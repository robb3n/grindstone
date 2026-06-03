import { App, Component, MarkdownRenderer, MarkdownView, Notice, TFile } from 'obsidian';
import { CardData } from '../card/types';
import { CardManager } from '../card/card-manager';

// Mirrors Obsidian's tag/search/backlink jump UX. openLinkText from a
// non-markdown view (e.g. the Grindstone tab) can't replace the current leaf —
// it always creates a new tab. So walk markdown leaves first; if the file is
// already open, refocus that leaf. Ctrl/Meta forces a new tab. Cursor
// placement uses ephemeralState — Obsidian's built-in cursor-on-open channel,
// works in source + reading mode without a manual editor.scrollIntoView dance.
export async function openCardSource(
  app: App,
  filePath: string,
  startLine: number | null | undefined,
  opts: { newTab?: boolean } = {},
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return;
  const eState = startLine != null ? { line: startLine, col: 0 } : undefined;
  const existingLeaf = opts.newTab
    ? null
    : app.workspace
        .getLeavesOfType('markdown')
        .find((l) => l.view instanceof MarkdownView && l.view.file?.path === filePath) ?? null;
  if (existingLeaf) {
    app.workspace.setActiveLeaf(existingLeaf, { focus: true });
    if (eState) existingLeaf.setEphemeralState(eState);
  } else {
    const leaf = app.workspace.getLeaf('tab');
    await leaf.openFile(file, { active: true, eState });
  }
}

/**
 * Render a card's answer (block content) into `container`.
 * Used by both ReviewModal and the inline workspace review.
 */
export async function renderCardAnswer(
  container: HTMLElement,
  card: CardData,
  cardId: string,
  cardManager: CardManager,
  app: App,
  component: Component,
): Promise<void> {
  const blockContent = await cardManager.getBlockContent(card, cardId);
  // Reading-mode CSS snippets scope their selectors to `.markdown-preview-view`
  // (Obsidian's reading-view container). MarkdownRenderer.render emits bare HTML
  // into our own container, so those rules never match — e.g. a `<sub>` cloze
  // snippet (`.markdown-preview-view sub { color: transparent }`) shows its hidden
  // text in full. Tagging the container with the same class the real reading view
  // carries (alongside the caller's `markdown-rendered`) lets every reading-mode
  // snippet reach card answers. Safe here because the bare renderer produces no
  // `.markdown-preview-sizer`/`.el-*` wrappers, so theme block-layout rules keyed
  // off those don't bleed in.
  container.classList.add('markdown-preview-view');
  await MarkdownRenderer.render(app, blockContent, container, card.file, component);
  bindFootnotePopovers(container, component);
  bindAnswerLinks(container, app, card.file, component);
}

// MarkdownRenderer.render produces inert anchors — unlike Reading View, Obsidian
// does not auto-wire `.internal-link` to `openLinkText` nor route external links
// to the browser when rendered inside custom views/modals. Footnote refs are
// handled separately by bindFootnotePopovers and skipped here.
export function bindAnswerLinks(
  container: HTMLElement,
  app: App,
  sourcePath: string,
  component: Component,
): void {
  component.registerDomEvent(container, 'click', (e) => {
    const target = e.target as HTMLElement | null;
    const link = target?.closest('a') as HTMLAnchorElement | null;
    if (!link || !container.contains(link)) return;
    const href = link.getAttribute('href');
    if (!href) return;
    // Footnote ref/backref — leave to popover hover + native in-doc scroll.
    if (href.startsWith('#fn-') || href.startsWith('#fnref-')) return;

    e.preventDefault();
    e.stopPropagation();

    if (link.classList.contains('internal-link')) {
      const linktext = link.getAttribute('data-href') ?? href;
      app.workspace.openLinkText(linktext, sourcePath, e.ctrlKey || e.metaKey);
      return;
    }

    openExternal(href);
  });
}

// Hand a URL to the OS handler. window.open() inside Obsidian's renderer can
// land in an Electron popup; shell.openExternal is the reliable route.
// If the href is malformed (Obsidian's markdown parser can leave nested-bracket
// links like `[https://a](custom://b)` as a single literal href), try to
// extract the real target from `](URL)` / first `proto://...` substring.
function openExternal(href: string): void {
  const electron = (window as { require?: (m: string) => { shell?: { openExternal?: (url: string) => Promise<void> } } }).require?.('electron');
  const opener = electron?.shell?.openExternal;
  const tryOpen = (url: string): Promise<void> => {
    if (opener) return Promise.resolve(opener(url));
    window.open(url, '_blank');
    return Promise.resolve();
  };
  tryOpen(href).catch(() => {
    let decoded = href;
    try { decoded = decodeURIComponent(href); } catch { /* keep raw */ }
    const m = decoded.match(/\]\(([a-z][a-z0-9+.-]*:\/\/[^\s)]+)/i)
           ?? decoded.match(/([a-z][a-z0-9+.-]*:\/\/[^\s)\]]+)/i);
    const extracted = m?.[1];
    if (extracted) {
      tryOpen(extracted).catch((err) => {
        console.error('[Grindstone] openExternal failed for', extracted, err);
        new Notice(`Cannot open link: ${href.slice(0, 60)}…`);
      });
      return;
    }
    new Notice(`Cannot open link: ${href.slice(0, 60)}…`);
  });
}

// MarkdownRenderer.render produces static HTML — unlike Reading View it does
// NOT auto-bind the footnote hover popover. Callers that render card answer
// markdown must invoke this to get the hover behavior. Uses event delegation
// on `container` so it survives async post-processing and doesn't depend on
// which class Obsidian's parser tags onto the anchor.
export function bindFootnotePopovers(container: HTMLElement, component: Component): void {
  const popover = document.createElement('div');
  popover.className = 'gs-footnote-popover';
  popover.style.display = 'none';
  document.body.appendChild(popover);
  component.register(() => popover.remove());

  let hideTimer: number | null = null;
  let currentAnchor: HTMLAnchorElement | null = null;

  const cancelHide = () => {
    if (hideTimer != null) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
  };
  const hide = () => {
    cancelHide();
    hideTimer = window.setTimeout(() => {
      popover.style.display = 'none';
      currentAnchor = null;
    }, 150);
  };
  const showFor = (link: HTMLAnchorElement) => {
    if (currentAnchor === link && popover.style.display !== 'none') return;
    const href = link.getAttribute('href');
    if (!href || !href.startsWith('#')) return;
    const targetId = href.slice(1);
    const target = container.querySelector<HTMLElement>(`[id="${CSS.escape(targetId)}"]`);
    if (!target) return;

    currentAnchor = link;
    const clone = target.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.footnote-backref').forEach((b) => b.remove());
    popover.empty();
    popover.appendChild(clone);

    popover.style.display = '';
    popover.style.top = '0px';
    popover.style.left = '0px';
    const linkRect = link.getBoundingClientRect();
    const popRect = popover.getBoundingClientRect();
    const margin = 8;

    let top = linkRect.bottom + margin;
    if (top + popRect.height > window.innerHeight - margin) {
      top = linkRect.top - popRect.height - margin;
    }
    let left = linkRect.left;
    if (left + popRect.width > window.innerWidth - margin) {
      left = window.innerWidth - popRect.width - margin;
    }
    if (left < margin) left = margin;
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
  };

  // Walk up the DOM from the event target looking for a footnote-ref anchor.
  // Match on `href` rather than class so we're independent of Obsidian's
  // internal class naming.
  const findFootnoteAnchor = (el: EventTarget | null): HTMLAnchorElement | null => {
    let cur = el as HTMLElement | null;
    while (cur && cur !== container) {
      if (cur.tagName === 'A') {
        const href = (cur as HTMLAnchorElement).getAttribute('href');
        if (href && href.startsWith('#fn-')) return cur as HTMLAnchorElement;
      }
      if (cur.tagName === 'SUP') {
        const inner = cur.querySelector<HTMLAnchorElement>('a[href^="#fn-"]');
        if (inner) return inner;
      }
      cur = cur.parentElement;
    }
    return null;
  };

  component.registerDomEvent(container, 'mouseover', (e) => {
    const link = findFootnoteAnchor(e.target);
    if (!link) return;
    cancelHide();
    showFor(link);
  });
  component.registerDomEvent(container, 'mouseout', (e) => {
    const link = findFootnoteAnchor(e.target);
    if (!link) return;
    const related = e.relatedTarget as HTMLElement | null;
    if (related && (link.contains(related) || popover.contains(related))) return;
    hide();
  });
  component.registerDomEvent(popover, 'mouseenter', cancelHide);
  component.registerDomEvent(popover, 'mouseleave', hide);
}
