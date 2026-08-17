import { createComponentImplementation } from "@a2ui/react/v0_9";
import { ImageApi } from "@a2ui/web_core/v0_9/basic_catalog";

import { cn } from "@/lib/utils";
import { weightStyle } from "../utils";

const FIT_CLASSES: Record<string, string> = {
  contain: "object-contain",
  cover: "object-cover",
  fill: "object-fill",
  none: "object-none",
  scaleDown: "object-scale-down",
};

const VARIANT_CLASSES: Record<string, string> = {
  icon: "size-6 rounded-md",
  avatar: "size-10 rounded-full object-cover",
  smallFeature: "max-w-24 rounded-lg",
  largeFeature: "max-h-96 rounded-lg",
  header: "h-48 w-full rounded-lg object-cover",
};

export const Image = createComponentImplementation(ImageApi, ({ props }) => {
  return (
    <img
      src={props.url}
      alt={props.description || ""}
      className={cn(
        "block rounded-lg",
        FIT_CLASSES[props.fit ?? "fill"],
        props.variant ? VARIANT_CLASSES[props.variant] : undefined,
      )}
      style={weightStyle(props.weight)}
    />
  );
});
