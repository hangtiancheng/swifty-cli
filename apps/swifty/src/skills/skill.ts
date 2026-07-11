export interface SkillMeta {
  name: string;
  description: string;
  mode?: "inline" | "fork"; // "inline"
  model?: string;
  forkContext?: "full" | "recent" | "none";
}

export interface Skill {
  meta: SkillMeta;
  body: string;
  sourceDir: string;
  isDirectory: boolean;
}

export interface SkillHost {
  activateSkill(name: string, body: string): void;
}

export interface SkillForkHost extends SkillHost {
  runSubagent(prompt: string): Promise<string>;
  snapshotParentMessages(count: number): string;
}
