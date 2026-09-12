import { Agents } from './components/Agents'
import { Faq } from './components/Faq'
import { Features } from './components/Features'
import { Footer } from './components/Footer'
import { Hero } from './components/Hero'
import { Install } from './components/Install'
import { Navbar } from './components/Navbar'
import { Providers } from './components/Providers'
import { Safety } from './components/Safety'
import { ScrollProgress } from './components/ScrollProgress'
import { TerminalShowcase } from './components/TerminalShowcase'
import { ToolsShowcase } from './components/ToolsShowcase'
import { Workflow } from './components/Workflow'
import { cn } from './lib/cn'
import { DOCS_URL, NPM_URL, REPO_URL } from './lib/content'
import { page } from './lib/styles'

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
  )
}

export default App
