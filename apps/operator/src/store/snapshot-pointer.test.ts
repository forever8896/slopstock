import { test, expect } from "bun:test";
import { SNAPSHOT_TEXT_KEY, buildPointerRecords } from "./snapshot-pointer.ts";

test("snapshot pointer uses the agent-snapshot text key", () => {
  expect(SNAPSHOT_TEXT_KEY).toBe("agent-snapshot");
});

test("buildPointerRecords produces a single text record for the blobId", () => {
  const recs = buildPointerRecords("abc123blob");
  expect(recs).toEqual([{ key: "agent-snapshot", value: "abc123blob" }]);
});
