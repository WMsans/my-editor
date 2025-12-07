type Listener<T> = (data: T) => void;

export class EventEmitter {
  private listeners: Map<string, Listener<any>[]> = new Map();

  on<T>(event: string, listener: Listener<T>) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(listener);
    return () => this.off(event, listener);
  }

  off<T>(event: string, listener: Listener<T>) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      this.listeners.set(event, handlers.filter(h => h !== listener));
    }
  }

  emit<T>(event: string, data?: T) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach(h => h(data));
    }
  }
}