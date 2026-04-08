import "@/i18n";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { MemoryCard } from "./memory-card";
import type { Memory } from "@/types/memory";

function createMemory(sessionID = ""): Memory {
  return {
    id: "mem-1",
    content: "Deploy dashboard status update",
    memory_type: "insight",
    source: "agent",
    tags: ["launch"],
    metadata: null,
    agent_id: "agent",
    session_id: sessionID,
    state: "active",
    version: 1,
    updated_by: "agent",
    created_at: "2026-03-21T04:57:00Z",
    updated_at: "2026-03-21T04:57:00Z",
  };
}

describe("MemoryCard", () => {
  it("shows linked-session text when the memory has a session_id", () => {
    render(
      <MemoryCard
        memory={createMemory("sess-1")}
        derivedTags={[]}
        hasLinkedSession
        isSelected={false}
        onClick={vi.fn()}
        onDelete={vi.fn()}
        t={i18n.t}
        delay={0}
      />,
    );

    expect(screen.getByText("From a conversation")).toBeInTheDocument();
  });

  it("omits linked-session text when the memory has no session_id", () => {
    render(
      <MemoryCard
        memory={createMemory("")}
        derivedTags={[]}
        hasLinkedSession={false}
        isSelected={false}
        onClick={vi.fn()}
        onDelete={vi.fn()}
        t={i18n.t}
        delay={0}
      />,
    );

    expect(screen.queryByText("From a conversation")).not.toBeInTheDocument();
  });
});
