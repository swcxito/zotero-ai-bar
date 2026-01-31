export const Icons = {
  QuickInput: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m8 12 4 4 4-4"/></svg>`,
  Delete: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`,
  Chevron: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
  Add: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`,
  Check: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
};

interface styleTransitionRecord {
  styleTrue: string[];
  styleFalse: string[];
  state: boolean;
}

export class ZbComponent extends HTMLElement {
  constructor() {
    super();
  }

  private styleTransitionRecords: Map<string, styleTransitionRecord> =
    new Map();
  protected registerStyleTransition(
    key: string,
    styleA: string[],
    styleB: string[],
    initState = false,
  ): void {
    this.styleTransitionRecords.set(key, {
      styleTrue: styleA,
      styleFalse: styleB,
      state: initState,
    });
  }

  protected styleTransition(key: string, state: boolean): void {
    const record = this.styleTransitionRecords.get(key);
    if (!record) {
      return;
    }
    if (state) {
      this.classList.remove(...record.styleFalse);
      this.classList.add(...record.styleTrue);
    } else {
      this.classList.remove(...record.styleTrue);
      this.classList.add(...record.styleFalse);
    }
    record.state = state;
  }

  protected touggleStyle(key: string): void {
    const record = this.styleTransitionRecords.get(key);
    if (!record) {
      return;
    }
    this.styleTransition(key, !record.state);
  }
}
