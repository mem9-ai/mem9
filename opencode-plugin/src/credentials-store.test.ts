import assert from "node:assert/strict";
import test from "node:test";

import {
  parseCredentialsFile,
  stringifyCredentialsFile,
} from "./credentials-store.js";

test("stringifyCredentialsFile writes the on-disk credentials structure", () => {
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

  assert.equal(
    raw,
    `{
  "schemaVersion": 1,
  "profiles": {
    "default": {
      "label": "Personal",
      "baseUrl": "https://api.mem9.ai",
      "apiKey": "mk_test"
    }
  }
}
`,
  );
});

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

test("parseCredentialsFile strips unknown profile fields during round-trip", () => {
  const parsed = parseCredentialsFile(
    JSON.stringify({
      schemaVersion: 1,
      profiles: {
        default: {
          label: "Personal",
          baseUrl: "https://api.mem9.ai",
          apiKey: "mk_test",
          extraField: "ignored",
        },
      },
    }),
  );

  assert.equal(
    stringifyCredentialsFile(parsed),
    `{
  "schemaVersion": 1,
  "profiles": {
    "default": {
      "label": "Personal",
      "baseUrl": "https://api.mem9.ai",
      "apiKey": "mk_test"
    }
  }
}
`,
  );
});

test("parseCredentialsFile throws a unified error for invalid files", () => {
  assert.throws(
    () => {
      parseCredentialsFile("{");
    },
    {
      message: "invalid mem9 credentials file",
    },
  );

  assert.throws(
    () => {
      parseCredentialsFile(
        JSON.stringify({
          schemaVersion: 1,
          profiles: {
            default: {
              label: "Personal",
              apiKey: "mk_test",
            },
          },
        }),
      );
    },
    {
      message: "invalid mem9 credentials file",
    },
  );
});
