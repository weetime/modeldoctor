import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ChevronsUpDown } from "lucide-react";
import { type ReactNode, useState } from "react";

export interface ComboboxProps<T> {
  items: T[];
  value: T | null;
  onChange: (v: T | null) => void;
  /** Stable key for React + cmdk filter; must be unique per item. */
  getKey: (item: T) => string;
  /** Plain-text label used for cmdk default filter + trigger fallback. */
  getLabel: (item: T) => string;
  /** Optional rich row renderer; receives the item. Falls back to getLabel. */
  renderItem?: (item: T) => ReactNode;
  /** Optional trigger content when nothing is selected. */
  triggerLabel?: ReactNode;
  /** Fully-custom trigger; overrides default Button. Must accept onClick + ref. */
  trigger?: ReactNode;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Footer slot rendered below the list (e.g. "Manage templates" link). */
  footer?: ReactNode;
  align?: "start" | "center" | "end";
  contentClassName?: string;
  /** Forwarded to the default Button trigger. */
  triggerClassName?: string;
}

export function Combobox<T>({
  items,
  value,
  onChange,
  getKey,
  getLabel,
  renderItem,
  triggerLabel,
  trigger,
  searchPlaceholder,
  emptyText,
  footer,
  align = "start",
  contentClassName,
  triggerClassName,
}: ComboboxProps<T>) {
  const [open, setOpen] = useState(false);

  const defaultTrigger = (
    <Button
      type="button"
      variant="outline"
      role="combobox"
      aria-expanded={open}
      className={cn("justify-between", triggerClassName)}
    >
      <span className="truncate">
        {value !== null ? getLabel(value) : (triggerLabel ?? "")}
      </span>
      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
    </Button>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger ?? defaultTrigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        className={cn("w-[320px] p-0", contentClassName)}
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {items.map((item) => {
              const key = getKey(item);
              return (
                <CommandItem
                  key={key}
                  value={getLabel(item)}
                  onSelect={() => {
                    onChange(item);
                    setOpen(false);
                  }}
                >
                  {renderItem ? renderItem(item) : getLabel(item)}
                </CommandItem>
              );
            })}
          </CommandList>
          {footer ? <div className="border-t p-2">{footer}</div> : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
