"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import VoiceAvatar from "@/components/VoiceAvatar";

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);

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

          <div className="flex items-center gap-3">
            {/* Submit Project Button */}
            <button
              onClick={() => setShowQrModal(true)}
              className="flex items-center gap-2 bg-[#00A3B4] hover:bg-[#008999] px-4 py-2 rounded-full text-white text-sm font-medium transition-all"
            >
              Submit Project
            </button>

            {/* Status Badge */}
            <div className="flex items-center gap-2 bg-white/10 px-4 py-2 rounded-full border border-white/20">
              {mounted && (
                <span className="w-2.5 h-2.5 bg-green-400 rounded-full animate-pulse" />
              )}
              <span className="text-sm text-white font-medium">System Operational</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <VoiceAvatar />

      {/* QR Code Modal */}
      {showQrModal && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center"
          onClick={() => setShowQrModal(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 shadow-2xl max-w-sm mx-4 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold text-[#1E3A5F] mb-4">Submit a Project Request</h2>
            <Image
              src="/qr-code.jpg"
              alt="Scan to submit project request"
              width={250}
              height={250}
              className="mx-auto rounded-lg"
            />
            <p className="text-sm text-gray-600 mt-4">
              Scan with your phone camera
            </p>
            <a
              href="https://for.sg/dttdaproject"
              target="_blank"
              className="text-[#00A3B4] text-sm hover:underline mt-2 block"
            >
              or click here to open form
            </a>
            <button
              onClick={() => setShowQrModal(false)}
              className="mt-4 px-6 py-2 bg-gray-100 hover:bg-gray-200 rounded-full text-sm font-medium transition-all"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
