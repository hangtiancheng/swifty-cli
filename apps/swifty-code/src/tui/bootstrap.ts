// TUI bootstrap: install synchronized output then launch the app
import { installSyncOutput } from "./sync-output.js";
import { launchTUI } from "./index.js";

installSyncOutput();
void launchTUI();
