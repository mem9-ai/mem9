import { writeFile } from "node:fs/promises";
import type { Context } from "@deepseek-ai/cordis";
import { Session, SessionId } from "@deepseek-ai/dsh-session";

export const name = "mem9-replay-inspector";
export const inject = ["sessionPersistence"];

export async function apply(ctx: Context): Promise<void> {
  const rawId = process.env.MEM9_REPLAY_SESSION_ID;
  if (rawId === undefined) throw new Error("MEM9_REPLAY_SESSION_ID is required");
  const id = SessionId(rawId);
  const loaded = await ctx.sessionPersistence.load(id);
  const session = Session.create(id, structuredClone(loaded.events));
  await writeFile("replay-session.json", JSON.stringify({
    eventTypes: loaded.events.map(event => event.type),
    messages: session.deriveMessages(),
  }), "utf8");
}
