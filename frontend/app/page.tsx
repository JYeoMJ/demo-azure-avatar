"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import VoiceAvatar from "@/components/VoiceAvatar";

export default function Home() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <main className="h-screen flex flex-col overflow-hidden">
      {/* Header Bar */}
      <header className="bg-[#002A50] px-6 py-3 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Logo */}
            <Image
              src="/DTT_Logo_removebg.png"
              alt="DTT Logo"
              width={48}
              height={48}
              className="w-12 h-12 object-contain"
            />
            <div>
              <p className="text-xs text-blue-300 uppercase tracking-wider font-medium">
                DTT Engagement Day
              </p>
              <h1 className="text-lg font-bold text-white">
                Digital Think Tank SWAT Team
              </h1>
            </div>
          </div>

          {/* Status Badge */}
          <div className="flex items-center gap-2 bg-white/10 px-4 py-2 rounded-full border border-white/20">
            {mounted && (
              <span className="w-2.5 h-2.5 bg-green-400 rounded-full animate-pulse" />
            )}
            <span className="text-sm text-white font-medium">System Operational</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <VoiceAvatar />
    </main>
  );
}
