import VoiceAvatar from "@/components/VoiceAvatar";

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-900 to-black">
      <div className="container mx-auto py-8">
        <header className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Voice Avatar</h1>
          <p className="text-gray-400">
            Real-time voice conversation with AI-powered avatar
          </p>
        </header>

        <VoiceAvatar />

        <footer className="text-center mt-12 text-gray-500 text-sm">
          <p>Powered by Azure VoiceLive + Avatar</p>
        </footer>
      </div>
    </main>
  );
}
