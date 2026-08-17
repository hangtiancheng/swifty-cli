import { createComponentImplementation } from "@a2ui/react/v0_9"
import { ListApi } from "@a2ui/web_core/v0_9/basic_catalog"

import { cn } from "@/lib/utils"
import { ChildList } from "./child-list"
import { alignClass } from "../utils"

export const List = createComponentImplementation(
  ListApi,
  ({ props, buildChild }) => {
    const horizontal = props.direction === "horizontal"

    return (
      <div
        className={cn(
          "flex gap-3",
          horizontal
            ? "flex-row overflow-x-auto overflow-y-hidden"
            : "flex-col overflow-x-hidden overflow-y-auto",
          alignClass(props.align)
        )}
      >
        <ChildList childList={props.children} buildChild={buildChild} />
      </div>
    )
  }
)
