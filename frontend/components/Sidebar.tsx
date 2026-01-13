import React from 'react';

const Sidebar = () => {
  return (
    <aside className="w-full lg:w-80 flex-shrink-0 flex flex-col gap-6 p-6 lg:border-r border-slate-200 bg-white h-full overflow-y-auto">
      
      {/* Booth Info */}
      <div className="space-y-3">
        <h2 className="text-lg font-bold text-[#002A50]">Digital Think Tank Booth</h2>
        <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 text-sm text-slate-600 space-y-2">
          <p className="font-medium text-slate-800">Key Objectives:</p>
          <ul className="list-disc pl-4 space-y-1 marker:text-[#F05A22]">
            <li>Assist inpatient wards with patient orientation.</li>
            <li>Gather socioeconomic data efficiently.</li>
            <li>Handle general patient queries autonomously.</li>
          </ul>
        </div>
      </div>

      {/* Project Highlight */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Current Focus</h3>
            <span className="px-2 py-0.5 bg-blue-100 text-blue-800 text-[10px] font-bold rounded">POC</span>
        </div>
        
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
           <div className="h-24 bg-gradient-to-r from-blue-900 to-[#002A50] flex items-center justify-center p-4">
               {/* Abstract decorative element */}
               <div className="text-white text-center opacity-90">
                  <p className="font-bold">Panasonic Collaboration</p>
                  <p className="text-xs text-blue-200">Hardware Integration</p>
               </div>
           </div>
           <div className="p-4">
              <p className="text-xs text-slate-500 leading-relaxed">
                We are testing new bedside assistants that integrate with existing ward infrastructure to reduce nurse call fatigue.
              </p>
           </div>
        </div>
      </div>

       {/* Quick Actions (Mock) */}
      <div className="mt-auto pt-6 border-t border-slate-100">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Settings</h3>
        <div className="space-y-2">
            <button className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 text-slate-700 text-sm transition-colors group">
                <span>Avatar Language</span>
                <span className="text-xs font-medium bg-slate-100 group-hover:bg-white px-2 py-1 rounded text-slate-500">English (SG)</span>
            </button>
            <button className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 text-slate-700 text-sm transition-colors group">
                <span>Accessibility</span>
                <span className="text-xs font-medium text-blue-600">On</span>
            </button>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;