"use client";

import { useState, useEffect } from "react";
import { Button } from "../../../_shared/ui/Button";
import { R2Item } from "../_types";

interface R2ExplorerModalProps {
  onClose: () => void;
  selectedR2Path: string;
  onSelectPath: (path: string) => void;
  initialPrefix?: string;
}

export function R2ExplorerModal({
  onClose,
  selectedR2Path,
  onSelectPath,
  initialPrefix = "",
}: R2ExplorerModalProps) {
  const [explorerData, setExplorerData] = useState<{
    currentPrefix: string;
    parentPrefix: string | null;
    items: R2Item[];
  } | null>(null);
  const [currentPath, setCurrentPath] = useState(initialPrefix);
  const [explorerLoading, setExplorerLoading] = useState(false);
  const [activeBucket, setActiveBucket] = useState<"system" | "quotes">(
    "system",
  );

  const loadR2Level = async (
    prefix: string,
    bucketType: "system" | "quotes" = activeBucket,
  ) => {
    setExplorerLoading(true);
    try {
      const res = await fetch(
        `/api/mail-settings/r2-explorer?prefix=${encodeURIComponent(prefix)}&bucket=${bucketType}`,
        { credentials: "include" },
      );
      if (res.ok) {
        const data = await res.json();
        setExplorerData(data);
        setCurrentPath(prefix);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setExplorerLoading(false);
    }
  };

  const handleBucketChange = (bucketType: "system" | "quotes") => {
    setActiveBucket(bucketType);
    setCurrentPath("");
    void loadR2Level("", bucketType);
  };

  useEffect(() => {
    void loadR2Level(initialPrefix, activeBucket);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden flex flex-col h-[520px] animate-in fade-in zoom-in-95 duration-150 text-slate-900">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center shrink-0">
          <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
            <span>🗂️</span> R2マルチバケットエクスプローラー
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-600 hover:text-slate-600 font-bold text-sm focus:outline-none cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="flex bg-slate-100 p-1 border-b border-slate-200 gap-1 shrink-0">
          <button
            type="button"
            onClick={() => handleBucketChange("system")}
            className={`flex-1 py-1.5 text-[11px] font-bold rounded-md transition-all cursor-pointer ${
              activeBucket === "system"
                ? "bg-white text-indigo-600 shadow-xs border border-slate-200/60"
                : "text-slate-500 hover:text-slate-800 hover:bg-slate-200/50"
            }`}
          >
            ⚙️ System アセット
          </button>
          <button
            type="button"
            onClick={() => handleBucketChange("quotes")}
            className={`flex-1 py-1.5 text-[11px] font-bold rounded-md transition-all cursor-pointer ${
              activeBucket === "quotes"
                ? "bg-white text-indigo-600 shadow-xs border border-slate-200/60"
                : "text-slate-500 hover:text-slate-800 hover:bg-slate-200/50"
            }`}
          >
            📄 Quotes 見積データ
          </button>
        </div>

        <div className="px-4 py-1.5 bg-slate-50 border-b border-slate-200 text-[10px] font-mono text-slate-500 flex items-center gap-1 truncate shrink-0">
          <span className="text-indigo-500 font-bold">
            [{activeBucket === "system" ? "system" : "my-erp-quotes"}]
          </span>
          <span className="text-slate-600">/</span>
          <span>{currentPath || "(ルート直下)"}</span>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5 bg-slate-50/50">
          {explorerLoading ? (
            <div className="text-center p-12 text-xs text-slate-600 italic animate-pulse">
              読み込み中...
            </div>
          ) : (
            <>
              {explorerData?.parentPrefix !== null &&
                explorerData?.parentPrefix !== undefined && (
                  <button
                    type="button"
                    onClick={() => loadR2Level(explorerData.parentPrefix!)}
                    className="w-full text-left px-3 py-1.5 text-xs text-indigo-600 hover:bg-slate-100 font-bold flex items-center gap-2 rounded-lg cursor-pointer"
                  >
                    <span>⬆️</span> <span>.. (親ディレクトリへ)</span>
                  </button>
                )}

              {explorerData?.items && explorerData.items.length > 0 ? (
                explorerData.items.map((item, idx) => (
                  <div
                    key={idx}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-xs rounded-lg bg-white border border-slate-200/60 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-2 truncate flex-1">
                      <span>{item.type === "folder" ? "📁" : "📄"}</span>
                      <span className="font-medium text-slate-700 truncate">
                        {item.name}
                      </span>
                    </div>
                    {item.type === "folder" ? (
                      <button
                        type="button"
                        onClick={() => loadR2Level(item.path)}
                        className="text-[10px] bg-indigo-50 text-indigo-600 border border-indigo-100 px-2 py-0.5 rounded font-bold cursor-pointer"
                      >
                        開く 📂
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          onSelectPath(item.path);
                          onClose();
                        }}
                        className="text-[10px] bg-emerald-50 text-emerald-600 border border-emerald-100 px-2 py-0.5 rounded font-bold cursor-pointer"
                      >
                        選択 📌
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-center py-12 text-xs text-slate-600 italic">
                  空のディレクトリ
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-between items-center shrink-0">
          <div className="space-y-0.5">
            <label className="block text-[9px] font-bold text-slate-600 uppercase">
              直接指定
            </label>
            <input
              type="text"
              className="border border-slate-300 px-2 py-1 text-[11px] rounded bg-white w-44 font-mono text-slate-700 focus:outline-none focus:border-indigo-500"
              value={selectedR2Path}
              onChange={(e) => onSelectPath(e.target.value)}
            />
          </div>
          <Button onClick={onClose}>閉じる</Button>
        </div>
      </div>
    </div>
  );
}
