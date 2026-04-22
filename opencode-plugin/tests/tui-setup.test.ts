import assert from "node:assert/strict";
import test from "node:test";
import { buildSetupActionOptions } from "../src/tui/index.js";

test("buildSetupActionOptions shows only API key actions when no usable profile exists", () => {
  const options = buildSetupActionOptions({
    usableProfiles: [],
  });

  assert.deepEqual(
    options.map((option) => option.value),
    ["auto-api-key", "manual-api-key"],
  );
});

test("buildSetupActionOptions shows scope actions after usable profiles exist", () => {
  const options = buildSetupActionOptions({
    usableProfiles: [
      {
        profileId: "default",
        label: "Personal",
        baseUrl: "https://api.mem9.ai",
        hasApiKey: true,
      },
    ],
  });

  assert.deepEqual(
    options.map((option) => option.value),
    [
      "auto-api-key",
      "manual-api-key",
      "use-profile-in-scope",
      "configure-scope",
    ],
  );
});
