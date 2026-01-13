import React from 'react';

const Header = () => {
  return (
    <header className="h-16 bg-[#002A50] flex items-center px-6 justify-between shadow-md z-20 sticky top-0">
      {/* Brand */}
      <div className="flex items-center gap-3">
        <div className="bg-[#F05A22] rounded-lg p-1.5 shadow-sm">
           <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
           </svg>
        </div>
        <div>
          <h1 className="text-white font-bold text-lg leading-tight">DTT Engagement Day</h1>
          <p className="text-blue-200 text-xs font-light">Digital Think Tank SWAT Team</p>
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-4">
        <div className="hidden md:flex items-center text-xs text-blue-100 gap-2 px-3 py-1 bg-white/10 rounded-full">
           <span className="w-2 h-2 rounded-full bg-green-400"></span>
           System Operational
        </div>
        <button className="text-white/80 hover:text-white transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
        </button>
      </div>
    </header>
  );
};

export default Header;