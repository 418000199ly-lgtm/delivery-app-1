import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Save, PlusCircle, MinusCircle, Plus, Edit3, X } from 'lucide-react';

const START_TIME_OPTIONS = Array.from({ length: 24 }, (_, i) => {
  const h = String(i).padStart(2, '0');
  return `${h}:00`;
});

const END_TIME_OPTIONS = Array.from({ length: 24 }, (_, i) => {
  const h = String(i).padStart(2, '0');
  return `${h}:59`;
});

const YUAN_OPTIONS = Array.from({ length: 121 }, (_, i) => i);
const JIAO_OPTIONS = Array.from({ length: 10 }, (_, i) => i);
const KM_OPTIONS = Array.from({ length: 121 }, (_, i) => i);
const SURCHARGE_KM_OPTIONS = Array.from({ length: 120 }, (_, i) => i + 1); // 1 - 120 公里
const SURCHARGE_YUAN_OPTIONS = Array.from({ length: 121 }, (_, i) => i); // 0 - 120 元
const RETURN_FEE_KM_OPTIONS = Array.from({ length: 121 }, (_, i) => i); // 0 - 120 公里
const RETURN_FEE_YUAN_OPTIONS = Array.from({ length: 121 }, (_, i) => i); // 0 - 120 元
const RETURN_FEE_JIAO_OPTIONS = Array.from({ length: 10 }, (_, i) => i); // 0 - 9 角
const WAITING_MIN_OPTIONS = Array.from({ length: 61 }, (_, i) => i); // 0 - 60 分钟
const WAITING_YUAN_OPTIONS = Array.from({ length: 121 }, (_, i) => i); // 0 - 120 元
import { BillingRules, TimeSlot } from '../types';

interface SmoothWheelColumnProps<T extends string | number> {
  options: T[];
  value: T;
  onChange: (val: T) => void;
  unit?: string;
  label?: string;
}

function SmoothWheelColumn<T extends string | number>({
  options,
  value,
  onChange,
  unit = '',
  label = '',
}: SmoothWheelColumnProps<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);
  const startScrollTopRef = useRef(0);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const ITEM_HEIGHT = 40;

  useEffect(() => {
    const idx = options.indexOf(value);
    if (idx !== -1 && containerRef.current && !isDraggingRef.current) {
      const targetTop = idx * ITEM_HEIGHT;
      if (Math.abs(containerRef.current.scrollTop - targetTop) > 2) {
        containerRef.current.scrollTop = targetTop;
      }
    }
  }, [value, options]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    
    const idx = Math.min(
      options.length - 1,
      Math.max(0, Math.round(container.scrollTop / ITEM_HEIGHT))
    );
    const selected = options[idx];

    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      if (selected !== undefined && selected !== value) {
        onChange(selected);
      }
    }, 40);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    isDraggingRef.current = true;
    startYRef.current = e.clientY;
    startScrollTopRef.current = containerRef.current.scrollTop;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || !containerRef.current) return;
    const dy = e.clientY - startYRef.current;
    containerRef.current.scrollTop = startScrollTopRef.current - dy;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || !containerRef.current) return;
    isDraggingRef.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch (_) {}
    
    if (containerRef.current) {
      const idx = Math.min(
        options.length - 1,
        Math.max(0, Math.round(containerRef.current.scrollTop / ITEM_HEIGHT))
      );
      containerRef.current.scrollTo({
        top: idx * ITEM_HEIGHT,
        behavior: 'smooth'
      });
      if (options[idx] !== undefined) {
        onChange(options[idx]);
      }
    }
  };

  return (
    <div className="flex flex-col h-full relative overflow-hidden select-none">
      {label && (
        <span className="text-center text-[10px] sm:text-xs font-bold text-gray-500 mb-1.5 self-center font-sans whitespace-nowrap">
          {label}
        </span>
      )}
      <div className="flex-1 relative overflow-hidden bg-gray-50/50 rounded-2xl border border-gray-150">
        <div className="absolute top-0 inset-x-0 h-[60px] bg-gradient-to-b from-white via-white/80 to-transparent pointer-events-none z-10" />
        <div className="absolute bottom-0 inset-x-0 h-[60px] bg-gradient-to-t from-white via-white/80 to-transparent pointer-events-none z-10" />

        <div
          ref={containerRef}
          onScroll={handleScroll}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="h-full overflow-y-auto scrollbar-none scroll-smooth snap-y snap-mandatory relative touch-pan-y cursor-grab active:cursor-grabbing"
          style={{
            scrollSnapType: 'y mandatory',
            scrollbarWidth: 'none',
            WebkitOverflowScrolling: 'touch',
            touchAction: 'pan-y',
          }}
        >
          <div className="h-[80px] pointer-events-none" />

          {options.map((option, idx) => {
            const isSelected = option === value;
            return (
              <div
                key={String(option)}
                onClick={() => {
                  onChange(option);
                  if (containerRef.current) {
                    containerRef.current.scrollTo({
                      top: idx * ITEM_HEIGHT,
                      behavior: 'smooth'
                    });
                  }
                }}
                className={`h-[40px] flex items-center justify-center text-xs sm:text-sm font-semibold transition-all duration-150 cursor-pointer snap-center ${
                  isSelected
                    ? 'text-[#4dbfb3] font-bold text-sm sm:text-[16px] scale-105'
                    : 'text-gray-400 opacity-60 scale-95 hover:text-gray-600'
                }`}
              >
                {option}{unit}
              </div>
            );
          })}

          <div className="h-[80px] pointer-events-none" />
        </div>
      </div>
    </div>
  );
}

interface MileageModeViewProps {
  billingRules: BillingRules;
  onSave: (rules: BillingRules) => void;
  onNavigateBack: () => void;
}

export default function MileageModeView({
  billingRules,
  onSave,
  onNavigateBack
}: MileageModeViewProps) {
  // 1. Maintain a list of templates in state, synchronized with localStorage
  const [rulesList, setRulesList] = useState<BillingRules[]>(() => {
    const cached = localStorage.getItem('dd_rules_list');
    if (cached) {
      try {
        const parsed: BillingRules[] = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map(r => r.templateName === '某滴代驾计费模版' ? { ...r, templateName: '滴滴代驾' } : r);
        }
      } catch (_) {}
    }
    
    // Default initial templates matching user's html:
    return [
      {
        templateName: '滴滴代驾',
        slots: [
          { id: '1', startTime: '06:00', endTime: '18:59', startingPrice: 40, includedDistance: 7, unitPricePerKm: 5, distanceInterval: 1, priceIncrease: 5 },
          { id: '2', startTime: '19:00', endTime: '23:59', startingPrice: 40, includedDistance: 7, unitPricePerKm: 5, distanceInterval: 1, priceIncrease: 5 },
          { id: '3', startTime: '00:00', endTime: '05:59', startingPrice: 40, includedDistance: 7, unitPricePerKm: 5, distanceInterval: 1, priceIncrease: 5 },
        ],
        returnFeeStartKm: 0,
        returnFeePerKm: 0,
        returnFeeIntervalKm: 1,
        returnFeeIncreaseYuan: 0,
        freeWaitingTime: 10,
        waitingChargePerMin: 1,
        waitingIntervalMin: 1,
        waitingIncreaseYuan: 1,
      },
      {
        templateName: '某E代驾计费模版',
        slots: [
          { id: '1', startTime: '06:00', endTime: '18:59', startingPrice: 38, includedDistance: 7, unitPricePerKm: 5, distanceInterval: 1, priceIncrease: 5 },
          { id: '2', startTime: '19:00', endTime: '23:59', startingPrice: 38, includedDistance: 7, unitPricePerKm: 5, distanceInterval: 1, priceIncrease: 5 },
          { id: '3', startTime: '00:00', endTime: '05:59', startingPrice: 38, includedDistance: 7, unitPricePerKm: 5, distanceInterval: 1, priceIncrease: 5 },
        ],
        returnFeeStartKm: 0,
        returnFeePerKm: 0,
        returnFeeIntervalKm: 1,
        returnFeeIncreaseYuan: 0,
        freeWaitingTime: 10,
        waitingChargePerMin: 1,
        waitingIntervalMin: 1,
        waitingIncreaseYuan: 1,
      },
      {
        templateName: '某某代驾计费模版',
        slots: [
          { id: '1', startTime: '06:00', endTime: '18:59', startingPrice: 35, includedDistance: 6, unitPricePerKm: 4, distanceInterval: 1, priceIncrease: 4 },
          { id: '2', startTime: '19:00', endTime: '23:45', startingPrice: 35, includedDistance: 6, unitPricePerKm: 4, distanceInterval: 1, priceIncrease: 4 },
          { id: '3', startTime: '00:00', endTime: '05:59', startingPrice: 35, includedDistance: 6, unitPricePerKm: 4, distanceInterval: 1, priceIncrease: 4 },
        ],
        returnFeeStartKm: 0,
        returnFeePerKm: 0,
        returnFeeIntervalKm: 1,
        returnFeeIncreaseYuan: 0,
        freeWaitingTime: 10,
        waitingChargePerMin: 1,
        waitingIntervalMin: 1,
        waitingIncreaseYuan: 1,
      }
    ];
  });

  // Keep rules list in sync on edits
  useEffect(() => {
    localStorage.setItem('dd_rules_list', JSON.stringify(rulesList));
  }, [rulesList]);

  // If a specific template is currently being edited
  const [editingRule, setEditingRule] = useState<BillingRules | null>(null);

  // Prompt / Options menu for clicked billing template
  const [activeActionItem, setActiveActionItem] = useState<BillingRules | null>(null);

  // Modal to add a new rule template
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');

  // Local states for editing form
  const [editTemplateName, setEditTemplateName] = useState('');
  const [editSlots, setEditSlots] = useState<TimeSlot[]>([]);

  // Refs for custom scroll wheel alignment
  const startScrollRef = useRef<HTMLDivElement | null>(null);
  const endScrollRef = useRef<HTMLDivElement | null>(null);

  // Custom vertical-scroll-list states
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);
  const [tempStartTime, setTempStartTime] = useState('06:00');
  const [tempEndTime, setTempEndTime] = useState('18:59');

  useEffect(() => {
    if (showTimePicker) {
      const timer = setTimeout(() => {
        const startIdx = START_TIME_OPTIONS.indexOf(tempStartTime);
        const endIdx = END_TIME_OPTIONS.indexOf(tempEndTime);
        if (startScrollRef.current && startIdx !== -1) {
          startScrollRef.current.scrollTop = startIdx * 40;
        }
        if (endScrollRef.current && endIdx !== -1) {
          endScrollRef.current.scrollTop = endIdx * 40;
        }
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [showTimePicker]);

  const handleStartScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const index = Math.round(container.scrollTop / 40);
    if (index >= 0 && index < START_TIME_OPTIONS.length) {
      const selected = START_TIME_OPTIONS[index];
      if (tempStartTime !== selected) {
        setTempStartTime(selected);
      }
    }
  };

  const handleEndScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const index = Math.round(container.scrollTop / 40);
    if (index >= 0 && index < END_TIME_OPTIONS.length) {
      const selected = END_TIME_OPTIONS[index];
      if (tempEndTime !== selected) {
        setTempEndTime(selected);
      }
    }
  };

  // Price Picker States & Refs
  const yuanScrollRef = useRef<HTMLDivElement | null>(null);
  const jiaoScrollRef = useRef<HTMLDivElement | null>(null);
  const kmScrollRef = useRef<HTMLDivElement | null>(null);

  const [showPricePicker, setShowPricePicker] = useState(false);
  const [pricePickerSlotId, setPricePickerSlotId] = useState<string | null>(null);
  const [tempYuan, setTempYuan] = useState(40);
  const [tempJiao, setTempJiao] = useState(0);
  const [tempKm, setTempKm] = useState(7);

  useEffect(() => {
    if (showPricePicker) {
      const timer = setTimeout(() => {
        if (yuanScrollRef.current) {
          yuanScrollRef.current.scrollTop = tempYuan * 40;
        }
        if (jiaoScrollRef.current) {
          jiaoScrollRef.current.scrollTop = tempJiao * 40;
        }
        if (kmScrollRef.current) {
          kmScrollRef.current.scrollTop = tempKm * 40;
        }
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [showPricePicker]);

  const handleYuanScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const index = Math.round(container.scrollTop / 40);
    if (index >= 0 && index < YUAN_OPTIONS.length) {
      const selected = YUAN_OPTIONS[index];
      if (tempYuan !== selected) {
        setTempYuan(selected);
      }
    }
  };

  const handleJiaoScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const index = Math.round(container.scrollTop / 40);
    if (index >= 0 && index < JIAO_OPTIONS.length) {
      const selected = JIAO_OPTIONS[index];
      if (tempJiao !== selected) {
        setTempJiao(selected);
      }
    }
  };

  const handleKmScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const index = Math.round(container.scrollTop / 40);
    if (index >= 0 && index < KM_OPTIONS.length) {
      const selected = KM_OPTIONS[index];
      if (tempKm !== selected) {
        setTempKm(selected);
      }
    }
  };

  // Surcharge Picker States & Refs
  const surchargeKmScrollRef = useRef<HTMLDivElement | null>(null);
  const surchargeYuanScrollRef = useRef<HTMLDivElement | null>(null);

  const [showSurchargePicker, setShowSurchargePicker] = useState(false);
  const [surchargePickerSlotId, setSurchargePickerSlotId] = useState<string | null>(null);
  const [tempSurchargeKm, setTempSurchargeKm] = useState(1);
  const [tempSurchargeYuan, setTempSurchargeYuan] = useState(5);

  useEffect(() => {
    if (showSurchargePicker) {
      const timer = setTimeout(() => {
        if (surchargeKmScrollRef.current) {
          const idx = SURCHARGE_KM_OPTIONS.indexOf(tempSurchargeKm);
          if (idx !== -1) {
            surchargeKmScrollRef.current.scrollTop = idx * 40;
          }
        }
        if (surchargeYuanScrollRef.current) {
          const idx = SURCHARGE_YUAN_OPTIONS.indexOf(tempSurchargeYuan);
          if (idx !== -1) {
            surchargeYuanScrollRef.current.scrollTop = idx * 40;
          }
        }
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [showSurchargePicker]);

  const handleSurchargeKmScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const index = Math.round(container.scrollTop / 40);
    if (index >= 0 && index < SURCHARGE_KM_OPTIONS.length) {
      const selected = SURCHARGE_KM_OPTIONS[index];
      if (tempSurchargeKm !== selected) {
        setTempSurchargeKm(selected);
      }
    }
  };

  const handleSurchargeYuanScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const index = Math.round(container.scrollTop / 40);
    if (index >= 0 && index < SURCHARGE_YUAN_OPTIONS.length) {
      const selected = SURCHARGE_YUAN_OPTIONS[index];
      if (tempSurchargeYuan !== selected) {
        setTempSurchargeYuan(selected);
      }
    }
  };

  const handleUpdateSurcharge = (id: string, distanceInterval: number, priceIncrease: number) => {
    setEditSlots(editSlots.map(s => {
      if (s.id === id) {
        return { 
          ...s, 
          distanceInterval, 
          priceIncrease,
          unitPricePerKm: Number((priceIncrease / distanceInterval).toFixed(2))
        };
      }
      return s;
    }));
  };

  // Return Fee Picker States & Refs
  const returnFeeStartKmScrollRef = useRef<HTMLDivElement | null>(null);
  const returnFeeIntervalScrollRef = useRef<HTMLDivElement | null>(null);
  const returnFeeYuanScrollRef = useRef<HTMLDivElement | null>(null);
  const returnFeeJiaoScrollRef = useRef<HTMLDivElement | null>(null);

  const [showReturnFeePicker, setShowReturnFeePicker] = useState(false);
  const [tempReturnFeeStartKm, setTempReturnFeeStartKm] = useState(0);
  const [tempReturnFeeIntervalKm, setTempReturnFeeIntervalKm] = useState(1);
  const [tempReturnFeeYuan, setTempReturnFeeYuan] = useState(0);
  const [tempReturnFeeJiao, setTempReturnFeeJiao] = useState(0);

  useEffect(() => {
    if (showReturnFeePicker) {
      const timer = setTimeout(() => {
        if (returnFeeStartKmScrollRef.current) {
          const idx = RETURN_FEE_KM_OPTIONS.indexOf(tempReturnFeeStartKm);
          if (idx !== -1) returnFeeStartKmScrollRef.current.scrollTop = idx * 40;
        }
        if (returnFeeIntervalScrollRef.current) {
          const idx = RETURN_FEE_KM_OPTIONS.indexOf(tempReturnFeeIntervalKm);
          if (idx !== -1) returnFeeIntervalScrollRef.current.scrollTop = idx * 40;
        }
        if (returnFeeYuanScrollRef.current) {
          const idx = RETURN_FEE_YUAN_OPTIONS.indexOf(tempReturnFeeYuan);
          if (idx !== -1) returnFeeYuanScrollRef.current.scrollTop = idx * 40;
        }
        if (returnFeeJiaoScrollRef.current) {
          const idx = RETURN_FEE_JIAO_OPTIONS.indexOf(tempReturnFeeJiao);
          if (idx !== -1) returnFeeJiaoScrollRef.current.scrollTop = idx * 40;
        }
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [showReturnFeePicker]);

  const handleReturnFeeStartKmScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const index = Math.round(container.scrollTop / 40);
    if (index >= 0 && index < RETURN_FEE_KM_OPTIONS.length) {
      const selected = RETURN_FEE_KM_OPTIONS[index];
      if (tempReturnFeeStartKm !== selected) {
        setTempReturnFeeStartKm(selected);
      }
    }
  };

  const handleReturnFeeIntervalScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const index = Math.round(container.scrollTop / 40);
    if (index >= 0 && index < RETURN_FEE_KM_OPTIONS.length) {
      const selected = RETURN_FEE_KM_OPTIONS[index];
      if (tempReturnFeeIntervalKm !== selected) {
        setTempReturnFeeIntervalKm(selected);
      }
    }
  };

  const handleReturnFeeYuanScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const index = Math.round(container.scrollTop / 40);
    if (index >= 0 && index < RETURN_FEE_YUAN_OPTIONS.length) {
      const selected = RETURN_FEE_YUAN_OPTIONS[index];
      if (tempReturnFeeYuan !== selected) {
        setTempReturnFeeYuan(selected);
      }
    }
  };

  const handleReturnFeeJiaoScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const index = Math.round(container.scrollTop / 40);
    if (index >= 0 && index < RETURN_FEE_JIAO_OPTIONS.length) {
      const selected = RETURN_FEE_JIAO_OPTIONS[index];
      if (tempReturnFeeJiao !== selected) {
        setTempReturnFeeJiao(selected);
      }
    }
  };

  // Waiting Fee Picker States & Refs
  const waitingFreeMinsScrollRef = useRef<HTMLDivElement | null>(null);
  const waitingIntervalMinsScrollRef = useRef<HTMLDivElement | null>(null);
  const waitingYuanScrollRef = useRef<HTMLDivElement | null>(null);

  const [showWaitingFeePicker, setShowWaitingFeePicker] = useState(false);
  const [tempFreeWaitingTime, setTempFreeWaitingTime] = useState(10);
  const [tempWaitingIntervalMin, setTempWaitingIntervalMin] = useState(1);
  const [tempWaitingIncreaseYuan, setTempWaitingIncreaseYuan] = useState(1);

  useEffect(() => {
    if (showWaitingFeePicker) {
      const timer = setTimeout(() => {
        if (waitingFreeMinsScrollRef.current) {
          const idx = WAITING_MIN_OPTIONS.indexOf(tempFreeWaitingTime);
          if (idx !== -1) waitingFreeMinsScrollRef.current.scrollTop = idx * 40;
        }
        if (waitingIntervalMinsScrollRef.current) {
          const idx = WAITING_MIN_OPTIONS.indexOf(tempWaitingIntervalMin);
          if (idx !== -1) waitingIntervalMinsScrollRef.current.scrollTop = idx * 40;
        }
        if (waitingYuanScrollRef.current) {
          const idx = WAITING_YUAN_OPTIONS.indexOf(tempWaitingIncreaseYuan);
          if (idx !== -1) waitingYuanScrollRef.current.scrollTop = idx * 40;
        }
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [showWaitingFeePicker]);

  const handleWaitingFreeMinsScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const index = Math.round(container.scrollTop / 40);
    if (index >= 0 && index < WAITING_MIN_OPTIONS.length) {
      const selected = WAITING_MIN_OPTIONS[index];
      if (tempFreeWaitingTime !== selected) {
        setTempFreeWaitingTime(selected);
      }
    }
  };

  const handleWaitingIntervalMinsScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const index = Math.round(container.scrollTop / 40);
    if (index >= 0 && index < WAITING_MIN_OPTIONS.length) {
      const selected = WAITING_MIN_OPTIONS[index];
      if (tempWaitingIntervalMin !== selected) {
        setTempWaitingIntervalMin(selected);
      }
    }
  };

  const handleWaitingYuanScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const index = Math.round(container.scrollTop / 40);
    if (index >= 0 && index < WAITING_YUAN_OPTIONS.length) {
      const selected = WAITING_YUAN_OPTIONS[index];
      if (tempWaitingIncreaseYuan !== selected) {
        setTempWaitingIncreaseYuan(selected);
      }
    }
  };

  const [editReturnFeeStartKm, setEditReturnFeeStartKm] = useState(0);
  const [editReturnFeePerKm, setEditReturnFeePerKm] = useState(0);
  const [editReturnFeeIntervalKm, setEditReturnFeeIntervalKm] = useState(1);
  const [editReturnFeeIncreaseYuan, setEditReturnFeeIncreaseYuan] = useState(0);
  const [editFreeWaitingTime, setEditFreeWaitingTime] = useState(10);
  const [editWaitingChargePerMin, setEditWaitingChargePerMin] = useState(1);
  const [editWaitingIntervalMin, setEditWaitingIntervalMin] = useState(1);
  const [editWaitingIncreaseYuan, setEditWaitingIncreaseYuan] = useState(1);

  // Navigation handlers
  const startEditing = (rule: BillingRules) => {
    setEditingRule(rule);
    setEditTemplateName(rule.templateName);
    setEditSlots(rule.slots.map(s => ({ ...s })));
    setEditReturnFeeStartKm(rule.returnFeeStartKm);
    setEditReturnFeePerKm(rule.returnFeePerKm);
    setEditReturnFeeIntervalKm(rule.returnFeeIntervalKm || 1);
    setEditReturnFeeIncreaseYuan(rule.returnFeeIncreaseYuan ?? rule.returnFeePerKm ?? 0);
    setEditFreeWaitingTime(rule.freeWaitingTime);
    setEditWaitingChargePerMin(rule.waitingChargePerMin);
    setEditWaitingIntervalMin(rule.waitingIntervalMin || 1);
    setEditWaitingIncreaseYuan(rule.waitingIncreaseYuan ?? rule.waitingChargePerMin ?? 1);
  };

  const handleAddNewRule = () => {
    if (!newTemplateName.trim()) {
      alert('请输入模板名称！');
      return;
    }

    // Check if name already exists
    if (rulesList.some(r => r.templateName === newTemplateName.trim())) {
      alert('该名称的模板已存在！');
      return;
    }

    const newRule: BillingRules = {
      templateName: newTemplateName.trim(),
      slots: [
        { id: '1', startTime: '06:00', endTime: '18:59', startingPrice: 40, includedDistance: 7, unitPricePerKm: 5, distanceInterval: 1, priceIncrease: 5 },
        { id: '2', startTime: '19:00', endTime: '23:59', startingPrice: 40, includedDistance: 7, unitPricePerKm: 5, distanceInterval: 1, priceIncrease: 5 },
        { id: '3', startTime: '00:00', endTime: '05:59', startingPrice: 40, includedDistance: 7, unitPricePerKm: 5, distanceInterval: 1, priceIncrease: 5 },
      ],
      returnFeeStartKm: 0,
      returnFeePerKm: 0,
      returnFeeIntervalKm: 1,
      returnFeeIncreaseYuan: 0,
      freeWaitingTime: 10,
      waitingChargePerMin: 1,
      waitingIntervalMin: 1,
      waitingIncreaseYuan: 1,
    };

    const updatedList = [...rulesList, newRule];
    setRulesList(updatedList);
    
    // Automatically select it as active
    onSave(newRule);
    
    // Start editing it
    startEditing(newRule);
    
    // Reset modal
    setNewTemplateName('');
    setShowAddModal(false);
  };

  const saveEditedRule = () => {
    const updatedRule: BillingRules = {
      templateName: editTemplateName,
      slots: editSlots,
      returnFeeStartKm: Number(editReturnFeeStartKm) || 0,
      returnFeePerKm: editReturnFeeIntervalKm > 0 ? Number((editReturnFeeIncreaseYuan / editReturnFeeIntervalKm).toFixed(4)) : Number(editReturnFeePerKm) || 0,
      returnFeeIntervalKm: editReturnFeeIntervalKm,
      returnFeeIncreaseYuan: editReturnFeeIncreaseYuan,
      freeWaitingTime: Number(editFreeWaitingTime) || 10,
      waitingChargePerMin: editWaitingIntervalMin > 0 ? Number((editWaitingIncreaseYuan / editWaitingIntervalMin).toFixed(4)) : Number(editWaitingChargePerMin) || 1,
      waitingIntervalMin: editWaitingIntervalMin,
      waitingIncreaseYuan: editWaitingIncreaseYuan,
    };

    // Replace the rule in rulesList
    const updatedList = rulesList.map(r => r.templateName === editingRule?.templateName ? updatedRule : r);
    setRulesList(updatedList);
    
    // Save live
    onSave(updatedRule);
    setEditingRule(null);
  };

  // Time-slot builders inside editor
  const handleAddSlot = () => {
    const newId = String(editSlots.length + 1);
    const newSlot: TimeSlot = {
      id: newId,
      startTime: '04:00',
      endTime: '05:59',
      startingPrice: 40,
      includedDistance: 7,
      unitPricePerKm: 5,
      distanceInterval: 1,
      priceIncrease: 5
    };
    setEditSlots([...editSlots, newSlot]);
  };

  const handleRemoveSlot = (id: string) => {
    if (editSlots.length <= 1) {
      alert('计费规则必须包含至少一个有效的主时间段！');
      return;
    }
    setEditSlots(editSlots.filter(s => s.id !== id));
  };

  const handleUpdateSlotField = (id: string | null, field: keyof TimeSlot, value: any) => {
    if (!id) return;
    setEditSlots(prev => prev.map(s => {
      if (s.id === id) {
        return { ...s, [field]: value };
      }
      return s;
    }));
  };

  const handleUpdateSlotTimeRange = (id: string | null, startTime: string, endTime: string) => {
    if (!id) return;
    setEditSlots(prev => prev.map(s => {
      if (s.id === id) {
        return { ...s, startTime, endTime };
      }
      return s;
    }));
  };

  const handleUpdatePriceAndDistance = (id: string | null, price: number, distance: number) => {
    if (!id) return;
    setEditSlots(prev => prev.map(s => {
      if (s.id === id) {
        return { ...s, startingPrice: price, includedDistance: distance };
      }
      return s;
    }));
  };

  const handleDeleteRule = (targetRule: BillingRules) => {
    if (rulesList.length <= 1) {
      alert('至少需要保留一个计费模板，无法删除最后一个模板！');
      return;
    }

    const isCurrentlyActive = targetRule.templateName === billingRules.templateName;
    const filteredList = rulesList.filter(r => r.templateName !== targetRule.templateName);
    
    setRulesList(filteredList);

    // If deleting the active template, select another template from the remaining list
    if (isCurrentlyActive) {
      const fallbackRule = filteredList[0];
      onSave(fallbackRule);
      alert(`已删除当前正在使用的计费模板 "${targetRule.templateName}"，系统已自动为您启用 "${fallbackRule.templateName}"。`);
    } else {
      alert(`已成功删除计费模板 "${targetRule.templateName}"。`);
    }

    setActiveActionItem(null);
  };

  // --- RENDERING VIEWS ---

  // Edit Mode Workspace
  if (editingRule) {
    return (
      <div className="flex-1 flex flex-col justify-between h-full bg-slate-50 select-none overflow-hidden text-gray-800">
        
        {/* Editor Head */}
        <header className="sticky top-0 z-50 bg-[#353b50] text-[#ffffff] header-safe-pt pb-1" data-purpose="edit-header">
          <div className="h-12 flex items-center justify-between px-4">
            <button 
              onClick={() => setEditingRule(null)}
              className="p-2 -ml-2"
              data-purpose="edit-back-action"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
              </svg>
            </button>
            <h1 className="text-lg font-normal">设置计费详情</h1>
            <button 
              onClick={saveEditedRule}
              className="text-base font-normal text-[#4dbfb3] active:opacity-60"
              data-purpose="save-rule-action"
            >
              保存
            </button>
          </div>
        </header>

        {/* Form Inputs Area */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          
          {/* Template name modifier */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-xs p-4 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">模板名称</span>
            <input
              type="text"
              value={editTemplateName}
              onChange={(e) => setEditTemplateName(e.target.value)}
              className="w-40 text-right bg-transparent border-b border-dashed border-gray-300 hover:border-gray-400 focus:border-[#4dbfb3] text-sm focus:outline-hidden font-mono font-bold text-gray-800"
            />
          </div>

          {/* Time Slots Area */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs text-gray-400 font-semibold tracking-wide block">起步价时段标准</span>
              <button
                onClick={handleAddSlot}
                className="text-xs text-[#4dbfb3] font-bold hover:underline py-0.5 flex items-center space-x-1"
              >
                <PlusCircle className="w-4 h-4" />
                <span>添加时段</span>
              </button>
            </div>

            <div className="space-y-3">
              {editSlots.map((slot, index) => (
                <div 
                  key={slot.id}
                  className="bg-white border border-gray-100 shadow-xs rounded-2xl p-4 space-y-3 relative"
                >
                  <div className="absolute top-4 left-4 w-5 h-5 rounded-full bg-slate-700 text-white text-[10px] flex items-center justify-center font-bold font-mono">
                    {index + 1}
                  </div>

                  <div className="pl-7 flex items-center justify-between gap-2.5">
                    {/* Time selection */}
                    <button
                      type="button"
                      onClick={() => {
                        setActiveSlotId(slot.id);
                        const startVal = START_TIME_OPTIONS.includes(slot.startTime) ? slot.startTime : '06:00';
                        const endVal = END_TIME_OPTIONS.includes(slot.endTime) ? slot.endTime : '18:59';
                        setTempStartTime(startVal);
                        setTempEndTime(endVal);
                        setShowTimePicker(true);
                      }}
                      className="flex items-center bg-slate-50 border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs text-gray-700 font-mono font-semibold hover:bg-slate-100 transition-all cursor-pointer"
                      title="点击设置时间段"
                    >
                      <span className="w-10 text-center">{slot.startTime}</span>
                      <span className="mx-1 text-gray-300 font-sans">-</span>
                      <span className="w-10 text-center">{slot.endTime}</span>
                    </button>

                    {/* Starting fare / included distance */}
                    <div className="flex items-center space-x-1.5 text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setPricePickerSlotId(slot.id);
                          const val = slot.startingPrice || 0;
                          const yuan = Math.floor(val);
                          const jiao = Math.round((val - yuan) * 10);
                          const km = slot.includedDistance || 0;
                          
                          setTempYuan(yuan >= 0 && yuan <= 120 ? yuan : 40);
                          setTempJiao(jiao >= 0 && jiao <= 9 ? jiao : 0);
                          setTempKm(km >= 0 && km <= 120 ? km : 7);
                          setShowPricePicker(true);
                        }}
                        className="flex items-center bg-slate-50 border border-gray-150 rounded-xl p-1.5 hover:bg-slate-100 transition-all cursor-pointer font-sans"
                        title="点击设置起步价"
                      >
                        <span className="font-mono font-bold text-gray-800">{slot.startingPrice}</span>
                        <span className="text-gray-400 font-semibold px-0.5">元/含</span>
                        <span className="font-mono font-bold text-[#4dbfb3]">{slot.includedDistance}</span>
                        <span className="text-gray-400 font-semibold pl-0.5">公里</span>
                      </button>

                      <button 
                        onClick={() => handleRemoveSlot(slot.id)}
                        className="text-red-500 hover:text-red-600 transition-colors p-1"
                        type="button"
                      >
                        <MinusCircle className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  {/* Pricing per extra km */}
                  <div className="pl-7 pt-2 border-t border-gray-50 flex items-center justify-between text-xs text-gray-400">
                    <span>超出免费里程后</span>
                    <button
                      type="button"
                      onClick={() => {
                        setSurchargePickerSlotId(slot.id);
                        const interval = slot.distanceInterval || 1;
                        const increase = slot.priceIncrease ?? slot.unitPricePerKm ?? 5;
                        setTempSurchargeKm(interval);
                        setTempSurchargeYuan(increase);
                        setShowSurchargePicker(true);
                      }}
                      className="flex items-center space-x-0.5 bg-slate-50 border border-gray-150 rounded-xl px-2 py-1.5 hover:bg-slate-100 transition-all cursor-pointer font-sans"
                      title="点击设置超出里程计费"
                    >
                      <span className="text-gray-400 font-semibold">每</span>
                      <span className="font-mono font-bold text-[#4dbfb3] px-0.5">{slot.distanceInterval || 1}</span>
                      <span className="text-gray-400 font-semibold px-0.5">公里，增加</span>
                      <span className="font-mono font-bold text-gray-800 px-0.5">{slot.priceIncrease ?? slot.unitPricePerKm ?? 5}</span>
                      <span className="text-gray-400 font-semibold">元</span>
                    </button>
                  </div>

                </div>
              ))}
            </div>
          </div>

          {/* Section 2: Return Fee */}
          <div className="space-y-2">
            <span className="text-xs text-gray-400 font-semibold px-1 block tracking-wide">返程加收费用标准</span>
            <button
              id="return-fee-trigger-button"
              type="button"
              onClick={() => {
                setTempReturnFeeStartKm(editReturnFeeStartKm);
                setTempReturnFeeIntervalKm(editReturnFeeIntervalKm);
                const yuan = Math.floor(editReturnFeeIncreaseYuan);
                const jiao = Math.round((editReturnFeeIncreaseYuan - yuan) * 10);
                setTempReturnFeeYuan(yuan);
                setTempReturnFeeJiao(jiao);
                setShowReturnFeePicker(true);
              }}
              className="w-full bg-white rounded-2xl border border-gray-100 shadow-xs p-4 flex flex-col items-center justify-center text-center space-y-1.5 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <span className="text-[11px] text-[#4dbfb3] font-bold block">点击修改返程费设置</span>
              <div className="flex items-center justify-center flex-wrap gap-1 text-xs sm:text-sm font-semibold text-gray-700">
                <span className="text-gray-400">行程超过</span>
                <span className="font-mono font-bold text-gray-800 text-[15px] bg-slate-50 px-1 rounded-sm">{editReturnFeeStartKm}</span>
                <span className="text-gray-400 font-semibold">公里，超出后每</span>
                <span className="font-mono font-bold text-[#4dbfb3] text-[15px] bg-[#eefaf8] px-1 rounded-sm">{editReturnFeeIntervalKm}</span>
                <span className="text-gray-400 font-semibold">公里，增加</span>
                <span className="font-mono font-bold text-gray-800 text-[15px] bg-slate-50 px-1 rounded-sm">
                  {editReturnFeeIncreaseYuan % 1 === 0 ? editReturnFeeIncreaseYuan : editReturnFeeIncreaseYuan.toFixed(1)}
                </span>
                <span className="text-gray-400 font-semibold">元</span>
              </div>
            </button>
          </div>

          {/* Section 3: Waiting Fee */}
          <div className="space-y-2 pb-6">
            <span className="text-xs text-gray-400 font-semibold px-1 block tracking-wide">等候费计算准则</span>
            <button
              id="waiting-fee-trigger-button"
              type="button"
              onClick={() => {
                setTempFreeWaitingTime(editFreeWaitingTime);
                setTempWaitingIntervalMin(editWaitingIntervalMin);
                setTempWaitingIncreaseYuan(editWaitingIncreaseYuan);
                setShowWaitingFeePicker(true);
              }}
              className="w-full bg-white rounded-2xl border border-gray-100 shadow-xs p-4 flex flex-col items-center justify-center text-center space-y-1.5 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <span className="text-[11px] text-[#4dbfb3] font-bold block">点击修改等候费设置</span>
              <div className="flex items-center justify-center flex-wrap gap-1 text-xs sm:text-sm font-semibold text-gray-700">
                <span className="text-gray-400">免费等候</span>
                <span className="font-mono font-bold text-gray-800 text-[15px] bg-slate-50 px-1 rounded-sm">{editFreeWaitingTime}</span>
                <span className="text-gray-400 font-semibold">分钟，超时单价每</span>
                <span className="font-mono font-bold text-[#4dbfb3] text-[15px] bg-[#eefaf8] px-1 rounded-sm">{editWaitingIntervalMin}</span>
                <span className="text-gray-400 font-semibold">分钟，加收</span>
                <span className="font-mono font-bold text-gray-800 text-[15px] bg-slate-50 px-1 rounded-sm">{editWaitingIncreaseYuan}</span>
                <span className="text-gray-400 font-semibold">元</span>
              </div>
            </button>
          </div>

        </div>

        {/* Custom vertical select wheel dialog wrapper */}
        {showTimePicker && activeSlotId && (
          <div 
            className="absolute inset-0 bg-black/60 z-50 flex flex-col justify-end animate-in fade-in duration-200 animate-out fade-out"
            onClick={() => {
              setShowTimePicker(false);
              setActiveSlotId(null);
            }}
          >
            <div 
              className="bg-white rounded-t-[24px] px-4 pt-3 pb-6 flex flex-col space-y-3.5 animate-in slide-in-from-bottom duration-250 cursor-default relative"
              onClick={(e) => e.stopPropagation()}
            >
              <style>{`
                .scrollbar-none::-webkit-scrollbar {
                  display: none !important;
                }
                .scrollbar-none {
                  -ms-overflow-style: none !important;
                  scrollbar-width: none !important;
                }
              `}</style>

              {/* iOS drag handle indicator */}
              <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-1" />
              
              <div className="text-center">
                <p className="text-[16px] font-bold text-gray-800">请设置时间段</p>
                <p className="text-xs text-gray-400 mt-0.5">请上下滑动或轻点选择时间</p>
              </div>

              {/* Grid with vertical scroll columns side by side */}
              <div className="grid grid-cols-2 gap-4 h-[200px] py-1 relative">
                {/* Center selection overlay backdrop frame */}
                <div className="absolute inset-x-0 top-[80px] h-[40px] bg-[#eefaf8]/60 border-y border-[#4dbfb3]/30 pointer-events-none z-10 rounded-xl" />

                <SmoothWheelColumn
                  options={START_TIME_OPTIONS}
                  value={tempStartTime}
                  onChange={setTempStartTime}
                  label="开始时间"
                />

                <SmoothWheelColumn
                  options={END_TIME_OPTIONS}
                  value={tempEndTime}
                  onChange={setTempEndTime}
                  label="结束时间"
                />
              </div>

              {/* Overlay dialog buttons */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowTimePicker(false);
                    setActiveSlotId(null);
                  }}
                  className="flex-1 py-3 text-center text-sm font-semibold text-gray-500 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleUpdateSlotTimeRange(activeSlotId, tempStartTime, tempEndTime);
                    setShowTimePicker(false);
                    setActiveSlotId(null);
                  }}
                  className="flex-1 py-3 text-center text-sm font-bold text-white bg-[#4dbfb3] rounded-xl hover:bg-[#3caea2] transition-colors shadow-xs"
                >
                  确定
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Custom Price Picker Dialog */}
        {showPricePicker && pricePickerSlotId && (
          <div 
            className="absolute inset-0 bg-black/60 z-50 flex flex-col justify-end animate-in fade-in duration-200"
            onClick={() => {
              setShowPricePicker(false);
              setPricePickerSlotId(null);
            }}
          >
            <div 
              className="bg-white rounded-t-[24px] px-4 pt-3 pb-6 flex flex-col space-y-3.5 animate-in slide-in-from-bottom duration-250 cursor-default relative text-gray-800"
              onClick={(e) => e.stopPropagation()}
            >
              {/* iOS drag handle indicator */}
              <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-1" />
              
              <div className="text-center">
                <p className="text-[16px] font-bold text-gray-800">请选择起步价</p>
                <p className="text-xs text-gray-400 mt-0.5">请上下滑动选择元、角、公里</p>
              </div>

              {/* Grid with 3 columns side by side */}
              <div className="grid grid-cols-3 gap-2 h-[200px] py-1 relative">
                {/* Center selection overlay backdrop frame */}
                <div className="absolute inset-x-0 top-[80px] h-[40px] bg-[#eefaf8]/60 border-y border-[#4dbfb3]/30 pointer-events-none z-10 rounded-xl" />

                <SmoothWheelColumn
                  options={YUAN_OPTIONS}
                  value={tempYuan}
                  onChange={setTempYuan}
                  unit="元"
                  label="多少元"
                />

                <SmoothWheelColumn
                  options={JIAO_OPTIONS}
                  value={tempJiao}
                  onChange={setTempJiao}
                  unit="角"
                  label="多少角"
                />

                <SmoothWheelColumn
                  options={KM_OPTIONS}
                  value={tempKm}
                  onChange={setTempKm}
                  unit="公里"
                  label="多少公里"
                />
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowPricePicker(false);
                    setPricePickerSlotId(null);
                  }}
                  className="flex-1 py-3 text-center text-sm font-semibold text-gray-500 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const price = Number((tempYuan + tempJiao / 10).toFixed(1));
                    handleUpdatePriceAndDistance(pricePickerSlotId, price, tempKm);
                    setShowPricePicker(false);
                    setPricePickerSlotId(null);
                  }}
                  className="flex-1 py-3 text-center text-sm font-bold text-white bg-[#4dbfb3] rounded-xl hover:bg-[#3caea2] transition-colors shadow-xs"
                >
                  确定
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Custom Surcharge Picker Dialog */}
        {showSurchargePicker && surchargePickerSlotId && (
          <div 
            className="absolute inset-0 bg-black/60 z-50 flex flex-col justify-end animate-in fade-in duration-200"
            onClick={() => {
              setShowSurchargePicker(false);
              setSurchargePickerSlotId(null);
            }}
          >
            <div 
              className="bg-white rounded-t-[24px] px-4 pt-3 pb-6 flex flex-col space-y-3.5 animate-in slide-in-from-bottom duration-250 cursor-default relative text-gray-800"
              onClick={(e) => e.stopPropagation()}
            >
              {/* iOS drag handle indicator */}
              <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-1" />
              
              <div className="text-center">
                <p className="text-[16px] font-bold text-gray-800 font-sans">请选择超出里程收费增量</p>
                <p className="text-xs text-gray-400 mt-0.5 font-sans">请上下滑动选择公里与增加金额</p>
              </div>

              {/* Grid with 2 columns side by side */}
              <div className="grid grid-cols-2 gap-4 h-[200px] py-1 relative">
                {/* Center selection overlay backdrop frame */}
                <div className="absolute inset-x-0 top-[80px] h-[40px] bg-[#eefaf8]/60 border-y border-[#4dbfb3]/30 pointer-events-none z-10 rounded-xl" />

                <SmoothWheelColumn
                  options={SURCHARGE_KM_OPTIONS}
                  value={tempSurchargeKm}
                  onChange={setTempSurchargeKm}
                  unit="公里"
                  label="每满多少公里"
                />

                <SmoothWheelColumn
                  options={SURCHARGE_YUAN_OPTIONS}
                  value={tempSurchargeYuan}
                  onChange={setTempSurchargeYuan}
                  unit="元"
                  label="增加多少元"
                />
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowSurchargePicker(false);
                    setSurchargePickerSlotId(null);
                  }}
                  className="flex-1 py-3 text-center text-sm font-semibold text-gray-500 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors font-sans"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleUpdateSurcharge(surchargePickerSlotId, tempSurchargeKm, tempSurchargeYuan);
                    setShowSurchargePicker(false);
                    setSurchargePickerSlotId(null);
                  }}
                  className="flex-1 py-3 text-center text-sm font-bold text-white bg-[#4dbfb3] rounded-xl hover:bg-[#3caea2] transition-colors shadow-xs font-sans"
                >
                  确定
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Custom Return Fee Picker Dialog */}
        {showReturnFeePicker && (
          <div 
            id="return-fee-picker-backdrop"
            className="absolute inset-0 bg-black/60 z-50 flex flex-col justify-end animate-in fade-in duration-200"
            onClick={() => {
              setShowReturnFeePicker(false);
            }}
          >
            <div 
              id="return-fee-picker-card"
              className="bg-white rounded-t-[24px] px-4 pt-3 pb-6 flex flex-col space-y-3.5 animate-in slide-in-from-bottom duration-250 cursor-default relative text-gray-800"
              onClick={(e) => e.stopPropagation()}
            >
              {/* iOS drag handle indicator */}
              <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-1" />
              
              <div className="text-center">
                <p className="text-[16px] font-bold text-gray-800 font-sans">请选择返程加收规则</p>
                <p className="text-xs text-gray-400 mt-0.5 font-sans">请上下滑动选择里程参数、增加金额</p>
              </div>

              {/* Grid with 4 columns side by side */}
              <div className="grid grid-cols-4 gap-1 sm:gap-2 h-[200px] py-1 relative">
                {/* Center selection overlay backdrop frame */}
                <div className="absolute inset-x-0 top-[80px] h-[40px] bg-[#eefaf8]/60 border-y border-[#4dbfb3]/30 pointer-events-none z-10 rounded-xl" />

                <SmoothWheelColumn
                  options={RETURN_FEE_KM_OPTIONS}
                  value={tempReturnFeeStartKm}
                  onChange={setTempReturnFeeStartKm}
                  label="行程超(km)"
                />

                <SmoothWheelColumn
                  options={RETURN_FEE_KM_OPTIONS}
                  value={tempReturnFeeIntervalKm}
                  onChange={setTempReturnFeeIntervalKm}
                  label="每超(km)"
                />

                <SmoothWheelColumn
                  options={RETURN_FEE_YUAN_OPTIONS}
                  value={tempReturnFeeYuan}
                  onChange={setTempReturnFeeYuan}
                  label="增加(元)"
                />

                <SmoothWheelColumn
                  options={RETURN_FEE_JIAO_OPTIONS}
                  value={tempReturnFeeJiao}
                  onChange={setTempReturnFeeJiao}
                  label="增加(角)"
                />
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  id="return-fee-cancel-button"
                  type="button"
                  onClick={() => {
                    setShowReturnFeePicker(false);
                  }}
                  className="flex-1 py-3 text-center text-sm font-semibold text-gray-500 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors font-sans"
                >
                  取消
                </button>
                <button
                  id="return-fee-confirm-button"
                  type="button"
                  onClick={() => {
                    setEditReturnFeeStartKm(tempReturnFeeStartKm);
                    setEditReturnFeeIntervalKm(tempReturnFeeIntervalKm);
                    const finalVal = tempReturnFeeYuan + (tempReturnFeeJiao / 10);
                    setEditReturnFeeIncreaseYuan(finalVal);
                    
                    // calculate rate per km
                    const rate = tempReturnFeeIntervalKm > 0 ? (finalVal / tempReturnFeeIntervalKm) : 0;
                    setEditReturnFeePerKm(Number(rate.toFixed(4)));

                    setShowReturnFeePicker(false);
                  }}
                  className="flex-1 py-3 text-center text-sm font-bold text-white bg-[#4dbfb3] rounded-xl hover:bg-[#3caea2] transition-colors shadow-xs font-sans"
                >
                  确定
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Custom Waiting Fee Picker Dialog */}
        {showWaitingFeePicker && (
          <div 
            id="waiting-fee-picker-backdrop"
            className="absolute inset-0 bg-black/60 z-50 flex flex-col justify-end animate-in fade-in duration-200"
            onClick={() => {
              setShowWaitingFeePicker(false);
            }}
          >
            <div 
              id="waiting-fee-picker-card"
              className="bg-white rounded-t-[24px] px-4 pt-3 pb-6 flex flex-col space-y-3.5 animate-in slide-in-from-bottom duration-250 cursor-default relative text-gray-800"
              onClick={(e) => e.stopPropagation()}
            >
              {/* iOS drag handle indicator */}
              <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-1" />
              
              <div className="text-center">
                <p className="text-[16px] font-bold text-gray-800 font-sans">请选择等候计算准则</p>
                <p className="text-xs text-gray-400 mt-0.5 font-sans">请上下滑动选择免费等候时间、超出计费标准</p>
              </div>

              {/* Grid with 3 columns side by side */}
              <div className="grid grid-cols-3 gap-1.5 sm:gap-2.5 h-[200px] py-1 relative">
                {/* Center selection overlay backdrop frame */}
                <div className="absolute inset-x-0 top-[80px] h-[40px] bg-[#eefaf8]/60 border-y border-[#4dbfb3]/30 pointer-events-none z-10 rounded-xl" />

                <SmoothWheelColumn
                  options={WAITING_MIN_OPTIONS}
                  value={tempFreeWaitingTime}
                  onChange={setTempFreeWaitingTime}
                  label="免费等候(分钟)"
                />

                <SmoothWheelColumn
                  options={WAITING_MIN_OPTIONS}
                  value={tempWaitingIntervalMin}
                  onChange={setTempWaitingIntervalMin}
                  label="每满多少分钟"
                />

                <SmoothWheelColumn
                  options={WAITING_YUAN_OPTIONS}
                  value={tempWaitingIncreaseYuan}
                  onChange={setTempWaitingIncreaseYuan}
                  label="加收多少元"
                />
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  id="waiting-fee-cancel-button"
                  type="button"
                  onClick={() => {
                    setShowWaitingFeePicker(false);
                  }}
                  className="flex-1 py-3 text-center text-sm font-semibold text-gray-500 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors font-sans"
                >
                  取消
                </button>
                <button
                  id="waiting-fee-confirm-button"
                  type="button"
                  onClick={() => {
                    setEditFreeWaitingTime(tempFreeWaitingTime);
                    setEditWaitingIntervalMin(tempWaitingIntervalMin);
                    setEditWaitingIncreaseYuan(tempWaitingIncreaseYuan);

                    // recalculate standard waitingChargePerMin rate
                    const finalRate = tempWaitingIntervalMin > 0 ? (tempWaitingIncreaseYuan / tempWaitingIntervalMin) : 0;
                    setEditWaitingChargePerMin(Number(finalRate.toFixed(4)));

                    setShowWaitingFeePicker(false);
                  }}
                  className="flex-1 py-3 text-center text-sm font-bold text-white bg-[#4dbfb3] rounded-xl hover:bg-[#3caea2] transition-colors shadow-xs font-sans"
                >
                  确定
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    );
  }

  // List templates selection mode (Matches provided HTML design spec exactly!)
  return (
    <div className="flex-1 flex flex-col justify-between h-full bg-white select-none overflow-hidden relative">
      
      {/* 2. Top HeaderSection with logo colors */}
      <header className="sticky top-0 z-50 bg-[#353b50] text-[#ffffff] header-safe-pt pb-1" data-purpose="page-navigation">
        
        {/* Title Bar */}
        <div className="h-12 flex items-center justify-between px-4 relative">
          {/* Back Button */}
          <button 
            onClick={onNavigateBack}
            className="p-2 -ml-2" 
            data-purpose="back-action"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
            </svg>
          </button>
          
          {/* Center Title */}
          <h1 className="text-lg font-normal absolute left-1/2 -translate-x-1/2">计费规则</h1>
          
          {/* Right Add Template Action */}
          <button 
            onClick={() => setShowAddModal(true)}
            className="text-base font-normal opacity-90 active:opacity-60 text-[#4dbfb3]" 
            data-purpose="add-rule-action"
          >
            添加规则
          </button>
        </div>
      </header>

      {/* 3. Main Selection Rules List Container */}
      <main className="flex-1 overflow-y-auto bg-white" data-purpose="billing-rules-container">
        {rulesList.map((rule) => {
          const isActive = rule.templateName === billingRules.templateName;
          return (
            <div 
              key={rule.templateName}
              onClick={() => {
                setActiveActionItem(rule);
              }}
              className="flex items-center justify-between px-4 py-4 border-b border-[#f2f2f2] active:bg-gray-50 transition-colors cursor-pointer"
              data-purpose={isActive ? "rule-item-active" : "rule-item-standard"}
            >
              <div className="flex flex-col gap-1">
                <span className="text-[17px] text-gray-800 font-medium">{rule.templateName}</span>
                <span className="text-sm text-[#999999]">里程模式</span>
              </div>
              
              <div className="flex items-center gap-2">
                {isActive ? (
                  <span className="text-[#4dbfb3] text-[15px] font-medium mr-1 animate-pulse">当前使用中</span>
                ) : (
                  <span className="text-xs text-gray-300 font-medium mr-1">点击设置</span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveActionItem(rule);
                  }}
                  className="p-1 text-gray-300 hover:text-gray-500 rounded-lg"
                  title="管理此模板"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                  </svg>
                </button>
              </div>
            </div>
          );
        })}
      </main>

      {/* 4. Safe iOS Bottom Indicator Area */}
      <footer className="h-8 flex justify-center items-end pb-2 bg-white" data-purpose="bottom-safe-area">
        <div className="w-32 h-1 bg-black rounded-full"></div>
      </footer>

      {/* 4.5 Action Sheet containing Modify, Delete and Cancel options */}
      {activeActionItem && (
        <div 
          className="absolute inset-0 bg-black/60 z-50 flex flex-col justify-end animate-in fade-in duration-200"
          onClick={() => setActiveActionItem(null)}
        >
          <div 
            className="bg-gray-100 rounded-t-[24px] px-4 pt-3 pb-6 flex flex-col space-y-2.5 animate-in slide-in-from-bottom duration-250 cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Grab handle identifier */}
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-1.5" />
            
            {/* Title card */}
            <div className="bg-white py-3 px-4 rounded-xl text-center">
              <p className="text-xs text-gray-400 font-semibold mb-0.5">计费规则控制</p>
              <p className="text-sm font-bold text-gray-800 font-sans tracking-wide">{activeActionItem.templateName}</p>
            </div>

            <div className="bg-white rounded-xl divide-y divide-gray-100 shadow-xs overflow-hidden">
              {/* Option: Activate/Enable Template */}
              {activeActionItem.templateName !== billingRules.templateName ? (
                <button
                  onClick={() => {
                    onSave(activeActionItem);
                    setActiveActionItem(null);
                  }}
                  className="w-full py-3.5 text-center text-[15px] font-semibold text-[#4dbfb3] hover:bg-gray-50/50 active:bg-gray-50/80 transition-colors block"
                >
                  启用该模板
                </button>
              ) : (
                <div className="w-full py-3 text-center text-xs font-semibold text-[#1da39b] bg-emerald-50/60">
                  当前已在使用激活状态
                </div>
              )}

              {/* Option: Modify (修改) */}
              <button
                onClick={() => {
                  startEditing(activeActionItem);
                  setActiveActionItem(null);
                }}
                className="w-full py-3.5 text-center text-[15px] font-semibold text-gray-700 hover:bg-gray-50/50 active:bg-gray-50/80 transition-colors block"
              >
                修改
              </button>

              {/* Option: Delete (删除) */}
              <button
                onClick={() => {
                  handleDeleteRule(activeActionItem);
                }}
                className="w-full py-3.5 text-center text-[15px] font-bold text-red-500 hover:bg-gray-50/50 active:bg-gray-50/80 transition-colors block"
              >
                删除
              </button>
            </div>

            {/* Option: Cancel (取消) */}
            <button
              onClick={() => setActiveActionItem(null)}
              className="w-full py-3.5 bg-white text-center text-[15px] font-bold text-gray-500 rounded-xl hover:bg-gray-50/50 active:bg-gray-50 shadow-xs transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 5. Custom Slide-up overlay Modal to Add a New Template Name */}
      {showAddModal && (
        <div className="absolute inset-0 bg-black/60 z-50 flex items-center justify-center p-6 animate-in fade-in duration-250">
          <div className="bg-white rounded-3xl w-full max-w-xs shadow-2xl p-5 space-y-4 animate-in zoom-in-95 duration-250 border border-gray-100">
            <div className="flex items-center justify-between">
              <span className="text-base font-bold text-gray-800">新建计费模板</span>
              <button 
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded-full text-gray-400 hover:bg-gray-150 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="space-y-1">
              <label className="text-xs text-gray-400 font-medium">计费模板名称（支持如"微信快车模板"等）</label>
              <input
                type="text"
                placeholder="请输入新计费模板名称..."
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                maxLength={20}
                className="w-full border border-gray-200 outline-hidden rounded-xl px-3 py-2 text-sm text-gray-800 bg-gray-50 focus:border-[#4dbfb3] focus:bg-white transition-all font-sans font-medium"
                autoFocus
              />
            </div>

            <div className="flex items-center space-x-2 pt-1.5">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 py-2 rounded-xl text-xs font-semibold bg-gray-100 text-gray-500 hover:bg-gray-200 active:scale-95 transition-all"
              >
                取消
              </button>
              <button
                onClick={handleAddNewRule}
                className="flex-1 py-2 rounded-xl text-xs font-bold bg-[#4dbfb3] text-white hover:bg-[#43a89d] active:scale-95 transition-all"
              >
                生成并配置
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
