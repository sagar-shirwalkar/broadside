import { execSync } from "node:child_process";

execSync("buf generate", { stdio: "inherit" });
console.log("✓ Proto generation complete → src/gen/");
