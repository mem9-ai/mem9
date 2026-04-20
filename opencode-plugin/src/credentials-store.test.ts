import assert from "node:assert/strict";
import test from "node:test";

import {
  parseCredentialsFile,
  stringifyCredentialsFile,
} from "./credentials-store.js";

test("credentials file stores profiles only", () => {
  const raw = stringifyCredentialsFile({
    schemaVersion: 1,
    profiles: {
      default: {
        label: "Personal",
        baseUrl: "https://api.mem9.ai",
        apiKey: "mk_test",
      },
    },
  });

  const parsed = parseCredentialsFile(raw);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.profiles.default.label, "Personal");
  assert.equal(parsed.profiles.default.baseUrl, "https://api.mem9.ai");
});
