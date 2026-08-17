import type { CSSProperties } from "react"

import { createComponentImplementation } from "@a2ui/react/v0_9"
import { TextApi } from "@a2ui/web_core/v0_9/basic_catalog"

import { cn } from "@/lib/utils"
import { useMarkdown } from "../use-markdown"
import { weightStyle } from "../utils"

const VARIANT_CLASSES: Record<string, string> = {
  h1: "font-heading text-3xl font-semibold tracking-tight",
  h2: "font-heading text-2xl font-semibold tracking-tight",
  h3: "font-heading text-xl font-semibold",
  h4: "font-heading text-lg font-medium",
  h5: "font-heading text-base font-medium",
  caption: "text-xs text-muted-foreground",
}

const MARKDOWN_CLASSES = cn(
  "min-w-0 text-sm leading-relaxed",
  "[&_a]:underline [&_a]:underline-offset-3",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs",
  "[&_ol]:list-decimal [&_ol]:pl-5 [&_p:not(:last-child)]:mb-2 [&_ul]:list-disc [&_ul]:pl-5"
)

function MarkdownText({ text, style }: { text: string; style: CSSProperties }) {
  const html = useMarkdown(text)

  if (html === null) {
    return (
      <div className={MARKDOWN_CLASSES} style={style}>
        {text}
      </div>
    )
  }
  return (
    <div
      className={MARKDOWN_CLASSES}
      style={style}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

export const Text = createComponentImplementation(TextApi, ({ props }) => {
  const text =
    typeof props.text === "string" ? props.text : String(props.text ?? "")
  const style = weightStyle(props.weight)
  const variantClass = props.variant
    ? VARIANT_CLASSES[props.variant]
    : undefined

  if (variantClass) {
    return (
      <div className={cn("min-w-0", variantClass)} style={style}>
        {text}
      </div>
    )
  }
  return <MarkdownText text={text} style={style} />
})
