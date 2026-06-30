import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createReportPdfApiKeyHandoffNonce,
  requestReportPdfApiKey,
  startReportPdfApiKeyHandoff,
} from "./report-pdf";

const LEGACY_REPORT_PDF_API_KEY_STORAGE_KEY = "mem9.reportPdfApiKey";

type MessageListener = (event: MessageEvent<unknown>) => void;

class FakeBroadcastChannel {
  private static channels = new Map<string, Set<FakeBroadcastChannel>>();

  private readonly listeners = new Set<MessageListener>();
  private closed = false;
  readonly name: string;

  constructor(name: string) {
    this.name = name;
    const channels = FakeBroadcastChannel.channels.get(name) ?? new Set();
    channels.add(this);
    FakeBroadcastChannel.channels.set(name, channels);
  }

  postMessage(message: unknown): void {
    const channels = FakeBroadcastChannel.channels.get(this.name);
    if (!channels) {
      return;
    }

    for (const channel of channels) {
      if (channel === this || channel.closed) {
        continue;
      }

      queueMicrotask(() => {
        for (const listener of channel.listeners) {
          listener(new MessageEvent("message", { data: message }));
        }
      });
    }
  }

  addEventListener(type: string, listener: MessageListener): void {
    if (type === "message") {
      this.listeners.add(listener);
    }
  }

  removeEventListener(type: string, listener: MessageListener): void {
    if (type === "message") {
      this.listeners.delete(listener);
    }
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
    FakeBroadcastChannel.channels.get(this.name)?.delete(this);
  }

  static reset(): void {
    this.channels.clear();
  }
}

const originalBroadcastChannel = globalThis.BroadcastChannel;

beforeEach(() => {
  Object.defineProperty(globalThis, "BroadcastChannel", {
    configurable: true,
    value: FakeBroadcastChannel,
  });
});

afterEach(() => {
  FakeBroadcastChannel.reset();
  Object.defineProperty(globalThis, "BroadcastChannel", {
    configurable: true,
    value: originalBroadcastChannel,
  });
  localStorage.clear();
});

describe("report PDF API key handoff", () => {
  it("hands off the active api key for a scoped nonce without writing persistent storage", async () => {
    const stopHandoff = startReportPdfApiKeyHandoff("space-1");
    const nonce = createReportPdfApiKeyHandoffNonce();

    await expect(requestReportPdfApiKey(nonce)).resolves.toBe("space-1");

    expect(localStorage.getItem(LEGACY_REPORT_PDF_API_KEY_STORAGE_KEY)).toBeNull();
    stopHandoff();
  });

  it("does not answer requests without a registered nonce", async () => {
    const stopHandoff = startReportPdfApiKeyHandoff("space-1");

    await expect(requestReportPdfApiKey("unregistered-nonce", 1)).resolves.toBeNull();

    stopHandoff();
  });

  it("consumes each nonce after one successful handoff", async () => {
    const stopHandoff = startReportPdfApiKeyHandoff("space-1");
    const nonce = createReportPdfApiKeyHandoffNonce();

    await expect(requestReportPdfApiKey(nonce)).resolves.toBe("space-1");
    await expect(requestReportPdfApiKey(nonce, 1)).resolves.toBeNull();

    stopHandoff();
  });

  it("deduplicates concurrent requests for the same nonce", async () => {
    const stopHandoff = startReportPdfApiKeyHandoff("space-1");
    const nonce = createReportPdfApiKeyHandoffNonce();

    await expect(
      Promise.all([
        requestReportPdfApiKey(nonce),
        requestReportPdfApiKey(nonce),
      ]),
    ).resolves.toEqual(["space-1", "space-1"]);
    await expect(requestReportPdfApiKey(nonce, 1)).resolves.toBeNull();

    stopHandoff();
  });

  it("does not resolve an api key after the source page stops responding", async () => {
    const stopHandoff = startReportPdfApiKeyHandoff("space-1");
    const nonce = createReportPdfApiKeyHandoffNonce();
    stopHandoff();

    await expect(requestReportPdfApiKey(nonce, 1)).resolves.toBeNull();
  });
});
