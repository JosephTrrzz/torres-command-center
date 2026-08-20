"use client";

import {
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

export type BrandSelectOption = {
  value: string;
  label: string;
  description?: string;
};

type BrandSelectProps = {
  value: string;
  options: BrandSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
  className?: string;
  disabled?: boolean;
};

function getInitials(label: string) {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function BrandSelect({
  value,
  options,
  onChange,
  placeholder = "Choose an option",
  label,
  className = "",
  disabled = false,
}: BrandSelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const labelId = useId();
  const listboxId = useId();
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (!open || options.length === 0) return;

    const nextIndex = selectedIndex >= 0 ? selectedIndex : 0;
    setActiveIndex(nextIndex);
    window.requestAnimationFrame(() => optionRefs.current[nextIndex]?.focus());
  }, [open, options.length, selectedIndex]);

  function moveFocus(index: number) {
    if (!options.length) return;

    const nextIndex = (index + options.length) % options.length;
    setActiveIndex(nextIndex);
    window.requestAnimationFrame(() => optionRefs.current[nextIndex]?.focus());
  }

  function closeMenu(refocus = false) {
    setOpen(false);
    if (refocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }

  function chooseOption(index: number) {
    const option = options[index];
    if (!option) return;

    onChange(option.value);
    closeMenu(true);
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      closeMenu(true);
    }
  }

  function handleOptionKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveFocus(0);
    } else if (event.key === "End") {
      event.preventDefault();
      moveFocus(options.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      chooseOption(index);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
    } else if (event.key === "Tab") {
      closeMenu();
    }
  }

  return (
    <div className={`brand-select-field ${className}`.trim()} ref={rootRef}>
      <span className="brand-select-label" id={labelId}>
        {label}
      </span>
      <div className={`brand-select ${open ? "is-open" : ""}`}>
        <button
          aria-controls={listboxId}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={`${label}: ${selectedOption?.label ?? placeholder}`}
          className="brand-select-trigger"
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
          onKeyDown={handleTriggerKeyDown}
          ref={triggerRef}
          type="button"
        >
          <span aria-hidden="true" className="brand-select-mark">
            {selectedOption ? getInitials(selectedOption.label) : "TC"}
          </span>
          <span className="brand-select-value">
            <strong>{selectedOption?.label ?? placeholder}</strong>
            <small>{selectedOption?.description || "Select an option"}</small>
          </span>
          <span aria-hidden="true" className="brand-select-chevron" />
        </button>

        {open ? (
          <div
            aria-labelledby={labelId}
            className="brand-select-menu"
            id={listboxId}
            role="listbox"
          >
            {options.map((option, index) => (
              <button
                aria-selected={option.value === value}
                className={`brand-select-option ${
                  option.value === value ? "is-selected" : ""
                }`}
                key={option.value}
                onClick={() => chooseOption(index)}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                role="option"
                tabIndex={index === activeIndex ? 0 : -1}
                type="button"
              >
                <span aria-hidden="true" className="brand-select-option-mark">
                  {getInitials(option.label)}
                </span>
                <span className="brand-select-option-copy">
                  <strong>{option.label}</strong>
                  {option.description ? <small>{option.description}</small> : null}
                </span>
                <span aria-hidden="true" className="brand-select-option-check">
                  {option.value === value ? "✓" : ""}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
