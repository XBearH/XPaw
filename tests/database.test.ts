import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { XPawDatabase } from "../src/database.js";

describe("XPawDatabase", () => {
  let directory: string;
  let database: XPawDatabase;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "xpaw-db-"));
    database = new XPawDatabase(join(directory, "xpaw.sqlite"));
  });

  afterEach(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("records tool runs when optional result fields are absent", () => {
    const conversationId = database.createConversation("test-agent", "Test");
    expect(() => database.auditToolRun({
      conversationId,
      toolName: "write_file",
      argumentsJson: "{}",
      authorizationState: "denied",
      status: "cancelled",
    })).not.toThrow();
  });
});
