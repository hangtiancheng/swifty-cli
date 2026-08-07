import { searchDocsModule } from "./search-docs/tool.js";
import type { ToolModule } from "./types.js";

/** All tool modules hosted by this server. Add future modules here. */
export const modules: ToolModule[] = [searchDocsModule];
