import { createChildLogger } from "../logger/index.js";

const log = createChildLogger({ module: "teams" });

import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { FileMailbox } from "./file-mailbox.js";
import { detectBackend, spawnTeammate as spawnTeammateProcess } from "./backend.js";
import type { SpawnConfig } from "./backend.js";
import type { TeammateUIState } from "./progress.js";
import { createProgress, recordToolUse, recordTokens } from "./progress.js";
import { randomVerb } from "../tui/verbs.js";
import type { ConversationManager } from "../conversation/conversation.js";
import { saveTranscript } from "./transcript.js";
import { asErrorString } from "@/utils/index.js";
import { SharedTaskStore } from "./shared-task.js";
import { getNameRegistry } from "./registry.js";

export type TeamMode = "in-process" | "tmux" | "iterm";

// Callback that receives agent events during execution. The team layer uses
// this to update TeammateUIState without depending on the agent/LLM layer.
export type AgentEventCallback = (event: {
  type: string;
  toolName?: string;
  args?: Record<string, unknown>;
  usage?: { inputTokens: number; outputTokens: number };
  text?: string;
}) => void;

export interface Member {
  name: string;
  active: boolean;
  cancel?: () => void;
  mailbox: FileMailbox;
  uiState?: TeammateUIState;
  /** Optional: Conversation manager for the teammate; when set, the transcript is persisted on exit. */
  conversation?: ConversationManager;
  /** Optional: pane / session identifier for the teammate under the tmux/iTerm backend, used to locate it on stop. */
  paneId?: string;
  /** Whether this is an external-process teammate (tmux/iTerm); determines whether shutdown is delivered via the mailbox. */
  external?: boolean;
}

// Runs a teammate's task and returns its final output. Injected so the team
// layer stays decoupled from the LLM/agent layer (and is unit-testable).
// The optional onEvent callback lets the team layer observe agent events
// (tool_use, usage) without coupling to the Agent/LLM types directly.
export type RunAgent = (task: string, onEvent?: AgentEventCallback) => Promise<string>;

export class Team {
  name: string;
  mode: TeamMode;
  members = new Map<string, Member>();
  leadMailbox: FileMailbox;
  private mailboxDir: string;
  private workDir: string;

  constructor(name: string, mode: TeamMode, workDir: string) {
    this.name = name;
    this.mode = mode;
    this.workDir = workDir;
    this.mailboxDir = join(workDir, ".swifty", "teams", name);
    mkdirSync(this.mailboxDir, { recursive: true });
    this.leadMailbox = new FileMailbox(this.mailboxDir, "lead");
  }

  addMember(name: string): Member {
    const mailbox = new FileMailbox(this.mailboxDir, name);
    const member: Member = { name, active: false, mailbox };
    this.members.set(name, member);
    return member;
  }

  // Idle polling interval (in milliseconds). Polls the mailbox for new messages after a teammate completes a turn.
  static readonly IDLE_POLL_INTERVAL_MS = 500;
  // Shutdown prefix: the lead writes a message with this prefix to notify teammates to exit.
  static readonly SHUTDOWN_PREFIX = "[shutdown]";

  /**
   * Spawns a teammate, dispatching by team backend mode.
   *   - in-process: runs the agent main loop in a background task within this process (idle-poll-continue).
   *   - tmux / iterm: assembles the teammate startup command and delegates to the backend to launch
   *     an independent worker process in a new pane / tab, communicating bidirectionally with the
   *     lead via the shared file-based mailbox.
   * Falls back to in-process when the external backend is unavailable (tmux not installed,
   * non-iTerm environment, etc.) to avoid crashes.
   */
  spawnTeammate(name: string, task: string, runAgent: RunAgent): void {
    if (this.mode === "in-process") {
      this.spawnInProcess(name, task, runAgent);
      return;
    }
    try {
      this.spawnExternal(name, task);
    } catch {
      // Fall back to in-process mode when the external backend fails to launch (missing dependency / unsupported platform)
      this.spawnInProcess(name, task, runAgent);
    }
  }

  /**
   * tmux / iTerm backend: launches the teammate as an independent process in a new pane / tab.
   * The teammate process connects back to the team via the same mailbox directory pointed to
   * by `--team-dir`; task assignments from the lead and idle/result notifications from the
   * worker all land in this directory, keeping both sides in sync.
   */
  private spawnExternal(name: string, task: string): void {
    const member = this.addMember(name);
    member.active = true;

    // Register the name so SendMessage can deliver by name
    getNameRegistry().register(name, name);

    // Progress events for external teammates are not in this process; the UI only reflects their liveness
    member.uiState = {
      name,
      teamName: this.name,
      status: "running",
      progress: createProgress(),
      startTime: Date.now(),
      spinnerVerb: randomVerb(),
    };

    // Teammate entry point mirrors main.tsx: bun runs this repo's entry script with --teammate flags.
    // Flag names align with parseTeammateFlags in teammate.ts: --team-dir/--member-name/--task.
    const entry = process.argv[1] ?? "src/main.tsx";
    const config: SpawnConfig = {
      mode: this.mode,
      command: "bun",
      args: [
        "run",
        entry,
        "--teammate",
        "--team-dir",
        this.mailboxDir,
        "--member-name",
        name,
        "--task",
        task,
      ],
      cwd: this.workDir,
    };

    // Launch the external process and record cancel/paneId on the member for later stop
    const { cancel, paneId } = spawnTeammateProcess(config);
    member.cancel = cancel;
    member.paneId = paneId;
    member.external = true;
  }

  /**
   * Starts an in-process teammate: runs the agent's main loop in the background,
   * sends an idle notification upon completion, and then polls the mailbox for new tasks.
   * Exits the loop upon receiving a shutdown message or being canceled.
   */
  private spawnInProcess(name: string, task: string, runAgent: RunAgent): void {
    const member = this.addMember(name);
    member.active = true;

    // Register the member name in the global name registry so SendMessage can resolve and deliver by name
    getNameRegistry().register(name, name);

    // Create UI state for progress tracking
    const uiState: TeammateUIState = {
      name,
      teamName: this.name,
      status: "running",
      progress: createProgress(),
      startTime: Date.now(),
      spinnerVerb: randomVerb(),
    };
    member.uiState = uiState;

    // Agent event callback: update progress
    const onEvent: AgentEventCallback = (event) => {
      switch (event.type) {
        case "tool_use":
          if (event.toolName && event.args) {
            recordToolUse(uiState.progress, event.toolName, event.args);
          }
          break;
        case "usage":
          if (event.usage) {
            recordTokens(uiState.progress, event.usage.inputTokens, event.usage.outputTokens);
          }
          break;
        case "stream_text":
          if (event.text) {
            uiState.lastMessage = event.text;
          }
          break;
      }
    };

    // Main loop: execute task → idle notification → poll mailbox → resume execution upon receiving new message
    void (async () => {
      let nextPrompt = task;
      let idleReason = "available";
      try {
        while (member.active) {
          // Execute one turn of the agent
          uiState.status = "running";
          const result = await runAgent(nextPrompt, onEvent);
          uiState.lastMessage = result.length > 200 ? result.slice(0, 200) + "..." : result;

          // Send idle notification to the lead
          uiState.status = "idle";
          await this.leadMailbox.send(name, `[idle] ${name} (reason: ${idleReason})`);
          idleReason = "available";

          // Poll mailbox for new messages or shutdown
          const pollResult = await this.waitForNextPromptOrShutdown(member);
          if (pollResult.shutdown) {
            break;
          }
          nextPrompt = pollResult.prompt;
        }

        uiState.status = "completed";
      } catch (err) {
        log.error({ err }, "teams operation failed");
        uiState.status = "failed";
        uiState.lastMessage = asErrorString(err);
        await this.leadMailbox.send(name, `[idle] ${name} (reason: failed)`);
      } finally {
        member.active = false;
        if (uiState.status === "running") {
          uiState.status = "idle";
        }
        // Persist conversation transcript on teammate exit for debugging
        if (member.conversation) {
          try {
            saveTranscript(this.workDir, this.name, name, member.conversation);
          } catch (err) {
            log.error({ err }, "teams operation failed");
            // Best-effort: persistence failure should not block normal exit
          }
        }
      }
    })();
  }

  /**
   * Blocks until there is a new message in the teammate's mailbox.
   * Returns the concatenated prompt or a shutdown flag.
   */

  private async waitForNextPromptOrShutdown(
    member: Member,
  ): Promise<{ prompt: string; shutdown: boolean }> {
    while (member.active) {
      await new Promise((r) => setTimeout(r, Team.IDLE_POLL_INTERVAL_MS));
      const msgs = member.mailbox.receiveSync();
      if (msgs.length === 0) {
        continue;
      }

      // Check for a shutdown request
      const hasShutdown = msgs.some((m) => m.text.trimStart().startsWith(Team.SHUTDOWN_PREFIX));
      if (hasShutdown) {
        return { prompt: "", shutdown: true };
      }

      // Concatenate all messages to form the user prompt for the next turn
      const prompt = msgs.map((m) => `From ${m.from}: ${m.text}`).join("\n\n");
      return {
        prompt: `You have new messages from your team:\n\n${prompt}`,
        shutdown: false,
      };
    }
    return { prompt: "", shutdown: true };
  }

  getMember(name: string): Member | undefined {
    return this.members.get(name);
  }

  async sendMessage(from: string, to: string, content: string): Promise<void> {
    const member = this.members.get(to);
    if (!member) {
      throw new Error(`Member '${to}' not found in team '${this.name}'`);
    }
    await member.mailbox.send(from, content);
  }

  async stopMember(name: string): Promise<void> {
    const member = this.members.get(name);
    if (member) {
      await this.stopOne(member);
    }
  }

  async stopAll(): Promise<void> {
    for (const member of this.members.values()) {
      await this.stopOne(member);
    }
  }

  /**
   * Stops a single teammate: marks it inactive and updates UI state.
   * For external teammates (tmux/iTerm), a shutdown notification is written to their mailbox
   * first to allow graceful exit, followed by cancel as a force-kill fallback;
   * in-process teammates only need cancel.
   */
  private async stopOne(member: Member): Promise<void> {
    member.active = false;
    if (member.uiState?.status === "running") {
      member.uiState.status = "stopped";
    }
    if (member.external) {
      try {
        await member.mailbox.send("lead", `${Team.SHUTDOWN_PREFIX} stop`);
      } catch {
        // best-effort: proceed to cancel fallback even if the shutdown write fails
      }
    }
    member.cancel?.();
  }

  listMembers(): Member[] {
    return [...this.members.values()];
  }

  getTeammateStates(): TeammateUIState[] {
    return (
      this.listMembers()
        .filter((m) => m.uiState)
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        .map((m) => m.uiState!)
    );
  }
}

export class TeamManager {
  private teams = new Map<string, Team>();
  private workDir: string;
  // One shared task store per team, persisted at <team-dir>/tasks.json
  private taskStores = new Map<string, SharedTaskStore>();

  constructor(workDir: string) {
    this.workDir = workDir;
  }

  private teamDir(name: string): string {
    return join(this.workDir, ".swifty", "teams", name);
  }
  
  create(name: string, mode: TeamMode = detectBackend()): Team {
    const team = new Team(name, mode, this.workDir);
    this.teams.set(name, team);
    // Initialize an empty shared task store when creating a new team
    const store = new SharedTaskStore(join(this.teamDir(name), "tasks.json"));
    store.initEmpty();
    this.taskStores.set(name, store);
    return team;
  }

  get(name: string): Team | undefined {
    return this.teams.get(name);
  }
  /** Retrieves the team's shared task store; loads from disk (tasks.json) when not cached in memory (e.g. in a teammate process). */
  getTaskStore(teamName: string): SharedTaskStore {
    const cached = this.taskStores.get(teamName);
    if (cached) {
      return cached;
    }
    const store = new SharedTaskStore(join(this.teamDir(teamName), "tasks.json"));
    this.taskStores.set(teamName, store);
    return store;
  }

  list(): Team[] {
    return [...this.teams.values()];
  }

  async delete(name: string): Promise<void> {
    const team = this.teams.get(name);
    if (team) {
      // Unregister this team's members from the global name registry
      const registry = getNameRegistry();
      for (const member of team.listMembers()) {
        registry.unregister(member.name);
      }
      await team.stopAll();
      this.teams.delete(name);
    }
    this.taskStores.delete(name);
  }

  getAllTeammateStates(): TeammateUIState[] {
    return this.list().flatMap((t) => t.getTeammateStates());
  }

  /**
   * Reads all unread messages from the team lead's mailbox and returns them in XML tag format.
   * This allows the model to parse team notifications in a structured manner.
   */
  drainLeads(): string[] {
    const out: string[] = [];
    for (const team of this.teams.values()) {
      const msgs = team.leadMailbox.receiveSync();
      if (msgs.length === 0) {
        continue;
      }
      const lines: string[] = [];
      lines.push(`<task-notification team="${team.name}">`);
      for (const msg of msgs) {
        lines.push(`from=${msg.from}: ${msg.text}`);
      }
      lines.push("</task-notification>");
      out.push(lines.join("\n"));
    }
    return out;
  }
}
