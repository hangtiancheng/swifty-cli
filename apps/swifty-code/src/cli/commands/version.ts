// CLI version command: print package version
import { version } from "../../version.js";

export function cmdVersion(): void {
  console.log(`swifty ${version}`);
}
