import { createComponentImplementation } from "@a2ui/react/v0_9"
import { FileIcon } from "lucide-react"

import {
  Attachment as UIAttachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment"
import { Bubble as UIBubble, BubbleContent } from "@/components/ui/bubble"
import {
  Marker as UIMarker,
  MarkerContent,
  MarkerIcon,
} from "@/components/ui/marker"
import { Message as UIMessage, MessageContent } from "@/components/ui/message"
import {
  MessageScroller as UIMessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import {
  Questionnaire as UIQuestionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireTitle,
} from "@/components/ui/questionnaire"
import { CatalogIcon } from "../components/icon"
import { weightStyle } from "../utils"
import {
  ChildListSchema,
  ComponentIdSchema,
  DynamicStringSchema,
  ICON_NAME,
  WEIGHT,
} from "./common"
import { z } from 'zod/v3'

export const AttachmentApi = {
  name: "Attachment",
  schema: z
    .object({
      ...WEIGHT,
      title: DynamicStringSchema.describe("The attachment file name or title."),
      description: DynamicStringSchema.describe(
        "Secondary text such as size or type."
      ).optional(),
      imageUrl: DynamicStringSchema.describe(
        "Optional thumbnail image URL."
      ).optional(),
      icon: ICON_NAME.optional(),
    })
    .strict(),
}

export const Attachment = createComponentImplementation(
  AttachmentApi,
  ({ props }) => (
    <UIAttachment style={weightStyle(props.weight)}>
      <AttachmentMedia variant={props.imageUrl ? "image" : "icon"}>
        {props.imageUrl ? (
          <img src={props.imageUrl} alt="" />
        ) : props.icon ? (
          <CatalogIcon name={props.icon} className="size-4" />
        ) : (
          <FileIcon />
        )}
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{props.title}</AttachmentTitle>
        {props.description && (
          <AttachmentDescription>{props.description}</AttachmentDescription>
        )}
      </AttachmentContent>
    </UIAttachment>
  )
)

export const BubbleApi = {
  name: "Bubble",
  schema: z
    .object({
      ...WEIGHT,
      child: ComponentIdSchema.describe(
        "The ID of the bubble content component."
      ),
      align: z
        .enum(["start", "end"])
        .default("start")
        .describe("'end' renders as a sent message, 'start' as a received one.")
        .optional(),
    })
    .strict(),
}

export const Bubble = createComponentImplementation(
  BubbleApi,
  ({ props, buildChild }) => (
    <UIBubble
      align={props.align === "end" ? "end" : "start"}
      style={weightStyle(props.weight)}
    >
      <BubbleContent>
        {props.child ? buildChild(props.child) : null}
      </BubbleContent>
    </UIBubble>
  )
)

export const MarkerApi = {
  name: "Marker",
  schema: z
    .object({
      ...WEIGHT,
      text: DynamicStringSchema.describe(
        "The marker text, e.g. a date or system note."
      ),
      icon: ICON_NAME.optional(),
      variant: z
        .enum(["default", "separator", "border"])
        .default("default")
        .optional(),
    })
    .strict(),
}

export const Marker = createComponentImplementation(MarkerApi, ({ props }) => (
  <UIMarker
    variant={props.variant ?? "default"}
    style={weightStyle(props.weight)}
  >
    {props.icon && (
      <MarkerIcon>
        <CatalogIcon name={props.icon} className="size-4" />
      </MarkerIcon>
    )}
    <MarkerContent>{props.text}</MarkerContent>
  </UIMarker>
))

export const MessageApi = {
  name: "Message",
  schema: z
    .object({
      ...WEIGHT,
      child: ComponentIdSchema.describe(
        "The ID of the message content component."
      ),
      align: z
        .enum(["start", "end"])
        .default("start")
        .describe("'end' aligns the message to the right (own messages).")
        .optional(),
    })
    .strict(),
}

export const Message = createComponentImplementation(
  MessageApi,
  ({ props, buildChild }) => (
    <UIMessage
      align={props.align === "end" ? "end" : "start"}
      style={weightStyle(props.weight)}
    >
      <MessageContent>
        {props.child ? buildChild(props.child) : null}
      </MessageContent>
    </UIMessage>
  )
)

export const MessageScrollerApi = {
  name: "MessageScroller",
  schema: z
    .object({
      ...WEIGHT,
      children: ChildListSchema.describe(
        "The IDs of the message components, oldest first."
      ),
      height: z
        .number()
        .describe("The viewport height in pixels.")
        .default(320)
        .optional(),
    })
    .strict(),
}

type ChildRef = string | { id: string; basePath: string }

export const MessageScroller = createComponentImplementation(
  MessageScrollerApi,
  ({ props, buildChild }) => {
    const children = (
      Array.isArray(props.children) ? props.children : []
    ) as ChildRef[]

    return (
      <div
        className="w-full"
        style={{ ...weightStyle(props.weight), height: props.height ?? 320 }}
      >
        <MessageScrollerProvider>
          <UIMessageScroller>
            <MessageScrollerViewport>
              <MessageScrollerContent>
                {children.map((ref, i) => (
                  <MessageScrollerItem key={i}>
                    {typeof ref === "string"
                      ? buildChild(ref)
                      : buildChild(ref.id, ref.basePath)}
                  </MessageScrollerItem>
                ))}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton />
          </UIMessageScroller>
        </MessageScrollerProvider>
      </div>
    )
  }
)

export const QuestionnaireApi = {
  name: "Questionnaire",
  schema: z
    .object({
      ...WEIGHT,
      items: z
        .array(
          z.object({
            name: z.string().describe("A unique name for the question."),
            title: DynamicStringSchema.describe("The question text."),
            description: DynamicStringSchema.describe(
              "Optional helper text."
            ).optional(),
            multiple: z
              .boolean()
              .describe("Whether several choices may be selected.")
              .optional(),
            choices: z
              .array(z.object({ label: z.string(), value: z.string() }))
              .min(1),
            value: DynamicStringSchema.describe(
              "The selected value(s) as a comma-separated string; bind to the data model for two-way sync."
            ).optional(),
          })
        )
        .min(1)
        .describe("The questions."),
    })
    .strict(),
}

type QuestionDef = {
  name?: unknown
  title?: unknown
  description?: unknown
  multiple?: unknown
  choices?: unknown
  value?: unknown
  setValue?: (value: string) => void
}
type ChoiceDef = { label?: unknown; value?: unknown }

export const Questionnaire = createComponentImplementation(
  QuestionnaireApi,
  ({ props }) => {
    const items = (
      Array.isArray(props.items) ? props.items : []
    ) as QuestionDef[]

    return (
      <UIQuestionnaire
        style={weightStyle(props.weight)}
        items={items.map((item, i) => ({
          name: String(item.name ?? `question-${i}`),
          choices: ((item.choices ?? []) as ChoiceDef[]).map((c) => ({
            value: String(c.value ?? ""),
          })),
        }))}
      >
        {items.map((item, i) => {
          const name = String(item.name ?? `question-${i}`)
          const selected = String(item.value ?? "")
            .split(",")
            .filter(Boolean)
          const toggle = (value: string, checked: boolean) => {
            const next = item.multiple
              ? checked
                ? [...selected.filter((v) => v !== value), value]
                : selected.filter((v) => v !== value)
              : checked
                ? [value]
                : []
            item.setValue?.(next.join(","))
          }

          return (
            <QuestionnaireItem key={i} name={name} multiple={!!item.multiple}>
              <QuestionnaireTitle>
                {String(item.title ?? "")}
              </QuestionnaireTitle>
              {item.description ? (
                <QuestionnaireDescription>
                  {String(item.description)}
                </QuestionnaireDescription>
              ) : null}
              <QuestionnaireChoices>
                {((item.choices ?? []) as ChoiceDef[]).map((choice, j) => {
                  const value = String(choice.value ?? "")
                  return (
                    <QuestionnaireChoice
                      key={j}
                      value={value}
                      checked={selected.includes(value)}
                      onChange={(e) => toggle(value, e.target.checked)}
                    >
                      {String(choice.label ?? value)}
                    </QuestionnaireChoice>
                  )
                })}
              </QuestionnaireChoices>
            </QuestionnaireItem>
          )
        })}
        <QuestionnaireActions>
          <QuestionnairePrevious />
          <QuestionnaireNext />
        </QuestionnaireActions>
      </UIQuestionnaire>
    )
  }
)
