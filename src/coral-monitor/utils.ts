export function htmlElement_updateStyle(
  el: HTMLElement | null | undefined,
  styleObj: Partial<CSSStyleDeclaration>,
) {
  if (!el) {
    return;
  }

  for (const key in styleObj) {
    const value = styleObj[key as keyof CSSStyleDeclaration];
    if (value !== undefined) {
      el.style[key] = value as any;
    }
  }
}

export function htmlElement_addClass(
  el: HTMLElement | null | undefined,
  ...listClassName: Array<string>
) {
  if (!el) {
    return;
  }

  el.classList.add(...listClassName);
}

export function htmlElement_removeClass(
  el: HTMLElement | null | undefined,
  ...listClassName: Array<string>
) {
  if (!el) {
    return;
  }

  el.classList.remove(...listClassName);
}
