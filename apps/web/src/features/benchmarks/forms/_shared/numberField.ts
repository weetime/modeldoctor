import type { ChangeEvent } from "react";
import type { ControllerRenderProps, FieldPath, FieldValues } from "react-hook-form";

/**
 * Spread-friendly props for binding a react-hook-form numeric field to an
 * <Input type="number" />. Implements the blank-string → undefined
 * convention so optional numeric fields don't emit NaN. Required fields
 * still parse via Number(), Zod will surface the "Expected number" error
 * if the field stays empty.
 *
 * Usage:
 *   <FormField name="params.parallel" control={form.control} render={({ field }) => (
 *     <FormItem>
 *       <FormLabel required>Parallel</FormLabel>
 *       <FormControl><Input type="number" {...numberField(field)} /></FormControl>
 *       <FormMessage />
 *     </FormItem>
 *   )} />
 */
export function numberField<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
>(field: ControllerRenderProps<TFieldValues, TName>) {
  return {
    name: field.name,
    onBlur: field.onBlur,
    ref: field.ref,
    value: (field.value as number | undefined) ?? "",
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      field.onChange(raw === "" ? undefined : Number(raw));
    },
  };
}
