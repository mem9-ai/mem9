// @ts-check

import { runHookShim } from "./shared/bootstrap.mjs";

runHookShim("session-start.mjs").catch(() => {});
