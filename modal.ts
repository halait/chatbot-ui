export let currentModal: HTMLElement | null = null;

export function toggleModal(modal: Node, display = 'block', isTemplate = false): boolean {
  if (!modal) return false;

  // resolve the actual HTMLElement to style (handles DocumentFragment from template.content.cloneNode)
  let targetEl: HTMLElement | null = null;
  if ((modal as DocumentFragment).nodeType === 11) {
    targetEl = (modal as DocumentFragment).firstElementChild as HTMLElement | null;
  } else if (modal instanceof HTMLElement) {
    targetEl = modal;
  }

  if (currentModal) {
    if (isTemplate) currentModal.remove();
    else currentModal.style.display = 'none';
  }

  if (targetEl?.id === currentModal?.id) {
    currentModal = null;
    return false;
  }

  if (isTemplate) {
    document.body.appendChild(modal); // appends fragment children or the element
    if (!targetEl) return false;
    currentModal = targetEl;
    requestAnimationFrame(() => {
      if (currentModal === targetEl) targetEl.style.display = display;
    });
  } else {
    if (!targetEl) return false;
    currentModal = targetEl;
    targetEl.style.display = display;
  }

  return true;
}
