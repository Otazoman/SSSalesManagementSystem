import React from "react";
import { DetailItemProps } from "../_types";

export function DetailItem({
  label,
  newVal,
  oldVal,
  isUpdate,
}: DetailItemProps) {
  const displayNew = newVal || "-";
  const displayOld = oldVal || "-";
  const hasChanged = isUpdate && displayNew !== displayOld;

  return (
    <div className="flex flex-col space-y-0.5 border-b pb-1 border-slate-100">
      <span className="text-slate-600 font-semibold text-[10px]">{label}</span>
      {isUpdate ? (
        <div className="flex items-center space-x-2">
          <span
            className="text-slate-600 line-through truncate max-w-[150px]"
            title={displayOld}
          >
            {displayOld}
          </span>
          <span className="text-slate-600 font-normal">➔</span>
          <span
            className={`font-bold ${hasChanged ? "text-indigo-600 bg-indigo-50 px-1 rounded" : "text-slate-800"}`}
          >
            {displayNew}
          </span>
        </div>
      ) : (
        <span className="font-bold text-slate-800">{displayNew}</span>
      )}
    </div>
  );
}
