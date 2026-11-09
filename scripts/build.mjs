// `npm run build`: type-check, since tsdown strips types without checking them, then build with tsdown.
import { execFileSync } from "node:child_process";
import { build } from "tsdown";

for (const project of [".", "cli"]) execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", project], { stdio: "inherit" });
await build({ logLevel: "warn" });
