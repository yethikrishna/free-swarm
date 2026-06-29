"use client";

import { useState } from "react";
import MyndLabsPromoModal from "./NineRemotePromoModal";

export default function MyndLabsButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all text-text-muted hover:text-text-main hover:bg-black/5 dark:hover:bg-white/5"
        title="MyndLabs"
      >
        <span className="material-symbols-outlined text-[18px]">science</span>
        <span className="text-xs font-medium">About</span>
      </button>

      <MyndLabsPromoModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}
