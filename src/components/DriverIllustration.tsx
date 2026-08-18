import React from 'react';
// @ts-ignore
import driverMascot from '../assets/images/driver_mascot_1781782355270.jpg';

interface Props {
  className?: string;
  size?: number;
}

export default function DriverIllustration({ className = '', size = 180 }: Props) {
  return (
    <div className={`flex items-center justify-center ${className}`} id="driver-illustration-container">
      <img
        src={driverMascot}
        alt="老板要代驾吗？"
        style={{ width: size, height: size }}
        className="rounded-2xl object-cover shadow-sm border border-slate-100 bg-white"
        referrerPolicy="no-referrer"
        id="driver-mascot-image"
      />
    </div>
  );
}
