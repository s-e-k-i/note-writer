"use client";

import { Calendar } from "lucide-react";
import { InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export default function DateInput({ className = "", ...props }: Props) {
  return (
    <span className="relative inline-flex items-center">
      <input
        type="date"
        className={`date-input-custom ${className}`}
        {...props}
      />
      <Calendar
        className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400"
        size={14}
      />
    </span>
  );
}
