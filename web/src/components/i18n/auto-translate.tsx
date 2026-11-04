/**
 * DOM bridge for legacy screens.
 *
 * It translates static UI copy and accessibility attributes while preserving
 * customer/content fields. User-generated content is marked with
 * `data-user-content` (or lives in editable/table body areas) and is skipped
 * by phrase substitution. The map only contains product copy, so names and
 * email bodies are never sent anywhere or rewritten by a translation service.
 */
import * as React from 'react';
import { useI18n, translateText } from '@/i18n';

const SKIP_SELECTOR = 'script,style,textarea,pre,code,[contenteditable="true"],[data-user-content],.ql-editor,.mail-body,.letter-body';
const PHRASE_SAFE_SELECTOR = 'button,label,h1,h2,h3,h4,h5,th,legend,option,[role="button"],[role="tab"],[role="menuitem"]';

const originalText = new WeakMap<Text, string>();
const originalAttrs = new WeakMap<Element, Record<string, string>>();
let originalTitle: string | null = null;
let scheduled = false;

function translateAttribute(element: Element, name: string): void {
  const value = element.getAttribute(name);
  if (!value || !/[\u4e00-\u9fff]/.test(value)) return;
  const translated = translateText(value, false);
  if (translated === value) return;
  const originals = originalAttrs.get(element) ?? {};
  if (!(name in originals)) {
    originals[name] = value;
    originalAttrs.set(element, originals);
  }
  element.setAttribute(name, translated);
}

function translateElementTree(root: ParentNode): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }
  for (const text of nodes) {
    const parent = text.parentElement;
    if (!parent || parent.closest(SKIP_SELECTOR)) continue;
    if (!/[\u4e00-\u9fff]/.test(text.data)) continue;
    if (!originalText.has(text)) originalText.set(text, text.data);
    const allowPhrases = Boolean(parent.closest(PHRASE_SAFE_SELECTOR));
    const translated = translateText(text.data, allowPhrases);
    if (translated !== text.data) text.data = translated;
  }
  if (root instanceof Element || root === document) {
    const elements = root instanceof Element ? [root, ...Array.from(root.querySelectorAll('*'))] : Array.from(document.querySelectorAll('*'));
    for (const element of elements) {
      if (element.closest(SKIP_SELECTOR)) continue;
      for (const name of ['placeholder', 'title', 'aria-label', 'alt']) translateAttribute(element, name);
    }
  }
}

function restore(): void {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = node as Text;
    const original = originalText.get(text);
    if (original !== undefined && text.data !== original) text.data = original;
    node = walker.nextNode();
  }
  for (const element of Array.from(document.querySelectorAll('*'))) {
    const originals = originalAttrs.get(element);
    if (!originals) continue;
    for (const [name, value] of Object.entries(originals)) element.setAttribute(name, value);
  }
  if (originalTitle) document.title = originalTitle;
  originalTitle = null;
}

function translateTitle(): void {
  if (!/[\u4e00-\u9fff]/.test(document.title)) return;
  if (!originalTitle) originalTitle = document.title;
  document.title = document.title
    .split(' · ')
    .map((part) => part === '客户开发信管理工具' ? 'GlobalCRM' : translateText(part, false))
    .join(' · ');
}

export function AutoTranslate(): null {
  const { language } = useI18n();

  React.useEffect(() => {
    if (language !== 'en') {
      restore();
      return;
    }
    const run = (): void => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        translateTitle();
        translateElementTree(document.body);
      });
    };
    run();
    const observer = new MutationObserver((mutations) => {
      // Ignore mutations produced by the bridge itself (they contain no Han).
      if (mutations.some((mutation) => Array.from(mutation.addedNodes).some((item) => item.textContent && /[\u4e00-\u9fff]/.test(item.textContent)))) run();
      else if (mutations.some((mutation) => mutation.type === 'characterData' && /[\u4e00-\u9fff]/.test(mutation.target.textContent ?? ''))) run();
      else if (mutations.some((mutation) => mutation.type === 'attributes')) run();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title', 'aria-label', 'alt'] });
    const titleObserver = new MutationObserver(translateTitle);
    titleObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => { observer.disconnect(); titleObserver.disconnect(); };
  }, [language]);

  return null;
}

export default AutoTranslate;
