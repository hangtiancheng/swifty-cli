import { RecoveryState } from "../compact/recovery.js";
import { FileHistory } from "../file-history/file-history.js";
import { rebuildFromSession } from "../session/session.js";
import type { SessionMessage } from "../session/session.js";
import { FileStateCache } from "../tools/file-state-cache.js";

import type { RemoteAgentHandle } from "./server.js";

type SessionState = Pick<
  RemoteAgentHandle,
  | "conv"
  | "sessionId"
  | "workDir"
  | "fileHistory"
  | "fileStateCache"
  | "recoveryState"
  | "activeSkills"
  | "toolFilter"
>;

export function restoreRemoteSession(
  state: SessionState,
  sessionId: string,
  saved: SessionMessage[],
) {
  const replay = rebuildFromSession(saved);
  // AgentTool's fork closure holds this conversation object across runs.
  state.conv.reset();
  state.conv.appendMessages(
    replay.map((message) => ({
      ...message,
      toolUses: message.toolUses?.map((tool) => ({ ...tool, arguments: tool.arguments ?? {} })),
    })),
  );
  state.sessionId = sessionId;
  state.fileHistory = new FileHistory(state.workDir, sessionId);
  state.fileStateCache = new FileStateCache();
  state.recoveryState = new RecoveryState();
  state.activeSkills.clear();
  state.toolFilter = null;
  return replay;
}
