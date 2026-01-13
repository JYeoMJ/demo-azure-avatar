import VoiceAvatar from "@/components/VoiceAvatar";

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-100">
      {/* Header Bar */}
      <header className="bg-[#002A50] px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Logo */}
            <div className="w-10 h-10 bg-orange-500 rounded-lg flex items-center justify-center">
              <svg
                className="w-6 h-6 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">
                DTT Engagement Day
              </h1>
              <p className="text-sm text-blue-200">
                Digital Think Tank SWAT Team
              </p>
            </div>
          </div>

          {/* Status Badge */}
          <div className="flex items-center gap-2 bg-white/10 px-4 py-2 rounded-full border border-white/20">
            <span className="w-2 h-2 bg-green-400 rounded-full" />
            <span className="text-sm text-white">System Operational</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <VoiceAvatar />
      </div>
    </main>
  );
}
