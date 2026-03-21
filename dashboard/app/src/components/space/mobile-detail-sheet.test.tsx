import "@/i18n";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { MobileDetailSheet } from "./mobile-detail-sheet";
import type { Memory, SessionMessage } from "@/types/memory";

function createMemory(): Memory {
  return {
    id: "mem-1",
    content: "The latest mem9 tenant count is 9579",
    memory_type: "insight",
    source: "agent",
    tags: ["mem9", "traffic"],
    metadata: null,
    agent_id: "agent",
    session_id: "session-1",
    state: "active",
    version: 1,
    updated_by: "agent",
    created_at: "2026-03-21T04:57:00Z",
    updated_at: "2026-03-21T04:57:00Z",
  };
}

function createSessionMessage(): SessionMessage {
  return {
    id: "msg-1",
    session_id: "session-1",
    agent_id: "agent",
    source: "agent",
    seq: 1,
    role: "user",
    content: [
      "Conversation info (untrusted metadata):",
      "",
      "{",
      '  "message_id": "om_x100b54d61dce74a0b21551c196de630",',
      '  "sender": "马圣博",',
      '  "timestamp": "Sat 2026-03-21 04:57 UTC"',
      "}",
      "",
      "Sender (untrusted metadata):",
      "",
      "{",
      '  "label": "马圣博",',
      '  "id": "ou_e77359a58df929cbfe166f14f37d3281",',
      '  "name": "马圣博"',
      "}",
      "",
      "[message_id: om_x100b54d61dce74a0b21551c196de630]",
      "马圣博: 多少了",
    ].join("\n"),
    content_type: "text/plain",
    tags: [],
    state: "active",
    created_at: "2026-03-21T04:57:00Z",
    updated_at: "2026-03-21T04:57:00Z",
  };
}

describe("MobileDetailSheet", () => {
  it("renders untrusted metadata as a summary first and expands inline on demand", async () => {
    render(
      <MobileDetailSheet
        memory={createMemory()}
        derivedTags={[]}
        sessionPreview={[createSessionMessage()]}
        sessionPreviewLoading={false}
        open
        onOpenChange={vi.fn()}
        onDelete={vi.fn()}
        t={i18n.t}
      />,
    );

    const conversationSummary = await screen.findByTestId(
      "session-metadata-summary-conversation-info-untrusted-metadata",
    );

    expect(conversationSummary).toHaveTextContent("马圣博");
    expect(
      screen.queryByTestId("session-metadata-body-conversation-info-untrusted-metadata"),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/多少了/)).toBeInTheDocument();

    fireEvent.click(
      screen.getByTestId("session-metadata-toggle-conversation-info-untrusted-metadata"),
    );

    expect(
      screen.getByTestId("session-metadata-body-conversation-info-untrusted-metadata"),
    ).toHaveTextContent('"message_id": "om_x100b54d61dce74a0b21551c196de630"');
    expect(screen.getByRole("button", { name: "Collapse" })).toBeInTheDocument();
  });

  it("renders into the fullscreen container when the page is fullscreen", () => {
    const fullscreenHost = document.createElement("div");
    document.body.appendChild(fullscreenHost);

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: fullscreenHost,
    });

    render(
      <MobileDetailSheet
        memory={createMemory()}
        derivedTags={[]}
        sessionPreview={[createSessionMessage()]}
        sessionPreviewLoading={false}
        open
        onOpenChange={vi.fn()}
        onDelete={vi.fn()}
        t={i18n.t}
      />,
    );

    expect(fullscreenHost.querySelector('[role="dialog"]')).not.toBeNull();

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: null,
    });
    fullscreenHost.remove();
  });

  it("shows derived tags separately when the active filter came from a local signal", () => {
    render(
      <MobileDetailSheet
        memory={createMemory()}
        derivedTags={["OpenClaw"]}
        sessionPreview={[createSessionMessage()]}
        sessionPreviewLoading={false}
        open
        onOpenChange={vi.fn()}
        onDelete={vi.fn()}
        t={i18n.t}
      />,
    );

    expect(screen.getByText("Derived tags")).toBeInTheDocument();
    expect(screen.getByText("#OpenClaw")).toBeInTheDocument();
  });
});
