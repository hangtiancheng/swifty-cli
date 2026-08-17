import { createComponentImplementation } from "@a2ui/react/v0_9"
import { SliderApi } from "@a2ui/web_core/v0_9/basic_catalog"

import { Field, FieldLabel } from "@/components/ui/field"
import { Slider as UISlider } from "@/components/ui/slider"

export const Slider = createComponentImplementation(SliderApi, ({ props }) => {
  const min = props.min ?? 0
  const max = props.max ?? 100
  const value = typeof props.value === "number" ? props.value : min

  return (
    <Field>
      <div className="flex items-center justify-between">
        {props.label && <FieldLabel>{props.label}</FieldLabel>}
        <span className="text-xs text-muted-foreground">{value}</span>
      </div>
      <UISlider
        min={min}
        max={max}
        value={[value]}
        onValueChange={(v) =>
          props.setValue(Array.isArray(v) ? Number(v[0]) : Number(v))
        }
      />
    </Field>
  )
})
