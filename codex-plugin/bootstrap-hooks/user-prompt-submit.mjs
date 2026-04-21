// @ts-check

import { runHookShim } from "./shared/bootstrap.mjs";

runHookShim("user-prompt-submit.mjs").catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
