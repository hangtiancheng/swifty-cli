import { dirname, join } from "path";
import { defineConfig, type UserConfig } from "rspress/config";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const config: UserConfig = defineConfig({
  root: "./docs",
  outDir: "./out",
  base: "/swifty-cli/",
  title: "Swifty",
  description: "Swifty Docs",
  globalStyles: join(__dirname, "docs", "index.css"),
  themeConfig: {
    nav: [
      { text: "About the Author", link: "https://hangtiancheng.github.io/r" },
      { text: "Homepage", link: "https://hangtiancheng.github.io/h" },
    ],
    sidebar: {
      "/": [
        {
          text: "Swifty 文档",
          items: [
            { text: "Swifty Dev", link: "/swifty" },
            { text: "什么是 Agent", link: "/ch1" },
            { text: "LLM API、对话管理", link: "/ch2" },
            { text: "工具调用", link: "/ch3" },
            { text: "ReAct 和 Agent Loop", link: "/ch4" },
            { text: "System Prompt", link: "/ch5" },
            { text: "权限", link: "/ch6" },
            { text: "MCP", link: "/ch7" },
            { text: "上下文压缩", link: "/ch8" },
            { text: "指令文件、会话持久化、跨会话记忆", link: "/ch9" },
            { text: "Slash Command", link: "/ch10" },
            { text: "Skill", link: "/ch11" },
            { text: "Hook", link: "/ch12" },
            { text: "Subagent", link: "/ch13" },
            { text: "Worktree", link: "/ch14" },
            { text: "Agent Team", link: "/ch15" },
          ],
        },
      ],
    },
    socialLinks: [
      {
        icon: "github",
        mode: "link",
        content: "https://github.com/hangtiancheng/swifty-cli/",
      },
    ],
  },
});

export default config;
