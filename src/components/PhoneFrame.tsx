import React from 'react';

interface PhoneFrameProps {
  children: React.ReactNode;
}

export default function PhoneFrame({ children }: PhoneFrameProps) {
  return (
    <div className="h-full w-full bg-[#111317]/5 flex items-center justify-center p-1 sm:p-3 select-none font-sans antialiased overflow-hidden">
      {/* Outer Sleek Phone Bezel */}
      <div 
        id="phone-frame"
        className="relative w-full max-w-[390px] h-[min(780px,94vh)] bg-black rounded-[40px] sm:rounded-[48px] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.85)] border-4 border-[#334155] flex flex-col overflow-hidden transition-all duration-300"
      >
        
        {/* Main Content Area */}
        <div className="flex-1 bg-[#F7F8FA] flex flex-col relative overflow-hidden">
          {children}
        </div>


      </div>
    </div>
  );
}
