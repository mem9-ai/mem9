// @ts-check

import { runHookShim } from "./shared/bootstrap.mjs";

runHookShim("stop.mjs").catch(() => {});
