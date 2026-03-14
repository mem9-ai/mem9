import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

declare global {
  var __triggerResizeObserver__: (() => void) | undefined;
}

class MemoryStorage implements Storage {
  private readonly store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

function ensureStorage(name: "localStorage" | "sessionStorage"): void {
  const current = globalThis[name];
  if (
    current &&
    typeof current.getItem === "function" &&
    typeof current.setItem === "function" &&
    typeof current.removeItem === "function" &&
    typeof current.clear === "function"
  ) {
    return;
  }

  Object.defineProperty(globalThis, name, {
    value: new MemoryStorage(),
    configurable: true,
  });
}

ensureStorage("localStorage");
ensureStorage("sessionStorage");

class ResizeObserverMock implements ResizeObserver {
  private static instances: ResizeObserverMock[] = [];

  public readonly targets = new Set<Element>();

  public constructor(private readonly callback: ResizeObserverCallback) {
    ResizeObserverMock.instances.push(this);
  }

  public disconnect(): void {
    this.targets.clear();
  }

  public observe(target: Element): void {
    this.targets.add(target);
  }

  public unobserve(target: Element): void {
    this.targets.delete(target);
  }

  public trigger(): void {
    const entries = [...this.targets].map(
      (target) =>
        ({
          target,
          contentRect: target.getBoundingClientRect(),
        }) as ResizeObserverEntry,
    );

    this.callback(entries, this);
  }

  public static triggerAll(): void {
    for (const instance of ResizeObserverMock.instances) {
      instance.trigger();
    }
  }

  public static reset(): void {
    ResizeObserverMock.instances = [];
  }
}

Object.defineProperty(globalThis, "ResizeObserver", {
  value: ResizeObserverMock,
  configurable: true,
});

globalThis.__triggerResizeObserver__ = () => {
  ResizeObserverMock.triggerAll();
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  ResizeObserverMock.reset();
});
