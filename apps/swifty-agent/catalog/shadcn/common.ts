import { z } from "zod/v3";

import {
  ActionSchema,
  ChildListSchema,
  ComponentIdSchema,
  DynamicBooleanSchema,
  DynamicNumberSchema,
  DynamicStringSchema,
  DynamicValueSchema,
} from "@a2ui/web_core/v0_9";

export {
  ActionSchema,
  ChildListSchema,
  ComponentIdSchema,
  DynamicBooleanSchema,
  DynamicNumberSchema,
  DynamicStringSchema,
  DynamicValueSchema,
};

// Shared `weight` prop, mirroring the basic catalog's CommonProps.
export const WEIGHT = {
  weight: z
    .number()
    .describe("Relative flex weight when placed inside a Row or Column.")
    .optional(),
};

export const ICON_NAME = z
  .string()
  .describe("An icon name from the basic catalog icon set (e.g. 'info', 'warning', 'search').");

export const OPTION = z.object({
  label: z.string().describe("The human-readable label of the option."),
  value: z.string().describe("The value submitted for the option."),
});

export const MENU_ENTRY = z.object({
  label: DynamicStringSchema.describe("The label of the entry."),
  action: ActionSchema.optional(),
  variant: z.enum(["default", "destructive"]).optional(),
  disabled: z.boolean().optional(),
});
