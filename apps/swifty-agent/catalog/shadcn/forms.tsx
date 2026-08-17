import { createComponentImplementation } from "@a2ui/react/v0_9"

import { Calendar as UICalendar } from "@/components/ui/calendar"
import {
  Combobox as UICombobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import {
  Command as UICommand,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Field as UIField,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field"
import {
  InputGroup as UIInputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import {
  NativeSelect as UINativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select"
import {
  Select as UISelect,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch as UISwitch } from "@/components/ui/switch"
import { Toggle as UIToggle } from "@/components/ui/toggle"
import { weightStyle } from "../utils"
import {
  ActionSchema,
  ComponentIdSchema,
  DynamicBooleanSchema,
  DynamicStringSchema,
  OPTION,
  WEIGHT,
} from "./common"
import { z } from 'zod/v3'

type OptionDef = { label?: unknown; value?: unknown }

const toOptions = (raw: unknown): { label: string; value: string }[] =>
  (Array.isArray(raw) ? (raw as OptionDef[]) : []).map((o) => ({
    label: String(o.label ?? ""),
    value: String(o.value ?? ""),
  }))

export const CalendarApi = {
  name: "Calendar",
  schema: z
    .object({
      ...WEIGHT,
      value: DynamicStringSchema.describe(
        "The selected date as YYYY-MM-DD; bind to the data model for two-way sync."
      ).optional(),
    })
    .strict(),
}

export const Calendar = createComponentImplementation(
  CalendarApi,
  ({ props }) => {
    const selected = props.value
      ? new Date(`${String(props.value).slice(0, 10)}T00:00:00`)
      : undefined

    return (
      <div style={weightStyle(props.weight)}>
        <UICalendar
          mode="single"
          selected={selected}
          onSelect={(date) => {
            if (date instanceof Date && !Number.isNaN(date.getTime())) {
              const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
              props.setValue(iso)
            }
          }}
          className="rounded-lg border"
        />
      </div>
    )
  }
)

export const ComboboxApi = {
  name: "Combobox",
  schema: z
    .object({
      ...WEIGHT,
      label: DynamicStringSchema.describe("The field label.").optional(),
      placeholder: z.string().describe("The input placeholder.").optional(),
      options: z.array(OPTION).min(1).describe("The selectable options."),
      value: DynamicStringSchema.describe(
        "The selected option value; bind to the data model for two-way sync."
      ).optional(),
    })
    .strict(),
}

export const Combobox = createComponentImplementation(
  ComboboxApi,
  ({ props }) => {
    const options = toOptions(props.options)
    const labelByValue = new Map(options.map((o) => [o.value, o.label]))
    const valueByLabel = new Map(options.map((o) => [o.label, o.value]))

    return (
      <UIField style={weightStyle(props.weight)}>
        {props.label && <FieldLabel>{props.label}</FieldLabel>}
        <UICombobox
          items={options.map((o) => o.label)}
          value={
            props.value ? (labelByValue.get(String(props.value)) ?? null) : null
          }
          onValueChange={(label) => {
            if (typeof label === "string")
              props.setValue(valueByLabel.get(label) ?? label)
          }}
        >
          <ComboboxInput placeholder={props.placeholder} />
          <ComboboxContent>
            <ComboboxEmpty>No results found.</ComboboxEmpty>
            <ComboboxList>
              {(label: string) => (
                <ComboboxItem key={label} value={label}>
                  {label}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </UICombobox>
      </UIField>
    )
  }
)

export const CommandApi = {
  name: "Command",
  schema: z
    .object({
      ...WEIGHT,
      placeholder: z
        .string()
        .describe("The search input placeholder.")
        .optional(),
      groups: z
        .array(
          z.object({
            heading: z.string().describe("The group heading.").optional(),
            items: z
              .array(
                z.object({
                  label: DynamicStringSchema.describe("The entry label."),
                  action: ActionSchema.optional(),
                })
              )
              .min(1),
          })
        )
        .min(1)
        .describe("The command groups."),
    })
    .strict(),
}

type CommandGroupDef = { heading?: unknown; items?: unknown }
type CommandItemDef = { label?: unknown; action?: unknown }

export const Command = createComponentImplementation(
  CommandApi,
  ({ props }) => {
    const groups = (
      Array.isArray(props.groups) ? props.groups : []
    ) as CommandGroupDef[]

    return (
      <UICommand
        className="w-full rounded-lg border"
        style={weightStyle(props.weight)}
      >
        <CommandInput
          placeholder={props.placeholder ?? "Type a command or search..."}
        />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          {groups.map((group, i) => (
            <CommandGroup
              key={i}
              heading={group.heading ? String(group.heading) : undefined}
            >
              {((group.items ?? []) as CommandItemDef[]).map((item, j) => (
                <CommandItem
                  key={j}
                  onSelect={
                    typeof item.action === "function"
                      ? (item.action as () => void)
                      : undefined
                  }
                >
                  {String(item.label ?? "")}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </UICommand>
    )
  }
)

export const FieldApi = {
  name: "Field",
  schema: z
    .object({
      ...WEIGHT,
      label: DynamicStringSchema.describe("The field label."),
      description: DynamicStringSchema.describe(
        "The field description."
      ).optional(),
      child: ComponentIdSchema.describe(
        "The ID of the field control component."
      ),
      orientation: z
        .enum(["vertical", "horizontal"])
        .default("vertical")
        .optional(),
    })
    .strict(),
}

export const Field = createComponentImplementation(
  FieldApi,
  ({ props, buildChild }) => (
    <UIField
      orientation={
        props.orientation === "horizontal" ? "horizontal" : "vertical"
      }
      style={weightStyle(props.weight)}
    >
      <FieldLabel>{props.label}</FieldLabel>
      {props.child ? buildChild(props.child) : null}
      {props.description && (
        <FieldDescription>{props.description}</FieldDescription>
      )}
    </UIField>
  )
)

export const InputGroupApi = {
  name: "InputGroup",
  schema: z
    .object({
      ...WEIGHT,
      value: DynamicStringSchema.describe(
        "The input value; bind to the data model for two-way sync."
      ).optional(),
      placeholder: z.string().describe("The input placeholder.").optional(),
      prefixText: z
        .string()
        .describe("Static text shown before the input.")
        .optional(),
      suffixText: z
        .string()
        .describe("Static text shown after the input.")
        .optional(),
      buttonLabel: DynamicStringSchema.describe(
        "Label of the trailing button."
      ).optional(),
      action: ActionSchema.describe(
        "Action dispatched by the trailing button."
      ).optional(),
    })
    .strict(),
}

export const InputGroup = createComponentImplementation(
  InputGroupApi,
  ({ props }) => (
    <UIInputGroup style={weightStyle(props.weight)}>
      {props.prefixText && (
        <InputGroupAddon align="inline-start">
          <InputGroupText>{props.prefixText}</InputGroupText>
        </InputGroupAddon>
      )}
      <InputGroupInput
        value={props.value || ""}
        placeholder={props.placeholder}
        onChange={(e) => props.setValue(e.target.value)}
      />
      {(props.suffixText || props.buttonLabel) && (
        <InputGroupAddon align="inline-end">
          {props.suffixText && (
            <InputGroupText>{props.suffixText}</InputGroupText>
          )}
          {props.buttonLabel && (
            <InputGroupButton onClick={props.action}>
              {props.buttonLabel}
            </InputGroupButton>
          )}
        </InputGroupAddon>
      )}
    </UIInputGroup>
  )
)

export const InputOtpApi = {
  name: "InputOtp",
  schema: z
    .object({
      ...WEIGHT,
      length: z
        .number()
        .min(1)
        .max(12)
        .describe("The number of digits.")
        .default(6)
        .optional(),
      value: DynamicStringSchema.describe(
        "The entered code; bind to the data model for two-way sync."
      ).optional(),
      label: DynamicStringSchema.describe("The field label.").optional(),
    })
    .strict(),
}

export const InputOtp = createComponentImplementation(
  InputOtpApi,
  ({ props }) => {
    const length = typeof props.length === "number" ? props.length : 6

    return (
      <UIField style={weightStyle(props.weight)}>
        {props.label && <FieldLabel>{props.label}</FieldLabel>}
        <InputOTP
          maxLength={length}
          value={props.value || ""}
          onChange={(value) => props.setValue(value)}
        >
          <InputOTPGroup>
            {Array.from({ length }, (_, i) => (
              <InputOTPSlot key={i} index={i} />
            ))}
          </InputOTPGroup>
        </InputOTP>
      </UIField>
    )
  }
)

export const NativeSelectApi = {
  name: "NativeSelect",
  schema: z
    .object({
      ...WEIGHT,
      label: DynamicStringSchema.describe("The field label.").optional(),
      options: z.array(OPTION).min(1).describe("The selectable options."),
      value: DynamicStringSchema.describe(
        "The selected option value; bind to the data model for two-way sync."
      ).optional(),
    })
    .strict(),
}

export const NativeSelect = createComponentImplementation(
  NativeSelectApi,
  ({ props }) => (
    <UIField style={weightStyle(props.weight)}>
      {props.label && <FieldLabel>{props.label}</FieldLabel>}
      <UINativeSelect
        value={props.value || ""}
        onChange={(e) => props.setValue(e.target.value)}
      >
        <NativeSelectOption value="" disabled>
          Select an option
        </NativeSelectOption>
        {toOptions(props.options).map((opt, i) => (
          <NativeSelectOption key={i} value={opt.value}>
            {opt.label}
          </NativeSelectOption>
        ))}
      </UINativeSelect>
    </UIField>
  )
)

export const SelectApi = {
  name: "Select",
  schema: z
    .object({
      ...WEIGHT,
      label: DynamicStringSchema.describe("The field label.").optional(),
      placeholder: z
        .string()
        .describe("The placeholder shown when nothing is selected.")
        .optional(),
      options: z.array(OPTION).min(1).describe("The selectable options."),
      value: DynamicStringSchema.describe(
        "The selected option value; bind to the data model for two-way sync."
      ).optional(),
    })
    .strict(),
}

export const Select = createComponentImplementation(SelectApi, ({ props }) => {
  const options = toOptions(props.options)

  return (
    <UIField style={weightStyle(props.weight)}>
      {props.label && <FieldLabel>{props.label}</FieldLabel>}
      <UISelect
        items={options}
        value={props.value || null}
        onValueChange={(value) => {
          if (typeof value === "string") props.setValue(value)
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={props.placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((opt, i) => (
              <SelectItem key={i} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </UISelect>
    </UIField>
  )
})

export const SwitchApi = {
  name: "Switch",
  schema: z
    .object({
      ...WEIGHT,
      label: DynamicStringSchema.describe("The switch label.").optional(),
      value: DynamicBooleanSchema.describe(
        "Whether the switch is on; bind to the data model for two-way sync."
      ).optional(),
    })
    .strict(),
}

export const Switch = createComponentImplementation(SwitchApi, ({ props }) => (
  <UIField orientation="horizontal" style={weightStyle(props.weight)}>
    <UISwitch
      checked={!!props.value}
      onCheckedChange={(checked) => props.setValue(checked === true)}
    />
    {props.label && <FieldLabel>{props.label}</FieldLabel>}
  </UIField>
))

export const ToggleApi = {
  name: "Toggle",
  schema: z
    .object({
      ...WEIGHT,
      text: DynamicStringSchema.describe("The toggle label."),
      value: DynamicBooleanSchema.describe(
        "Whether the toggle is pressed; bind to the data model for two-way sync."
      ).optional(),
      variant: z.enum(["default", "outline"]).default("default").optional(),
    })
    .strict(),
}

export const Toggle = createComponentImplementation(ToggleApi, ({ props }) => (
  <UIToggle
    variant={props.variant === "outline" ? "outline" : "default"}
    pressed={!!props.value}
    onPressedChange={(pressed) => props.setValue(pressed === true)}
    style={weightStyle(props.weight)}
  >
    {props.text}
  </UIToggle>
))
