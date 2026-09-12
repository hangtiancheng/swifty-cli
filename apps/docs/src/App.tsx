import { Agents } from "./components/agents";
import { Faq } from "./components/faq";
import { Features } from "./components/features";
import { Footer } from "./components/footer";
import { Hero } from "./components/hero";
import { Install } from "./components/install";
import { Navbar } from "./components/navbar";
import { Providers } from "./components/providers";
import { Safety } from "./components/safety";
import { ScrollProgress } from "./components/scroll-process";
import { TerminalShowcase } from "./components/terminal-showcase";
import { ToolsShowcase } from "./components/tools-showcase";
import { Workflow } from "./components/workflow";
import { cn } from "./lib/cn";
import { DOCS_URL, NPM_URL, REPO_URL } from "./lib/content";
import { page } from "./lib/styles";

function App() {
  return (
    <div className={cn(page)}>
      <ScrollProgress />
      <Navbar repoUrl={REPO_URL} />
      <main>
        <Hero docsUrl={DOCS_URL} />
        <TerminalShowcase />
        <Features />
        <Workflow />
        <ToolsShowcase />
        <Providers />
        <Safety />
        <Agents />
        <Install />
        <Faq />
      </main>
      <Footer repoUrl={REPO_URL} npmUrl={NPM_URL} />
    </div>
  );
}

export default App;
