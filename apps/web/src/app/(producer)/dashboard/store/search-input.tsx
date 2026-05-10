// search-input.tsx
//
// Search input with a leading lucide-search icon and a trailing "/"
// keyboard-hint chip. The / handler that focuses this input lives on
// <StoreScreen>; we forward the ref so the parent can call .focus().

"use client";

import { forwardRef } from "react";
import { Search } from "lucide-react";

import { KeyboardHintChip } from "./keyboard-hint-chip";

interface SearchInputProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput({ value, onChange, placeholder = "Search products" }, ref) {
    return (
      <label className="relative inline-flex h-9 items-center rounded-[10px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] pl-2.5 pr-1.5 text-[12.5px] focus-within:border-[rgb(var(--border-strong))]">
        <Search size={14} strokeWidth={2.1} className="text-[rgb(var(--fg-muted))]" />
        <input
          ref={ref}
          type="search"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          placeholder={placeholder}
          className="ml-1.5 h-full w-[180px] bg-transparent outline-none placeholder:text-[rgb(var(--fg-faint))]"
        />
        <KeyboardHintChip label="/" />
      </label>
    );
  },
);
