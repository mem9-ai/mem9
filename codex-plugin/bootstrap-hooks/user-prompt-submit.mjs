// @ts-check

import { runHookShim } from "./shared/bootstrap.mjs";

runHookShim("user-prompt-submit.mjs").catch(() => {});
