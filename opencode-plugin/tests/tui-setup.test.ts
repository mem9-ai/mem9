import assert from "node:assert/strict";
import test from "node:test";
import {
  buildScopeProfileOptions,
  buildSetupActionOptions,
} from "../src/tui/index.js";

test("buildSetupActionOptions shows only API key actions when no usable profile exists", () => {
  const options = buildSetupActionOptions({
    usableProfiles: [],
  });

  assert.deepEqual(
    options,
    [
      {
        title: "Get a mem9 API key automatically",
        value: "auto-api-key",
        description: "Request a new mem9 API key and save it as a profile.",
      },
      {
        title: "Add an existing mem9 API key",
        value: "manual-api-key",
        description: "Paste a mem9 API key and save it as a profile.",
      },
    ],
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
        apiKeyPreview: "mk_d...ault",
      },
    ],
  });

  assert.deepEqual(
    options,
    [
      {
        title: "Get a mem9 API key automatically",
        value: "auto-api-key",
        description: "Request a new mem9 API key and save it as a profile.",
      },
      {
        title: "Add an existing mem9 API key",
        value: "manual-api-key",
        description: "Paste a mem9 API key and save it as a profile.",
      },
      {
        title: "Use an existing mem9 profile in a scope",
        value: "use-profile-in-scope",
        description: "Choose which saved profile user or project settings should use.",
      },
      {
        title: "Adjust scope settings",
        value: "configure-scope",
        description: "Change debug logging, request timeouts, and other mem9 settings for a user or project scope.",
      },
    ],
  );
});

test("buildScopeProfileOptions shows masked API key previews and disables incomplete profiles", () => {
  const options = buildScopeProfileOptions({
    profiles: [
      {
        profileId: "default",
        label: "Personal",
        baseUrl: "https://api.mem9.ai",
        hasApiKey: true,
        apiKeyPreview: "mk_d...ault",
      },
      {
        profileId: "acme",
        label: "Acme Production",
        baseUrl: "https://acme.mem9.ai",
        hasApiKey: false,
        apiKeyPreview: "",
      },
    ],
  }, {
    currentProfileId: "default",
  });

  assert.deepEqual(options, [
    {
      title: "Personal (default)",
      value: "default",
      description: "mk_d...ault | https://api.mem9.ai | Current in this scope",
      disabled: false,
    },
    {
      title: "Acme Production (acme)",
      value: "acme",
      description: "API key missing | https://acme.mem9.ai",
      disabled: true,
    },
  ]);
});
