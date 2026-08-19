import React from 'react';
import { DRIVER_MASCOT_BASE64 } from '../assets/images/driverImageConstants';

interface Props {
  className?: string;
  size?: number;
}

export default function DriverIllustration({ className = '', size = 180 }: Props) {
  return (
    <div className={`flex items-center justify-center ${className}`} id="driver-illustration-container">
      <img
        src="/t041a040bace9bbe659.jpg"
        onError={(e) => {
          // Robust fallback to local bundled Base64 if relative network fetch fails
          const target = e.currentTarget;
          if (target.src !== DRIVER_MASCOT_BASE64) {
            target.src = DRIVER_MASCOT_BASE64;
          }
        }}
        alt="老板要代驾吗？"
        style={{ width: size, height: size }}
        className="rounded-2xl object-cover shadow-sm border border-slate-100 bg-white"
        referrerPolicy="no-referrer"
        id="driver-mascot-image"
      />
    </div>
  );
}
