export class ChatWindowCloseCoordinator<T extends object> {
  private readonly programmaticWindows = new WeakSet<T>();

  markProgrammatic(window: T): void {
    this.programmaticWindows.add(window);
  }

  consumeProgrammatic(window: T): boolean {
    return this.programmaticWindows.delete(window);
  }

  shouldPrevent(window: T, hasActiveRequests: boolean): boolean {
    return hasActiveRequests && !this.programmaticWindows.has(window);
  }
}
