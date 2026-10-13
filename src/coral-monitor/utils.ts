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

export function htmlElement_createFromTemplate<T extends HTMLElement>(
  strTemplate: string,
): T {
  const template = document.createElement("template");
  template.innerHTML = strTemplate.trim();
  return template.content.firstElementChild as T;
}

export async function waitAsync(msec: number) {
  if (msec <= 0) {
    return;
  }

  return new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, msec);
  });
}
